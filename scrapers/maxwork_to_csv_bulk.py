#!/usr/bin/env python3
"""
Maxwork -> CSV (pesquisa global, SEM filtro de agência)

Variante de maxwork_to_csv.py para quando queres TODOS os imóveis do
Maxwork (todas as agências, sem escolher nenhuma) em vez de percorrer
uma lista de agências — reutiliza a lógica de paginação/extração de
cartões desse ficheiro (não duplicada aqui), só troca o "o que
pesquisar": em vez de aplicar um filtro de Agência por vez, lê a grelha
tal como aparece por omissão em /listing/search, com o tamanho de
página no máximo (100).

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
)

OUTPUT_CSV = "maxwork_imoveis.csv"


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

    print("[maxwork] pesquisa global — sem filtro de agência")

    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, page = open_session(browser)

        ensure_no_agency_filter(page)
        if not ensure_results_loaded(page):
            context.close()
            browser.close()
            raise SystemExit("A grelha de resultados nunca carregou — corre com HEADLESS=false para ver o que se passa")

        maximize_search_page_size(page)
        rows = scrape_search_all(page)

        context.close()
        browser.close()

    # O mesmo imóvel pode aparecer duas vezes se a grelha repetir alguma
    # página durante a paginação — dedup por código, igual a maxwork_to_csv.py
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
