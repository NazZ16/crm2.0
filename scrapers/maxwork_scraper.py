"""
Scraper para páginas Maxwork (app.maxwork.pt) — "Compradores Encontrados".

A lista de qualificações (cartões QC...) fica DENTRO da mesma página do
imóvel (ex: /listing/details/7139446) e a paginação é feita em JavaScript,
sem mudar o URL — há um botão "página seguinte" e um campo de número de
página. Por isso o script não itera URLs para a paginação: entra na
página do imóvel uma vez, lê os cartões, clica em "seguinte", lê outra
vez, até a última página.

Login e sessão partilhados com os outros scrapers Maxwork (maxwork_common.py):
credenciais em MAXWORK_EMAIL/MAXWORK_PASSWORD no .env desta pasta (nunca no
código), e a mesma sessão gravada (maxwork_session.json) — corre este script
depois de qualquer um dos outros e não pede login outra vez.

Instalação (uma vez só):
    pip install playwright --break-system-packages
    playwright install chromium

Uso:
    python3 maxwork_scraper.py
"""

import csv
import re
import time
import unicodedata

from playwright.sync_api import sync_playwright

from maxwork_common import launch_browser, open_session

# ──────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO — ajusta isto para cada caso de uso
# ──────────────────────────────────────────────────────────────────
CONFIG = {
    # --- Páginas de imóvel a percorrer ---
    # Cada uma tem a sua própria lista paginada de "Compradores Encontrados"
    "listing_urls": [
        "https://app.maxwork.pt/sellermatch/details/7139459",
        "https://app.maxwork.pt/sellermatch/details/7139463",
        "https://app.maxwork.pt/sellermatch/details/7139446",
        # adiciona mais URLs de imóveis aqui, se quiseres
    ],

    # --- Seletores dentro de cada cartão (sm-card) ---
    "card_selector": "div.sm-card",
    "selectors": {
        "code": "a.sm-card__title-link",   # texto completo, ex: "QC5396950 - Family"
        "name": ".sm-card__agent-name",
        "contact": ".sm-card__agent-phone",
        "email": ".sm-card__agent-link",
        "meta_item": ".sm-card__meta-item",
        "field_label": ".sm-card__field-label",
        "field_value": ".sm-card__field-value",
    },
    # Palavra-chave (sem acentos, minúsculas) a procurar no field-label
    # para identificar o campo de preço/limite máximo do imóvel
    "limite_maximo_keyword": "preco do imovel",

    # --- Paginação interna (sem mudar o URL) ---
    "next_page_selector": "li.page-item.next-item a.page-link",
    "next_page_disabled_selector": "li.page-item.next-item.disabled",

    # --- Marcar automaticamente como "Contactado" (AÇÃO REAL no CRM) ---
    # DESLIGADO por defeito — muda para True só quando tiveres a certeza.
    # Marca TODOS os cartões lidos como Contactado (sem filtro de orçamento).
    "mark_as_contacted": False,
    "contacted_button_text": "Contactado",
    "confirm_ok_selector": "button.btn.btn-primary:has-text('Ok')",
    "modal_overlay_selector": "div.modal.show",

    # --- Output ---
    "output_csv": "resultados_maxwork.csv",
    "wait_seconds": 1.2,

    # --- Integração com o Excel da macro EnviarMensagensWhatsApp ---
    # DESLIGADO por defeito. Requer: pip install openpyxl
    "write_to_xlsm": False,
    "xlsm_path": "Whatsapp_message.xlsm",       # ficheiro template (com a macro)
    "xlsm_output_path": None,                    # None = sobrescreve o mesmo ficheiro
    "xlsm_public_listing_url": "",               # link público remax.pt para a célula D1
}


def strip_accents(text):
    """Remove acentos para comparação insensível a acentuação (não altera o texto exibido)."""
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(c for c in normalized if not unicodedata.combining(c))


def extract_qc_code(text):
    """De 'QC5197374 - Family' devolve só 'QC5197374'."""
    if not text:
        return text
    match = re.match(r"\s*(QC\d+)", text, re.IGNORECASE)
    if match:
        return match.group(1)
    return text.split(" - ")[0].strip()


