"""GoCardless Bank Account Data API v2 client (requests-based, no extra SDK needed)."""
import time
from typing import Optional

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
    def __init__(self, secret_id: str, secret_key: str):
        self._secret_id = secret_id
        self._secret_key = secret_key
        self._access_token: Optional[str] = None
        self.institution = _InstitutionAPI(self)

    def _authenticate(self) -> None:
        resp = _request_with_retry(
            "POST",
            f"{BASE_URL}/token/new/",
            json={"secret_id": self._secret_id, "secret_key": self._secret_key},
            timeout=15,
        )
        resp.raise_for_status()
        self._access_token = resp.json()["access"]

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
            self._access_token = None
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
                self._access_token = None
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
