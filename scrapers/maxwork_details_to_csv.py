#!/usr/bin/env python3
"""
Maxwork -> CSV (detalhe de cada imóvel)

Lê "maxwork_imoveis.csv" (gerado pelo maxwork_to_csv.py) e, para cada
imóvel com "url" preenchido, entra na ficha e recolhe: descrição
completa, título curto, badges (Ativo/Publicado), morada completa,
localização (concelho/freguesia/distrito/lat/long), áreas, e fotos.

A maior parte dos campos usa atributos data-id (ex: dd[data-id="totalArea"])
que a própria app usa internamente — muito mais fiável do que depender
de classes CSS genéricas.

Antes de começar, consulta o CRM (CRM_API_URL/SCRAPER_API_KEY) para saber
que imóveis já lá existem (por source_url). Para esses, só entra na ficha
para ler o essencial (estado/publicado) e salta fotos, descrição e
características — é aí que está a maior parte do tempo de execução. Só faz
a extração completa para imóveis novos, que o CRM ainda não conhece.

Sobre as fotos: os URLs do Maxwork são públicos (confirmado — carregam sem
sessão), por isso o CRM guarda e mostra as fotos diretamente a partir
desses links, sem precisar dos ficheiros. Por omissão (DOWNLOAD_PHOTOS =
False) este script só lê os URLs, não descarrega nada — muda para True só
se quiseres mesmo uma cópia local em fotos/.

COMO USAR:
    1. Corre primeiro o maxwork_to_csv.py (produz maxwork_imoveis.csv)
    2. Garante que tens o mesmo .env (MAXWORK_EMAIL, MAXWORK_PASSWORD,
       CRM_API_URL, SCRAPER_API_KEY)
    3. python maxwork_details_to_csv.py
    4. Resultado: maxwork_imoveis_detalhado.csv nesta pasta

Também recolhe 3 sinais úteis para triar possíveis negócios (imóvel há
muito tempo no mercado sem visitas/propostas costuma ser oportunidade
de negociação): dias no mercado, nº de visitas, nº de propostas. São
baratos de ler (só texto, sem fotos), por isso são lidos mesmo na
passagem "leve" de imóveis já conhecidos do CRM.

NOTA: isto continua a visitar 1 página por imóvel (233 páginas) — mas para
os que já existem no CRM a visita é rápida (só os badges/sinais, sem
fotos). Se quiseres testar rápido primeiro, edita LIMIT abaixo (ex: 5)
para só processar os primeiros N.
"""

import csv
import os
import re

import requests
from playwright.sync_api import sync_playwright

from maxwork_common import EMAIL, PASSWORD, HEADLESS, CRM_API_URL, SCRAPER_API_KEY, login, parse_number

INPUT_CSV = "maxwork_imoveis.csv"
OUTPUT_CSV = "maxwork_imoveis_detalhado.csv"
LIMIT = 5  # ex: 5 para testar só os primeiros 5; None = todos

DOWNLOAD_PHOTOS = False  # True só se quiseres cópia local em fotos/ — o CRM usa
                          # diretamente os URLs do Maxwork (confirmado públicos,
                          # não exigem login), por isso não precisa dos ficheiros
PHOTOS_TAB_TEXT = "Media e Documentos"
PHOTOS_DIR = "fotos"  # pasta onde ficam as imagens descarregadas, uma subpasta por imóvel (só se DOWNLOAD_PHOTOS=True)


def dd_text(page, data_id):
    el = page.query_selector(f'dd[data-id="{data_id}"]')
    if not el:
        return None
    text = el.inner_text().strip()
    return text if text else None


def dt_dd_text(page, label):
    """Para campos SEM data-id (ex: Elevador, Carregamento carros elétricos):
    procura um <dt> cujo texto seja este label e devolve o texto do <dd>
    logo a seguir — mesmo padrão dt/dd usado no resto da ficha, só que sem
    o atributo data-id nestes casos específicos."""
    return page.evaluate(
        """(label) => {
            const dts = Array.from(document.querySelectorAll('dt.fw-bolder'));
            for (const dt of dts) {
                const text = dt.textContent.trim().replace(/:$/, '').trim();
                if (text === label) {
                    const dd = dt.nextElementSibling;
                    const value = dd ? dd.textContent.trim() : '';
                    return value || null;
                }
            }
            return null;
        }""",
        label,
    )