def normalize_phone(text):
    """Deixa só dígitos e remove o indicativo 351 do início, se presente."""
    if not text:
        return text
    digits = re.sub(r"\D", "", text)
    if digits.startswith("351") and len(digits) > 9:
        digits = digits[-9:]
    return digits


def extract_limite_maximo(card, cfg):
    """
    Procura, entre os pares label/value do cartão, o campo cujo label
    corresponde a 'Limite Máximo'. Devolve o valor só se existir e for
    diferente de 'N/D'; caso contrário devolve None.
    """
    keyword = cfg["limite_maximo_keyword"]
    items = card.query_selector_all(cfg["selectors"]["meta_item"])
    for item in items:
        label_el = item.query_selector(cfg["selectors"]["field_label"])
        value_el = item.query_selector(cfg["selectors"]["field_value"])
        if not label_el or not value_el:
            continue
        label = strip_accents(label_el.inner_text().strip()).lower()
        if keyword in label:
            value = value_el.inner_text().strip().replace("\xa0", " ")
            if value and value.upper() != "N/D":
                return value
            return None
    return None


def extract_cards(page, cfg, listing_url):
    """Lê todos os cartões (sm-card) visíveis na página atual, sem filtro."""
    rows = []
    cards = page.query_selector_all(cfg["card_selector"])
    for card in cards:
        code_el = card.query_selector(cfg["selectors"]["code"])
        name_el = card.query_selector(cfg["selectors"]["name"])
        contact_el = card.query_selector(cfg["selectors"]["contact"])
        email_el = card.query_selector(cfg["selectors"]["email"])

        name_text = name_el.inner_text().strip() if name_el else None
        contact_text = contact_el.inner_text().strip() if contact_el else None
        code_text = code_el.inner_text().strip() if code_el else None

        first_name = name_text.split()[0] if name_text else None
        code_only = extract_qc_code(code_text)
        limite_maximo = extract_limite_maximo(card, cfg)  # informativo, já não filtra
        email_text = email_el.inner_text().strip() if email_el else None

        detail_href = code_el.get_attribute("href") if code_el else None

        rows.append({
            "listing_url": listing_url,
            "code": code_only,
            "name": first_name,
            "contact": normalize_phone(contact_text),
            "email": email_text,
            "limite_maximo": limite_maximo,
            "_detail_href": detail_href,     # uso interno, não vai para o CSV
        })
    return rows


def click_card_button_and_confirm(page, detail_href, button_text, cfg):
    """
    Localiza de novo o cartão pelo seu link único (detail_href), clica no
    botão indicado (por texto) e confirma no modal 'Ok'. Volta a procurar
    o cartão em vez de reutilizar o handle antigo, porque o DOM pode ter
    mudado entretanto (ex: outro cartão processado antes deste).
    """
    if not detail_href:
        return False
    card_selector = f"{cfg['card_selector']}:has(a[href='{detail_href}'])"

    # Garante que não fica nenhum modal anterior ainda a fechar (animação),
    # senão bloqueia os cliques seguintes ("intercepts pointer events").
    try:
        page.wait_for_selector(cfg["modal_overlay_selector"], state="hidden", timeout=8000)
    except Exception:
        pass

    # Tenta várias vezes com espera: depois de processar um cartão, a lista
    # pode levar uns segundos a recarregar antes do próximo cartão reaparecer.
    card = None
    for attempt in range(4):
        card = page.query_selector(card_selector)
        if card:
            break
        time.sleep(1.5)

    if not card:
        print(f"     AVISO: não encontrei o cartão para '{button_text}' (href={detail_href})")
        return False

    btn = card.query_selector(f"button:has-text('{button_text}')")
    if not btn:
        print(f"     AVISO: botão '{button_text}' não encontrado (href={detail_href})")
        return False

    try:
        btn.click(timeout=15000)
    except Exception as e:
        print(f"     AVISO: falha ao clicar em '{button_text}' (href={detail_href}): {e}")
        return False

    try:
        page.wait_for_selector(cfg["confirm_ok_selector"], timeout=5000)
        page.click(cfg["confirm_ok_selector"])
        # Espera o modal fechar por completo (animação de saída) antes de
        # devolver o controlo — evita que o próximo clique bata num modal
        # ainda visível.
        page.wait_for_selector(cfg["modal_overlay_selector"], state="hidden", timeout=8000)
    except Exception:
        print(f"     AVISO: modal de confirmação não apareceu (href={detail_href})")
        return False

    # Espera o PRÓPRIO cartão marcado desaparecer da lista — sinal real de
    # que a lista já recarregou, em vez de networkidle (a página tem
    # widgets de fundo com pedidos periódicos, ver login() em
    # maxwork_common.py — networkidle pode nunca disparar) + sleep fixo
    # de +2s (mais lento do que precisa quando o servidor responde depressa,
    # e ainda pode não chegar quando está mais lento).
    if not wait_for_card_removed(page, cfg, detail_href):
        print(f"     AVISO: cartão ainda visível depois de marcar (href={detail_href}) — a continuar mesmo assim")
    return True


