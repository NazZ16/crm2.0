#!/usr/bin/env python3
"""
Maxwork -> CSV (pesquisa global, SEM filtro de agência, via API + fatias de preço)

Variante de maxwork_to_csv.py para quando queres TODOS os imóveis do
Maxwork (todas as agências, sem escolher nenhuma) em vez de percorrer
uma lista de agências.

Em vez de ler os cartões da grelha no ecrã, intercetamos a resposta da
API que alimenta a pesquisa (POST /api/Metadata/multi-match-listing-
search — descoberta num HAR do DevTools, confirmada com
maxwork_to_csv_api_test.py). Isto dá o ID real de cada imóvel, sempre
presente mesmo sem foto — a extração antiga (regex na foto de capa)
deixava ~1559 imóveis sem URL (sem foto) e confundia ~966 grupos de
imóveis diferentes que partilhavam a mesma foto de capa (prédios com
várias frações). Chamar a API diretamente por fora (sem passar pela UI)
dá 401 — a autenticação está ligada ao login Microsoft, não a cookies
simples — por isso continuamos a deixar a UI disparar o pedido (clicar
em "Ver Resultados", mudar de página) e só lemos a resposta.

O Maxwork limita qualquer pesquisa a no máximo 10 000 resultados — um
limite do próprio motor de busca (tipo Elasticsearch), independente de
quantos imóveis existam mesmo (a API diz totalCount ~47 500). Para ir
além disso é preciso dividir a pesquisa em fatias que fiquem cada uma
abaixo do limite — feito automaticamente pelo filtro "Preço Atual"
(Mínimo/Máximo): sempre que uma fatia bate no limite, divide o
intervalo de preço a meio e tenta cada metade separadamente,
recursivamente, até cada fatia ficar abaixo do limite. Agora usamos o
totalCount exato da API para decidir isto, em vez de adivinhar pelo
número de páginas visíveis.

Corre TUDO num único separador, sequencialmente (não em paralelo) —
já tentámos correr 2 pesquisas em simultâneo na mesma conta e deu
resultados errados (o filtro/paginação parece ser guardado por conta,
não por sessão/separador). Correto mas mais lento é melhor do que
rápido e errado.

COMO USAR:
    1. pip install playwright python-dotenv
    2. playwright install chromium
    3. Cria um .env nesta pasta com:
           MAXWORK_EMAIL=elsiomota@remax.pt
           MAXWORK_PASSWORD=a-tua-password
           HEADLESS=false
       (não precisa de MAXWORK_AGENCIES — esse só é usado por
       maxwork_to_csv.py, a versão por agência.)
    4. python maxwork_to_csv_bulk.py
    5. Resultado: maxwork_imoveis.csv nesta pasta (mesmo nome de
       maxwork_to_csv.py — são alternativas, não corras os dois a
       apontar à mesma pasta ao mesmo tempo)

A pesquisa parte dos filtros por omissão da Maxwork (Estado: Ativo,
Classe do imóvel: Habitação) — os mesmos que já vêm aplicados quando
abres /listing/search sem mexer em nada. Se quiseres mesmo TODOS os
estados/classes (incluindo vendidos/retirados, comercial, terrenos),
diz para eu ajustar — por agora fica igual ao que a pesquisa já mostra
por omissão.

A sessão de login (maxwork_session.json) é partilhada com
maxwork_to_csv.py — se correste esse script antes com um filtro de
Agência, este script limpa esse filtro sozinho antes de começar (ver
ensure_no_agency_filter), para não herdar sem querer uma pesquisa
filtrada de uma corrida anterior.
"""

import csv

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser, parse_number
from maxwork_to_csv import (
    SEARCH_AGENCY_CONTROL_SELECTOR,
    SEARCH_RESULTS_CARD_SELECTOR,
    SEARCH_PAGE_SIZE_SELECT_SELECTOR,
    NEXT_PAGE_SELECTOR,
    ensure_filters_open,
    run_search,
    has_next_page,
)

OUTPUT_CSV = "maxwork_imoveis.csv"

SEARCH_API_PATH_FRAGMENT = "multi-match-listing-search"
MAX_RESULTS_PER_SEARCH = 10_000  # limite do motor de busca da Maxwork (confirmado via API: totalCount pode passar disto, mas nunca dá para paginar até lá)
SEARCH_PAUSE_MS = 800  # pausa antes de cada pesquisa nova — evita encadear pedidos depressa demais um atrás do outro

