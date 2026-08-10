#!/usr/bin/env python3
"""
Maxwork -> CSV (pesquisa global) via API direta (requests) para as
páginas dentro de cada fatia de preço — variante EXPERIMENTAL de
maxwork_to_csv_bulk.py, ainda por validar numa corrida real.

Reutiliza toda a lógica já comprovada do maxwork_to_csv_bulk.py (login,
SearchWatcher, correlação página+preço, divisão de fatias >10k,
retry de fatia incompleta) — a ÚNICA coisa que muda é COMO se
percorrem as páginas dentro de uma fatia já confirmada abaixo do
limite: em vez de clicar em "seguinte" no browser e esperar o DOM
(SEARCH_PAUSE_MS + render a cada página), pedimos essas páginas
diretamente com `requests`, sem passar pelo browser.

Porque não pedir TUDO diretamente (incluindo a 1ª página de cada
fatia)? Já tentámos (maxwork_to_csv_api_test.py) — dá 401. A Maxwork
autentica via Azure AD/MSAL: o token vive em localStorage e é
injetado pelo JS da app como header Authorization, não é um cookie
simples que dê para replicar à mão. Em vez de reconstruir o corpo do
pedido a adivinhar nomes de campos, deixamos o PRÓPRIO BROWSER
construir e disparar o pedido da página 1 de cada fatia (exatamente
como o resto do pipeline já faz), e REUTILIZAMOS esse corpo exato
(via response.request.post_data_json) e esses headers de autenticação
para pedir as páginas 2..N diretamente — só a paginação (que não muda
o corpo do pedido, só a query string ?page=N) é que passa a ser feita
sem o browser.

Isto significa um pedido ao browser por FATIA de preço (não por
página) — para fatias com muitas páginas (até 100), poupa dezenas de
cliques + esperas de DOM. Para fatias pequenas o ganho é menor.

RISCOS a validar numa corrida real (por isso é um script à parte, não
substitui maxwork_to_csv_bulk.py):
  - O token MSAL pode expirar a meio de uma fatia grande — se um
    pedido direto vier com 401, a fatia é dada como incompleta e o
    mecanismo de retry (herdado de scrape_price_bucket) volta a passar
    pelo browser, o que renova o token. Mas ainda não vimos isto
    acontecer numa corrida real.
  - Pedidos feitos por `requests` têm uma "assinatura" de rede
    diferente de um browser real (TLS/ordem de headers) — pode ser
    bloqueado por proteção anti-bot (Cloudflare) mesmo com os headers
    certos. Se isso acontecer, o resultado esperado é HTTP 403/429 nos
    pedidos diretos — usa maxwork_to_csv_bulk.py nesse caso.

COMO USAR: igual a maxwork_to_csv_bulk.py (mesmo .env). Escreve para
maxwork_imoveis_api.csv (nome diferente de propósito, para não pisar o
resultado já validado de maxwork_to_csv_bulk.py enquanto este não
estiver confirmado a trazer o mesmo total).

    python3 maxwork_api_fetch.py                # corrida completa (0 até sem máximo)
    python3 maxwork_api_fetch.py 0 300000        # só a fatia [preço 0-300 000], para
                                                  # reproduzir mais depressa um problema
                                                  # visto numa fatia específica
"""

import argparse
import time

import requests
from playwright.sync_api import sync_playwright

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser
from maxwork_to_csv_bulk import (
    NO_MAX_PRICE,
    SearchWatcher,
    capture_search,
    ensure_no_agency_filter,
    ensure_results_loaded,
    set_price_range,
    map_api_item_to_row,
    price_label,
    scrape_price_bucket,
    write_csv,
)
from maxwork_to_csv import run_search

