#!/usr/bin/env python3
"""
Maxwork -> CRM (listings)

Lê "maxwork_imoveis_detalhado.csv" (gerado pelo maxwork_details_to_csv.py)
e faz POST para /api/listings do CRM 2.0. O servidor trata sozinho do
dedup por source_url (atualiza os dados se já existir, cria se for novo).

Para imóveis já conhecidos do CRM (coluna "already_in_crm", marcada pelo
maxwork_details_to_csv.py), envia só o essencial — preço, estado (ativo/
inativo/etc.), se está publicado, e os sinais de negócio (dias no
mercado/visitas/propostas) — em vez do imóvel completo. O servidor só
mexe nos campos que vierem no pedido, por isso isto não apaga fotos,
descrição nem características já guardadas.

"listings" é o módulo de imóveis próprios/angariados para venda ou
arrendamento (diferente de "opportunities", que é só para o módulo de
investidores fix&flip / buy-to-let).

COMO USAR:
    1. Corre primeiro maxwork_to_csv.py e depois maxwork_details_to_csv.py
    2. Cria um .env nesta pasta (ou usa o que já tens) com:
           CRM_API_URL=http://localhost:3000/api/listings
           SCRAPER_API_KEY=<key gerada em /dashboard/settings>
    3. Corre primeiro com DRY_RUN=True (só mostra o que ia enviar,
       não escreve nada no CRM) e confirma que os dados saem bem
    4. Muda DRY_RUN para False e corre outra vez para enviar a sério
"""

import csv
import os

import requests

from maxwork_common import CRM_API_URL, SCRAPER_API_KEY

INPUT_CSV = "maxwork_imoveis_detalhado.csv"

DRY_RUN = False  # muda para False depois de confirmares os payloads
LIMIT = 1  # None = processa tudo; um número pequeno para testar primeiro

# Valores devolvidos pelo Maxwork -> enum "property_type" da tabela listings
# ('apartamento','moradia','terreno','comercial','garagem','outro','quinta',
#  'loja','armazem','escritorio','predio' — migration 029)
PROPERTY_TYPE_MAP = {
    "apartamento": "apartamento",
    "moradia": "moradia",
    "vivenda": "moradia",
    "quinta": "quinta",
    "terreno": "terreno",
    "loja": "loja",
    "armazem": "armazem",
    "escritorio": "escritorio",
    "predio": "predio",
    "garagem": "garagem",
}
VALID_PROPERTY_TYPES = {
    "apartamento", "moradia", "terreno", "comercial", "garagem", "outro",
    "quinta", "loja", "armazem", "escritorio", "predio",
}

# Valores devolvidos pelo Maxwork -> enum "business_type" da tabela listings
# ('venda','arrendamento')
BUSINESS_TYPE_MAP = {
    "venda": "venda",
    "arrendamento": "arrendamento",
}


def strip_accents(text):
    import unicodedata
    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def map_property_type(tipo):
    key = strip_accents(tipo or "").lower()
    for needle, mapped in PROPERTY_TYPE_MAP.items():
        if needle in key:
            return mapped if mapped in VALID_PROPERTY_TYPES else "outro"
    return "outro"


def map_business_type(transacao):
    key = strip_accents(transacao or "").lower()
    for needle, mapped in BUSINESS_TYPE_MAP.items():
        if needle in key:
            return mapped
    return None


def build_address(row):
    parts = [
        row.get("morada_rua"),
        row.get("freguesia"),
        row.get("concelho"),
        row.get("codigo_postal"),
    ]
    return ", ".join(p for p in parts if p) or None


def build_typology(row):
    quartos = row.get("quartos")
    if quartos and quartos.strip().isdigit():
        return f"T{quartos.strip()}"
    return None


def parse_pt_number(text):
    """Lê um número escrito no formato PT do CSV (vírgula decimal, ex: '601,77')."""
    if not text:
        return None
    try:
        return float(str(text).replace(",", "."))
    except ValueError:
        return None


def parse_int(text):
    if not text or not str(text).strip().isdigit():
        return None
    return int(str(text).strip())


def clean_email(text):
    """O servidor valida o formato do email — só envia se parecer válido,
    senão o pedido inteiro falha por causa de um campo secundário."""
    value = (text or "").strip()
    return value if "@" in value else None


def clean_energy_rating(text):
    """O CRM limita "energy_rating" a 10 caracteres — a Maxwork por vezes
    devolve algo mais longo (ex.: "Não determinado", 16 caracteres), o
    que fazia o pedido inteiro falhar com HTTP 400 por causa de um campo
    secundário, saltando o imóvel todo."""
    value = (text or "").strip()
    if not value:
        return None
    return value[:10] if len(value) > 10 else value


def parse_bool(text):
    if not text:
        return None
    key = strip_accents(text).strip().lower()
    if key in ("sim", "yes", "true"):
        return True
    if key in ("nao", "no", "false"):
        return False
    return None


# Valores do badge "estado" do Maxwork -> enum "status" da tabela listings
# ('active','reserved','sold','withdrawn')
STATUS_MAP = {
    "reserv": "reserved",
    "vend": "sold",
    "ativ": "active",
}


def map_status(estado_raw):
    # "inativ"/"suspens"/"retirad" têm de ser checados primeiro, senão
    # "inativo" batia em "ativ" do STATUS_MAP por conter esse substring.
    key = strip_accents(estado_raw or "").lower()
    if "inativ" in key or "suspens" in key or "retirad" in key:
        return "withdrawn"
    for needle, mapped in STATUS_MAP.items():
        if needle in key:
            return mapped
    return None  # desconhecido — não enviar, para não sobrepor o que já está no CRM