PRICE_MIN_SELECTOR = '[data-id="minPriceId"] input[placeholder="Mínimo"]'
PRICE_MAX_SELECTOR = '[data-id="minPriceId"] input[placeholder="Máximo"]'
# Sentinela para "sem máximo" — bem acima de qualquer imóvel real em
# Portugal, só serve de teto inicial para a divisão binária do intervalo.
NO_MAX_PRICE = 50_000_000


def capture_search(page, trigger, attempts: int = 3):
    """Regista a interceção da resposta da API de pesquisa ANTES de
    disparar "trigger" (clicar em "Ver Resultados", mudar de página,
    mudar o tamanho de página...) e devolve o JSON já parseado, ou None
    se não aparecer nenhuma resposta válida dentro do timeout — tenta
    outra vez antes de desistir, tal como o resto do scraper faz para
    pedidos que por vezes demoram mais do que o costume.

    Uma pequena pausa antes de disparar (SEARCH_PAUSE_MS) evita
    encadear pesquisas depressa demais uma atrás da outra — já
    aconteceu numa corrida real ficar preso a meio com muitas pesquisas
    seguidas sem pausa nenhuma (pode ser limite de pedidos por segundo
    do lado da Maxwork)."""
    page.wait_for_timeout(SEARCH_PAUSE_MS)
    for attempt in range(1, attempts + 1):
        print(f"  a aguardar resposta da pesquisa (tentativa {attempt}/{attempts})...")
        try:
            with page.expect_response(
                lambda r: SEARCH_API_PATH_FRAGMENT in r.url, timeout=15000
            ) as resp_info:
                print("  a disparar a ação (clique/mudança)...")
                trigger()
                print("  ação disparada, a aguardar a resposta chegar...")
            response = resp_info.value
        except PlaywrightTimeout:
            print(f"  [aviso] a resposta da pesquisa não chegou em 15s (tentativa {attempt}/{attempts})")
            continue
        except Exception as e:
            print(f"  [aviso] erro a disparar a pesquisa (tentativa {attempt}/{attempts}): {e}")
            continue

        if not response.ok:
            print(f"  [aviso] HTTP {response.status} na pesquisa — corpo: {response.text()[:300]}")
            return None
        return response.json()
    return None


def ensure_no_agency_filter(page):
    """Limpa o filtro "Agência" se ficou preso de uma corrida anterior de
    maxwork_to_csv.py — a sessão de login é partilhada entre os dois
    scripts, e a Maxwork guarda o último filtro usado nessa sessão. Sem
    isto, esta pesquisa "sem filtro" podia continuar presa na última
    agência testada em vez de mostrar mesmo todos os imóveis.

    Best-effort: só mexe se o painel de filtros e o campo existirem e
    tiverem mesmo um valor selecionado (ícone "limpar" do react-select,
    .select__clear-indicator — só aparece quando há algo para limpar)."""
    ensure_filters_open(page)
    more_toggle = page.get_by_role("button", name="Ver Mais")
    if more_toggle.count() > 0:
        more_toggle.first.click()
        page.wait_for_timeout(500)

    try:
        page.wait_for_selector(SEARCH_AGENCY_CONTROL_SELECTOR, timeout=10000)
    except PlaywrightTimeout:
        return

    clear_indicator = page.locator(f"{SEARCH_AGENCY_CONTROL_SELECTOR} .select__clear-indicator")
    if clear_indicator.count() > 0:
        print("[aviso] havia um filtro de Agência preso de uma corrida anterior — a limpar...")
        clear_indicator.first.click()
        page.wait_for_timeout(500)
        run_search(page)


def ensure_results_loaded(page, attempts: int = 3) -> bool:
    """Garante que a grelha carrega com cartões — pesquisa global, sem
    nenhum filtro aplicado. Tenta clicar em "Ver Resultados" se não
    aparecer nada à primeira."""
    for attempt in range(1, attempts + 1):
        try:
            page.wait_for_selector(SEARCH_RESULTS_CARD_SELECTOR, timeout=15000)
            return True
        except PlaywrightTimeout:
            print(f"[aviso] cartões ainda não apareceram (tentativa {attempt}/{attempts})")
            if attempt < attempts:
                run_search(page)
    return False


