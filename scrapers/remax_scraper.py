#!/usr/bin/env python3
"""
Scraper Remax PT → CRM 2.0
Extrai listings e faz POST para /api/opportunities com dedup por source_url.
Usa Playwright (headless) porque o Remax carrega via JavaScript.

Uso:
  pip install -r requirements.txt
  playwright install chromium
  python remax_scraper.py
"""

import os
import json
import re
import time
import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

load_dotenv()

CRM_API_URL = os.getenv("CRM_API_URL", "http://localhost:3000/api/opportunities")
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")
REMAX_ZONES_RAW = os.getenv("REMAX_ZONES", "Lisboa")
REMAX_MAX_PRICE = int(os.getenv("REMAX_MAX_PRICE", "800000"))
REMAX_TYPOLOGIES_RAW = os.getenv("REMAX_TYPOLOGIES", "")

ZONES = [z.strip() for z in REMAX_ZONES_RAW.split(",") if z.strip()]
TYPOLOGIES = [t.strip() for t in REMAX_TYPOLOGIES_RAW.split(",") if t.strip()]

BASE_SEARCH_URL = "https://www.remax.pt/imoveis"


def parse_price(text: str) -> int | None:
    """Extrai preço inteiro de strings como '250.000 €' ou '250000€'."""
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None


def parse_typology(text: str) -> str | None:
    """Extrai tipologia PT: T0, T1, T2, T3, T4+"""
    match = re.search(r"T(\d+)\+?", text.upper())
    return match.group(0) if match else None


def parse_area(text: str) -> int | None:
    """Extrai área em m² de strings como '85 m²'."""
    match = re.search(r"(\d+)\s*m", text.lower())
    return int(match.group(1)) if match else None


def normalize_zone(raw_location: str) -> str:
    """Tenta mapear a localização para uma das zonas configuradas."""
    for zone in ZONES:
        if zone.lower() in raw_location.lower():
            return zone
    parts = [p.strip() for p in raw_location.split(",")]
    return parts[-1] if parts else raw_location


def extract_card_data(card) -> dict | None:
    """Extrai dados de um card individual."""
    try:
        href = card.get_attribute("href")
        if not href:
            link = card.query_selector("a")
            href = link.get_attribute("href") if link else None
        if not href:
            return None
        source_url = href if href.startswith("http") else f"https://www.remax.pt{href}"

        text = card.inner_text()
        lines = [l.strip() for l in text.splitlines() if l.strip()]

        price = None
        for line in lines:
            if "€" in line or "eur" in line.lower():
                price = parse_price(line)
                if price and price > 10000:
                    break

        if not price or price > REMAX_MAX_PRICE:
            return None

        typology = None
        for line in lines:
            typology = parse_typology(line)
            if typology:
                break

        area = None
        for line in lines:
            area = parse_area(line)
            if area and area > 20:
                break

        location = ""
        for line in lines:
            if any(z.lower() in line.lower() for z in ZONES):
                location = line
                break

        if not location:
            return None  # skip listings without identifiable location
        zone = normalize_zone(location)
        title = lines[0][:300] if lines else "Imóvel Remax"

        return {
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
        }

    except Exception as e:
        print(f"[remax] extract error: {e}")
        return None


def scrape_listings(page) -> list[dict]:
    """Navega no Remax PT e extrai os listings da página de resultados."""
    listings = []

    try:
        page.goto(BASE_SEARCH_URL, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(2000)

        cards = page.query_selector_all('[data-testid="property-card"], .property-card, article.listing-card')

        if not cards:
            cards = page.query_selector_all('a[href*="/imovel/"]')

        print(f"[remax] {len(cards)} cards encontrados")

        for card in cards[:50]:
            try:
                listing = extract_card_data(card)
                if listing:
                    listings.append(listing)
            except Exception as e:
                print(f"[remax] Erro a processar card: {e}")
                continue

    except PlaywrightTimeout:
        print("[remax] Timeout ao carregar página de resultados")

    return listings


def post_to_crm(listing: dict) -> bool:
    """Envia um listing para o CRM via POST /api/opportunities."""
    body = json.dumps(listing)
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": SCRAPER_API_KEY,
    }

    try:
        resp = requests.post(CRM_API_URL, data=body, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            action = "criado" if resp.status_code == 201 else "preço atualizado"
            print(f"  ✓ {listing['title'][:60]} — {action}")
            return True
        else:
            print(f"  ✗ {listing['title'][:60]} — HTTP {resp.status_code}: {resp.text[:200]}")
            return False
    except requests.RequestException as e:
        print(f"  ✗ Erro de rede: {e}")
        return False


def main():
    print(f"[remax] A iniciar scraper para zonas: {', '.join(ZONES)}")
    print(f"[remax] Preço máximo: €{REMAX_MAX_PRICE:,}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        page = context.new_page()
        listings = scrape_listings(page)
        browser.close()

    print(f"[remax] {len(listings)} listings extraídos")

    success = 0
    for listing in listings:
        if post_to_crm(listing):
            success += 1
        time.sleep(0.3)

    print(f"[remax] Concluído: {success}/{len(listings)} enviados ao CRM")
    return success


if __name__ == "__main__":
    main()
