#!/usr/bin/env python3
"""
Scraper Remax PT → CRM 2.0
Extrai listings e faz POST para /api/opportunities com dedup por source_url.
Usa Playwright (headless) porque o Remax carrega via JavaScript.

URL format descoberto:
  https://www.remax.pt/pt/comprar/imoveis/habitacao/{zona}/r/r/{tipologia},preco__{preco}
  ?s={"rg":"{Zona}"}&p=1&o=-PublishDate

Uso:
  pip install -r requirements.txt
  playwright install chromium
  python remax_scraper.py
"""

import re
import time
import json
import requests
from urllib.parse import quote
from dotenv import load_dotenv
import os
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

load_dotenv()

CRM_API_URL = os.getenv("CRM_API_URL", "http://localhost:3000/api/opportunities")
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")
REMAX_ZONES_RAW = os.getenv("REMAX_ZONES", "Lisboa")
REMAX_MAX_PRICE = int(os.getenv("REMAX_MAX_PRICE", "800000"))
REMAX_TYPOLOGIES_RAW = os.getenv("REMAX_TYPOLOGIES", "")
LEAD_ID = os.getenv("LEAD_ID", "")

ZONES = [z.strip() for z in REMAX_ZONES_RAW.split(",") if z.strip()]
TYPOLOGIES = [t.strip() for t in REMAX_TYPOLOGIES_RAW.split(",") if t.strip()]


def fetch_config_from_api() -> dict | None:
    """Lê configuração do CRM API. Retorna None se falhar."""
    if not CRM_API_URL or not SCRAPER_API_KEY:
        return None
    try:
        base = CRM_API_URL.replace("/api/opportunities", "").rstrip("/")
        resp = requests.get(
            f"{base}/api/scraper/config",
            headers={"X-API-Key": SCRAPER_API_KEY},
            timeout=10
        )
        if resp.ok:
            return resp.json()
    except Exception:
        pass
    return None


# Override com config da API se env vars estão nos defaults
if not REMAX_ZONES_RAW or REMAX_ZONES_RAW == "Lisboa":
    api_config = fetch_config_from_api()
    if api_config:
        if api_config.get("zones"):
            ZONES = api_config["zones"]
        if api_config.get("max_price"):
            REMAX_MAX_PRICE = api_config["max_price"]
        if api_config.get("typologies"):
            TYPOLOGIES = api_config["typologies"]


def zone_to_slug(zone: str) -> str:
    """'Porto - arredores próximos' → 'porto---arredores-proximos'"""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", zone.lower())
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", ascii_str).strip("-")


def build_search_urls(zone: str, typologies: list[str], max_price: int) -> list[str]:
    """
    Constrói URLs de pesquisa Remax PT.
    Formato: /pt/comprar/imoveis/habitacao/{zona}/r/r/{tipologia},preco__{preco}
             ?s={"rg":"{Zona}"}&p=1&o=-PublishDate
    """
    slug = zone_to_slug(zone)
    s_param = quote(json.dumps({"rg": zone}, ensure_ascii=False))
    base = f"https://www.remax.pt/pt/comprar/imoveis/habitacao/{slug}/r/r"
    suffix = f"?s={s_param}&p=1&o=-PublishDate"

    if typologies:
        # Uma URL por tipologia
        urls = []
        for t in typologies:
            typo_slug = t.lower()  # T2 → t2
            urls.append(f"{base}/{typo_slug},preco__{max_price}{suffix}")
        return urls
    else:
        # Sem filtro de tipologia — só preço
        return [f"{base}/preco__{max_price}{suffix}"]


def parse_price(text: str) -> int | None:
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None


def parse_typology(text: str) -> str | None:
    match = re.search(r"T(\d+)\+?", text.upper())
    return match.group(0) if match else None


def parse_area(text: str) -> int | None:
    match = re.search(r"(\d[\d.]*)\s*m[²2]", text.lower())
    if match:
        return int(re.sub(r"[^\d]", "", match.group(1)))
    return None


def normalize_zone(raw_location: str, fallback: str) -> str:
    for zone in ZONES:
        if zone.lower() in raw_location.lower():
            return zone
    return fallback


