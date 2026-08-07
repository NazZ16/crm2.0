#!/usr/bin/env python3
"""
Maxwork -> teste da API de pesquisa (multi-match-listing-search)

A grelha de resultados de /listing/search é alimentada por
POST /api/Metadata/multi-match-listing-search?page=N&size=M — descoberto
num HAR exportado do DevTools (Network tab) durante uma pesquisa normal.
Essa resposta é JSON estruturado com:
  - o ID real de cada imóvel ("id"), sempre presente mesmo sem foto —
    resolve os imóveis sem URL e os duplicados que a extração atual (via
    regex na foto de capa) não consegue apanhar;
  - totalCount / totalPages exatos, em vez de adivinhar pelo número mais
    alto visível na paginação;
  - muitos campos que hoje só apanhávamos na página de detalhe (área,
    quartos, eficiência energética, ano de construção, contacto do
    agente, ...).

ESTE SCRIPT É SÓ PARA TESTAR se dá para chamar esta API diretamente
(reaproveitando a sessão de login já autenticada, via page.request —
que partilha os cookies com o browser) e se o totalCount bate certo com
o que a Maxwork mostra (~47k) — antes de reescrever o
maxwork_to_csv_bulk.py a sério para usar isto em vez de ler os cartões
no ecrã.

COMO USAR:
    1. Garante que tens MAXWORK_EMAIL/MAXWORK_PASSWORD no .env (já
       deves ter, dos outros scripts)
    2. python maxwork_to_csv_api_test.py
    3. Lê o que aparece no ecrã — não escreve nenhum CSV, é só teste
"""

import json

from playwright.sync_api import sync_playwright

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser

BASE_URL = "https://app.maxwork.pt"
SEARCH_API_PATH = "/api/Metadata/multi-match-listing-search"
PROFILE_API_PATH = "/api/User/GetUserProfile"

# ListingClassID=1 ("Habitação") e ListingStatusID=1 ("Ativo") são os
# filtros que já vêm por omissão na pesquisa normal (confirmado no HAR)
# — os mesmos que maxwork_to_csv_bulk.py já assume ao não mexer neles.
DEFAULT_FILTER_FIELDS = [
    ("ListingClassID", "1"),
    ("ListingStatusID", "1"),
]


def _full_filter(field: str, value: str) -> dict:
    """A API espera todos estes campos presentes no objeto do filtro
    (mesmo a null) — replica exatamente a forma vista no pedido real
    capturado do DevTools, para não arriscar um 400 por faltar um campo."""
    return {
        "field": field, "type": 0, "value": value, "fuzziness": None,
        "latitude": None, "longitude": None, "topLeftLatitude": None,
        "topLeftLongitude": None, "bottomRightLatitude": None,
        "bottomRightLongitude": None, "distance": None, "greaterThan": None,
        "lessThan": None, "biggerThan": None, "smallerThan": None, "boost": None,
    }


def search(page, filters: list[dict], headers: dict, page_number: int = 1, size: int = 100):
    body = {
        "filters": filters,
        "sort": {"fieldToSort": "PublishDate", "order": 1},
        "index": None,
        "size": None,
    }
    resp = page.request.post(
        f"{BASE_URL}{SEARCH_API_PATH}?page={page_number}&size={size}",
        data=json.dumps(body),
        headers=headers,
    )
    print(f"  HTTP {resp.status}")
    if not resp.ok:
        print(f"  corpo da resposta: {resp.text()[:500]}")
        return None
    return resp.json()


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")

    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, page = open_session(browser)

        print("[teste] a chamar GetUserProfile (para descobrir agentID/officeID)...")
        profile_resp = page.request.get(f"{BASE_URL}{PROFILE_API_PATH}")
        print(f"  HTTP {profile_resp.status}")
        agent_id = ""
        office_id = ""
        if profile_resp.ok:
            profile = profile_resp.json()
            agent_id = str(profile.get("id", ""))
            office_id = str(profile.get("officeID", ""))
            print(f"  utilizador: {profile.get('name')}, agentID: {agent_id}, officeID: {office_id}")
        else:
            print(f"  [aviso] não consegui o perfil — corpo: {profile_resp.text()[:300]}")

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "impersonateagentid": agent_id,
            "impersonateofficeid": office_id,
            "impersonateuserteamid": "",
            "x-languageid": "9",
        }

        filters = [_full_filter(field, value) for field, value in DEFAULT_FILTER_FIELDS]

        print("\n[teste 1] pesquisa sem preço (página 1, 100 por página)...")
        data = search(page, filters, headers, page_number=1, size=100)
        if data is None:
            print("  FALHOU — ver detalhes acima. Pode faltar algum header; compara com o HAR.")
        else:
            print(f"  totalCount: {data.get('totalCount')}")
            print(f"  totalPages: {data.get('totalPages')}")
            print(f"  nº items devolvidos: {len(data.get('items', []))}")
            items = data.get("items") or []
            if items:
                print("\n  1º imóvel (todos os campos):")
                print(json.dumps(items[0], indent=2, ensure_ascii=False))
                sem_foto = [it for it in items if not it.get("listingPictureUrl")]
                print(f"\n  imóveis sem foto nesta página (que antes ficavam sem URL): {len(sem_foto)}")

        print("\n[teste 2] pesquisa com preço (0 a 200 000, página 1)...")
        filters_com_preco = filters + [
            {**_full_filter("Price", None), "greaterThan": 0, "lessThan": 200000},
        ]
        data2 = search(page, filters_com_preco, headers, page_number=1, size=10)
        if data2 is None:
            print("  FALHOU — o nome do campo \"Price\" pode estar errado. Precisamos de outro HAR com filtro de preço aplicado para confirmar o nome certo.")
        else:
            print(f"  totalCount: {data2.get('totalCount')} (devia ser bem menor que os {data.get('totalCount') if data else '?'} totais)")

        context.close()
        browser.close()


if __name__ == "__main__":
    main()