OUTPUT_CSV = "maxwork_imoveis_api.csv"
API_URL = "https://app.maxwork.pt/api/Metadata/multi-match-listing-search"
# maxwork_api_size_test.py confirmou size=100/200/300/400 rápidos e
# size=500+ a dar timeout (>30s sem resposta) num pedido isolado — 200
# fica com margem folgada abaixo da parede dos 500, para uma corrida
# real com centenas de pedidos seguidos sob carga variável do
# servidor, em vez de colar ao valor mais alto só testado uma vez.
PAGE_SIZE = 200
REQUEST_SLEEP_S = 0.3  # pausa entre pedidos diretos — mais curta que SEARCH_PAUSE_MS porque não há UI a re-renderizar, mas ainda assim não dispara pedidos em rajada


class FastPageFetcher:
    """Percorre TODAS as páginas de uma fatia via pedidos diretos
    (requests) ao nosso PAGE_SIZE — o browser só entra para disparar
    UM pedido (tamanho de página irrelevante, o corpo do pedido não
    leva o "size", só a query string ?page=N&size=M leva, e essa
    construímos nós) e capturar dele os headers de autenticação e o
    corpo exato a reutilizar. Reautentica sozinho em cada fatia (e em
    cada retry de fatia incompleta, via scrape_price_bucket), o que
    também renova o token se tiver expirado entretanto.

    Importante: a página 1 é sempre pedida por NÓS via requests, nunca
    reaproveitada da resposta que o browser capturou — essa resposta
    pode ter vindo com um tamanho de página diferente (o que a UI
    tiver por omissão), e misturar tamanhos diferentes na mesma
    paginação faria saltar itens (ex.: página 1 com 10 itens do
    browser + página 2 pedida com size=200 saltava os itens 10-199)."""

    def __init__(self):
        self.session = requests.Session()
        self.auth_headers: dict = {}

    def _update_auth(self, headers: dict, cookies: list[dict]):
        self.auth_headers = headers
        for c in cookies:
            self.session.cookies.set(c["name"], c["value"], domain=c.get("domain"))

    def _fetch_page(self, body: dict, page_number: int):
        try:
            resp = self.session.post(
                API_URL,
                params={"page": page_number, "size": PAGE_SIZE},
                json=body,
                headers=self.auth_headers,
                timeout=30,
            )
        except requests.RequestException as e:
            print(f"  [aviso] erro de rede a pedir a página {page_number} via API direta: {e}")
            return None
        if resp.status_code == 401:
            return "unauthorized"
        if not resp.ok:
            print(f"  [aviso] HTTP {resp.status_code} a pedir a página {page_number} via API direta")
            return None
        try:
            return resp.json()
        except Exception:
            print(f"  [aviso] resposta da página {page_number} não é JSON válido")
            return None

    @staticmethod
    def _extract_auth(response) -> tuple[dict, dict]:
        """Extrai (headers, corpo) do PEDIDO que gerou "response" — sem
        disparar nenhum pedido novo."""
        req = response.request
        # Filtra pseudo-headers HTTP/2 (":method", ":authority", ...) e
        # content-length — o requests recalcula este último sozinho a
        # partir do corpo, reenviar o valor capturado podia ficar
        # errado se o corpo mudar de tamanho (não muda aqui, mas não
        # vale a pena arriscar).
        headers = {
            k: v for k, v in response.request.headers.items()
            if not k.startswith(":") and k.lower() != "content-length"
        }
        return headers, req.post_data_json

    def _capture_auth(self, watcher: "SearchWatcher", expected_price):
        """Deixa o browser disparar "Ver Resultados" (a fatia de preço
        já está aplicada — quem chama garante isso) e devolve
        (headers, corpo) do pedido REAL que a app fez. Só usado numa
        repetição (ver fetch_bucket_pages) — na 1ª tentativa reutiliza
        o pedido que scrape_price_bucket já disparou, para não haver
        um 2º clique em "Ver Resultados" por fatia (ver docstring da
        classe)."""
        page = watcher.page
        result = capture_search(
            watcher, lambda: run_search(page),
            expected_page=1, expected_price=expected_price, return_response=True,
        )
        if result is None:
            return None
        _data, response = result
        return self._extract_auth(response)

    def fetch_bucket_pages(
        self,
        watcher: "SearchWatcher",
        label: str,
        min_price: int,
        max_price: int,
        expected_price,
        initial_data: dict | None = None,
        initial_response=None,
    ) -> tuple[list[dict], bool]:
        """Mesma assinatura/contrato de _fetch_bucket_pages (maxwork_to_csv_bulk.py)
        — devolve (linhas, completo) — para poder ser injetada em
        scrape_price_bucket via fetch_leaf, herdando de lá toda a
        lógica de divisão de fatias >10k e retry de fatia incompleta.

        Na 1ª tentativa, initial_response é o response BRUTO do pedido
        que scrape_price_bucket já disparou (com return_response=True)
        para saber o totalCount desta fatia — reaproveitamo-lo para os
        headers/corpo, sem clicar outra vez em "Ver Resultados". Um 2º
        clique por fatia já mostrou, numa corrida real, atropelar o
        preenchimento do preço da fatia SEGUINTE (a app não tinha
        tempo de aplicar o novo filtro a tempo desse clique extra).

        Numa repetição (fatia incompleta na tentativa anterior,
        initial_response é None), reaplica o filtro de preço por
        segurança e dispara um pedido de raiz (_capture_auth)."""
        page = watcher.page
        if initial_response is not None:
            headers, body = self._extract_auth(initial_response)
        else:
            set_price_range(page, min_price, max_price)
            captured = self._capture_auth(watcher, expected_price)
            if captured is None:
                print(f"{label} [aviso] não consegui confirmar o pedido para autenticação")
                return [], False
            headers, body = captured
        self._update_auth(headers, page.context.cookies())

        rows: list[dict] = []
        total_pages = None
        page_num = 0
        while total_pages is None or page_num < total_pages:
            page_num += 1
            result = self._fetch_page(body, page_num)
            if result == "unauthorized":
                print(f"{label} [aviso] pedido direto devolveu 401 (token expirou?) na página {page_num} — a parar aqui")
                return rows, False
            if result is None:
                print(f"{label} [aviso] falhou a apanhar a página {page_num} via API direta")
                return rows, False
            if total_pages is None:
                total_pages = result.get("totalPages") or 1
            page_items = result.get("items", [])
            if not page_items:
                break
            rows.extend(map_api_item_to_row(it) for it in page_items)
            time.sleep(REQUEST_SLEEP_S)

        return rows, True


