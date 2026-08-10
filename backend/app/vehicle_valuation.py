"""Vehicle valuator: multi-source public asking prices → realizable sale value."""
from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Literal, Optional

import requests

logger = logging.getLogger("soberan.vehicle_valuation")

Confidence = Literal["alta", "media", "baja"]
Source = Literal["wallapop", "coches.net", "autoscout24", "mixto"]
VEHICLE_VALUATION_INTERVAL_DAYS = 30

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-ES,es;q=0.9",
}

DEFAULT_ASK_HAIRCUT = 0.12


@dataclass
class ListingSample:
    price: int
    km: Optional[float] = None
    year: Optional[int] = None
    title: str = ""
    source: str = "wallapop"


@dataclass
class ValuationResult:
    valor_estimado: float
    muestras: int
    min: int
    max: int
    mediana: int
    asking_p10: int
    asking_p25: int
    asking_p50: int
    asking_ref: int
    haircut: float
    valor_mercado_realizable: float
    precios_muestra: list[int]
    fuente: Source
    percentil_usado: float
    confianza: Confidence
    filtro_año: str
    filtro_km: Optional[int]
    precio_cap: int
    actualizado_en: str
    match_mode: str = "strict"
    clamped: bool = False
    clamp_techo: Optional[float] = None
    pro: Optional[dict[str, Any]] = None
    nota: str = (
        "Basado en anuncios; el precio de venta suele ser inferior al de publicación."
    )

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d

    def snapshot_json(self) -> str:
        return json.dumps(self.as_dict(), ensure_ascii=False)


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def url_slug(value: str) -> str:
    """Slug for Autoscout24 paths (peugeot, 208, citroen, etc.)."""
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def title_tokens(value: str) -> list[str]:
    return [t for t in normalize_text(value).split() if len(t) >= 2]


