#!/usr/bin/env python3
"""
Configuração e funções partilhadas pelos 3 scrapers do Maxwork
(maxwork_to_csv.py, maxwork_details_to_csv.py, maxwork_to_crm.py) —
login, parsing de números, e as variáveis de ambiente comuns. Evita ter
o mesmo código de login/credenciais copiado três vezes.
"""

import os
import re

from dotenv import load_dotenv

load_dotenv()

EMAIL = os.getenv("MAXWORK_EMAIL", "")
PASSWORD = os.getenv("MAXWORK_PASSWORD", "")
HEADLESS = os.getenv("HEADLESS", "true").lower() != "false"

CRM_API_URL = os.getenv("CRM_API_URL", "http://localhost:3000/api/listings")
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")

LOGIN_URL = "https://app.maxwork.pt/listing/search"

EMAIL_SELECTOR = "input[name='loginfmt']"
EMAIL_NEXT_SELECTOR = "input[type='submit']"
PASSWORD_SELECTOR = "input[name='passwd']"
PASSWORD_SUBMIT_SELECTOR = "input[type='submit']"
STAY_SIGNED_IN_SELECTOR = "input#idSIButton9"
APP_LOADED_SELECTOR = "#search-term"


def login(page, start_url: str = LOGIN_URL):
    """Faz login no Maxwork (Microsoft/Azure AD) se ainda não estiver
    autenticado, e espera até a app estar pronta a usar. Sem
    wait_for_load_state("networkidle") de propósito — a página tem
    widgets de fundo (chat, analytics) que fazem pedidos periódicos e
    podem nunca deixar a rede "parada"."""
    print("A abrir o Maxwork...")
    page.goto(start_url)
    page.wait_for_selector(f"{EMAIL_SELECTOR}, {APP_LOADED_SELECTOR}", timeout=20000)

    if page.query_selector(EMAIL_SELECTOR):
        print("A fazer login...")
        page.fill(EMAIL_SELECTOR, EMAIL)
        page.click(EMAIL_NEXT_SELECTOR)
        page.wait_for_selector(PASSWORD_SELECTOR, timeout=15000)
        page.fill(PASSWORD_SELECTOR, PASSWORD)
        page.click(PASSWORD_SUBMIT_SELECTOR)
        try:
            page.wait_for_selector(STAY_SIGNED_IN_SELECTOR, timeout=8000)
            page.click(STAY_SIGNED_IN_SELECTOR)
        except Exception:
            pass

    page.wait_for_selector(APP_LOADED_SELECTOR, timeout=20000)
    print("Login OK.")


def parse_number(text):
    """Extrai o número do INÍCIO do texto, parando antes da unidade (ex.:
    'm2') e preservando casas decimais (ex.: '165.13 m2' -> 165.13, não
    16513 — filtrar dígitos do texto todo colava o '2' de 'm2' ao valor)."""
    if not text:
        return None
    match = re.match(r"\s*([\d.,]+)", text)
    if not match:
        return None
    raw = match.group(1).replace(",", "")
    try:
        value = float(raw)
    except ValueError:
        return None
    return int(value) if value.is_integer() else value
