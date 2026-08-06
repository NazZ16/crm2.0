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

from maxwork_common import EMAIL, PASSWORD, HEADLESS, CRM_API_URL, SCRAPER_API_KEY, open_session, parse_number

INPUT_CSV = "maxwork_imoveis.csv"
OUTPUT_CSV = "maxwork_imoveis_detalhado.csv"
LIMIT = 5  # ex: 5 para testar só os primeiros 5; None = todos

DOWNLOAD_PHOTOS = False  # True só se quiseres cópia local em fotos/ — o CRM usa
                          # diretamente os URLs do Maxwork (confirmado públicos,
                          # não exigem login), por isso não precisa dos ficheiros
PHOTOS_TAB_TEXT = "Media e Documentos"
PHOTOS_DIR = "fotos"  # pasta onde ficam as imagens descarregadas, uma subpasta por imóvel (só se DOWNLOAD_PHOTOS=True)


# Lê TODOS os campos da ficha de uma só vez dentro do browser (1 chamada
# JS) em vez de um query_selector/inner_text por campo em Python — a
# versão anterior fazia ~85 idas-e-voltas Python<->browser por imóvel novo
# (17 campos dd[data-id], badges, descrição, características, sinais de
# negócio, cada um com a sua própria chamada); tudo dentro do próprio
# browser evita esse custo.
_EXTRACT_DETAIL_JS = """
() => {
    const ddText = (id) => {
        const el = document.querySelector(`dd[data-id="${id}"]`);
        const t = el ? el.innerText.trim() : '';
        return t || null;
    };
    const dtDdText = (label) => {
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
    };
    const liSpanText = (label) => {
        const spans = Array.from(document.querySelectorAll('li span.fw-bolder.me-25'));
        for (const span of spans) {
            const text = span.textContent.trim().replace(/:$/, '').trim();
            if (text === label) {
                const value = span.nextElementSibling;
                return value ? value.textContent.trim() : null;
            }
        }
        return null;
    };

    const badges = Array.from(document.querySelectorAll('.badge-detail')).map((b) => b.innerText.trim());

    let descEls = Array.from(document.querySelectorAll('#listing-description dd.mb-1.col'));
    if (descEls.length < 2) {
        descEls = Array.from(document.querySelectorAll('#listing-summary-description dd.mb-1.col'));
    }

    const amenities = Array.from(document.querySelectorAll('#listing-attribute label.custom-button-chips'))
        .map((el) => el.innerText.trim())
        .filter(Boolean);

    return {
        estado_badge: badges[0] || null,
        publicado: badges[1] || null,
        descricao_html: descEls.length > 1 ? descEls[1].innerHTML : null,
        titulo_html: descEls.length > 3 ? descEls[3].innerHTML : null,
        distrito: ddText('regionName1'),
        concelho: ddText('regionName2'),
        freguesia: ddText('regionName3'),
        codigo_postal: ddText('zipCode'),
        morada_rua: ddText('address'),
        latitude: ddText('latitude'),
        longitude: ddText('longitude'),
        area_bruta_privativa_raw: ddText('totalArea'),
        area_util_raw: ddText('livingArea'),
        area_exterior_raw: ddText('exteriorPrivateArea'),
        area_lote_raw: ddText('lotSize'),
        ano_construcao: ddText('constructionYear'),
        eficiencia_energetica: ddText('energyEfficiencyLevel'),
        tipo_estacionamento: ddText('parkingTypeID'),
        num_lugares_garagem: ddText('garageType'),
        num_pisos: ddText('floorNumber'),
        tipo_vista: ddText('listingSightType'),
        elevador: dtDdText('Elevador'),
        carregamento_carro_eletrico: dtDdText('Carregamento carros elétricos'),
        caracteristicas: amenities,
        dias_mercado_raw: liSpanText('Dias no Mercado'),
        visitas_raw: liSpanText('Visitas'),
        propostas_raw: liSpanText('Propostas'),
        preco_raw: liSpanText('Preço do Imóvel'),
    };
}
"""


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


