"""Kraken REST API client — HMAC-SHA512 auth, no third-party SDK needed."""
import base64
import hashlib
import hmac
import time
import urllib.parse
from typing import Optional
import requests

KRAKEN_API_URL = "https://api.kraken.com"

ASSET_NAMES: dict[str, str] = {
    "XXBT": "BTC", "XBT": "BTC",
    "XETH": "ETH",
    "XLTC": "LTC",
    "XXRP": "XRP",
    "XXLM": "XLM",
    "XXDG": "DOGE", "XDG": "DOGE",
    "XZEC": "ZEC",
    "ZUSD": "USD",
    "ZEUR": "EUR",
    "ZGBP": "GBP",
    "ZCAD": "CAD",
}

# Pairs for EUR price lookup (Kraken native pair name)
EUR_PAIRS: dict[str, str] = {
    "BTC": "XXBTZEUR",
    "ETH": "XETHZEUR",
    "LTC": "XLTCZEUR",
    "XRP": "XXRPZEUR",
    "XLM": "XXLMZEUR",
    "DOGE": "XDGEUR",
    "ZEC": "XZECZEUR",
    "SOL": "SOLEUR",
    "ADA": "ADAEUR",
    "DOT": "DOTEUR",
    "MATIC": "MATICEUR",
    "LINK": "LINKEUR",
    "ATOM": "ATOMEUR",
    "AVAX": "AVAXEUR",
    "USDT": "USDTEUR",
    "USDC": "USDCEUR",
    "USD": "USDTZEUR",  # approximation via USDT
}

FIAT_ASSETS = {"EUR", "ZEUR", "USD", "ZUSD", "GBP", "ZGBP", "CAD", "ZCAD"}


def normalize_asset(raw: str) -> str:
    return ASSET_NAMES.get(raw, raw)


def is_fiat(raw: str) -> bool:
    return raw in FIAT_ASSETS or normalize_asset(raw) in {"EUR", "USD", "GBP", "CAD"}


class KrakenAPI:
    def __init__(self, api_key: str, api_secret: str):
        self._api_key = api_key.strip()
        self._api_secret = api_secret.strip()

    def _sign(self, urlpath: str, data: dict) -> str:
        postdata = urllib.parse.urlencode(data)
        encoded = (str(data["nonce"]) + postdata).encode()
        message = urlpath.encode() + hashlib.sha256(encoded).digest()
        mac = hmac.new(base64.b64decode(self._api_secret), message, hashlib.sha512)
        return base64.b64encode(mac.digest()).decode()

    def _post(self, method: str, data: Optional[dict] = None) -> dict:
        if data is None:
            data = {}
        data["nonce"] = str(int(time.time() * 1000))
        urlpath = f"/0/private/{method}"
        resp = requests.post(
            f"{KRAKEN_API_URL}{urlpath}",
            headers={"API-Key": self._api_key, "API-Sign": self._sign(urlpath, data)},
            data=data,
            timeout=15,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get("error"):
            raise Exception(f"Kraken API error: {result['error']}")
        return result.get("result", {})

    def get_balance(self) -> dict[str, float]:
        raw = self._post("Balance")
        return {asset: float(amount) for asset, amount in raw.items() if float(amount) > 0}

    def get_ledgers(self, start: Optional[int] = None, ofs: int = 0) -> dict:
        data: dict = {"ofs": str(ofs)}
        if start:
            data["start"] = str(start)
        return self._post("Ledgers", data)

    @staticmethod
    def get_eur_prices(assets: list[str]) -> dict[str, float]:
        """Fetch EUR spot prices for a list of normalized asset names via public ticker."""
        pairs = [EUR_PAIRS[a] for a in assets if a in EUR_PAIRS]
        if not pairs:
            return {}
        try:
            resp = requests.get(
                f"{KRAKEN_API_URL}/0/public/Ticker",
                params={"pair": ",".join(pairs)},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("error"):
                return {}
            prices: dict[str, float] = {}
            for asset in assets:
                pair = EUR_PAIRS.get(asset)
                if not pair:
                    continue
                for key, val in data.get("result", {}).items():
                    if key == pair or key.replace("XBT", "BTC") == pair:
                        prices[asset] = float(val["c"][0])
                        break
            return prices
        except Exception:
            return {}
