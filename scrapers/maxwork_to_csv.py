#!/usr/bin/env python3
"""
Maxwork -> CSV (v2 — lê o ecrã diretamente, sem chamar a API interna)

A primeira versão tentava chamar a API interna do Maxwork diretamente,
mas essa API exige uma autenticação (token) que a app gere sozinha em
JavaScript e que não é trivial de replicar a partir de fora.

Esta versão segue o mesmo princípio do teu scraper de "Compradores
Encontrados", que já sabes que funciona: navega, espera o ecrã carregar,
e LÊ o que está visível — tal como um utilizador veria. Mais lento
(percorre páginas), mas garantido.

COMO USAR:
    1. pip install playwright python-dotenv
    2. playwright install chromium
    3. Cria um .env nesta pasta com:
           MAXWORK_EMAIL=elsiomota@remax.pt
           MAXWORK_PASSWORD=a-tua-password
           HEADLESS=false
           MAXWORK_URLS=https://app.maxwork.pt/listing/officelistings,https://app.maxwork.pt/listing/officelistings?outro-filtro
           MAXWORK_AGENCIES=4 You,Outra Agência
    4. python maxwork_to_csv.py
    5. Resultado: maxwork_imoveis.csv nesta pasta

MAXWORK_URLS aceita vários links (separados por vírgula ou por linha) —
útil para percorrer várias vistas/filtros guardados no Maxwork numa só
corrida. Se não definires nada, usa só o link por omissão (comportamento
de sempre). O mesmo imóvel é escrito uma única vez no CSV final, mesmo
que apareça em mais do que um link.

MAXWORK_AGENCIES pesquisa imóveis de OUTRAS agências (não só os teus/da
tua agência), usando a página /listing/search. Essa página filtra via
JavaScript (react-select) em vez de por URL — por isso não dá para usar
MAXWORK_URLS para isto; o script preenche o campo "Agência" sozinho para
cada nome que lhe deres. É uma página diferente da de "Imóveis da
Agência", com uma grelha de resultados diferente (mais rica em dados —
inclui o nome/telefone/email do agente responsável e o nome da agência
dele, que ficam na coluna extra "agencia").

NOTA: os cartões do modo "link" (MAXWORK_URLS) não têm um link direto para
a ficha do imóvel (por isso não há coluna de URL nesse caso — é preenchida
depois via escuta da API interna). Já os cartões do modo "agência"
(MAXWORK_AGENCIES) já trazem o link direto, não precisam desse truque. E
a ordem dos 4 campos numéricos de cada cartão do modo "link" (dias no
mercado / área / quartos / casas de banho) foi confirmada só para
Apartamentos — vale a pena conferir uma linha de cada tipo (Moradia,
Loja, Terreno, Quinta...) no CSV final, porque podem não ter exatamente
os mesmos 4 campos.
"""

import csv
import os
import re

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

load_dotenv()

EMAIL = os.getenv("MAXWORK_EMAIL", "")
PASSWORD = os.getenv("MAXWORK_PASSWORD", "")
HEADLESS = os.getenv("HEADLESS", "true").lower() != "false"
OUTPUT_CSV = "maxwork_imoveis.csv"

START_URL = "https://app.maxwork.pt/listing/officelistings"
SEARCH_URL = "https://app.maxwork.pt/listing/search"

MAXWORK_URLS_RAW = os.getenv("MAXWORK_URLS", "")
LISTING_URLS = [u.strip() for u in re.split(r"[,\n]+", MAXWORK_URLS_RAW) if u.strip()] or [START_URL]

MAXWORK_AGENCIES_RAW = os.getenv("MAXWORK_AGENCIES", "")
AGENCIES = [a.strip() for a in re.split(r"[,\n]+", MAXWORK_AGENCIES_RAW) if a.strip()]

EMAIL_SELECTOR = "input[name='loginfmt']"
EMAIL_NEXT_SELECTOR = "input[type='submit']"
PASSWORD_SELECTOR = "input[name='passwd']"
PASSWORD_SUBMIT_SELECTOR = "input[type='submit']"
STAY_SIGNED_IN_SELECTOR = "input#idSIButton9"
APP_LOADED_SELECTOR = "#search-term"

