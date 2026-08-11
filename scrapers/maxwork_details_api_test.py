#!/usr/bin/env python3
"""
Maxwork -> teste de descoberta da API de detalhe de um imóvel

O maxwork_details_to_csv.py visita 1 página por imóvel (via browser,
DOM) para recolher descrição, morada completa, áreas, características,
fotos, etc. — a 47 mil imóveis, isso é lento mesmo com paralelismo.

Já vimos com a pesquisa (multi-match-listing-search, ver
maxwork_to_csv_api_test.py e maxwork_api_fetch.py) que a app carrega os
dados da grelha via uma API JSON interna, e que interceptar essa
resposta (em vez de ler o ecrã) é muito mais rápido E mais fiável. É
plausível que a FICHA DE DETALHE (/listing/details/{id}) também
carregue os seus dados via alguma API própria — este script existe só
para descobrir se isso é verdade e, se for, qual é o endpoint e que
campos traz.

Em vez de adivinhar o caminho da API (como fizemos para a pesquisa),
regista TODOS os pedidos a /api/ feitos durante o carregamento de UMA
ficha e imprime-os — para vermos candidatos moço a olho. Não escreve
nenhum CSV nem mexe em nada do pipeline.

COMO USAR:
    python3 maxwork_details_api_test.py                        # usa o 1º "url" de
                                                                 # maxwork_imoveis_api.csv
                                                                 # ou maxwork_imoveis.csv
    python3 maxwork_details_api_test.py <url-ou-id-do-imovel>   # um imóvel em concreto
"""

import argparse
import csv
import json
import os

from playwright.sync_api import sync_playwright

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser

DETAILS_URL_TEMPLATE = "https://app.maxwork.pt/listing/details/{id}"
CANDIDATE_INPUT_CSVS = ["maxwork_imoveis_api.csv", "maxwork_imoveis.csv"]


def find_sample_url() -> str | None:
    """Lê o 1º "url" preenchido de qualquer um dos CSVs de listagens já
    conhecidos, para nao ser preciso passar sempre um argumento à mão."""
    for path in CANDIDATE_INPUT_CSVS:
        if not os.path.exists(path):
            continue
        with open(path, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                url = row.get("url")
                if url:
                    print(f"[info] a usar o 1º imóvel de {path}: {url}")
                    return url
    return None


def resolve_target(raw: str | None) -> str:
    if raw is None:
        url = find_sample_url()
        if url is None:
            raise SystemExit(
                "Não encontrei nenhum maxwork_imoveis*.csv com um 'url' preenchido — "
                "passa um URL ou ID de imóvel como argumento."
            )
        return url
    if raw.startswith("http"):
        return raw
    return DETAILS_URL_TEMPLATE.format(id=raw)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", nargs="?", default=None, help="URL completo ou ID do imóvel a testar")
    return parser.parse_args()


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")

    args = parse_args()
    target_url = resolve_target(args.target)

    captured = []

    def on_response(response):
        if "/api/" not in response.url:
            return
        entry = {"method": response.request.method, "url": response.url, "status": response.status}
        try:
            content_type = response.headers.get("content-type", "")
        except Exception:
            content_type = ""
        entry["content_type"] = content_type
        if "json" in content_type:
            try:
                entry["body"] = response.json()
            except Exception:
                entry["body"] = None
        else:
            entry["body"] = None
        captured.append(entry)

    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, page = open_session(browser)
        page.on("response", on_response)

        print(f"\nA abrir {target_url} ...")
        page.goto(target_url)
        try:
            page.wait_for_selector(".badge-detail", timeout=15000)
        except Exception:
            print("[aviso] a ficha pode não ter carregado bem (badge-detail não apareceu)")
        # Dá tempo a pedidos que só disparam depois do carregamento inicial
        # (ex.: separadores/tabs que só chamam a API quando ficam visíveis).
        page.wait_for_timeout(3000)

        context.close()
        browser.close()

    print(f"\n{len(captured)} pedidos /api/ vistos durante o carregamento desta ficha:\n")
    print(f"{'MÉTODO':>6} | {'HTTP':>4} | {'content-type':<28} | URL")
    print("-" * 100)
    for entry in captured:
        print(f"{entry['method']:>6} | {entry['status']:>4} | {entry['content_type']:<28} | {entry['url']}")

    print("\nCorpo JSON de cada resposta candidata (não é de metadata/cache/config genérico):\n")
    for entry in captured:
        if entry["body"] is None:
            continue
        url_lower = entry["url"].lower()
        if any(skip in url_lower for skip in ("metadatacache", "languagecache", "userprofile", "userofffices", "app-version", "authorizationfeature")):
            continue
        print(f"=== {entry['method']} {entry['url']} ===")
        print(json.dumps(entry["body"], indent=2, ensure_ascii=False)[:4000])
        print()


if __name__ == "__main__":
    main()