def parse_publicado(text):
    if not text:
        return None
    key = strip_accents(text).strip().lower()
    if "nao publicado" in key or "não publicado" in key:
        return False
    if "publicado" in key:
        return True
    return None


def build_payload(row):
    price = row.get("preco")
    if not price or not str(price).strip():
        return None

    business_type = map_business_type(row.get("transacao"))
    if not business_type:
        return None

    status = map_status(row.get("estado_badge") or row.get("estado"))
    is_published = parse_publicado(row.get("publicado"))

    # Imóvel já conhecido do CRM (marcado por maxwork_details_to_csv.py) —
    # só atualiza o essencial. O servidor só toca nos campos que vierem no
    # pedido, por isso omitir os restantes não apaga o que já lá está.
    if row.get("already_in_crm") == "1":
        title = row.get("titulo_curto") or row.get("titulo") or "Imóvel Maxwork"
        payload = {
            "title": title[:300],
            "source_url": row.get("url") or None,
            "price": int(float(price)),
            "days_on_market": parse_int(row.get("dias_mercado")),
            "visit_count": parse_int(row.get("visitas")),
            "proposal_count": parse_int(row.get("propostas")),
        }
        if status:
            payload["status"] = status
        if is_published is not None:
            payload["is_published"] = is_published
        return payload

    title = row.get("titulo_curto") or row.get("titulo") or "Imóvel Maxwork"
    description = (row.get("descricao_completa") or "")[:5000] or None
    photos = [u for u in (row.get("fotos") or "").split(";") if u]

    payload = {
        "reference": row.get("codigo"),
        "title": title[:300],
        "business_type": business_type,
        "property_type": map_property_type(row.get("tipo")),
        "typology": build_typology(row),
        "price": int(float(price)),

        "district": row.get("distrito"),
        "municipality": row.get("concelho"),
        "parish": row.get("freguesia"),
        "address": build_address(row),
        "zip_code": row.get("codigo_postal"),
        "latitude": parse_pt_number(row.get("latitude")),
        "longitude": parse_pt_number(row.get("longitude")),

        "area_useful_m2": parse_pt_number(row.get("area_util_m2")),
        "area_gross_m2": parse_pt_number(row.get("area_bruta_privativa_m2")),
        "area_plot_m2": parse_pt_number(row.get("area_lote_m2")),
        "bedrooms": parse_int(row.get("quartos")),
        "bathrooms": parse_int(row.get("casas_banho")),
        "construction_year": parse_int(row.get("ano_construcao")),
        "has_elevator": parse_bool(row.get("elevador")),
        "energy_rating": clean_energy_rating(row.get("eficiencia_energetica")),

        "features": [f for f in (row.get("caracteristicas") or "").split(";") if f],
        "description": description,
        "cover_image_url": photos[0] if photos else None,
        "photos": photos[:50],

        "source": "maxwork",
        "source_url": row.get("url") or None,
        "status": status or "active",

        "agent_name": row.get("agente") or None,
        "agent_phone": row.get("telefone_agente") or None,
        "agent_email": clean_email(row.get("email_agente")),

        "days_on_market": parse_int(row.get("dias_mercado")),
        "visit_count": parse_int(row.get("visitas")),
        "proposal_count": parse_int(row.get("propostas")),
    }
    if is_published is not None:
        payload["is_published"] = is_published
    return payload


def post_to_crm(payload):
    headers = {"Content-Type": "application/json", "X-API-Key": SCRAPER_API_KEY}
    try:
        resp = requests.post(CRM_API_URL, json=payload, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            action = "criado" if resp.status_code == 201 else "atualizado"
            print(f"  OK {action} — {payload['title'][:60]}")
            return True
        print(f"  ERRO HTTP {resp.status_code}: {resp.text[:300]}")
        return False
    except requests.RequestException as e:
        print(f"  ERRO de rede: {e}")
        return False


def main():
    if not os.path.exists(INPUT_CSV):
        raise SystemExit(f"Não encontrei {INPUT_CSV} — corre primeiro o maxwork_details_to_csv.py")
    if not DRY_RUN and not SCRAPER_API_KEY:
        raise SystemExit("Falta SCRAPER_API_KEY no .env (necessário fora de DRY_RUN)")

    if SCRAPER_API_KEY:
        masked = f"{SCRAPER_API_KEY[:6]}...{SCRAPER_API_KEY[-4:]}" if len(SCRAPER_API_KEY) > 12 else "***"
        print(f"[debug] SCRAPER_API_KEY carregada: {masked} ({len(SCRAPER_API_KEY)} caracteres)")
    else:
        print("[debug] SCRAPER_API_KEY está vazia — não vai autenticar")

    with open(INPUT_CSV, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    if LIMIT:
        rows = rows[:LIMIT]

    print(f"{'DRY RUN — nada será enviado' if DRY_RUN else f'A ENVIAR para {CRM_API_URL}'}")
    print(f"{len(rows)} imóveis a processar\n")

    skipped = 0
    success = 0
    for i, row in enumerate(rows, start=1):
        payload = build_payload(row)
        if not payload:
            print(f"[{i}/{len(rows)}] {row.get('codigo')} — sem preço ou tipo de negócio desconhecido, a saltar")
            skipped += 1
            continue

        if DRY_RUN:
            print(f"[{i}/{len(rows)}] {row.get('codigo')}")
            import json
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            print()
        else:
            print(f"[{i}/{len(rows)}] {row.get('codigo')}", end=" ")
            if post_to_crm(payload):
                success += 1

    enviados_ou_prontos = "prontos a enviar" if DRY_RUN else "enviados"
    print(f"\nConcluído: {success if not DRY_RUN else len(rows) - skipped}/{len(rows)} {enviados_ou_prontos} ({skipped} saltados)")


if __name__ == "__main__":
    main()
