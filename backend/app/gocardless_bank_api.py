"""GoCardless Bank Account Data API v2 client (requests-based, no extra SDK needed)."""
import threading
import time
from typing import Callable, Optional

import requests
from requests.exceptions import ConnectionError, Timeout

BASE_URL = "https://bankaccountdata.gocardless.com/api/v2"
GC_HOST = "bankaccountdata.gocardless.com"
MAX_RETRIES = 3
RETRY_BACKOFF_SEC = 0.75
# Free-tier Bank Account Data is easy to trip with many Revolut pockets.
MAX_RATE_LIMIT_RETRIES = 5
RATE_LIMIT_BASE_WAIT_SEC = 4.0
RATE_LIMIT_MAX_WAIT_SEC = 60.0
# Tokens: el de acceso dura ~24 h y el de refresco ~30 días. Pedir uno nuevo en cada sincronización (y en
# cada cuenta cuando fallaba) agotaba el límite de /token/new/ y todo acababa en 429 (Soberan, 2026-10-29).
# Se comparten entre clientes del mismo proceso y, si se da un almacén, sobreviven a los reinicios.
TOKEN_MARGIN_SEC = 300
_TOKENS: dict[str, dict] = {}
_TOKENS_LOCK = threading.Lock()
_AUTH_BLOCKED_UNTIL: dict[str, float] = {}


class GoCardlessRateLimited(Exception):
    """GoCardless no deja pedir token ahora (429): no se insiste hasta que pase la espera."""


def format_gocardless_error(err: Exception) -> str:
    """User-facing message for GoCardless connectivity failures."""
    msg = str(err)
    lower = msg.lower()
    if "429" in msg or "too many requests" in lower:
        return (
            "GoCardless ha limitado las peticiones (demasiadas syncs / muchas cuentas). "
            "Espera unos minutos y sincroniza de nuevo; con muchas cuentas Revolut conviene "
            "sincronizar de una en una o dejar que pase el job periódico."
        )
    if (
        "nameresolutionerror" in lower
        or "temporary failure in name resolution" in lower
        or "failed to resolve" in lower
    ):
        return (
            f"No se puede resolver {GC_HOST} (fallo DNS temporal en el servidor). "
            "Reintenta en unos minutos; si persiste, revisa DNS del contenedor Nomad."
        )
    if isinstance(err, Timeout) or "timed out" in lower:
        return "GoCardless no respondió a tiempo. Reintenta en unos minutos."
    return f"Error de GoCardless: {msg}"


def _retry_after_seconds(resp: requests.Response, attempt: int) -> float:
    header = (resp.headers.get("Retry-After") or "").strip()
    if header.isdigit():
        return min(float(header), RATE_LIMIT_MAX_WAIT_SEC)
    wait = RATE_LIMIT_BASE_WAIT_SEC * (2 ** attempt)
    return min(wait, RATE_LIMIT_MAX_WAIT_SEC)


def _request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
    last_err: Optional[Exception] = None
    for attempt in range(MAX_RETRIES):
        try:
            return requests.request(method, url, **kwargs)
        except (ConnectionError, Timeout) as err:
            last_err = err
            if attempt + 1 >= MAX_RETRIES:
                raise
            time.sleep(RETRY_BACKOFF_SEC * (attempt + 1))
    if last_err:
        raise last_err
    raise RuntimeError("request retry loop exited without response")


class _InstitutionAPI:
    def __init__(self, client: "GoCardlessBankAPI"):
        self._client = client

    def get_institutions(self, country: str = "ES"):
        return self._client._get_paginated_list(f"/institutions/?country={country}")