def mark_card_as_contacted(page, detail_href, cfg):
    return click_card_button_and_confirm(page, detail_href, cfg["contacted_button_text"], cfg)


def wait_for_card_removed(page, cfg, detail_href, timeout_ms: int = 10000, poll_ms: int = 300) -> bool:
    """Espera por polling curto que um cartão específico (pelo seu href
    único) deixe de existir no DOM — marcar como Contactado remove-o da
    lista 'Novos' (é nisto que scrape_listing_with_marking já confia para
    detetar progresso). Devolve False se continuar visível depois do
    timeout, sem levantar exceção — quem chama decide o que fazer."""
    if not detail_href:
        return True
    card_selector = f"{cfg['card_selector']}:has(a[href='{detail_href}'])"
    elapsed = 0
    while elapsed < timeout_ms:
        if page.query_selector(card_selector) is None:
            return True
        page.wait_for_timeout(poll_ms)
        elapsed += poll_ms
    return False


def has_next_page(page, cfg):
    """True se o botão 'página seguinte' existir e não estiver desativado."""
    disabled = page.query_selector(cfg["next_page_disabled_selector"])
    if disabled:
        return False
    next_btn = page.query_selector(cfg["next_page_selector"])
    return next_btn is not None


def first_card_key(page, cfg) -> str | None:
    """Href (único por cartão) do 1º cartão da página atual — usado para
    confirmar que a grelha mudou mesmo depois de clicar em "seguinte", em
    vez de confiar num sleep fixo. Mesma razão do wait_for_new_first_card
    em maxwork_to_csv.py: a grelha pode continuar visualmente "com
    cartões" a meio da transição, ainda com os da página anterior."""
    card = page.query_selector(cfg["card_selector"])
    if not card:
        return None
    code_el = card.query_selector(cfg["selectors"]["code"])
    return code_el.get_attribute("href") if code_el else None


def wait_for_new_first_card(page, cfg, previous_first: str | None, timeout_ms: int = 10000, poll_ms: int = 300) -> bool:
    """Espera (por polling curto) que o 1º cartão mude a sério depois de
    paginar. Devolve False se nunca mudar dentro do timeout — sinal de
    que já não há página seguinte a sério, mesmo que o botão "seguinte"
    continue visualmente ativo."""
    elapsed = 0
    while elapsed < timeout_ms:
        page.wait_for_timeout(poll_ms)
        elapsed += poll_ms
        current = first_card_key(page, cfg)
        if current is not None and current != previous_first:
            return True
    return False