def parse_args():
    parser = argparse.ArgumentParser(
        description="Maxwork -> CSV via API direta. Sem argumentos, corre a pesquisa "
        "global completa (0 até sem máximo). Passa min/max para testar só UMA fatia "
        "de preço isolada — útil para reproduzir mais depressa um problema visto numa "
        "fatia específica, sem esperar pela divisão recursiva desde o topo."
    )
    parser.add_argument("min_price", type=int, nargs="?", default=0, help="preço mínimo da fatia a testar (omite para 0)")
    parser.add_argument("max_price", type=int, nargs="?", default=NO_MAX_PRICE, help="preço máximo da fatia a testar (omite para sem máximo — corrida completa)")
    return parser.parse_args()


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")

    args = parse_args()
    print("[maxwork] pesquisa global — via API direta (requests) para as páginas dentro de cada fatia [EXPERIMENTAL]")
    if (args.min_price, args.max_price) != (0, NO_MAX_PRICE):
        print(f"[maxwork] a testar só a fatia {price_label(args.min_price, args.max_price)} (não a corrida completa)")

    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, page = open_session(browser)

        ensure_no_agency_filter(page)
        if not ensure_results_loaded(page):
            context.close()
            browser.close()
            raise SystemExit("A grelha de resultados nunca carregou — corre com HEADLESS=false para ver o que se passa")

        watcher = SearchWatcher(page)
        fetcher = FastPageFetcher()
        rows = scrape_price_bucket(watcher, args.min_price, args.max_price, fetch_leaf=fetcher.fetch_bucket_pages)

        context.close()
        browser.close()

    seen = set()
    unique_rows = []
    for row in rows:
        key = row.get("id_interno") or row.get("codigo")
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        unique_rows.append(row)

    write_csv(unique_rows, OUTPUT_CSV)


if __name__ == "__main__":
    main()