def li_span_text(page, label):
    """Para os sinais de negócio (Dias no Mercado, Visitas, Propostas):
    <li><span class="fw-bolder me-25">Label: </span><span>Valor</span></li>
    — procura o <span> cujo texto seja este label e devolve o texto do
    <span> irmão seguinte."""
    return page.evaluate(
        """(label) => {
            const spans = Array.from(document.querySelectorAll('li span.fw-bolder.me-25'));
            for (const span of spans) {
                const text = span.textContent.trim().replace(/:$/, '').trim();
                if (text === label) {
                    const value = span.nextElementSibling;
                    return value ? value.textContent.trim() : null;
                }
            }
            return null;
        }""",
        label,
    )


def extract_amenities(page):
    """Lista de 'chips' na secção Características (ex: Praia, Varanda, Piscina)."""
    els = page.query_selector_all("#listing-attribute label.custom-button-chips")
    amenities = []
    for el in els:
        text = el.inner_text().strip()
        if text:
            amenities.append(text)
    return amenities


def html_to_text(html):
    """Converte HTML em texto simples, preservando quebras entre parágrafos/itens.
    Usa inner_html() em vez de inner_text() porque o 'Ver Mais' só esconde o
    resto do texto visualmente (CSS) — o HTML completo já está no DOM."""
    if not html:
        return None
    html = re.sub(r"<(br|/p|/li|/div)\s*/?>", "\n", html, flags=re.IGNORECASE)
    html = re.sub(r"<[^>]+>", "", html)
    import html as html_lib
    text = html_lib.unescape(html)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() or None


def sanitize_folder_name(name):
    return re.sub(r"[^A-Za-z0-9_-]", "_", name or "sem_codigo")


def download_photo(page, url, dest_path):
    """Descarrega uma foto usando a sessão autenticada do browser (page.request
    partilha os cookies/estado do Playwright — evita problemas de acesso)."""
    if os.path.exists(dest_path):
        return True  # já descarregada numa corrida anterior
    try:
        resp = page.request.get(url)
        if not resp.ok:
            print(f"     [aviso] HTTP {resp.status} a descarregar {url}")
            return False
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(dest_path, "wb") as f:
            f.write(resp.body())
        return True
    except Exception as e:
        print(f"     [aviso] falha a descarregar {url}: {e}")
        return False


def extract_photos(page, codigo):
    """Lê os URLs das fotos (sempre — é o que o CRM guarda) e, só se
    DOWNLOAD_PHOTOS=True, descarrega cada uma para fotos/<codigo>/NN.jpg.
    Devolve (urls, caminhos_locais)."""
    try:
        page.get_by_text(PHOTOS_TAB_TEXT, exact=True).click()
        page.wait_for_selector("#listing-pictures", timeout=8000)
        page.wait_for_timeout(500)
        imgs = page.query_selector_all("#listing-pictures .big-swipper img")
        if not imgs:
            imgs = page.query_selector_all("#listing-pictures .swiper-slide img")
        urls = []
        seen = set()
        for img in imgs:
            src = img.get_attribute("src")
            if src and src not in seen:
                seen.add(src)
                urls.append(src)
    except Exception as e:
        print(f"     [aviso] não consegui ler fotos: {e}")
        return [], []

    if not DOWNLOAD_PHOTOS:
        return urls, []

    folder = sanitize_folder_name(codigo)
    local_paths = []
    for i, url in enumerate(urls, start=1):
        ext = os.path.splitext(url.split("?")[0])[1] or ".jpg"
        dest = os.path.join(PHOTOS_DIR, folder, f"{i:02d}{ext}")
        if download_photo(page, url, dest):
            local_paths.append(dest)

    if urls:
        print(f"     {len(local_paths)}/{len(urls)} fotos descarregadas -> {PHOTOS_DIR}/{folder}/")

    return urls, local_paths


