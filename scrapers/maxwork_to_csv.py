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

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser, parse_number

OUTPUT_CSV = "maxwork_imoveis.csv"

MAXWORK_AGENCIES_RAW = os.getenv("MAXWORK_AGENCIES", "")
AGENCIES = [a.strip() for a in re.split(r"[,\n]+", MAXWORK_AGENCIES_RAW) if a.strip()]

NEXT_PAGE_SELECTOR = "li.page-item.next-item a.page-link"
NEXT_PAGE_DISABLED_SELECTOR = "li.page-item.next-item.disabled"

# Página /listing/search — filtros por JS (react-select), não por URL
SEARCH_AGENCY_CONTROL_SELECTOR = '[data-id="officeId"] .select__control'
SEARCH_AGENCY_INPUT_SELECTOR = '[data-id="officeId"] input.select__input'
SEARCH_RESULTS_CARD_SELECTOR = ".property-card"

# Extrai o ID interno do imóvel a partir do src da foto de capa —
# "/listings/{officeId}/{internalId}/{photoUuid}.jpg". A Maxwork deixou de
# pôr um <a href="/listing/details/{id}"> no cartão (mudança de HTML de
# ago/2026), este é o único sítio onde o ID interno ainda aparece.
_IMAGE_ID_RE = re.compile(r"/listings/\d+/(\d+)/")
SEARCH_PAGE_SIZE_SELECT_SELECTOR = "select.custom-select"


def has_next_page(page):
    if page.query_selector(NEXT_PAGE_DISABLED_SELECTOR):
        return False
    return page.query_selector(NEXT_PAGE_SELECTOR) is not None


def ensure_filters_open(page):
    """Garante que o painel de filtros (onde vive o campo "Agência") está
    visível. A Maxwork recolhe este painel sozinha a seguir a "Ver
    Resultados" — o botão passa de "Esconder Filtros" a "Ver Filtros" — e
    sem o reabrir o campo Agência continua no DOM mas invisível: um clique
    nele fica preso ~30s à espera que fique visível, sem nunca conseguir
    (foi o que aconteceu ao mudar de agência sem recarregar a página)."""
    toggle = page.get_by_role("button", name="Ver Filtros")
    if toggle.count() > 0:
        toggle.first.click()
        page.wait_for_timeout(500)


def ensure_more_filters_open(page):
    """O campo "Agência" só fica acessível depois de clicar em "Ver Mais"
    — os filtros avançados (onde a Agência vive) ficam escondidos por
    omissão desde a mudança de HTML de ago/2026. Sem este clique o campo
    Agência continua inacessível e a espera por ele expira. Uma vez
    aberto o botão passa a "Ver Menos" e get_by_role deixa de o encontrar
    por este nome — por isso é seguro chamar isto em cada agência sem
    voltar a fechar os filtros avançados sem querer."""
    toggle = page.get_by_role("button", name="Ver Mais")
    if toggle.count() > 0:
        toggle.first.click()
        page.wait_for_timeout(500)


def select_agency_filter(page, agency_name: str, attempts: int = 3) -> bool:
    """Escreve o nome no campo react-select 'Agência' e escolhe a primeira
    opção correspondente. Devolve False se não aparecer nenhuma opção
    (nome não bate certo com o que o Maxwork tem registado).
    Clica na caixa toda (.select__control) em vez do input isolado — o
    texto do placeholder ("Agência") fica visualmente por cima do input
    e intercepta o clique se se tentar clicar só no input.

    A lista de agências deste campo é carregada de forma assíncrona (só
    depois de escrever é que o Maxwork vai buscar as opções ao servidor)
    — logo a seguir a um load/reload da página essa lista às vezes ainda
    não está pronta e o dropdown aparece vazio, mesmo com o nome certo.
    Por isso tenta várias vezes antes de desistir."""
    for attempt in range(1, attempts + 1):
        page.locator(SEARCH_AGENCY_CONTROL_SELECTOR).click()
        field = page.locator(SEARCH_AGENCY_INPUT_SELECTOR)
        field.wait_for(state="visible", timeout=5000)
        field.fill(agency_name)
        try:
            option = page.locator(".select__menu .select__option", has_text=agency_name).first
            option.wait_for(timeout=8000)
            option.click()
            page.wait_for_timeout(300)  # dá tempo ao estado do react-select assentar antes de pesquisar
            return True
        except PlaywrightTimeout:
            options = page.locator(".select__menu .select__option").all_inner_texts()
            if options:
                # o dropdown abriu com opções a sério, só nenhuma bate certo
                # com o nome — não vale a pena repetir, o nome é que está errado
                print(f"  [aviso] Nenhuma agência encontrada para \"{agency_name}\" — a saltar")
                print(f"  [debug] opções visíveis no dropdown: {options}")
                return False
            if attempt < attempts:
                print(f"  [aviso] dropdown ainda sem opções (tentativa {attempt}/{attempts}) — a tentar outra vez...")
                page.keyboard.press("Escape")
                page.wait_for_timeout(1500)
            else:
                print(f"  [aviso] Nenhuma agência encontrada para \"{agency_name}\" — a saltar")
                print("  [debug] dropdown sem opções visíveis (menu pode não ter aberto) após várias tentativas")
    return False