CARD_SELECTOR = "div.property-card"
GRID_VIEW_TOGGLE_SELECTOR = ".view-toggle .toggle-btn"  # 2º botão (índice 1) = vista em grelha
PAGE_SIZE_SELECT_SELECTOR = ".card-pagination-container select.custom-select"
NEXT_PAGE_SELECTOR = "li.page-item.next-item a.page-link"
NEXT_PAGE_DISABLED_SELECTOR = "li.page-item.next-item.disabled"
LISTING_API_FRAGMENT = "/api/Listing/ListWithOfficePagination"

# Página /listing/search — filtros por JS (react-select), não por URL
SEARCH_AGENCY_CONTROL_SELECTOR = '[data-id="officeId"] .select__control'
SEARCH_AGENCY_INPUT_SELECTOR = '[data-id="officeId"] input.select__input'
SEARCH_RESULTS_CARD_SELECTOR = ".ecommerce-card"
SEARCH_PAGE_SIZE_SELECT_SELECTOR = "select.custom-select"


def attach_api_listener(page):
    """
    Escuta passivamente as respostas da API de listagem que o PRÓPRIO
    BROWSER já faz sozinho ao carregar/paginar a grelha (com a
    autenticação dele, que já sabemos que funciona) — em vez de tentarmos
    replicar esse pedido a partir do Python, o que exigiria reconstruir a
    autenticação da app. Constrói um dicionário {codigo: item da API},
    para conseguirmos o ID interno de cada imóvel e montar o URL da ficha.
    """
    items_by_codigo = {}

    def handler(response):
        if LISTING_API_FRAGMENT not in response.url:
            return
        if response.request.method != "POST":
            return
        try:
            data = response.json()
        except Exception:
            return
        for item in data.get("items", []):
            codigo = item.get("listingTitle")
            if codigo:
                items_by_codigo[codigo] = item

    page.on("response", handler)
    return items_by_codigo


def login(page):
    print("A abrir o Maxwork...")
    page.goto(LISTING_URLS[0])
    page.wait_for_load_state("networkidle")

    if page.query_selector(EMAIL_SELECTOR):
        print("A fazer login...")
        page.fill(EMAIL_SELECTOR, EMAIL)
        page.click(EMAIL_NEXT_SELECTOR)
        page.wait_for_selector(PASSWORD_SELECTOR, timeout=15000)
        page.fill(PASSWORD_SELECTOR, PASSWORD)
        page.click(PASSWORD_SUBMIT_SELECTOR)
        try:
            page.wait_for_selector(STAY_SIGNED_IN_SELECTOR, timeout=8000)
            page.click(STAY_SIGNED_IN_SELECTOR)
        except Exception:
            pass
        page.wait_for_load_state("networkidle")

    page.wait_for_selector(APP_LOADED_SELECTOR, timeout=20000)
    print("Login OK.")


def switch_to_grid_view(page):
    try:
        page.locator(GRID_VIEW_TOGGLE_SELECTOR).nth(1).click()
        page.wait_for_timeout(500)
    except Exception:
        pass  # se falhar, seguimos com a vista que já estiver ativa
    page.wait_for_selector(CARD_SELECTOR, timeout=15000)


def maximize_page_size(page):
    """Tenta mostrar 100 por página em vez de 10, para reduzir o nº de páginas."""
    try:
        page.select_option(PAGE_SIZE_SELECT_SELECTOR, "100")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        print("Tamanho de página ajustado para 100.")
    except Exception:
        print("Não consegui aumentar o tamanho de página — a seguir com o valor por defeito (10).")


def parse_number(text):
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


def extract_cards(page):
    rows = []
    cards = page.query_selector_all(CARD_SELECTOR)
    for card in cards:
        badges = [b.inner_text().strip() for b in card.query_selector_all(".badge-overlay-custom")]
        tipo = badges[0] if len(badges) > 0 else None
        transacao = badges[1] if len(badges) > 1 else None
        estado = badges[2] if len(badges) > 2 else None

        price_el = card.query_selector(".price-value")
        codigo_el = card.query_selector(".property-id")
        titulo_el = card.query_selector(".property-title")
        morada_el = card.query_selector(".property-address")

        fields = [f.inner_text().strip() for f in card.query_selector_all(".dynamic-field-value")]
        dias_mercado = fields[0] if len(fields) > 0 else None
        area = fields[1] if len(fields) > 1 else None
        quartos = fields[2] if len(fields) > 2 else None
        wc = fields[3] if len(fields) > 3 else None

        agente_el = card.query_selector(".agent-name")
        contactos = [c.inner_text().strip() for c in card.query_selector_all(".agent-detail-item")]
        telefone = contactos[0] if len(contactos) > 0 else None
        email = contactos[1] if len(contactos) > 1 else None

        img_el = card.query_selector(".card-img")

        rows.append({
            "codigo": codigo_el.inner_text().strip() if codigo_el else None,
            "titulo": titulo_el.inner_text().strip() if titulo_el else None,
            "tipo": tipo,
            "transacao": transacao,
            "estado": estado,
            "preco": parse_number(price_el.inner_text() if price_el else None),
            "area_m2": parse_number(area),
            "quartos": quartos,
            "casas_banho": wc,
            "dias_mercado": dias_mercado,
            "morada": morada_el.inner_text().strip() if morada_el else None,
            "foto_capa": img_el.get_attribute("src") if img_el else None,
            "agente": agente_el.inner_text().strip() if agente_el else None,
            "telefone_agente": telefone,
            "email_agente": email,
        })
    return rows


