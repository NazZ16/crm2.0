#!/usr/bin/env python3
"""
Maxwork -> CSV (via /listing/search)

Lê a pesquisa global do Maxwork (todos os imóveis de todas as agências,
não só os teus) filtrando pelo nome da agência, e lê os cartões de
resultados diretamente do ecrã — tal como um utilizador veria.

A página /listing/search filtra via JavaScript (react-select), não por
URL — o script preenche o campo "Agência" sozinho, um nome de cada vez,
e lê os resultados depois de pesquisar.

COMO USAR:
    1. pip install playwright python-dotenv
    2. playwright install chromium
    3. Cria um .env nesta pasta com:
           MAXWORK_EMAIL=elsiomota@remax.pt
           MAXWORK_PASSWORD=a-tua-password
           HEADLESS=false
           MAXWORK_AGENCIES=4 You,Outra Agência
    4. python maxwork_to_csv.py
    5. Resultado: maxwork_imoveis.csv nesta pasta

MAXWORK_AGENCIES aceita vários nomes (separados por vírgula ou por linha)
— um por cada agência a pesquisar, incluindo a tua própria se quiseres
os teus imóveis também. O mesmo imóvel é escrito uma única vez no CSV
final, mesmo que apareça em mais do que uma pesquisa.

A sessão de login fica guardada em maxwork_session.json (ao lado deste
ficheiro) depois da primeira corrida — as seguintes reutilizam-na e só
pedem login Microsoft outra vez se tiver expirado. Importante para
corridas automáticas/noturnas (Task Scheduler): evita ficar preso à
espera de um MFA que ninguém vai aprovar. Não apagues nem partilhes esse
ficheiro — dá acesso à tua conta.
"""

import csv
import os
import re

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

from maxwork_common import EMAIL, PASSWORD, HEADLESS, APP_LOADED_SELECTOR, open_session, parse_number

OUTPUT_CSV = "maxwork_imoveis.csv"

SEARCH_URL = "https://app.maxwork.pt/listing/search"

MAXWORK_AGENCIES_RAW = os.getenv("MAXWORK_AGENCIES", "")
AGENCIES = [a.strip() for a in re.split(r"[,\n]+", MAXWORK_AGENCIES_RAW) if a.strip()]

NEXT_PAGE_SELECTOR = "li.page-item.next-item a.page-link"
NEXT_PAGE_DISABLED_SELECTOR = "li.page-item.next-item.disabled"

# Página /listing/search — filtros por JS (react-select), não por URL
SEARCH_AGENCY_CONTROL_SELECTOR = '[data-id="officeId"] .select__control'
SEARCH_AGENCY_INPUT_SELECTOR = '[data-id="officeId"] input.select__input'
SEARCH_RESULTS_CARD_SELECTOR = ".ecommerce-card"
SEARCH_PAGE_SIZE_SELECT_SELECTOR = "select.custom-select"


def has_next_page(page):
    if page.query_selector(NEXT_PAGE_DISABLED_SELECTOR):
        return False
    return page.query_selector(NEXT_PAGE_SELECTOR) is not None


def select_agency_filter(page, agency_name: str) -> bool:
    """Escreve o nome no campo react-select 'Agência' e escolhe a primeira
    opção correspondente. Devolve False se não aparecer nenhuma opção
    (nome não bate certo com o que o Maxwork tem registado).
    Clica na caixa toda (.select__control) em vez do input isolado — o
    texto do placeholder ("Agência") fica visualmente por cima do input
    e intercepta o clique se se tentar clicar só no input."""
    page.locator(SEARCH_AGENCY_CONTROL_SELECTOR).click()
    page.wait_for_timeout(300)
    field = page.locator(SEARCH_AGENCY_INPUT_SELECTOR)
    field.fill(agency_name)
    try:
        option = page.locator(".select__menu .select__option", has_text=agency_name).first
        option.wait_for(timeout=8000)
        option.click()
        return True
    except PlaywrightTimeout:
        print(f"  [aviso] Nenhuma agência encontrada para \"{agency_name}\" — a saltar")
        return False


def run_search(page):
    # Sem wait_for_load_state("networkidle") de propósito — os widgets de
    # fundo (chat, analytics) fazem pedidos periódicos que nunca deixam a
    # rede "parada", por isso essa espera podia ficar presa até ao timeout
    # (30s) antes sequer de tentar ler os resultados. Quem espera mesmo
    # pelos resultados é o wait_for_selector(SEARCH_RESULTS_CARD_SELECTOR)
    # em scrape_agency(), que verifica o DOM diretamente.
    page.get_by_role("button", name="Ver Resultados").first.click()
    page.wait_for_timeout(1500)


def maximize_search_page_size(page):
    try:
        page.select_option(SEARCH_PAGE_SIZE_SELECT_SELECTOR, "100")
        page.wait_for_timeout(1500)
    except Exception:
        print("  [aviso] não consegui aumentar o tamanho de página na pesquisa")