def title_matches_vehicle(title: str, marca: str, modelo: str, *, strict: bool) -> bool:
    """Require brand + model tokens in listing title."""
    hay = normalize_text(title)
    if not hay:
        return not strict
    brand_ok = all(tok in hay for tok in title_tokens(marca)) if title_tokens(marca) else True
    model_toks = title_tokens(modelo)
    if not model_toks:
        return brand_ok
    if strict:
        model_ok = all(tok in hay for tok in model_toks)
    else:
        # At least half of model tokens (rounded up)
        need = max(1, (len(model_toks) + 1) // 2)
        model_ok = sum(1 for tok in model_toks if tok in hay) >= need
    return brand_ok and model_ok


def ask_haircut() -> float:
    raw = os.getenv("VEHICLE_ASK_HAIRCUT", "").strip()
    try:
        val = float(raw) if raw else DEFAULT_ASK_HAIRCUT
    except ValueError:
        val = DEFAULT_ASK_HAIRCUT
    return max(0.08, min(0.18, val))


def km_price_cap(km: Optional[int]) -> int:
    if not km:
        return 60_000
    if km > 200_000:
        return 6_000
    if km > 150_000:
        return 9_000
    if km > 100_000:
        return 16_000
    if km > 75_000:
        return 25_000
    return 60_000


def percentile_index(n: int, p: float) -> int:
    if n <= 0:
        raise ValueError("empty sample")
    if n == 1:
        return 0
    return max(0, min(n - 1, int(round((n - 1) * p))))


def percentile_value(ordered: list[int], p: float) -> int:
    return ordered[percentile_index(len(ordered), p)]


def filter_iqr_outliers(prices: list[int]) -> list[int]:
    if len(prices) < 5:
        return sorted(prices)
    ordered = sorted(prices)
    n = len(ordered)
    q1 = ordered[percentile_index(n, 0.25)]
    q3 = ordered[percentile_index(n, 0.75)]
    iqr = q3 - q1
    if iqr <= 0:
        return ordered
    lo = q1 - 1.5 * iqr
    hi = q3 + 1.5 * iqr
    filtered = [p for p in ordered if lo <= p <= hi]
    return filtered if len(filtered) >= 3 else ordered


def soft_price_cap(hard_cap: int, prices: list[int], min_samples: int = 8) -> int:
    if len(prices) < min_samples:
        return hard_cap
    ordered = sorted(prices)
    med = ordered[len(ordered) // 2]
    return min(hard_cap, max(int(med * 1.45), 500))


def adaptive_ask_percentile(
    vehicle_km: Optional[int],
    sample_kms: list[float],
    vehicle_year: Optional[int],
) -> float:
    """Low asking percentile band (P12–P18) for realizable conversion."""
    if vehicle_km and sample_kms:
        med_km = sorted(sample_kms)[len(sample_kms) // 2]
        if med_km > 0:
            ratio = vehicle_km / med_km
            if ratio >= 1.25:
                return 0.12
            if ratio >= 0.90:
                return 0.15
            return 0.18

    if vehicle_km and vehicle_year:
        age = max(1, datetime.utcnow().year - int(vehicle_year))
        expected = age * 15_000
        if expected > 0:
            ratio = vehicle_km / expected
            if ratio >= 1.35:
                return 0.12
            if ratio >= 0.95:
                return 0.15
            return 0.18

    if vehicle_km:
        if vehicle_km > 150_000:
            return 0.12
        if vehicle_km > 90_000:
            return 0.15
        return 0.18

    return 0.15


def confidence_for_samples(n: int, *, strict_failed: bool = False) -> Confidence:
    """
    Confidence from sample size. Relaxed title match caps at media
    (never forces baja when the sample is large enough).
    """
    if n >= 8:
        return "media" if strict_failed else "alta"
    if n >= 4:
        return "media"
    return "baja"


def sanity_ceiling(vehicle_year: Optional[int], vehicle_km: Optional[int]) -> Optional[float]:
    """Rough upper bound for a mainstream used car (prevents runaway asking prices)."""
    if not vehicle_year:
        return None
    age = max(0, datetime.utcnow().year - int(vehicle_year))
    # Start ~28k new-equivalent, decay ~11%/year, then km penalty
    base = 28_000 * ((0.89) ** age)
    if vehicle_km:
        # Extra penalty beyond 12k km/year expected
        expected = max(age, 1) * 12_000
        if vehicle_km > expected:
            extra = (vehicle_km - expected) / 10_000
            base *= max(0.35, 1 - 0.04 * extra)
    return max(800.0, base)


def apply_haircut(asking_ref: float, haircut: float) -> float:
    return max(500.0, round(asking_ref * (1.0 - haircut), 2))


def valuation_is_due(
    valor_actualizado_en: Optional[str],
    *,
    now: Optional[datetime] = None,
    interval_days: int = VEHICLE_VALUATION_INTERVAL_DAYS,
) -> bool:
    """True if never valued or last valuation is older than interval_days."""
    if not valor_actualizado_en or not str(valor_actualizado_en).strip():
        return True
    raw = str(valor_actualizado_en).strip()
    try:
        # Support ISO with/without Z
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if ts.tzinfo is not None:
            ts = ts.replace(tzinfo=None)
    except ValueError:
        return True
    ref = now or datetime.utcnow()
    return (ref - ts).total_seconds() >= interval_days * 86400


def compute_market_valuation(
    samples: list[ListingSample],
    *,
    vehicle_km: Optional[int],
    vehicle_year: Optional[int],
    hard_cap: int,
    fuente: Source,
    year_note: str,
    match_mode: str,
    strict_failed: bool,
    haircut: Optional[float] = None,
) -> ValuationResult:
    if not samples:
        raise ValueError("No hay muestras de precio")

    haircut = ask_haircut() if haircut is None else haircut
    prices = [s.price for s in samples]
    soft_cap = soft_price_cap(hard_cap, prices)
    prices = [p for p in prices if 500 <= p <= soft_cap]
    if not prices:
        raise ValueError("No quedan precios tras aplicar el tope de mercado")

    cleaned = filter_iqr_outliers(prices)
    cleaned.sort()

    sample_kms = [
        float(s.km)
        for s in samples
        if s.km is not None and isinstance(s.km, (int, float)) and s.km > 10_000
        and s.price in set(cleaned)
    ]
    if not sample_kms:
        sample_kms = [
            float(s.km)
            for s in samples
            if s.km is not None and isinstance(s.km, (int, float)) and s.km > 10_000
        ]

    p = adaptive_ask_percentile(vehicle_km, sample_kms, vehicle_year)
    asking_ref = float(percentile_value(cleaned, p))
    asking_p10 = percentile_value(cleaned, 0.10)
    asking_p25 = percentile_value(cleaned, 0.25)
    asking_p50 = percentile_value(cleaned, 0.50)

    realizable = apply_haircut(asking_ref, haircut)
    techo = sanity_ceiling(vehicle_year, vehicle_km)
    clamped = False
    if techo is not None and realizable > techo:
        realizable = round(techo, 2)
        clamped = True

    n = len(cleaned)
    now = datetime.utcnow().isoformat()
    return ValuationResult(
        valor_estimado=realizable,
        muestras=n,
        min=cleaned[0],
        max=cleaned[-1],
        mediana=asking_p50,
        asking_p10=asking_p10,
        asking_p25=asking_p25,
        asking_p50=asking_p50,
        asking_ref=int(round(asking_ref)),
        haircut=haircut,
        valor_mercado_realizable=realizable,
        precios_muestra=cleaned[:20],
        fuente=fuente,
        percentil_usado=round(p * 100, 1),
        confianza=confidence_for_samples(n, strict_failed=strict_failed),
        filtro_año=year_note,
        filtro_km=vehicle_km,
        precio_cap=soft_cap,
        actualizado_en=now,
        match_mode=match_mode,
        clamped=clamped,
        clamp_techo=techo if clamped else None,
    )


def _accept_wallapop_listing(
    content: dict,
    *,
    marca: str,
    modelo: str,
    km: Optional[int],
    anio: Optional[int],
    price_cap: int,
    loose: bool,
    strict_title: bool,
) -> bool:
    price = content.get("price")
    if not price or not isinstance(price, (int, float)):
        return False
    if not (500 <= price <= price_cap):
        return False

    title = content.get("title", "") or ""
    if not title_matches_vehicle(title, marca, modelo, strict=strict_title):
        return False

    km_lo_factor, km_hi_factor = (0.2, 2.5) if loose else (0.3, 2.0)
    year_tol = 5 if loose else 3

    if km:
        listing_km = content.get("km") or content.get("kilometers")
        if listing_km and isinstance(listing_km, (int, float)) and listing_km > 10_000:
            if not (km * km_lo_factor <= listing_km <= km * km_hi_factor):
                return False

    if anio:
        item_year = content.get("year")
        if item_year and isinstance(item_year, int):
            if abs(item_year - anio) > year_tol:
                return False
        else:
            found_years = [int(m) for m in re.findall(r"\b((?:19|20)\d{2})\b", title)]
            if found_years and not any(abs(y - anio) <= year_tol for y in found_years):
                return False
    return True


def fetch_wallapop_samples(
    marca: str,
    modelo: str,
    *,
    km: Optional[int],
    anio: Optional[int],
    price_cap: int,
    loose: bool = False,
    strict_title: bool = True,
) -> list[ListingSample]:
    samples: list[ListingSample] = []
    seen: set[int] = set()
    year_pad = 2 if loose else 1
    wp_base: dict[str, str] = {
        "keywords": f"{marca} {modelo}",
        "category_ids": "100",
        "latitude": "40.4168",
        "longitude": "-3.7038",
        "distance": "500000",
        "order_by": "closest",
        "min_sale_price": "500",
        "max_sale_price": str(price_cap),
        "step": "40",
    }
    if km:
        lo = 0.25 if loose else 0.4
        hi = 2.0 if loose else 1.5
        wp_base["km_max"] = str(int(km * hi))
        wp_base["km_min"] = str(max(0, int(km * lo)))
    if anio:
        wp_base["year_start"] = str(anio - year_pad)
        wp_base["year_end"] = str(anio + year_pad)

    wp_headers = {**BROWSER_HEADERS, "Accept": "application/json", "DeviceOS": "0"}

    def _page(start: int) -> list:
        resp = requests.get(
            "https://api.wallapop.com/api/v3/search",
            params={**wp_base, "start": str(start)},
            headers=wp_headers,
            timeout=15,
        )
        if resp.status_code != 200:
            return []
        return (
            resp.json()
            .get("data", {})
            .get("section", {})
            .get("payload", {})
            .get("items", [])
        )

    try:
        for start in (0, 40, 80) if loose else (0, 40):
            for item in _page(start):
                content = item.get("content", {}) or {}
                if not _accept_wallapop_listing(
                    content,
                    marca=marca,
                    modelo=modelo,
                    km=km,
                    anio=anio,
                    price_cap=price_cap,
                    loose=loose,
                    strict_title=strict_title,
                ):
                    continue
                price = int(content["price"])
                if price in seen:
                    continue
                seen.add(price)
                listing_km = content.get("km") or content.get("kilometers")
                listing_year = content.get("year")
                samples.append(
                    ListingSample(
                        price=price,
                        km=float(listing_km) if isinstance(listing_km, (int, float)) else None,
                        year=int(listing_year) if isinstance(listing_year, int) else None,
                        title=str(content.get("title") or ""),
                        source="wallapop",
                    )
                )
    except Exception as exc:
        logger.debug("Wallapop fetch failed: %s", exc, exc_info=True)

    return samples


def fetch_coches_net_samples(
    marca: str,
    modelo: str,
    *,
    anio: Optional[int],
    price_cap: int,
    strict_title: bool = True,
) -> list[ListingSample]:
    from bs4 import BeautifulSoup

    samples: list[ListingSample] = []
    seen: set[int] = set()
    cn_params: dict[str, Any] = {
        "ac_marca": marca.upper(),
        "ac_modelo": modelo.upper(),
    }
    if anio:
        cn_params["ac_anio_desde"] = anio - 2
        cn_params["ac_anio_hasta"] = anio + 1

    try:
        cn_resp = requests.get(
            "https://www.coches.net/segunda-mano/",
            params=cn_params,
            headers={**BROWSER_HEADERS, "Accept": "text/html"},
            timeout=15,
        )
        if cn_resp.status_code != 200:
            return samples

        soup = BeautifulSoup(cn_resp.text, "html.parser")
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                obj = json.loads(script.string or "{}")

                def _walk_ld(o: Any) -> None:
                    if isinstance(o, dict):
                        name = str(o.get("name") or o.get("title") or "")
                        if o.get("@type") in ("Offer", "Product", "Car", "Vehicle") and "price" in o:
                            p = o["price"]
                            if isinstance(p, (int, float)) and 500 <= p <= price_cap:
                                if name and not title_matches_vehicle(
                                    name, marca, modelo, strict=strict_title
                                ):
                                    return
                                pi = int(p)
                                if pi not in seen:
                                    seen.add(pi)
                                    samples.append(
                                        ListingSample(
                                            price=pi,
                                            title=name,
                                            source="coches.net",
                                        )
                                    )
                        for v in o.values():
                            _walk_ld(v)
                    elif isinstance(o, list):
                        for v in o:
                            _walk_ld(v)

                _walk_ld(obj)
            except Exception as exc:
                logger.debug("JSON-LD parse error: %s", exc)

        if not samples and not strict_title:
            for m in re.finditer(r"(\d{1,3}(?:\.\d{3})+)\s*€", cn_resp.text):
                val = int(m.group(1).replace(".", ""))
                if 1000 <= val <= price_cap and val not in seen:
                    seen.add(val)
                    samples.append(ListingSample(price=val, source="coches.net"))
    except Exception as exc:
        logger.debug("coches.net fetch failed: %s", exc, exc_info=True)

    return samples


def _parse_autoscout_year(listing: dict) -> Optional[int]:
    tracking = listing.get("tracking") or {}
    fr = tracking.get("firstRegistration") or tracking.get("first_registration")
    if isinstance(fr, str):
        m = re.search(r"(19|20)\d{2}", fr)
        if m:
            return int(m.group(0))
    vehicle = listing.get("vehicle") or {}
    for key in ("firstRegistrationYear", "firstRegistrationDate", "productionYear"):
        val = vehicle.get(key)
        if isinstance(val, int) and 1980 <= val <= 2100:
            return val
        if isinstance(val, str):
            m = re.search(r"(19|20)\d{2}", val)
            if m:
                return int(m.group(0))
    return None


def _parse_autoscout_km(listing: dict) -> Optional[float]:
    for detail in listing.get("vehicleDetails") or []:
        if not isinstance(detail, dict):
            continue
        icon = str(detail.get("iconName") or "")
        data = str(detail.get("data") or "")
        if "mileage" in icon or "km" in data.lower():
            digits = re.sub(r"[^\d]", "", data.replace(".", "").replace(",", ""))
            if digits.isdigit():
                return float(digits)
    vehicle = listing.get("vehicle") or {}
    mileage = vehicle.get("mileageInKm") or vehicle.get("mileage")
    if isinstance(mileage, (int, float)) and mileage > 0:
        return float(mileage)
    return None


def fetch_autoscout_samples(
    marca: str,
    modelo: str,
    *,
    km: Optional[int],
    anio: Optional[int],
    price_cap: int,
    loose: bool = False,
    strict_title: bool = True,
) -> list[ListingSample]:
    """Public Autoscout24.es listings via __NEXT_DATA__ (no API key)."""
    samples: list[ListingSample] = []
    seen: set[int] = set()
    make = url_slug(marca)
    model = url_slug(modelo)
    if not make or not model:
        return samples

    year_pad = 5 if loose else 2
    params: dict[str, Any] = {
        "cy": "E",
        "atype": "C",
        "ustate": "N,U",
        "sort": "price",
        "desc": "0",
        "damaged_listing": "exclude",
        "priceto": str(price_cap),
        "pricefrom": "500",
    }
    if anio:
        params["fregfrom"] = anio - year_pad
        params["fregto"] = anio + year_pad
    if km:
        lo = 0.25 if loose else 0.4
        hi = 2.0 if loose else 1.5
        params["kmfrom"] = max(0, int(km * lo))
        params["kmto"] = int(km * hi)

    url = f"https://www.autoscout24.es/lst/{make}/{model}"
    try:
        resp = requests.get(
            url,
            params=params,
            headers={**BROWSER_HEADERS, "Accept": "text/html"},
            timeout=20,
        )
        if resp.status_code != 200:
            logger.debug("Autoscout24 HTTP %s for %s", resp.status_code, url)
            return samples

        match = re.search(
            r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
            resp.text,
            re.S,
        )
        if not match:
            return samples

        data = json.loads(match.group(1))
        listings = (
            data.get("props", {})
            .get("pageProps", {})
            .get("listings", [])
        )
        if not isinstance(listings, list):
            return samples

        year_tol = 5 if loose else 3
        for listing in listings:
            if not isinstance(listing, dict):
                continue
            price_obj = listing.get("price") or {}
            raw = price_obj.get("priceRaw")
            if not isinstance(raw, (int, float)):
                continue
            price = int(raw)
            if not (500 <= price <= price_cap) or price in seen:
                continue

            vehicle = listing.get("vehicle") or {}
            make_name = str(vehicle.get("make") or marca)
            model_name = str(vehicle.get("model") or modelo)
            version = str(vehicle.get("modelVersionInput") or "")
            title = f"{make_name} {model_name} {version}".strip()
            if not title_matches_vehicle(title, marca, modelo, strict=strict_title):
                continue

            listing_year = _parse_autoscout_year(listing)
            if anio and listing_year is not None and abs(listing_year - anio) > year_tol:
                continue

            listing_km = _parse_autoscout_km(listing)
            if km and listing_km is not None and listing_km > 10_000:
                lo_f, hi_f = (0.2, 2.5) if loose else (0.3, 2.0)
                if not (km * lo_f <= listing_km <= km * hi_f):
                    continue

            seen.add(price)
            samples.append(
                ListingSample(
                    price=price,
                    km=listing_km,
                    year=listing_year,
                    title=title,
                    source="autoscout24",
                )
            )
    except Exception as exc:
        logger.debug("Autoscout24 fetch failed: %s", exc, exc_info=True)

    return samples


def _merge_samples(*groups: list[ListingSample]) -> list[ListingSample]:
    by_price: dict[int, ListingSample] = {}
    for group in groups:
        for s in group:
            prev = by_price.get(s.price)
            if prev is None or (s.title and not prev.title) or (s.km and not prev.km):
                by_price[s.price] = s
    return list(by_price.values())


def _fuente_from_samples(samples: list[ListingSample]) -> Source:
    src = {s.source for s in samples}
    if len(src) == 1:
        only = next(iter(src))
        if only in ("wallapop", "coches.net", "autoscout24"):
            return only  # type: ignore[return-value]
    return "mixto"


def collect_market_samples(
    marca: str,
    modelo: str,
    *,
    km: Optional[int],
    anio: Optional[int],
    price_cap: int,
    strict_title: bool,
    loose: bool,
) -> list[ListingSample]:
    wp = fetch_wallapop_samples(
        marca,
        modelo,
        km=km,
        anio=anio,
        price_cap=price_cap,
        loose=loose,
        strict_title=strict_title,
    )
    cn = fetch_coches_net_samples(
        marca,
        modelo,
        anio=anio,
        price_cap=price_cap,
        strict_title=strict_title,
    )
    as24 = fetch_autoscout_samples(
        marca,
        modelo,
        km=km,
        anio=anio,
        price_cap=price_cap,
        loose=loose,
        strict_title=strict_title,
    )
    return _merge_samples(wp, cn, as24)


def estimate_vehicle_value(
    *,
    marca: str,
    modelo: str,
    anio: Optional[int],
    km: Optional[int],
    bastidor: Optional[str] = None,
) -> ValuationResult:
    """Public-market valuation only (Wallapop + coches.net). bastidor unused; kept for API compat."""
    del bastidor  # public scrapers do not use VIN
    marca = marca.strip()
    modelo = modelo.strip()
    if not marca or not modelo:
        raise ValueError("Se requieren marca y modelo para la valoración")

    hard_cap = km_price_cap(km)
    year_note = f", año {anio} ±3" if anio else " (sin filtro de año)"
    haircut = ask_haircut()

    samples = collect_market_samples(
        marca,
        modelo,
        km=km,
        anio=anio,
        price_cap=hard_cap,
        strict_title=True,
        loose=False,
    )
    match_mode = "strict"
    strict_failed = False

    if len(samples) < 5:
        samples = collect_market_samples(
            marca,
            modelo,
            km=km,
            anio=anio,
            price_cap=hard_cap,
            strict_title=False,
            loose=True,
        )
        match_mode = "relaxed"
        strict_failed = True
        year_note = f", año {anio} ±5 (ampliado)" if anio else year_note

    if not samples:
        msg = f"No se encontraron precios para {marca} {modelo}"
        if anio:
            msg += f" ({anio})"
        else:
            msg += ". Añade el año del vehículo para mejorar la precisión"
        raise ValueError(msg + ". Introduce el valor manualmente.")

    return compute_market_valuation(
        samples,
        vehicle_km=km,
        vehicle_year=anio if isinstance(anio, int) else None,
        hard_cap=hard_cap,
        fuente=_fuente_from_samples(samples),
        year_note=year_note,
        match_mode=match_mode,
        strict_failed=strict_failed,
        haircut=haircut,
    )