def advance_to_next_page(page, cfg, previous_first: str | None, attempts: int = 3) -> bool:
    """Clica em "seguinte" e espera que o 1º cartão mude a sério — antes
    de assumir que já não há mais páginas, tenta clicar outra vez em vez
    de desistir logo à primeira espera falhada (a página seguinte pode só
    ter demorado mais do que o normal nesse momento)."""
    for attempt in range(1, attempts + 1):
        page.click(cfg["next_page_selector"])
        if wait_for_new_first_card(page, cfg, previous_first):
            return True
        if attempt < attempts:
            print(f"     [aviso] a página seguinte ainda não chegou (tentativa {attempt}/{attempts}) — a tentar outra vez...")
    return False


def get_all_card_hrefs(page, cfg):
    """Devolve os hrefs de TODOS os cartões visíveis (incluindo os N/D, sem filtro)."""
    cards = page.query_selector_all(cfg["card_selector"])
    hrefs = []
    for card in cards:
        code_el = card.query_selector(cfg["selectors"]["code"])
        hrefs.append(code_el.get_attribute("href") if code_el else None)
    return hrefs


def scrape_listing_with_marking(page, cfg, listing_url):
    """
    Modo usado quando mark_as_contacted está ativo: como marcar um cartão
    o remove da lista 'Novos', a paginação não faz sentido — os cartões
    seguintes vão aparecendo automaticamente na página 1. Por isso fica-se
    sempre na página 1, lendo e marcando TODOS os cartões, até a lista ficar
    vazia (ou parar de haver progresso, por segurança).
    """
    all_rows = []
    previous_hrefs = None
    stagnant_rounds = 0
    round_num = 1

    while True:
        current_hrefs = get_all_card_hrefs(page, cfg)
        if not current_hrefs:
            print("  Não há mais cartões — concluído.")
            break

        if current_hrefs == previous_hrefs:
            stagnant_rounds += 1
        else:
            stagnant_rounds = 0

        if stagnant_rounds >= 2:
            print("  Sem progresso (os cartões continuam a falhar ao marcar) — a parar.")
            break

        print(f"  -> leitura {round_num} (página 1, {listing_url})")
        rows = extract_cards(page, cfg, listing_url)
        print(f"     {len(rows)} cartões nesta leitura")

        for row in rows:
            ok = mark_card_as_contacted(page, row["_detail_href"], cfg)
            status = "marcado" if ok else "FALHOU"
            print(f"     Contactado: {row['code']} -> {status}")

        all_rows.extend(rows)
        previous_hrefs = current_hrefs
        round_num += 1

    return all_rows


def scrape_listing_readonly(page, cfg, listing_url):
    """Modo normal (sem marcar Contactado): percorre todas as páginas com paginação."""
    all_rows = []
    page_num = 1
    while True:
        print(f"  -> a ler página {page_num} de {listing_url}")
        rows = extract_cards(page, cfg, listing_url)
        print(f"     {len(rows)} cartões encontrados nesta página")
        all_rows.extend(rows)

        if not has_next_page(page, cfg):
            break

        previous_first = first_card_key(page, cfg)
        if not advance_to_next_page(page, cfg, previous_first):
            print("     [aviso] botão 'seguinte' continua ativo mas a página não mudou — a considerar concluído")
            break
        page_num += 1

    return all_rows


def scrape_listing(page, cfg, listing_url):
    """Percorre a(s) página(s) internas de uma página de imóvel."""
    page.goto(listing_url)
    page.wait_for_load_state("networkidle")

    # Espera explicitamente que pelo menos um cartão apareça (a lista carrega
    # via JS depois do networkidle disparar, por isso não basta esperar o load).
    try:
        page.wait_for_selector(cfg["card_selector"], timeout=20000)
    except Exception:
        print(f"  AVISO: nenhum cartão apareceu em {listing_url} depois de 20s.")
        shot_path = f"debug_{int(time.time())}.png"
        try:
            page.screenshot(path=shot_path, full_page=True)
            print(f"  Screenshot de diagnóstico guardado em: {shot_path}")
        except Exception:
            pass
        print(f"  URL atual do browser: {page.url}")
        return []

    time.sleep(cfg["wait_seconds"])

    if cfg["mark_as_contacted"]:
        return scrape_listing_with_marking(page, cfg, listing_url)
    else:
        return scrape_listing_readonly(page, cfg, listing_url)