def fetch_known_source_urls() -> set[str]:
    """Consulta o CRM para saber que imóveis já existem (por source_url).
    Para esses, main() vai usar extract_status_only em vez de extract_detail
    — poupa a parte mais lenta (fotos, descrição, características) em quem
    já foi importado antes."""
    if not CRM_API_URL or not SCRAPER_API_KEY:
        print("[aviso] CRM_API_URL/SCRAPER_API_KEY em falta — a tratar todos os imóveis como novos")
        return set()
    try:
        resp = requests.get(CRM_API_URL, headers={"X-API-Key": SCRAPER_API_KEY}, timeout=20)
        if not resp.ok:
            print(f"[aviso] Falha a consultar o CRM (HTTP {resp.status_code}) — a tratar todos como novos")
            return set()
        return {item["source_url"] for item in resp.json() if item.get("source_url")}
    except requests.RequestException as e:
        print(f"[aviso] Erro de rede a consultar o CRM: {e} — a tratar todos como novos")
        return set()


def extract_status_only(page):
    """Versão leve de extract_detail — só os badges do topo (estado/publicado)
    e os sinais de negócio (dias no mercado/visitas/propostas). Usada para
    imóveis que já existem no CRM: só precisamos de confirmar se mudaram de
    estado ou de nível de interesse, não de reimportar fotos/descrição/
    características — tudo isto é barato de ler (só texto)."""
    badges = [b.inner_text().strip() for b in page.query_selector_all(".badge-detail")]
    return {
        "estado_badge": badges[0] if len(badges) > 0 else None,
        "publicado": badges[1] if len(badges) > 1 else None,
        "dias_mercado": parse_number(li_span_text(page, "Dias no Mercado")),
        "visitas": parse_number(li_span_text(page, "Visitas")),
        "propostas": parse_number(li_span_text(page, "Propostas")),
    }


def extract_detail(page, codigo):
    badges = [b.inner_text().strip() for b in page.query_selector_all(".badge-detail")]
    estado_badge = badges[0] if len(badges) > 0 else None
    publicado = badges[1] if len(badges) > 1 else None

    # Descrição/título completos: o separador "Resumo" (#listing-summary-description)
    # mostra só um excerto curto (termina em "..." no próprio HTML, não é truncagem
    # CSS). O texto completo vive em #listing-description, no separador "Principal"
    # — e como a Maxwork parece renderizar todos os separadores de uma vez (só
    # esconde os inativos com CSS), não é preciso clicar em nada para o ler.
    desc_els = page.query_selector_all("#listing-description dd.mb-1.col")
    if len(desc_els) < 2:
        # apanha (excerto curto) se por algum motivo a versão completa não existir
        desc_els = page.query_selector_all("#listing-summary-description dd.mb-1.col")
    descricao_completa = html_to_text(desc_els[1].inner_html()) if len(desc_els) > 1 else None
    titulo_curto = html_to_text(desc_els[3].inner_html()) if len(desc_els) > 3 else None

    raw_total_area = dd_text(page, "totalArea")
    raw_living_area = dd_text(page, "livingArea")
    raw_exterior_area = dd_text(page, "exteriorPrivateArea")
    raw_lot_size = dd_text(page, "lotSize")

    detail = {
        "estado_badge": estado_badge,
        "publicado": publicado,
        "titulo_curto": titulo_curto,
        "descricao_completa": descricao_completa,
        "distrito": dd_text(page, "regionName1"),
        "concelho": dd_text(page, "regionName2"),
        "freguesia": dd_text(page, "regionName3"),
        "codigo_postal": dd_text(page, "zipCode"),
        "morada_rua": dd_text(page, "address"),
        "latitude": dd_text(page, "latitude"),
        "longitude": dd_text(page, "longitude"),
        "area_bruta_privativa_m2": parse_number(raw_total_area),
        "area_util_m2": parse_number(raw_living_area),
        "area_exterior_privativa_m2": parse_number(raw_exterior_area),
        "area_lote_m2": parse_number(raw_lot_size),
        "ano_construcao": dd_text(page, "constructionYear"),
        "eficiencia_energetica": dd_text(page, "energyEfficiencyLevel"),
        "tipo_estacionamento": dd_text(page, "parkingTypeID"),
        "num_lugares_garagem": dd_text(page, "garageType"),
        "num_pisos": dd_text(page, "floorNumber"),
        "tipo_vista": dd_text(page, "listingSightType"),
        "elevador": dt_dd_text(page, "Elevador"),
        "carregamento_carro_eletrico": dt_dd_text(page, "Carregamento carros elétricos"),
        "caracteristicas": ";".join(extract_amenities(page)),
        "dias_mercado": parse_number(li_span_text(page, "Dias no Mercado")),
        "visitas": parse_number(li_span_text(page, "Visitas")),
        "propostas": parse_number(li_span_text(page, "Propostas")),
    }

    urls, local_paths = extract_photos(page, codigo)
    detail["fotos"] = ";".join(urls)
    detail["fotos_local"] = ";".join(local_paths)
    detail["num_fotos"] = len(urls)

    return detail