def has_next_page(page):
    if page.query_selector(NEXT_PAGE_DISABLED_SELECTOR):
        return False
    return page.query_selector(NEXT_PAGE_SELECTOR) is not None


def scrape_all(page):
    all_rows = []
    page_num = 1
    while True:
        print(f"A ler página {page_num}...")
        rows = extract_cards(page)
        print(f"  {len(rows)} imóveis nesta página")
        all_rows.extend(rows)

        if not has_next_page(page):
            break

        page.click(NEXT_PAGE_SELECTOR)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(600)
        page_num += 1

    return all_rows


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
    page.get_by_role("button", name="Ver Resultados").first.click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)


def maximize_search_page_size(page):
    try:
        page.select_option(SEARCH_PAGE_SIZE_SELECT_SELECTOR, "100")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
    except Exception:
        print("  [aviso] não consegui aumentar o tamanho de página na pesquisa")


def extract_search_cards(page) -> list[dict]:
    """Extrai os cartões da pesquisa global (/listing/search) — estrutura
    de HTML diferente da grelha de 'Imóveis da Agência', mas com atributos
    data-class estáveis para cada campo."""
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
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)
        page_num += 1

    return all_rows


def scrape_agency(page, agency_name: str) -> list[dict]:
    print(f"\n[maxwork] === Agência: {agency_name} ===")
    page.goto(SEARCH_URL, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    try:
        page.wait_for_selector(SEARCH_AGENCY_INPUT_SELECTOR, timeout=15000)
    except PlaywrightTimeout:
        print("  [aviso] Página de pesquisa não carregou o campo Agência — a saltar")
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

    print(f"[maxwork] {len(LISTING_URLS)} link(s) a percorrer")
    if AGENCIES:
        print(f"[maxwork] {len(AGENCIES)} agência(s) a pesquisar: {', '.join(AGENCIES)}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=HEADLESS)
        context = browser.new_context(locale="pt-PT")
        page = context.new_page()

        items_by_codigo = attach_api_listener(page)

        login(page)

        all_rows = []
        for i, url in enumerate(LISTING_URLS, start=1):
            print(f"\n[maxwork] === Link {i}/{len(LISTING_URLS)}: {url} ===")
            if i > 1:
                page.goto(url)
                page.wait_for_load_state("networkidle")
            switch_to_grid_view(page)
            maximize_page_size(page)
            all_rows.extend(scrape_all(page))

        for agency_name in AGENCIES:
            all_rows.extend(scrape_agency(page, agency_name))

        browser.close()

    # O mesmo imóvel pode aparecer em mais do que um link/agência — dedup por código
    seen = set()
    rows = []
    for row in all_rows:
        codigo = row.get("codigo")
        if codigo and codigo in seen:
            continue
        if codigo:
            seen.add(codigo)
        rows.append(row)

    # Só os cartões do modo "link" (MAXWORK_URLS) precisam deste fallback —
    # não têm href direto, por isso o id/url vêm da escuta da API interna.
    # Os cartões do modo "agência" já trazem o url preenchido diretamente.
    faltantes = 0
    for row in rows:
        if row.get("url"):
            continue
        api_item = items_by_codigo.get(row["codigo"])
        listing_id = api_item.get("id") if api_item else None
        row["id_interno"] = listing_id
        row["url"] = f"https://app.maxwork.pt/listing/details/{listing_id}" if listing_id else None
        if not listing_id:
            faltantes += 1
    if faltantes:
        print(f"[aviso] {faltantes} imóveis sem URL (não apanhados pela escuta da API)")

    write_csv(rows)


if __name__ == "__main__":
    main()