def run_search(page):
    # Sem wait_for_load_state("networkidle") de propósito — os widgets de
    # fundo (chat, analytics) fazem pedidos periódicos que nunca deixam a
    # rede "parada", por isso essa espera podia ficar presa até ao timeout
    # (30s) antes sequer de tentar ler os resultados. Quem espera mesmo
    # pelos resultados é o wait_for_selector(SEARCH_RESULTS_CARD_SELECTOR)
    # em scrape_agency(), que verifica o DOM diretamente.
    print("  a clicar em \"Ver Resultados\"...")
    page.get_by_role("button", name="Ver Resultados").first.click()
    page.wait_for_timeout(1500)


def first_card_key(page) -> str | None:
    """Assinatura (src da foto de capa) do 1º cartão de resultados no ecrã.
    A Maxwork atualiza o número em "Total de imóveis encontrados" assim que
    se muda de agência, mas os CARTÕES por baixo continuam a ser os da
    pesquisa anterior até a grelha atualizar a sério — por isso não chega
    verificar que existe ALGUM cartão, é preciso confirmar que já não é o
    mesmo de antes de pesquisar. Usa o src da imagem em vez do href porque
    os cartões deixaram de ter um <a href="/listing/details/..."> (mudança
    de HTML de ago/2026)."""
    card = page.query_selector(SEARCH_RESULTS_CARD_SELECTOR)
    if not card:
        return None
    img = card.query_selector("img")
    return img.get_attribute("src") if img else None


def wait_for_results(page, agency_name: str, previous_first: str | None, attempts: int = 3) -> bool:
    """Espera que a grelha de resultados atualize a sério depois de clicar
    "Ver Resultados" — não só que apareça ALGUM cartão (podem ser os da
    pesquisa anterior, ver first_card_key()), mas que o 1º cartão seja
    diferente do que estava lá antes. Se não atualizar, ou se não aparecer
    cartão nenhum, volta a clicar em "Ver Resultados" e tenta de novo."""
    for attempt in range(1, attempts + 1):
        try:
            page.wait_for_selector(SEARCH_RESULTS_CARD_SELECTOR, timeout=15000)
            if previous_first is None or first_card_key(page) != previous_first:
                return True
            print(f"  [aviso] resultados ainda são os da pesquisa anterior (tentativa {attempt}/{attempts})")
        except PlaywrightTimeout:
            print(f"  [aviso] cartões ainda não apareceram (tentativa {attempt}/{attempts})")

        if attempt < attempts:
            print("  a repetir a pesquisa...")
            run_search(page)
        else:
            print(f"  [aviso] Sem resultados (novos) para \"{agency_name}\" após {attempts} tentativas")
    return False


def maximize_search_page_size(page):
    print("  a aumentar o tamanho de página da pesquisa...")
    try:
        page.select_option(SEARCH_PAGE_SIZE_SELECT_SELECTOR, "100")
        page.wait_for_timeout(1500)
    except Exception:
        print("  [aviso] não consegui aumentar o tamanho de página na pesquisa")


