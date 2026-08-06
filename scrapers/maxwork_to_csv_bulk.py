#!/usr/bin/env python3
"""
Maxwork -> CSV (pesquisa global, SEM filtro de agência, por fatias de preço)

Variante de maxwork_to_csv.py para quando queres TODOS os imóveis do
Maxwork (todas as agências, sem escolher nenhuma) em vez de percorrer
uma lista de agências — reutiliza a lógica de paginação/extração de
cartões desse ficheiro (não duplicada aqui).

O Maxwork limita qualquer pesquisa a no máximo 100 páginas (10 000
resultados, a 100 por página) — um limite do próprio motor de busca
(tipo Elasticsearch), independente de quantos imóveis existam mesmo
(a Maxwork diz ter ~47 000 angariações no total). Para ir além dos
10 000 é preciso dividir a pesquisa em fatias que fiquem cada uma
abaixo do limite — este script faz isso automaticamente pelo filtro
"Preço Atual" (Mínimo/Máximo): sempre que uma fatia bate no limite de
100 páginas, divide o intervalo de preço a meio e tenta cada metade
separadamente, recursivamente, até cada fatia ficar abaixo do limite.

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

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser
from maxwork_to_csv import (
    SEARCH_AGENCY_CONTROL_SELECTOR,
    SEARCH_RESULTS_CARD_SELECTOR,
    ensure_filters_open,
    run_search,
    maximize_search_page_size,
    scrape_search_all,
    highest_visible_page_number,
)

OUTPUT_CSV = "maxwork_imoveis.csv"

MAX_PAGES_PER_SEARCH = 100  # limite do motor de busca da Maxwork (100 x 100/página = 10 000)
PRICE_MIN_SELECTOR = '[data-id="minPriceId"] input[placeholder="Mínimo"]'
PRICE_MAX_SELECTOR = '[data-id="minPriceId"] input[placeholder="Máximo"]'
# Sentinela para "sem máximo" — bem acima de qualquer imóvel real em
# Portugal, só serve de teto inicial para a divisão binária do intervalo.
NO_MAX_PRICE = 50_000_000


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
    simples — sem react-select) e pesquisa. max_price == NO_MAX_PRICE
    deixa o campo Máximo em branco (sem teto), em vez de escrever um
    número irrealista lá dentro."""
    ensure_filters_open(page)
    page.locator(PRICE_MIN_SELECTOR).fill(str(min_price) if min_price > 0 else "")
    page.locator(PRICE_MAX_SELECTOR).fill(str(max_price) if max_price < NO_MAX_PRICE else "")
    run_search(page)


def price_label(min_price: int, max_price: int) -> str:
    max_text = "sem máx" if max_price >= NO_MAX_PRICE else f"{max_price:,}".replace(",", " ")
    return f"[preço {min_price:,}".replace(",", " ") + f"–{max_text}]"


def scrape_price_bucket(page, min_price: int, max_price: int) -> list[dict]:
    """Pesquisa um intervalo de preço; se atingir o limite de 100 páginas
    da Maxwork, divide o intervalo a meio e tenta cada metade
    separadamente (recursivo) até cada fatia ficar abaixo do limite."""
    label = price_label(min_price, max_price)
    print(f"{label} a pesquisar...")

    has_results = False
    for attempt in range(1, 3):
        set_price_range(page, min_price, max_price)
        try:
            page.wait_for_selector(SEARCH_RESULTS_CARD_SELECTOR, timeout=8000)
            has_results = True
            break
        except PlaywrightTimeout:
            if attempt == 1:
                print(f"{label} sem cartões à 1ª — a confirmar se é mesmo 0 resultados...")

    if not has_results:
        print(f"{label} sem resultados")
        return []

    maximize_search_page_size(page)
    highest = highest_visible_page_number(page)

    if highest is not None and highest >= MAX_PAGES_PER_SEARCH:
        if max_price - min_price <= 1:
            print(f"{label} [aviso] intervalo já não dá para dividir mais e continua no limite de {MAX_PAGES_PER_SEARCH} páginas — pode faltar imóveis deste preço exato")
            return scrape_search_all(page)

        mid = min_price + (max_price - min_price) // 2
        print(f"{label} atingiu o limite de {MAX_PAGES_PER_SEARCH} páginas — a dividir em dois")
        left = scrape_price_bucket(page, min_price, mid)
        right = scrape_price_bucket(page, mid + 1, max_price)
        return left + right

    rows = scrape_search_all(page)
    print(f"{label} {len(rows)} imóveis")
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

    print("[maxwork] pesquisa global — sem filtro de agência, dividida por fatias de preço")

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
    # a paginação) — dedup por código, igual a maxwork_to_csv.py
    seen = set()
    unique_rows = []
    for row in rows:
        codigo = row.get("codigo")
        if codigo and codigo in seen:
            continue
        if codigo:
            seen.add(codigo)
        unique_rows.append(row)

    write_csv(unique_rows)


if __name__ == "__main__":
    main()
