#!/usr/bin/env python3
"""
Maxwork -> CSV (pesquisa global, SEM filtro de agência, 2 workers)

Variante de maxwork_to_csv.py para quando queres TODOS os imóveis do
Maxwork (todas as agências, sem escolher nenhuma) em vez de percorrer
uma lista de agências — reutiliza a lógica de paginação/extração de
cartões desse ficheiro (não duplicada aqui), só troca o "o que
pesquisar": em vez de aplicar um filtro de Agência por vez, lê a grelha
tal como aparece por omissão em /listing/search, com o tamanho de
página no máximo (100).

Para ir mais rápido, usa DOIS browsers em paralelo (mesma sessão de
login, cada um no seu processo Chromium — o Playwright sync não é
seguro para partilhar entre threads Python):
  - um a avançar da página 1 para a frente ("seguinte");
  - outro a saltar logo para a última página VISÍVEL na paginação
    (normalmente "1000" — um limite genérico da Maxwork, não o total
    real) e a recuar ("anterior") até encontrar a última página com
    dados a sério, continuando a recuar a partir daí.
Param quando se encontram a meio (coordenados por um contador de
páginas partilhado). Se o "worker de trás" nunca encontrar dados reais
dentro de MAX_EMPTY_TAIL_PAGES páginas vazias, desiste sozinho e o
worker da frente continua e acaba a lista completa na mesma — só perdes
o ganho de velocidade, não imóveis.

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
import threading

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

from maxwork_common import (
    EMAIL, PASSWORD, LOGIN_URL, APP_LOADED_SELECTOR, STORAGE_STATE_PATH,
    open_session, launch_browser,
)
from maxwork_to_csv import (
    SEARCH_AGENCY_CONTROL_SELECTOR,
    SEARCH_RESULTS_CARD_SELECTOR,
    ensure_filters_open,
    run_search,
    maximize_search_page_size,
    extract_search_cards,
    first_card_key,
    has_next_page,
    has_prev_page,
    advance_to_next_page,
    retreat_to_prev_page,
    highest_visible_page_number,
    jump_to_page,
)

OUTPUT_CSV = "maxwork_imoveis.csv"

# Quantas páginas vazias seguidas o worker de trás aceita percorrer, a
# recuar a partir da última página visível (ex.: "1000"), à procura da
# última página com dados a sério, antes de desistir. Não sabemos de
# antemão quão grande é essa "cauda vazia" — este é só um limite de
# segurança para não ficar preso ali indefinidamente.
MAX_EMPTY_TAIL_PAGES = 60


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


class _SharedProgress:
    """Coordena os dois workers por número de página — sem isto, cada um
    não sabe quando o outro já chegou à zona dele e continuariam a ler
    (e a demorar) para lá do ponto de encontro."""

    def __init__(self):
        self.lock = threading.Lock()
        self.forward_last_page = 0        # última página real já lida pelo worker da frente
        self.backward_first_page = None   # página mais baixa já lida pelo worker de trás


def _prepare_page(page):
    """Login + sem filtro de agência + grelha carregada + 100 por
    página — preparação comum aos dois workers, cada um na sua página
    (processo Chromium) própria."""
    page.goto(LOGIN_URL)
    page.wait_for_selector(APP_LOADED_SELECTOR, timeout=20000)
    ensure_no_agency_filter(page)
    if not ensure_results_loaded(page):
        return False
    maximize_search_page_size(page)
    return True


def _forward_worker(progress: "_SharedProgress", results: list):
    try:
        with sync_playwright() as pw:
            browser = launch_browser(pw)
            context = browser.new_context(locale="pt-PT", storage_state=STORAGE_STATE_PATH)
            page = context.new_page()
            if not _prepare_page(page):
                print("  [frente] a grelha nunca carregou — a desistir deste worker")
                context.close()
                browser.close()
                return

            page_num = 1
            while True:
                with progress.lock:
                    if progress.backward_first_page is not None and page_num >= progress.backward_first_page:
                        print(f"  [frente] encontrou-se com o worker de trás na página {page_num} — a parar")
                        break

                print(f"  [frente] a ler página {page_num}...")
                rows = extract_search_cards(page)
                print(f"    [frente] {len(rows)} imóveis nesta página")
                if not rows:
                    # Mesma lógica de scrape_search_all: parar aqui, não em
                    # has_next_page(), é o único sinal fiável de "já não há mais".
                    break
                results.extend(rows)
                with progress.lock:
                    progress.forward_last_page = page_num

                if not has_next_page(page):
                    break
                previous_first = first_card_key(page)
                if not advance_to_next_page(page, previous_first):
                    print("  [frente] a página seguinte não trouxe cartões novos depois de várias tentativas — a parar")
                    break
                page_num += 1

            context.close()
            browser.close()
    except Exception as e:
        print(f"  [frente] [erro] {e}")


def _backward_worker(progress: "_SharedProgress", results: list):
    try:
        with sync_playwright() as pw:
            browser = launch_browser(pw)
            context = browser.new_context(locale="pt-PT", storage_state=STORAGE_STATE_PATH)
            page = context.new_page()
            if not _prepare_page(page):
                print("  [trás] a grelha nunca carregou — a desistir deste worker (o worker da frente trata de tudo sozinho)")
                context.close()
                browser.close()
                return

            last_visible = highest_visible_page_number(page)
            if last_visible is None or last_visible <= 1:
                print("  [trás] não encontrei um número de página alto na paginação — a desistir deste worker")
                context.close()
                browser.close()
                return

            previous_first = first_card_key(page)
            if not jump_to_page(page, last_visible, previous_first):
                print(f"  [trás] não consegui saltar para a página {last_visible} — a desistir deste worker")
                context.close()
                browser.close()
                return

            # Recua a saltar páginas vazias até encontrar a 1ª com dados a
            # sério — essa é a verdadeira última página da lista (a Maxwork
            # mostra sempre até "1000" independentemente do total real).
            page_num = last_visible
            empty_seen = 0
            found_data = False
            while True:
                rows = extract_search_cards(page)
                if rows:
                    found_data = True
                    break
                empty_seen += 1
                print(f"  [trás] página {page_num} vazia ({empty_seen} seguida(s))...")
                if empty_seen >= MAX_EMPTY_TAIL_PAGES:
                    print(f"  [trás] {MAX_EMPTY_TAIL_PAGES} páginas vazias seguidas — a desistir deste worker, o worker da frente trata do resto sozinho")
                    break
                with progress.lock:
                    if progress.forward_last_page >= page_num - 1:
                        print(f"  [trás] o worker da frente já passou daqui (página {page_num}) — a parar sem encontrar dados")
                        break
                if page_num <= 1 or not has_prev_page(page):
                    print("  [trás] chegou à página 1 sem encontrar dados — a desistir deste worker")
                    break
                previous_first = first_card_key(page)
                if not retreat_to_prev_page(page, previous_first):
                    print("  [trás] a página anterior não trouxe cartões novos depois de várias tentativas — a desistir deste worker")
                    break
                page_num -= 1

            if not found_data:
                context.close()
                browser.close()
                return

            print(f"  [trás] última página real encontrada: {page_num}")
            while True:
                with progress.lock:
                    if progress.forward_last_page >= page_num:
                        print(f"  [trás] encontrou-se com o worker da frente na página {page_num} — a parar")
                        break

                print(f"  [trás] a ler página {page_num}...")
                rows = extract_search_cards(page)
                print(f"    [trás] {len(rows)} imóveis nesta página")
                results.extend(rows)
                with progress.lock:
                    progress.backward_first_page = page_num

                if page_num <= 1 or not has_prev_page(page):
                    break
                previous_first = first_card_key(page)
                if not retreat_to_prev_page(page, previous_first):
                    print("  [trás] a página anterior não trouxe cartões novos depois de várias tentativas — a parar")
                    break
                page_num -= 1

            context.close()
            browser.close()
    except Exception as e:
        print(f"  [trás] [erro] {e}")


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")

    print("[maxwork] pesquisa global — sem filtro de agência (2 workers: frente + trás)")

    # Garante login válido e a sessão gravada ANTES de lançar os dois
    # workers em threads separadas — cada um abre o seu próprio browser
    # (o Playwright sync não é seguro entre threads dentro da mesma
    # instância), mas os dois reutilizam o mesmo maxwork_session.json,
    # já preparado aqui, para não terem de fazer login Microsoft os dois
    # ao mesmo tempo nem escrever no ficheiro de sessão em simultâneo.
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, _ = open_session(browser)
        context.close()
        browser.close()

    progress = _SharedProgress()
    results_forward: list = []
    results_backward: list = []

    thread_a = threading.Thread(target=_forward_worker, args=(progress, results_forward))
    thread_b = threading.Thread(target=_backward_worker, args=(progress, results_backward))
    thread_a.start()
    thread_b.start()
    thread_a.join()
    thread_b.join()

    all_rows = results_forward + results_backward

    # O mesmo imóvel pode aparecer duas vezes perto do ponto de encontro
    # dos dois workers (ou se a grelha repetir alguma página durante a
    # paginação) — dedup por código, igual a maxwork_to_csv.py
    seen = set()
    unique_rows = []
    for row in all_rows:
        codigo = row.get("codigo")
        if codigo and codigo in seen:
            continue
        if codigo:
            seen.add(codigo)
        unique_rows.append(row)

    write_csv(unique_rows)


if __name__ == "__main__":
    main()