def set_price_range(page, min_price: int, max_price: int):
    """Preenche o filtro "Preço Atual" (Mínimo/Máximo, campos de texto
    simples — sem react-select). max_price == NO_MAX_PRICE deixa o
    campo Máximo em branco (sem teto), em vez de escrever um número
    irrealista lá dentro. Não pesquisa sozinho — quem chama decide
    quando disparar (para poder intercetar a resposta).

    A Maxwork recolhe o painel de filtros sozinha a seguir a "Ver
    Resultados" (ensure_filters_open reabre-o) — já vimos uma corrida
    real em que a pesquisa seguinte saiu com o preço máximo antigo
    (dois intervalos diferentes deram exatamente o mesmo total), sinal
    de que o preenchimento não ficou a valer a tempo do clique
    seguinte. Por isso confirma sempre o valor lido de volta do campo,
    e volta a preencher se não bater certo."""
    ensure_filters_open(page)
    min_text = str(min_price) if min_price > 0 else ""
    max_text = str(max_price) if max_price < NO_MAX_PRICE else ""

    for attempt in range(1, 3):
        page.locator(PRICE_MIN_SELECTOR).fill(min_text)
        page.locator(PRICE_MAX_SELECTOR).fill(max_text)
        actual_min = page.locator(PRICE_MIN_SELECTOR).input_value()
        actual_max = page.locator(PRICE_MAX_SELECTOR).input_value()
        if actual_min == min_text and actual_max == max_text:
            return
        print(f"  [aviso] campos de preço não ficaram como esperado (min='{actual_min}', esperado='{min_text}'; max='{actual_max}', esperado='{max_text}') — a tentar outra vez...")
        page.wait_for_timeout(500)

    print("  [aviso] campos de preço continuam sem bater certo depois de repetir — a pesquisa seguinte pode sair com o filtro errado")


def price_label(min_price: int, max_price: int) -> str:
    max_text = "sem máx" if max_price >= NO_MAX_PRICE else f"{max_price:,}".replace(",", " ")
    return f"[preço {min_price:,}".replace(",", " ") + f"–{max_text}]"


def split_point(min_price: int, max_price: int) -> int:
    """Onde cortar um intervalo de preço que ainda está acima do limite.
    O mercado imobiliário tem uma distribuição muito assimétrica (muitos
    imóveis baratos, poucos caríssimos) — bisseção aritmética pura a
    partir de "sem máximo" desperdiçava várias divisões em intervalos
    astronomicamente irrealistas (25M, 12.5M, ...) antes de chegar a
    preços a sério. Para o topo "sem máximo" cresce por dobragem a
    partir de onde já vai, em vez de dividir sempre ao meio — aproxima-se
    muito mais depressa da distribuição real do mercado."""
    if max_price >= NO_MAX_PRICE:
        return max(min_price * 2, min_price + 1_000_000)
    return min_price + (max_price - min_price) // 2


def map_api_item_to_row(item: dict) -> dict:
    """Traduz um imóvel devolvido pela API para o mesmo formato de linha
    que o resto do pipeline (maxwork_details_to_csv.py, maxwork_to_crm.py)
    já espera — mesmos nomes de coluna de sempre, só a origem dos dados
    mudou (API em vez de ler o ecrã)."""
    internal_id = item.get("id")
    codigo = item.get("listingTitle")
    region = item.get("regionName2") or ""
    return {
        "codigo": codigo,
        "id_interno": str(internal_id) if internal_id is not None else None,
        "url": f"https://app.maxwork.pt/listing/details/{internal_id}" if internal_id is not None else None,
        "titulo": f"{codigo} / {region}".strip(" /") if codigo else None,
        "tipo": item.get("listingType"),
        "transacao": item.get("businessType"),
        "estado": item.get("listingStatus"),
        "preco": parse_number(item.get("actualValueText")),
        "area_m2": item.get("totalArea"),
        "quartos": item.get("numberOfBedrooms"),
        "casas_banho": item.get("numberOfBathrooms"),
        "dias_mercado": None,
        "morada": item.get("address") or item.get("regionName3"),
        "foto_capa": item.get("listingPictureUrl"),
        "agente": item.get("userName"),
        "telefone_agente": item.get("userCellPhone"),
        "email_agente": item.get("userEmail"),
        "agencia": item.get("officeName"),
    }


def set_page_size_100(page) -> dict | None:
    """Muda o tamanho de página para 100 e devolve o JSON dessa
    resposta — separado em ações individuais (uma select_option por
    vez) para nunca ter dúvidas de qual pedido estamos a intercetar,
    ao contrário de disparar 2 mudanças seguidas e só apanhar a 1ª."""
    page.wait_for_selector(SEARCH_PAGE_SIZE_SELECT_SELECTOR, timeout=10000)
    current = page.eval_on_selector(SEARCH_PAGE_SIZE_SELECT_SELECTOR, "el => el.value")
    if current == "100":
        # já mostra "100" visualmente de uma pesquisa anterior — força uma
        # mudança real (senão o onChange que aplicaria a sério não dispara)
        capture_search(page, lambda: page.select_option(SEARCH_PAGE_SIZE_SELECT_SELECTOR, "50"))
    return capture_search(page, lambda: page.select_option(SEARCH_PAGE_SIZE_SELECT_SELECTOR, "100"))