def merge_by_contact(rows):
    """
    Se o mesmo contacto aparecer em mais do que um cartão, junta os
    códigos QC (separados por ', ') numa única linha, em vez de criar
    linhas duplicadas. Mantém o nome/limite do primeiro registo desse contacto.
    """
    merged = {}
    order = []
    for row in rows:
        contact = row["contact"]
        if contact in merged:
            existing_codes = merged[contact]["code"].split(", ")
            if row["code"] not in existing_codes:
                merged[contact]["code"] += f", {row['code']}"
        else:
            merged[contact] = dict(row)
            order.append(contact)
    return [merged[c] for c in order]


def write_to_xlsm(cfg, merged_results):
    """
    Preenche a Sheet1 do ficheiro Excel da macro EnviarMensagensWhatsApp:
    A=telefone, K=nome, L=códigos QC, D1=link público do imóvel.
    Mantém a macro VBA intacta (keep_vba=True). Não mexe na Sheet2.
    """
    import openpyxl

    wb = openpyxl.load_workbook(cfg["xlsm_path"], keep_vba=True)
    ws1 = wb["Sheet1"]

    # Limpa dados antigos a partir da linha 2 (mantém o cabeçalho da linha 1)
    for r in range(2, ws1.max_row + 1):
        for col in ("A", "C", "K", "L", "M"):
            ws1[f"{col}{r}"] = None

    listing_link = cfg.get("xlsm_public_listing_url", "").strip()
    if not listing_link:
        listing_link = input(
            "\nCola aqui o link público do imóvel (remax.pt) para a célula D1: "
        ).strip()
    ws1["D1"] = listing_link

    for i, row in enumerate(merged_results, start=2):
        ws1[f"A{i}"] = row["contact"]
        ws1[f"K{i}"] = row["name"]
        ws1[f"L{i}"] = row["code"]
        ws1[f"C{i}"] = f"=AND(MATCH(A{i},Sheet2!A:A,0),MATCH(Sheet1!L{i},Sheet2!C:C,0))"

    output_path = cfg.get("xlsm_output_path") or cfg["xlsm_path"]
    wb.save(output_path)
    print(f"\nExcel atualizado: {output_path} ({len(merged_results)} contactos em Sheet1)")


def run(cfg):
    all_results = []
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        # Login + sessão partilhados com os outros scrapers Maxwork — mesmo
        # maxwork_session.json, mesmas credenciais do .env (MAXWORK_EMAIL/
        # MAXWORK_PASSWORD), mesma lógica de "sessão Microsoft ainda válida"
        # vs. login do zero. Não pede login outra vez se já correu outro
        # script da pipeline antes.
        context, page = open_session(browser)

        for listing_url in cfg["listing_urls"]:
            print(f"A processar: {listing_url}")
            try:
                rows = scrape_listing(page, cfg, listing_url)
                all_results.extend(rows)
            except Exception as e:
                print(f"  ERRO ao processar {listing_url}: {e}")
                print("  A continuar para o próximo imóvel (resultados já recolhidos ficam guardados).")
                continue

        browser.close()

    merged_results = merge_by_contact(all_results)

    with open(cfg["output_csv"], "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["listing_url", "code", "name", "contact", "email", "limite_maximo"],
            extrasaction="ignore",  # ignora campos internos como _detail_href
        )
        writer.writeheader()
        writer.writerows(merged_results)

    print(f"\nConcluído. {len(merged_results)} registos guardados em {cfg['output_csv']} "
          f"({len(all_results)} cartões lidos antes da junção por contacto)")

    if cfg["write_to_xlsm"]:
        try:
            write_to_xlsm(cfg, merged_results)
        except ImportError:
            print("\nAVISO: openpyxl não está instalado. Corre: pip install openpyxl")
        except Exception as e:
            print(f"\nAVISO: falha ao atualizar o Excel: {e}")


if __name__ == "__main__":
    run(CONFIG)