# Lê os ~100 cartões da página de uma só vez dentro do browser (1 chamada
# JS) em vez de um query_selector/inner_text por campo por cartão em
# Python — com 100 cartões x ~10 campos isso eram ~1000 idas-e-voltas
# Python<->browser por página, cada uma com o seu bocadinho de latência;
# tudo dentro do próprio browser é ordens de magnitude mais rápido.
# A Maxwork mudou o HTML da página de pesquisa (ago/2026): já não há
# atributos data-class nem <a href> no cartão — os campos agora vivem em
# classes fixas (.badges-top-left, .price-box, .dynamic-fields-zone,
# .agent-section) e o ID interno só existe embutido no src da foto.
_EXTRACT_CARDS_JS = """
() => Array.from(document.querySelectorAll('.property-card')).map((card) => {
    const text = (el) => el ? el.innerText.trim() : null;

    const img = card.querySelector('img');
    const imgSrc = img ? img.getAttribute('src') : null;

    // Ordem confirmada nos cartões: estado, transação, tipo, eficiência energética
    const badges = Array.from(card.querySelectorAll('.badges-top-left .badge-overlay-custom')).map((b) => b.innerText.trim());

    const titleEl = card.querySelector('.property-title');
    const titulo = titleEl ? titleEl.innerText.trim() : null;
    const freguesia = text(card.querySelector('.property-id'));

    const addressEl = card.querySelector('.property-address');
    const morada = addressEl ? addressEl.getAttribute('title') : null;

    const preco_raw = text(card.querySelector('.price-box .price-value'));

    // Ordem confirmada (por forma do ícone SVG): quartos, casas de banho, garagem, área
    const dynFields = Array.from(card.querySelectorAll('.dynamic-fields-zone .dynamic-field-value')).map((el) => el.innerText.trim());

    const agentNameText = text(card.querySelector('.agent-section .agent-name'));
    const detailItems = Array.from(card.querySelectorAll('.agent-details .agent-detail-item')).map((el) => el.innerText.trim());

    return {
        imgSrc,
        estado_raw: badges[0] || null,
        transacao: badges[1] || null,
        tipo: badges[2] || null,
        titulo,
        freguesia,
        morada,
        preco_raw,
        quartos: dynFields[0] || null,
        casas_banho: dynFields[1] || null,
        area_raw: dynFields[3] || null,
        agentNameText,
        detailItems,
    };
})
"""


def extract_search_cards(page) -> list[dict]:
    """Extrai os cartões da pesquisa global (/listing/search)."""
    rows = []
    for c in page.evaluate(_EXTRACT_CARDS_JS):
        try:
            img_src = c.get("imgSrc") or ""
            id_match = _IMAGE_ID_RE.search(img_src)
            id_interno = id_match.group(1) if id_match else None
            url = f"https://app.maxwork.pt/listing/details/{id_interno}" if id_interno else None

            title_text = c.get("titulo") or ""
            codigo = title_text.split(" / ", 1)[0].strip() if title_text else None

            agent_name_text = c.get("agentNameText") or ""
            if " - " in agent_name_text:
                agencia, agente = agent_name_text.split(" - ", 1)
            else:
                agencia, agente = None, agent_name_text or None

            telefone_agente, email_agente = None, None
            for item in c.get("detailItems") or []:
                if "@" in item:
                    email_agente = item
                elif item:
                    telefone_agente = item

            rows.append({
                "codigo": codigo,
                "titulo": title_text or None,
                "tipo": c.get("tipo"),
                "transacao": c.get("transacao"),
                "estado": c.get("estado_raw"),
                "preco": parse_number(c.get("preco_raw")),
                "area_m2": parse_number(c.get("area_raw")),
                "quartos": c.get("quartos"),
                "casas_banho": c.get("casas_banho"),
                "dias_mercado": None,
                "morada": c.get("morada") or c.get("freguesia"),
                "foto_capa": img_src or None,
                "agente": agente.strip() if agente else None,
                "telefone_agente": telefone_agente,
                "email_agente": email_agente,
                "agencia": agencia.strip() if agencia else None,
                "id_interno": id_interno,
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

    # Nada de reload da página entre agências: a pesquisa filtra por JS
    # sem mudar de URL, por isso um reload não limpa nada (a Maxwork guarda
    # o último filtro usado e volta a mostrá-lo) — só torna a página mais
    # lenta e instável a repetir todo o carregamento inicial. Basta reabrir
    # o painel de filtros (ensure_filters_open) e mudar a Agência no sítio.
    ensure_filters_open(page)
    ensure_more_filters_open(page)

    try:
        page.wait_for_selector(SEARCH_AGENCY_INPUT_SELECTOR, timeout=25000)
    except PlaywrightTimeout:
        print(f"  [aviso] Campo Agência não apareceu (URL atual: {page.url}) — a saltar")
        html = page.content()
        print(f"  [debug] HTML da página tem {len(html)} caracteres")
        return []

    if not select_agency_filter(page, agency_name):
        return []

    previous_first = first_card_key(page)
    run_search(page)
    if not wait_for_results(page, agency_name, previous_first):
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
        browser = launch_browser(pw)
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