def extract_search_cards(page) -> list[dict]:
    """Extrai os cartões da pesquisa global (/listing/search) — usa
    atributos data-class estáveis para cada campo."""
    rows = []
    cards = page.query_selector_all(SEARCH_RESULTS_CARD_SELECTOR)
    for card in cards:
        try:
            link_el = card.query_selector('.item-name a[href*="/listing/details/"]')
            href = link_el.get_attribute("href") if link_el else None
            url = f"https://app.maxwork.pt{href}" if href else None

            title_text = link_el.inner_text().strip() if link_el else ""
            codigo = title_text.split(" - ", 1)[0].strip() if title_text else None

            address_el = card.query_selector('[data-class="item-address"]')
            status_el = card.query_selector('[data-class="item-status"]')
            price_el = card.query_selector('[data-class="item-price"]')
            area_el = card.query_selector('[data-class="item-totalArea"]')
            typology_el = card.query_selector('[data-class="item-typology"]')
            bathrooms_el = card.query_selector('[data-class="item-numberOfBathrooms"]')

            # "Terreno - Venda" / "Moradia - Venda" vem num <h5 class="item-description">
            # sem data-class, distinto dos outros que têm data-class.
            tipo = transacao = None
            for el in card.query_selector_all("h5.item-description"):
                if el.get_attribute("data-class"):
                    continue
                text = el.inner_text().strip()
                if " - " in text:
                    tipo, transacao = [p.strip() for p in text.split(" - ", 1)]
                    break

            agente_el = card.query_selector('[data-class="item-userName"]')
            agencia_el = card.query_selector('[data-class="item-officeName"]')
            email_el = card.query_selector('[data-class="item-email"]')
            telefone_el = card.query_selector('[data-class="item-phone"]')
            img_el = card.query_selector("img.card-img-top")

            rows.append({
                "codigo": codigo,
                "titulo": title_text or None,
                "tipo": tipo,
                "transacao": transacao,
                "estado": status_el.inner_text().split(":")[-1].strip() if status_el else None,
                "preco": parse_number(price_el.inner_text()) if price_el else None,
                "area_m2": parse_number(area_el.inner_text().split(":")[-1]) if area_el else None,
                "quartos": typology_el.inner_text().strip() if typology_el else None,
                "casas_banho": bathrooms_el.inner_text().strip() if bathrooms_el else None,
                "dias_mercado": None,
                "morada": address_el.inner_text().strip() if address_el else None,
                "foto_capa": img_el.get_attribute("src") if img_el else None,
                "agente": agente_el.inner_text().strip() if agente_el else None,
                "telefone_agente": telefone_el.inner_text().strip() if telefone_el else None,
                "email_agente": email_el.inner_text().strip() if email_el else None,
                "agencia": agencia_el.inner_text().strip() if agencia_el else None,
                "id_interno": href.rstrip("/").split("/")[-1] if href else None,
                "url": url,
            })
        except Exception as e:
            print(f"  [aviso] erro num cartão de pesquisa: {e}")
            continue
    return rows


def scrape_search_all(page) -> list[dict]:
    all_rows = []
    page_num = 1
    while True:
        print(f"  A ler página {page_num} da pesquisa...")
        rows = extract_search_cards(page)
        print(f"    {len(rows)} imóveis nesta página")
        all_rows.extend(rows)

        if not has_next_page(page):
            break

        page.click(NEXT_PAGE_SELECTOR)
        page.wait_for_timeout(1500)
        page_num += 1

    return all_rows


def scrape_agency(page, agency_name: str) -> list[dict]:
    print(f"\n[maxwork] === Agência: {agency_name} ===")

    # login() já deixa a página em SEARCH_URL — recarregar outra vez à toa
    # só torna as coisas mais lentas/instáveis na primeira agência. Para as
    # seguintes, o reload é preciso para limpar o filtro da pesquisa anterior.
    if not page.url.startswith(SEARCH_URL):
        page.goto(SEARCH_URL, wait_until="domcontentloaded")

    # Espera por um elemento concreto em vez de "networkidle" — a página tem
    # widgets de fundo (chat, analytics) que fazem pedidos periódicos e podem
    # nunca deixar a rede "parada", o que faria o networkidle ficar preso.
    try:
        page.wait_for_selector(APP_LOADED_SELECTOR, timeout=25000)
    except PlaywrightTimeout:
        print(f"  [aviso] Página de pesquisa não carregou (URL atual: {page.url}) — a saltar")
        return []

    try:
        page.wait_for_selector(SEARCH_AGENCY_INPUT_SELECTOR, timeout=25000)
    except PlaywrightTimeout:
        print(f"  [aviso] Campo Agência não apareceu (URL atual: {page.url}) — a saltar")
        html = page.content()
        print(f"  [debug] HTML da página tem {len(html)} caracteres")
        return []

    if not select_agency_filter(page, agency_name):
        return []

    run_search(page)
    try:
        page.wait_for_selector(SEARCH_RESULTS_CARD_SELECTOR, timeout=15000)
    except PlaywrightTimeout:
        print(f"  [aviso] Sem resultados para \"{agency_name}\"")
        return []

    maximize_search_page_size(page)
    return scrape_search_all(page)


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
    if not AGENCIES:
        raise SystemExit("Falta MAXWORK_AGENCIES no ficheiro .env (nomes de agência a pesquisar, separados por vírgula)")

    print(f"[maxwork] {len(AGENCIES)} agência(s) a pesquisar: {', '.join(AGENCIES)}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=HEADLESS)
        context, page = open_session(browser)

        all_rows = []
        for agency_name in AGENCIES:
            all_rows.extend(scrape_agency(page, agency_name))

        context.close()
        browser.close()

    # O mesmo imóvel pode aparecer em mais do que uma pesquisa — dedup por código
    seen = set()
    rows = []
    for row in all_rows:
        codigo = row.get("codigo")
        if codigo and codigo in seen:
            continue
        if codigo:
            seen.add(codigo)
        rows.append(row)

    write_csv(rows)


if __name__ == "__main__":
    main()