DETAIL_FIELDNAMES = [
    "estado_badge", "publicado", "titulo_curto", "descricao_completa",
    "distrito", "concelho", "freguesia", "codigo_postal", "morada_rua",
    "latitude", "longitude", "area_bruta_privativa_m2", "area_util_m2",
    "area_exterior_privativa_m2", "area_lote_m2", "ano_construcao", "eficiencia_energetica",
    "tipo_estacionamento", "num_lugares_garagem", "num_pisos", "tipo_vista",
    "elevador", "carregamento_carro_eletrico", "caracteristicas",
    "fotos", "fotos_local", "num_fotos",
    "dias_mercado", "visitas", "propostas",
]

# Campos numéricos que podem ter casas decimais — o Excel em português
# espera vírgula para decimais (e ponto-e-vírgula a separar colunas),
# senão interpreta mal o ponto e "come" a parte decimal.
DECIMAL_FIELDS = ["area_bruta_privativa_m2", "area_util_m2", "area_exterior_privativa_m2", "area_lote_m2"]


def format_row_for_csv(row):
    formatted = dict(row)
    for key in DECIMAL_FIELDS:
        value = formatted.get(key)
        if value is None or value == "":
            continue
        formatted[key] = str(value).replace(".", ",")
    return formatted


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")
    if not os.path.exists(INPUT_CSV):
        raise SystemExit(f"Não encontrei {INPUT_CSV} — corre primeiro o maxwork_to_csv.py")

    with open(INPUT_CSV, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    if LIMIT:
        rows = rows[:LIMIT]

    known_urls = fetch_known_source_urls()
    print(f"[maxwork] {len(known_urls)} imóveis já no CRM — esses só levam atualização leve (sem fotos)")

    if DOWNLOAD_PHOTOS:
        os.makedirs(PHOTOS_DIR, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=HEADLESS)
        context = browser.new_context(locale="pt-PT")
        page = context.new_page()

        login(page)

        for i, row in enumerate(rows, start=1):
            url = row.get("url")
            codigo = row.get("codigo")
            already_known = bool(url and url in known_urls)
            row["already_in_crm"] = "1" if already_known else ""

            if not url:
                print(f"[{i}/{len(rows)}] {codigo} — sem url, a saltar")
                for k in DETAIL_FIELDNAMES:
                    row[k] = None
                continue

            mode = "atualização leve" if already_known else "completo"
            print(f"[{i}/{len(rows)}] {codigo} -> {url} ({mode})")
            try:
                page.goto(url)
                page.wait_for_selector(".badge-detail", timeout=15000)
                page.wait_for_timeout(300)
                if already_known:
                    for k in DETAIL_FIELDNAMES:
                        row.setdefault(k, None)
                    row.update(extract_status_only(page))
                else:
                    row.update(extract_detail(page, codigo))
            except Exception as e:
                print(f"     [erro] {e}")
                for k in DETAIL_FIELDNAMES:
                    row[k] = None

        browser.close()

    fieldnames = list(rows[0].keys()) if rows else []
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        for row in rows:
            writer.writerow(format_row_for_csv(row))

    print(f"\n{len(rows)} imoveis detalhados guardados em {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