class GoCardlessBankAPI:
    def __init__(self, secret_id: str, secret_key: str,
                 token_load: Optional[Callable[[], Optional[dict]]] = None,
                 token_save: Optional[Callable[[dict], None]] = None):
        self._secret_id = secret_id
        self._secret_key = secret_key
        self._access_token: Optional[str] = None
        self._token_load = token_load
        self._token_save = token_save
        self.institution = _InstitutionAPI(self)

    def _cached(self) -> Optional[dict]:
        tok = _TOKENS.get(self._secret_id)
        if tok is None and self._token_load:
            try:
                tok = self._token_load()
            except Exception:  # noqa: BLE001 — un almacén roto no impide pedir token
                tok = None
            if tok:
                _TOKENS[self._secret_id] = tok
        return tok

    def _store(self, tok: dict) -> None:
        _TOKENS[self._secret_id] = tok
        if self._token_save:
            try:
                self._token_save(tok)
            except Exception:  # noqa: BLE001
                pass

    def _token_post(self, path: str, payload: dict) -> requests.Response:
        resp = _request_with_retry("POST", f"{BASE_URL}{path}", json=payload, timeout=15)
        if resp.status_code == 429:
            # Hasta que pase la espera no se vuelve a pedir token (antes: un intento por cuenta, todos 429).
            header = (resp.headers.get("Retry-After") or "").strip()
            wait = float(header) if header.isdigit() else 15 * 60.0
            _AUTH_BLOCKED_UNTIL[self._secret_id] = time.time() + wait
            raise GoCardlessRateLimited(f"429 Too Many Requests: GoCardless limita los tokens; reintento en {max(1, round(wait / 60))} min")
        return resp

    def _authenticate(self, force_new: bool = False) -> None:
        """Token de acceso: el guardado si sigue vivo; si no, se renueva con el de refresco y, solo si
        tampoco vale, se pide uno nuevo (lo que tiene límite)."""
        with _TOKENS_LOCK:
            now = time.time()
            blocked = _AUTH_BLOCKED_UNTIL.get(self._secret_id, 0)
            tok = None if force_new else self._cached()
            if tok and tok.get("access") and tok.get("access_until", 0) - TOKEN_MARGIN_SEC > now:
                self._access_token = tok["access"]
                return
            if blocked > now:
                raise GoCardlessRateLimited(
                    f"429 Too Many Requests: GoCardless limita los tokens; reintento en {max(1, round((blocked - now) / 60))} min")
            if tok and tok.get("refresh") and tok.get("refresh_until", 0) - TOKEN_MARGIN_SEC > now:
                resp = self._token_post("/token/refresh/", {"refresh": tok["refresh"]})
                if resp.ok:
                    data = resp.json()
                    tok = {**tok, "access": data["access"], "access_until": now + float(data.get("access_expires", 86400))}
                    self._store(tok)
                    self._access_token = tok["access"]
                    return
            resp = self._token_post("/token/new/", {"secret_id": self._secret_id, "secret_key": self._secret_key})
            resp.raise_for_status()
            data = resp.json()
            tok = {"access": data["access"], "access_until": now + float(data.get("access_expires", 86400)),
                   "refresh": data.get("refresh"), "refresh_until": now + float(data.get("refresh_expires", 2592000))}
            self._store(tok)
            self._access_token = tok["access"]

    def _expire_access(self) -> None:
        """El de acceso ya no vale (401): fuera, pero se conserva el de refresco."""
        self._access_token = None
        with _TOKENS_LOCK:
            tok = _TOKENS.get(self._secret_id)
            if tok:
                _TOKENS[self._secret_id] = {**tok, "access": None, "access_until": 0}

    def _headers(self) -> dict:
        if not self._access_token:
            self._authenticate()
        return {"Authorization": f"Bearer {self._access_token}", "Accept": "application/json"}

    def _request(self, method: str, url: str, retry_auth: bool = True, **kwargs) -> requests.Response:
        kwargs.setdefault("timeout", 30)
        if "headers" not in kwargs:
            kwargs["headers"] = self._headers()
        resp = _request_with_retry(method, url, **kwargs)
        if resp.status_code == 401 and retry_auth:
            self._expire_access()
            kwargs["headers"] = self._headers()
            resp = _request_with_retry(method, url, **kwargs)

        # Honor GoCardless rate limits instead of failing every Revolut pocket.
        rate_attempt = 0
        while resp.status_code == 429 and rate_attempt < MAX_RATE_LIMIT_RETRIES:
            wait = _retry_after_seconds(resp, rate_attempt)
            time.sleep(wait)
            rate_attempt += 1
            resp = _request_with_retry(method, url, **kwargs)
            if resp.status_code == 401 and retry_auth:
                self._expire_access()
                kwargs["headers"] = self._headers()
                resp = _request_with_retry(method, url, **kwargs)
        return resp

    def _get(self, path: str) -> dict:
        resp = self._request("GET", f"{BASE_URL}{path}")
        resp.raise_for_status()
        return resp.json()

    def _get_paginated_list(self, path: str) -> list[dict]:
        items: list[dict] = []
        next_url = f"{BASE_URL}{path}"

        while next_url:
            resp = self._request("GET", next_url)
            resp.raise_for_status()
            payload = resp.json()

            if isinstance(payload, list):
                items.extend(payload)
                break

            if not isinstance(payload, dict):
                raise ValueError("Unexpected institutions response format from GoCardless")

            page_items = payload.get("results")
            if isinstance(page_items, list):
                items.extend(page_items)
            else:
                raise ValueError("GoCardless institutions response missing results list")

            next_candidate = payload.get("next")
            next_url = next_candidate if isinstance(next_candidate, str) and next_candidate else None

        return items

    def _post(self, path: str, data: dict) -> dict:
        resp = self._request("POST", f"{BASE_URL}{path}", json=data)
        resp.raise_for_status()
        return resp.json()

    def _delete(self, path: str) -> None:
        resp = self._request("DELETE", f"{BASE_URL}{path}")
        if resp.status_code not in (200, 204):
            resp.raise_for_status()

    def create_requisition(
        self,
        institution_id: str,
        redirect_url: str,
        reference: str,
        user_language: str = "ES",
    ) -> dict:
        return self._post("/requisitions/", {
            "redirect": redirect_url,
            "institution_id": institution_id,
            "reference": reference,
            "user_language": user_language,
        })

    def get_requisition(self, requisition_id: str) -> dict:
        return self._get(f"/requisitions/{requisition_id}/")

    def delete_requisition(self, requisition_id: str) -> None:
        self._delete(f"/requisitions/{requisition_id}/")

    def get_account_details(self, account_id: str) -> dict:
        return self._get(f"/accounts/{account_id}/details/")

    def get_account_metadata(self, account_id: str) -> dict:
        return self._get(f"/accounts/{account_id}/")

    def get_account_balances(self, account_id: str) -> dict:
        return self._get(f"/accounts/{account_id}/balances/")

    def get_account_transactions(
        self,
        account_id: str,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> dict:
        params = []
        if date_from:
            params.append(f"date_from={date_from}")
        if date_to:
            params.append(f"date_to={date_to}")
        qs = ("?" + "&".join(params)) if params else ""
        return self._get(f"/accounts/{account_id}/transactions/{qs}")


def reset_token_cache_for_tests() -> None:
    _TOKENS.clear()
    _AUTH_BLOCKED_UNTIL.clear()
