#!/usr/bin/env python3
"""
Configuração e funções partilhadas pelos 3 scrapers do Maxwork
(maxwork_to_csv.py, maxwork_details_to_csv.py, maxwork_to_crm.py) —
login, parsing de números, e as variáveis de ambiente comuns. Evita ter
o mesmo código de login/credenciais copiado três vezes.
"""

import datetime
import os
import re
import sys

from dotenv import load_dotenv

load_dotenv()

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")


class _Tee:
    """Escreve em vários streams ao mesmo tempo (ex.: terminal + ficheiro)."""

    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)
        return len(data)

    def flush(self):
        for s in self.streams:
            s.flush()


def setup_logging():
    """Duplica tudo o que é impresso (print + tracebacks de erros) também
    para um ficheiro em scrapers/logs/ — para conseguires ver o que
    aconteceu mesmo depois de a janela do terminal fechar (corrida pelo
    Task Scheduler, ou a janela a fechar sozinha no fim/num erro).

    Usa MAXWORK_RUN_LOG (definida pelo run_all.bat) para os 3 scripts
    escreverem no mesmo ficheiro numa única corrida; sem essa variável
    (a correr um script sozinho, fora do run_all.bat), cria o seu
    próprio ficheiro com a hora atual."""
    os.makedirs(LOG_DIR, exist_ok=True)
    log_path = os.getenv("MAXWORK_RUN_LOG") or os.path.join(
        LOG_DIR, f"run_{datetime.datetime.now():%Y%m%d_%H%M%S}.log"
    )
    log_file = open(log_path, "a", encoding="utf-8")
    sys.stdout = _Tee(sys.__stdout__, log_file)
    sys.stderr = _Tee(sys.__stderr__, log_file)
    script = os.path.basename(sys.argv[0])
    print(f"\n{'=' * 70}\n{datetime.datetime.now():%Y-%m-%d %H:%M:%S} — {script}\n{'=' * 70}")
    return log_path


setup_logging()

EMAIL = os.getenv("MAXWORK_EMAIL", "")
PASSWORD = os.getenv("MAXWORK_PASSWORD", "")
HEADLESS = os.getenv("HEADLESS", "true").lower() != "false"

CRM_API_URL = os.getenv("CRM_API_URL", "http://localhost:3000/api/listings")
CRM_BULK_API_URL = os.getenv("CRM_BULK_API_URL", CRM_API_URL.rstrip("/") + "/bulk")
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")

LOGIN_URL = "https://app.maxwork.pt/listing/search"

EMAIL_SELECTOR = "input[name='loginfmt']"
EMAIL_NEXT_SELECTOR = "input[type='submit']"
PASSWORD_SELECTOR = "input[name='passwd']"
PASSWORD_SUBMIT_SELECTOR = "input[type='submit']"
STAY_SIGNED_IN_SELECTOR = "input#idSIButton9"
APP_LOADED_SELECTOR = "#search-term"

# Sessão de login guardada (cookies + local storage) — reutilizada entre
# corridas para não precisar de fazer login Microsoft outra vez sempre que
# o script corre. Importante para corridas noturnas sem ninguém a ver: um
# login Microsoft do zero pode pedir MFA/"aprovar este dispositivo", o que
# pararia o script sem ninguém para responder. Fica ao lado deste ficheiro,
# nunca deve ir para o git (está no .gitignore).
STORAGE_STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "maxwork_session.json")


def login(page, start_url: str = LOGIN_URL):
    """Faz login no Maxwork (Microsoft/Azure AD) se ainda não estiver
    autenticado, e espera até a app estar pronta a usar. Sem
    wait_for_load_state("networkidle") de propósito — a página tem
    widgets de fundo (chat, analytics) que fazem pedidos periódicos e
    podem nunca deixar a rede "parada"."""
    print("A abrir o Maxwork...")
    page.goto(start_url)

    # Com storage_state de uma sessão anterior, a Microsoft por vezes não
    # avança logo para a app — mostra o ecrã "Escolher conta" (a sessão SSO
    # continua ativa, mas o Azure AD pede para confirmar qual conta usar
    # antes de continuar). Sem tratar isto, o script fica preso à espera do
    # campo de email ou da app carregar, e nenhum dos dois aparece.
    account_tile_selector = f'[data-test-id="{EMAIL}"]'
    page.wait_for_selector(
        f"{EMAIL_SELECTOR}, {APP_LOADED_SELECTOR}, {account_tile_selector}",
        timeout=20000,
    )

    if not page.query_selector(APP_LOADED_SELECTOR) and not page.query_selector(EMAIL_SELECTOR):
        account_tile = page.locator(account_tile_selector)
        if account_tile.count() == 0 and EMAIL:
            account_tile = page.get_by_text(EMAIL, exact=False)
        if account_tile.count() > 0:
            print("Ecrã 'Escolher conta' da Microsoft — a selecionar a conta guardada...")
            account_tile.first.click()
            page.wait_for_selector(f"{EMAIL_SELECTOR}, {APP_LOADED_SELECTOR}", timeout=15000)

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
    else:
        print("Sessão guardada ainda válida — sem precisar de login.")

    page.wait_for_selector(APP_LOADED_SELECTOR, timeout=20000)
    print("Login OK.")


def open_session(browser):
    """Abre uma página do Maxwork já autenticada, reutilizando a sessão
    guardada em maxwork_session.json de uma corrida anterior (se existir e
    ainda for válida — login() só volta a pedir email/password se tiver
    expirado). Grava a sessão logo a seguir, para ficar disponível mesmo
    que o resto do script falhe a meio. Devolve (context, page) — fecha o
    context (não só a page) quando terminares, para libertar os recursos."""
    context = browser.new_context(
        locale="pt-PT",
        storage_state=STORAGE_STATE_PATH if os.path.exists(STORAGE_STATE_PATH) else None,
    )
    page = context.new_page()
    login(page)
    context.storage_state(path=STORAGE_STATE_PATH)
    return context, page


def parse_number(text):
    """Extrai o número do texto, parando antes da unidade (ex.: 'm2') e
    preservando casas decimais (ex.: '165.13 m2' -> 165.13, não 16513 —
    filtrar dígitos do texto todo colava o '2' de 'm2' ao valor).

    Preços do Maxwork usam espaço como separador de milhares (ex.:
    '3 250 000 €') — sem tratar o espaço como parte do número, o regex
    parava no primeiro espaço e devolvia só '3'."""
    if not text:
        return None
    match = re.search(r"\d[\d.,\s]*", text)
    if not match:
        return None
    raw = match.group(0).replace(",", "").replace(" ", "").strip()
    try:
        value = float(raw)
    except ValueError:
        return None
    return int(value) if value.is_integer() else value
