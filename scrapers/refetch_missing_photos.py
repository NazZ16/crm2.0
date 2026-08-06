#!/usr/bin/env python3
"""
Maxwork -> volta a ler fotos em falta

Alguns imóveis ficaram sem fotos numa corrida anterior do
maxwork_details_to_csv.py, por causa de um modal do Bootstrap que
bloqueava o separador "Media e Documentos" (já corrigido em
maxwork_details_to_csv.py). Este script lê o CSV detalhado, encontra as
linhas que deviam ter tido extração completa mas ficaram com 0 fotos, e
volta a visitar só essas — sem depender do "já existe no CRM" (que as
marcaria para atualização leve e nunca voltaria a ler fotos, mesmo já
com a correção).

COMO USAR:
    1. Corre isto depois do maxwork_details_to_csv.py ter terminado
       (usa o maxwork_imoveis_detalhado.csv que ele gerou)
    2. python refetch_missing_photos.py
    3. Atualiza maxwork_imoveis_detalhado.csv no sítio (guarda uma
       cópia de segurança em maxwork_imoveis_detalhado.csv.bak antes)
    4. Corre o maxwork_to_crm.py outra vez normalmente — o servidor
       atualiza os imóveis já existentes (por source_url) com as fotos
       agora lidas
"""

import csv
import os
import shutil

from playwright.sync_api import sync_playwright

from maxwork_common import EMAIL, PASSWORD, open_session, launch_browser
from maxwork_details_to_csv import dismiss_blocking_modal, extract_detail, format_row_for_csv

INPUT_CSV = "maxwork_imoveis_detalhado.csv"


def needs_refetch(row: dict) -> bool:
    """Só os que deviam ter tido extração completa (already_in_crm vazio,
    ou seja eram novos nessa corrida) e ficaram sem nenhuma foto lida —
    imóveis marcados "1" (atualização leve, de propósito) nunca leem
    fotos, isso não é o bug."""
    if row.get("already_in_crm") == "1":
        return False
    if not row.get("url"):
        return False
    num_fotos = (row.get("num_fotos") or "").strip()
    return num_fotos in ("", "0")


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit("Falta MAXWORK_EMAIL / MAXWORK_PASSWORD no ficheiro .env")
    if not os.path.exists(INPUT_CSV):
        raise SystemExit(f"Não encontrei {INPUT_CSV} — corre primeiro o maxwork_details_to_csv.py")

    with open(INPUT_CSV, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    targets = [r for r in rows if needs_refetch(r)]
    print(f"[maxwork] {len(targets)} imóveis sem fotos a reler (de {len(rows)} no total)")
    if not targets:
        return

    backup_path = INPUT_CSV + ".bak"
    shutil.copy(INPUT_CSV, backup_path)
    print(f"[maxwork] cópia de segurança guardada em {backup_path}")

    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context, page = open_session(browser)

        for i, row in enumerate(targets, start=1):
            url = row["url"]
            codigo = row.get("codigo")
            print(f"[{i}/{len(targets)}] {codigo} -> {url}")
            try:
                page.goto(url)
                page.wait_for_selector(".badge-detail", timeout=15000)
                page.wait_for_timeout(300)
                dismiss_blocking_modal(page)
                row.update(extract_detail(page, codigo))
                print(f"     {row.get('num_fotos', 0)} fotos lidas")
            except Exception as e:
                print(f"     [erro] {e}")

        context.close()
        browser.close()

    fieldnames = list(rows[0].keys())
    with open(INPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        for row in rows:
            writer.writerow(format_row_for_csv(row))

    print(f"\n{INPUT_CSV} atualizado. Corre agora o maxwork_to_crm.py para enviar as fotos ao CRM.")


if __name__ == "__main__":
    main()
