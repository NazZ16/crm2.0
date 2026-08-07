#!/usr/bin/env python3
"""
Maxwork -> teste da API de pesquisa (multi-match-listing-search)

A grelha de resultados de /listing/search é alimentada por
POST /api/Metadata/multi-match-listing-search?page=N&size=M — descoberto
num HAR exportado do DevTools (Network tab) durante uma pesquisa normal.
Essa resposta é JSON estruturado com:
  - o ID real de cada imóvel ("id"), sempre presente mesmo sem foto —
    resolve os imóveis sem URL e os duplicados que a extração atual (via
    regex na foto de capa) não consegue apanhar;
  - totalCount / totalPages exatos, em vez de adivinhar pelo número mais
    alto visível na paginação;
  - muitos campos que hoje só apanhávamos na página de detalhe (área,
    quartos, eficiência energética, ano de construção, contacto do
    agente, ...).

1ª tentativa (chamar a API diretamente com page.request, replicando o
pedido do HAR) deu 401 — a Maxwork autentica os pedidos de API de outra
forma (provavelmente um token ligado ao login Microsoft/Azure AD, não
cookies simples) que não temos como replicar manualmente.

Esta versão usa outra estratégia: em vez de construirmos o pedido nós
próprios, deixamos a PRÓPRIA APP fazer o pedido (como já faz quando
clicamos em "Ver Resultados" — isso sabemos que funciona, é a base de
todo o scraper) e só intercetamos a resposta com
page.expect_response(). Também lemos o CORPO DO PEDIDO que a app envia
quando aplicamos o filtro de preço na UI — assim descobrimos o nome
certo do campo de preço na API sem precisar de adivinhar nem de outro
HAR.

COMO USAR:
    1. Garante que tens MAXWORK_EMAIL/MAXWORK_PASSWORD no .env (já
       deves ter, dos outros scripts)
    2. python maxwork_to_csv_api_test.py
    3. Lê o que aparece no ecrã — não escreve nenhum CSV, é só teste
"""

import json

from playwright.sync_api import sync_playwright

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser
from maxwork_to_csv import ensure_filters_open, run_search
from maxwork_to_csv_bulk import (
    ensure_no_agency_filter,
    ensure_results_loaded,
    PRICE_MIN_SELECTOR,
    PRICE_MAX_SELECTOR,
)

SEARCH_API_PATH_FRAGMENT = "multi-match-listing-search"


def capture_search(page, trigger):
    """Regista a interceção da resposta da API de pesquisa ANTES de
    disparar "trigger" (a ação que a provoca — clicar em "Ver
    Resultados", mudar o tamanho de página, etc.), devolve
    (request_body, response_json) ou (None, None) se não aparecer
    nenhuma dentro do timeout."""
    try:
        with page.expect_response(
            lambda r: SEARCH_API_PATH_FRAGMENT in r.url, timeout=15000
        ) as resp_info:
            trigger()
        response = resp_info.value
    except Exception as e:
        print(f"  [aviso] não apanhei nenhuma resposta da API: {e}")
        return None, None

    print(f"  HTTP {response.status} — {response.url}")
    req_body = None
    try:
        req_body = response.request.post_data_json
    except Exception:
        pass

    if not response.ok:
        print(f"  corpo da resposta: {response.text()[:500]}")
        return req_body, None

    return req_body, response.json()


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")

    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, page = open_session(browser)

        ensure_no_agency_filter(page)
        if not ensure_results_loaded(page):
            context.close()
            browser.close()
            raise SystemExit("A grelha de resultados nunca carregou — corre com HEADLESS=false para ver o que se passa")

        print("\n[teste 1] a intercetar a resposta ao clicar em \"Ver Resultados\" (sem preço)...")
        req_body, data = capture_search(page, lambda: run_search(page))

        if data is None:
            print("  FALHOU — não apanhei uma resposta válida da API.")
        else:
            print(f"  totalCount: {data.get('totalCount')}")
            print(f"  totalPages: {data.get('totalPages')}")
            items = data.get("items") or []
            print(f"  nº items devolvidos: {len(items)}")
            if items:
                print("\n  1º imóvel (todos os campos):")
                print(json.dumps(items[0], indent=2, ensure_ascii=False))
                sem_foto = [it for it in items if not it.get("listingPictureUrl")]
                print(f"\n  imóveis sem foto nesta página (que antes ficavam sem URL): {len(sem_foto)}")

        print("\n[teste 2] a preencher preço 0-200000 e intercetar o pedido/resposta...")
        ensure_filters_open(page)

        def fill_price_and_search():
            page.locator(PRICE_MIN_SELECTOR).fill("0")
            page.locator(PRICE_MAX_SELECTOR).fill("200000")
            run_search(page)

        req_body2, data2 = capture_search(page, fill_price_and_search)

        if req_body2 is not None:
            print("\n  corpo do pedido que a APP enviou (para descobrir o nome do campo de preço):")
            print(json.dumps(req_body2, indent=2, ensure_ascii=False))

        if data2 is None:
            print("\n  FALHOU — não apanhei uma resposta válida da API para a pesquisa com preço.")
        else:
            total_antes = data.get("totalCount") if data else "?"
            print(f"\n  totalCount com preço: {data2.get('totalCount')} (devia ser bem menor que os {total_antes} totais)")

        context.close()
        browser.close()


if __name__ == "__main__":
    main()
