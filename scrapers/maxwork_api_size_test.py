#!/usr/bin/env python3
"""
Teste de diagnóstico: qual é o "size" máximo que a API de pesquisa do
Maxwork (multi-match-listing-search) aceita num único pedido — ANTES
de tentarmos pedir tudo de uma vez (size=47650) diretamente.

O limite de 10.000 resultados que já descobrimos (ver
maxwork_to_csv_bulk.py) tem cheiro a "index.max_result_window" do
Elasticsearch — um limite de JANELA (from + size), não de tamanho de
página. Se for isso, pedir size=47650 em page=1 não contorna nada:
bate na mesma parede, só que numa única query gigante em vez de 100
pedidos pequenos — o que arrisca sobrecarregar o servidor deles sem
nenhum benefício (já vimos sinais de sobrecarga — 504 do Cloudflare —
com pedidos normais de 100 em 100).

Este script testa essa teoria aos poucos: pede page=1 com "size"
cada vez maior (100, 200, 500, ... até acima dos 10.000 conhecidos) e
mostra quantos itens vêm mesmo de volta em cada um — para ver se cresce
sempre junto com o pedido, ou se estagna nalgum ponto (esse ponto é o
teto real). Não escreve nenhum CSV nem mexe no pipeline — é só leitura.

Uso:
    python3 maxwork_api_size_test.py
"""

import time

import requests
from playwright.sync_api import sync_playwright

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser
from maxwork_to_csv import run_search
from maxwork_to_csv_bulk import (
    SearchWatcher,
    capture_search,
    ensure_no_agency_filter,
    ensure_results_loaded,
)

API_URL = "https://app.maxwork.pt/api/Metadata/multi-match-listing-search"

# Do mais pequeno (para confirmar que a técnica funciona) até bem
# acima dos 10.000 já conhecidos — para ver onde exatamente a API
# estagna ou passa a recusar. Sobe aos poucos por respeito ao servidor
# deles, não salta logo para valores enormes.
SIZES_TO_TEST = [100, 200, 500, 1000, 2000, 5000, 9999, 10000, 10001, 15000]
SLEEP_BETWEEN_CALLS_S = 1.5


def capture_auth(watcher: "SearchWatcher"):
    """Deixa o browser disparar uma pesquisa normal (sem filtro de
    preço — para termos o totalCount máximo, ~47k, disponível para o
    teste) e devolve (headers, cookies, body, response_json) do pedido
    REAL que a app fez, tal como o maxwork_api_fetch.py já faz para os
    seus pedidos diretos."""
    page = watcher.page
    result = capture_search(watcher, lambda: run_search(page), expected_page=1, return_response=True)
    if result is None:
        return None
    data, response = result
    req = response.request
    headers = {
        k: v for k, v in req.headers.items()
        if not k.startswith(":") and k.lower() != "content-length"
    }
    body = req.post_data_json
    return headers, page.context.cookies(), body, data


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")

    print("A autenticar e a apanhar um pedido real da app...")
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, page = open_session(browser)

        ensure_no_agency_filter(page)
        if not ensure_results_loaded(page):
            context.close()
            browser.close()
            raise SystemExit("A grelha de resultados nunca carregou — corre com HEADLESS=false para ver o que se passa")

        watcher = SearchWatcher(page)
        captured = capture_auth(watcher)

        context.close()
        browser.close()

    if captured is None:
        raise SystemExit("Não consegui apanhar um pedido válido da app — tenta outra vez.")

    headers, cookies, body, data = captured
    total_count = data.get("totalCount")
    print(f"\ntotalCount sem filtro: {total_count}")
    print(f"nº de itens devolvidos no pedido normal (size por omissão): {len(data.get('items') or [])}\n")

    session = requests.Session()
    for c in cookies:
        session.cookies.set(c["name"], c["value"], domain=c.get("domain"))

    print(f"{'size pedido':>12} | {'HTTP':>4} | {'itens devolvidos':>17} | observações")
    print("-" * 80)

    for size in SIZES_TO_TEST:
        try:
            resp = session.post(API_URL, params={"page": 1, "size": size}, json=body, headers=headers, timeout=30)
        except requests.RequestException as e:
            print(f"{size:>12} | {'—':>4} | {'—':>17} | erro de rede: {e}")
            time.sleep(SLEEP_BETWEEN_CALLS_S)
            continue

        n_items = "—"
        note = ""
        if resp.status_code == 401:
            note = "não autorizado — o token pode ter expirado"
        elif resp.ok:
            try:
                resp_data = resp.json()
                items = resp_data.get("items") or []
                n_items = len(items)
                if n_items < size and n_items < (total_count or 0):
                    note = "menos itens do que o pedido — provável teto real"
            except Exception:
                note = "resposta não é JSON válido"
        else:
            note = (resp.text or "")[:150]

        print(f"{size:>12} | {resp.status_code:>4} | {str(n_items):>17} | {note}")
        time.sleep(SLEEP_BETWEEN_CALLS_S)

    print(
        "\nFeito. O maior 'size' que devolveu exatamente esse nº de itens "
        "(sem cortar nem dar erro) é o teto real — usa esse valor em "
        "PAGE_SIZE no maxwork_api_fetch.py."
    )


if __name__ == "__main__":
    main()
