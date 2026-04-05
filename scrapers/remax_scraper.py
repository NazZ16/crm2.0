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
import re
import time
import requests
from urllib.parse import quote_plus
from dotenv import load_dotenv
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


# Override with API config only when env vars are at defaults (not provided as workflow inputs)
if not REMAX_ZONES_RAW or REMAX_ZONES_RAW == "Lisboa":
    api_config = fetch_config_from_api()
    if api_config:
        if api_config.get("zones"):
            ZONES = api_config["zones"]
        if api_config.get("max_price"):
            REMAX_MAX_PRICE = api_config["max_price"]
        if api_config.get("typologies"):
            TYPOLOGIES = api_config["typologies"]


def build_search_url(zone: str, typology: str | None = None) -> str:
    """
    Constrói URL de pesquisa do Remax PT.
    Exemplo: https://www.remax.pt/imoveis?searchQueryState={"regionName":"Porto","businessType":1}
    O Remax usa um querystring JSON — tentamos a URL simples com filtros na path.
    """
    # Remax PT usa URLs como:
    # https://www.remax.pt/imoveis/comprar/apartamentos/porto
    # Vamos usar a URL de pesquisa com query params que o site aceita
    zone_slug = zone.lower().replace(" ", "-").replace(",", "")

    if typology:
        # T1 → apartamentos (simplificado)
        url = f"https://www.remax.pt/imoveis/comprar/apartamentos/{zone_slug}"
    else:
        url = f"https://www.remax.pt/imoveis/comprar/apartamentos/{zone_slug}"

    return url


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


def normalize_zone(raw_location: str, target_zone: str) -> str:
    """Mapeia a localização para a zona configurada."""
    for zone in ZONES:
        if zone.lower() in raw_location.lower():
            return zone
    return target_zone


def extract_listings_from_page(page, zone: str) -> list[dict]:
    """Extrai listings da página actual."""
    listings = []

    # Debug: mostrar URL actual
    print(f"[remax] URL: {page.url}")

    # Tentar vários seletores conhecidos do Remax PT
    selectors = [
        'a[href*="/imovel/"]',
        '[class*="property-card"]',
        '[class*="listing-card"]',
        '[class*="PropertyCard"]',
        '[class*="ListingCard"]',
        'article[class*="card"]',
        '[data-testid*="property"]',
        '[class*="result-item"]',
        '[class*="search-result"]',
    ]

    cards = []
    for sel in selectors:
        found = page.query_selector_all(sel)
        if found:
            print(f"[remax] Seletor '{sel}' → {len(found)} elementos")
            cards = found
            break

    if not cards:
        # Debug: guardar HTML para análise
        html = page.content()
        print(f"[remax] Nenhum card encontrado. HTML length: {len(html)}")
        # Mostrar primeiros links com /imovel/ no href
        links = page.query_selector_all('a')
        imovel_links = [l.get_attribute('href') for l in links if l.get_attribute('href') and '/imovel/' in (l.get_attribute('href') or '')]
        print(f"[remax] Links /imovel/ encontrados: {len(imovel_links)}")
        for link in imovel_links[:5]:
            print(f"  {link}")
        return listings

    print(f"[remax] {len(cards)} cards encontrados para zona '{zone}'")

    for card in cards[:50]:
        try:
            href = card.get_attribute("href")
            if not href:
                link = card.query_selector("a")
                href = link.get_attribute("href") if link else None
            if not href or "/imovel/" not in href:
                continue

            source_url = href if href.startswith("http") else f"https://www.remax.pt{href}"
            text = card.inner_text()
            lines = [l.strip() for l in text.splitlines() if l.strip()]

            # Preço
            price = None
            for line in lines:
                if "€" in line or "eur" in line.lower():
                    price = parse_price(line)
                    if price and price > 10000:
                        break

            if not price or price > REMAX_MAX_PRICE:
                continue

            # Tipologia
            typology = None
            for line in lines:
                typology = parse_typology(line)
                if typology:
                    break

            # Filtrar por tipologia se especificada
            if TYPOLOGIES and typology and typology not in TYPOLOGIES:
                continue

            # Área
            area = None
            for line in lines:
                area = parse_area(line)
                if area and area > 20:
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
            print(f"[remax] Erro a processar card: {e}")
            continue

    return listings


def scrape_zone(page, zone: str) -> list[dict]:
    """Scrape de uma zona específica, tentando múltiplas URLs."""
    listings = []

    # Tentar diferentes variantes de URL
    zone_slug = zone.lower().replace(" ", "-").replace(",", "").replace("  ", "-")
    urls_to_try = [
        f"https://www.remax.pt/imoveis/comprar/apartamentos/{quote_plus(zone)}",
        f"https://www.remax.pt/imoveis/comprar/apartamentos/{zone_slug}",
        f"https://www.remax.pt/imoveis?s={quote_plus(zone)}&businessType=1&listingType=2",
        "https://www.remax.pt/imoveis",
    ]

    for url in urls_to_try:
        try:
            print(f"[remax] A tentar: {url}")
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)

            # Verificar se há resultados
            links = page.query_selector_all('a[href*="/imovel/"]')
            if links:
                print(f"[remax] {len(links)} links de imóveis encontrados")
                listings = extract_listings_from_page(page, zone)
                if listings:
                    return listings
                # Sem listings mas há links — continuar com extração
                if links:
                    listings = extract_listings_from_page(page, zone)
                    return listings

        except PlaywrightTimeout:
            print(f"[remax] Timeout: {url}")
            continue
        except Exception as e:
            print(f"[remax] Erro em {url}: {e}")
            continue

    return listings


def post_to_crm(listing: dict) -> bool:
    """Envia um listing para o CRM via POST /api/opportunities."""
    if not CRM_API_URL or not SCRAPER_API_KEY:
        print("  ✗ CRM_API_URL ou SCRAPER_API_KEY não configurados")
        return False

    headers = {
        "Content-Type": "application/json",
        "X-API-Key": SCRAPER_API_KEY,
    }

    try:
        resp = requests.post(CRM_API_URL, json=listing, headers=headers, timeout=15)
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
    if TYPOLOGIES:
        print(f"[remax] Tipologias: {', '.join(TYPOLOGIES)}")
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
            print(f"\n[remax] A pesquisar zona: {zone}")
            zone_listings = scrape_zone(page, zone)
            all_listings.extend(zone_listings)
            print(f"[remax] {len(zone_listings)} listings em '{zone}'")

        browser.close()

    # Dedup por source_url
    seen = set()
    unique_listings = []
    for l in all_listings:
        if l["source_url"] not in seen:
            seen.add(l["source_url"])
            unique_listings.append(l)

    print(f"\n[remax] {len(unique_listings)} listings únicos extraídos")

    success = 0
    for listing in unique_listings:
        if post_to_crm(listing):
            success += 1
        time.sleep(0.3)

    print(f"[remax] Concluído: {success}/{len(unique_listings)} enviados ao CRM")
    return success


if __name__ == "__main__":
    main()
