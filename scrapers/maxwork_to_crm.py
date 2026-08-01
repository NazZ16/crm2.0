#!/usr/bin/env python3
"""
Maxwork -> CRM (listings)

Lê "maxwork_imoveis_detalhado.csv" (gerado pelo maxwork_details_to_csv.py)
e faz POST para /api/listings do CRM 2.0, no mesmo princípio que o
remax_scraper.py já usa. O servidor trata sozinho do dedup por
source_url (atualiza o preço se já existir, cria se for novo).

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
import re

import requests
from dotenv import load_dotenv

load_dotenv()

CRM_API_URL = os.getenv("CRM_API_URL", "http://localhost:3000/api/listings")
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")

INPUT_CSV = "maxwork_imoveis_detalhado.csv"

DRY_RUN = False  # muda para False depois de confirmares os payloads
LIMIT = 1  # None = processa tudo; um número pequeno para testar primeiro

# Valores devolvidos pelo Maxwork -> enum "property_type" da tabela listings
# ('apartamento','moradia','terreno','comercial','garagem','outro')
PROPERTY_TYPE_MAP = {
    "apartamento": "apartamento",
    "moradia": "moradia",
    "vivenda": "moradia",
    "quinta": "terreno",
    "terreno": "terreno",
    "loja": "comercial",
    "armazem": "comercial",
    "escritorio": "comercial",
    "predio": "comercial",
    "garagem": "garagem",
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
            return mapped
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


def parse_bool(text):
    if not text:
        return None
    key = strip_accents(text).strip().lower()
    if key in ("sim", "yes", "true"):
        return True
    if key in ("nao", "no", "false"):
        return False
    return None


def build_payload(row):
    price = row.get("preco")
    if not price or not str(price).strip():
        return None

    business_type = map_business_type(row.get("transacao"))
    if not business_type:
        return None

    title = row.get("titulo_curto") or row.get("titulo") or "Imóvel Maxwork"
    description = (row.get("descricao_completa") or "")[:5000] or None
    photos = [u for u in (row.get("fotos") or "").split(";") if u]

    return {
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
        "energy_rating": row.get("eficiencia_energetica"),

        "features": [f for f in (row.get("caracteristicas") or "").split(";") if f],
        "description": description,
        "cover_image_url": photos[0] if photos else None,
        "photos": photos[:50],

        "source": "maxwork",
        "source_url": row.get("url") or None,
        "status": "active",

        "agent_name": row.get("agente") or None,
        "agent_phone": row.get("telefone_agente") or None,
        "agent_email": clean_email(row.get("email_agente")),
    }


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