def dismiss_blocking_modal(page):
    """Fecha um modal Bootstrap (.modal.show) que tenha ficado aberto e
    bloqueia cliques — apanhado em produção a impedir SEMPRE o clique em
    "Media e Documentos", em dezenas de imóveis seguidos (30s de retries
    Playwright cada vez, com o log a mostrar
    '<div role="dialog" ... class="modal fade sh…"> ... intercepts
    pointer events'). Chamado antes de qualquer clique que possa ser
    bloqueado por isto."""
    try:
        modal = page.locator(".modal.show").first
        if modal.count() == 0:
            return
        close_btn = modal.locator("[data-bs-dismiss='modal'], .btn-close").first
        if close_btn.count() > 0:
            close_btn.click(timeout=2000)
        else:
            page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    except Exception:
        pass


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
    dismiss_blocking_modal(page)
    try:
        page.get_by_text(PHOTOS_TAB_TEXT, exact=True).click()
        page.wait_for_selector("#listing-pictures", timeout=8000)
        page.wait_for_timeout(500)
        # 1 chamada JS a ler todos os <img src> em vez de um get_attribute
        # por foto (podem ser 20-30 por imóvel).
        urls = page.evaluate(
            """() => {
                let imgs = Array.from(document.querySelectorAll('#listing-pictures .big-swipper img'));
                if (imgs.length === 0) {
                    imgs = Array.from(document.querySelectorAll('#listing-pictures .swiper-slide img'));
                }
                const seen = new Set();
                const urls = [];
                for (const img of imgs) {
                    const src = img.getAttribute('src');
                    if (src && !seen.has(src)) {
                        seen.add(src);
                        urls.push(src);
                    }
                }
                return urls;
            }"""
        )
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
    data = page.evaluate(_EXTRACT_DETAIL_JS)
    result = {
        "estado_badge": data["estado_badge"],
        "publicado": data["publicado"],
        "dias_mercado": parse_number(data["dias_mercado_raw"]),
        "visitas": parse_number(data["visitas_raw"]),
        "propostas": parse_number(data["propostas_raw"]),
    }
    # "Preço do Imóvel" na ficha é mais fiável que o preço lido no cartão da
    # pesquisa (maxwork_to_csv.py) — só sobrepõe a coluna "preco" existente
    # se conseguir ler um valor, para não perder o preço da pesquisa em caso
    # de erro.
    preco = parse_number(data["preco_raw"])
    if preco is not None:
        result["preco"] = preco
    return result


def extract_detail(page, codigo):
    # Descrição/título completos: o separador "Resumo" (#listing-summary-description)
    # mostra só um excerto curto (termina em "..." no próprio HTML, não é truncagem
    # CSS). O texto completo vive em #listing-description, no separador "Principal"
    # — e como a Maxwork parece renderizar todos os separadores de uma vez (só
    # esconde os inativos com CSS), não é preciso clicar em nada para o ler.
    data = page.evaluate(_EXTRACT_DETAIL_JS)

    detail = {
        "estado_badge": data["estado_badge"],
        "publicado": data["publicado"],
        "titulo_curto": html_to_text(data["titulo_html"]),
        "descricao_completa": html_to_text(data["descricao_html"]),
        "distrito": data["distrito"],
        "concelho": data["concelho"],
        "freguesia": data["freguesia"],
        "codigo_postal": data["codigo_postal"],
        "morada_rua": data["morada_rua"],
        "latitude": data["latitude"],
        "longitude": data["longitude"],
        "area_bruta_privativa_m2": parse_number(data["area_bruta_privativa_raw"]),
        "area_util_m2": parse_number(data["area_util_raw"]),
        "area_exterior_privativa_m2": parse_number(data["area_exterior_raw"]),
        "area_lote_m2": parse_number(data["area_lote_raw"]),
        "ano_construcao": data["ano_construcao"],
        "eficiencia_energetica": data["eficiencia_energetica"],
        "tipo_estacionamento": data["tipo_estacionamento"],
        "num_lugares_garagem": data["num_lugares_garagem"],
        "num_pisos": data["num_pisos"],
        "tipo_vista": data["tipo_vista"],
        "elevador": data["elevador"],
        "carregamento_carro_eletrico": data["carregamento_carro_eletrico"],
        "caracteristicas": ";".join(data["caracteristicas"]),
        "dias_mercado": parse_number(data["dias_mercado_raw"]),
        "visitas": parse_number(data["visitas_raw"]),
        "propostas": parse_number(data["propostas_raw"]),
    }

    # Idem extract_status_only(): o preço da ficha é mais fiável que o do
    # cartão da pesquisa.
    preco = parse_number(data["preco_raw"])
    if preco is not None:
        detail["preco"] = preco

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
        context, page = open_session(browser)

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
                dismiss_blocking_modal(page)
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

        context.close()
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