MAX_SPLIT_DEPTH = 30  # rede de segurança — garante que a recursão acaba mesmo que o intervalo nunca fique fino o suficiente


def scrape_price_bucket(page, min_price: int, max_price: int, depth: int = 0) -> list[dict]:
    """Pesquisa um intervalo de preço via API; se o totalCount passar do
    limite do motor de busca, divide o intervalo a meio e tenta cada
    metade separadamente (recursivo) até cada fatia ficar abaixo do
    limite."""
    label = price_label(min_price, max_price)
    print(f"{label} a pesquisar...")

    set_price_range(page, min_price, max_price)
    data = capture_search(page, lambda: run_search(page))

    if data is None:
        print(f"{label} sem resposta válida da pesquisa depois de várias tentativas — a saltar esta fatia (podem faltar imóveis deste intervalo)")
        return []

    total = data.get("totalCount", 0)
    if total > MAX_RESULTS_PER_SEARCH:
        if max_price - min_price <= 1 or depth >= MAX_SPLIT_DEPTH:
            print(f"{label} [aviso] intervalo já não dá para dividir mais (profundidade {depth}) e continua acima do limite ({total} resultados) — pode faltar imóveis deste preço")
        else:
            mid = split_point(min_price, max_price)
            print(f"{label} {total} resultados (> {MAX_RESULTS_PER_SEARCH}) — a dividir em dois")
            left = scrape_price_bucket(page, min_price, mid, depth + 1)
            right = scrape_price_bucket(page, mid + 1, max_price, depth + 1)
            return left + right

    if total == 0:
        print(f"{label} sem resultados")
        return []

    data100 = set_page_size_100(page)
    if data100 is not None:
        data = data100

    items = data.get("items", [])
    rows = [map_api_item_to_row(it) for it in items]
    page_num = 1
    # A Maxwork mostra o botão "seguinte" ativo (e hasNextPage=True) bem
    # depois de a pesquisa já ter acabado a sério — o mesmo comportamento
    # genérico já visto na paginação da UI. Por isso o sinal fiável de
    # "já não há mais" é a página vir mesmo vazia, não hasNextPage/
    # has_next_page(); sem isto entra em loop infinito a "avançar" para
    # sempre sem nunca ler uma página com 0 imóveis.
    while items and data.get("hasNextPage") and has_next_page(page):
        page_num += 1
        data = capture_search(page, lambda: page.click(NEXT_PAGE_SELECTOR))
        if data is None:
            print(f"{label} [aviso] falhou a apanhar a página {page_num} — a parar aqui, pode faltar o resto desta fatia")
            break
        items = data.get("items", [])
        if not items:
            break
        rows.extend(map_api_item_to_row(it) for it in items)

    print(f"{label} {len(rows)} imóveis ({total} esperados)")
    return rows


def write_csv(rows):
    fieldnames = [
        "codigo", "id_interno", "url", "titulo", "tipo", "transacao", "estado",
        "preco", "area_m2", "quartos", "casas_banho", "dias_mercado",
        "morada", "foto_capa", "agente", "telefone_agente", "email_agente", "agencia",
    ]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"\n{len(rows)} imoveis guardados em {OUTPUT_CSV}")


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")

    print("[maxwork] pesquisa global — sem filtro de agência, via API, dividida por fatias de preço")

    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, page = open_session(browser)

        ensure_no_agency_filter(page)
        if not ensure_results_loaded(page):
            context.close()
            browser.close()
            raise SystemExit("A grelha de resultados nunca carregou — corre com HEADLESS=false para ver o que se passa")

        rows = scrape_price_bucket(page, 0, NO_MAX_PRICE)

        context.close()
        browser.close()

    # O mesmo imóvel pode aparecer duas vezes perto da fronteira entre
    # duas fatias de preço (ou se a grelha repetir alguma página durante
    # a paginação) — dedup por id_interno (fiável agora, vem da API,
    # ao contrário do código que podia repetir-se por engano)
    seen = set()
    unique_rows = []
    for row in rows:
        key = row.get("id_interno") or row.get("codigo")
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        unique_rows.append(row)

    write_csv(unique_rows)


if __name__ == "__main__":
    main()