def extract_listings(page, zone: str) -> list[dict]:
    """Extrai todos os listings da página actual."""
    listings = []

    # Seletores por ordem de preferência — o Remax PT usa links /pt/imovel/ ou /imovel/
    cards = page.query_selector_all('a[href*="/imovel/"]')

    if not cards:
        # Debug
        html = page.content()
        print(f"[remax] Sem cards. HTML: {len(html)} chars, URL: {page.url}")
        all_links = page.query_selector_all("a[href]")
        sample = [a.get_attribute("href") for a in all_links[:20] if a.get_attribute("href")]
        print(f"[remax] Sample links: {sample}")
        return listings

    print(f"[remax] {len(cards)} cards em '{zone}'")

    for card in cards[:50]:
        try:
            href = card.get_attribute("href") or ""
            if "/imovel/" not in href:
                continue
            source_url = href if href.startswith("http") else f"https://www.remax.pt{href}"

            text = card.inner_text()
            lines = [l.strip() for l in text.splitlines() if l.strip()]

            # Preço
            price = None
            for line in lines:
                if "€" in line or "eur" in line.lower():
                    p = parse_price(line)
                    if p and p > 10000:
                        price = p
                        break
            if not price or price > REMAX_MAX_PRICE:
                continue

            typology = None
            for line in lines:
                t = parse_typology(line)
                if t:
                    typology = t
                    break

            area = None
            for line in lines:
                a = parse_area(line)
                if a and a > 20:
                    area = a
                    break

            title = lines[0][:300] if lines else "Imóvel Remax"

            listings.append({
                "title": title,
                "zone": zone,
                "typology": typology,
                "asking_price": price,
                "area_m2": area,
                "source_url": source_url,
                "source": "remax",
                "auto_imported": True,
                "property_type": "apartment",
                "deal_type": "buy_to_let",
                "status": "analyzing",
            })

        except Exception as e:
            print(f"[remax] Erro no card: {e}")
            continue

    return listings


def scrape_zone(page, zone: str) -> list[dict]:
    """Scrape de uma zona com as tipologias configuradas."""
    all_listings = []
    urls = build_search_urls(zone, TYPOLOGIES, REMAX_MAX_PRICE)

    for url in urls:
        print(f"[remax] → {url}")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # Aguardar renderização JS
            page.wait_for_timeout(3000)
            # Scroll para carregar lazy content
            page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
            page.wait_for_timeout(1000)

            listings = extract_listings(page, zone)
            all_listings.extend(listings)
            print(f"[remax] {len(listings)} listings em {url}")
        except PlaywrightTimeout:
            print(f"[remax] Timeout: {url}")
        except Exception as e:
            print(f"[remax] Erro: {e}")

        time.sleep(1)

    return all_listings


def post_to_crm(listing: dict) -> bool:
    if not CRM_API_URL or not SCRAPER_API_KEY:
        print("  ✗ CRM_API_URL ou SCRAPER_API_KEY não configurados — a saltar envio")
        return False

    headers = {"Content-Type": "application/json", "X-API-Key": SCRAPER_API_KEY}
    try:
        resp = requests.post(CRM_API_URL, json=listing, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            action = "criado" if resp.status_code == 201 else "preço atualizado"
            print(f"  ✓ {listing['title'][:60]} — {action}")
            return True
        else:
            print(f"  ✗ HTTP {resp.status_code}: {resp.text[:200]}")
            return False
    except requests.RequestException as e:
        print(f"  ✗ Erro de rede: {e}")
        return False


def main():
    print(f"[remax] Zonas: {', '.join(ZONES)}")
    print(f"[remax] Preço máx: €{REMAX_MAX_PRICE:,}")
    print(f"[remax] Tipologias: {', '.join(TYPOLOGIES) if TYPOLOGIES else 'todas'}")
    if LEAD_ID:
        print(f"[remax] Lead ID: {LEAD_ID}")

    all_listings = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="pt-PT",
        )
        page = context.new_page()

        for zone in ZONES:
            print(f"\n[remax] === Zona: {zone} ===")
            listings = scrape_zone(page, zone)
            all_listings.extend(listings)

        browser.close()

    # Dedup por source_url
    seen: set[str] = set()
    unique: list[dict] = []
    for l in all_listings:
        if l["source_url"] not in seen:
            seen.add(l["source_url"])
            unique.append(l)

    print(f"\n[remax] {len(unique)} listings únicos")

    success = 0
    for listing in unique:
        if post_to_crm(listing):
            success += 1
        time.sleep(0.3)

    print(f"[remax] Concluído: {success}/{len(unique)} enviados ao CRM")
    return success


if __name__ == "__main__":
    main()
