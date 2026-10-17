"""Thin async client for Yahoo Finance's public (keyless) JSON endpoints.

Some endpoints (batch quotes, company profiles) need a session cookie plus a
"crumb" token. The client fetches both once and re-fetches on a 401.
"""

import asyncio
import logging

import httpx

log = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
Q1 = "https://query1.finance.yahoo.com"
Q2 = "https://query2.finance.yahoo.com"
MAX_ATTEMPTS = 3


class YahooError(Exception):
    pass


class YahooClient:
    def __init__(self, timeout: float = 15.0, concurrency: int = 8):
        self._http = httpx.AsyncClient(headers={"User-Agent": UA}, timeout=timeout, follow_redirects=True)
        self._crumb: str | None = None
        self._crumb_lock = asyncio.Lock()
        self._sem = asyncio.Semaphore(concurrency)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self._http.aclose()

    async def _get_crumb(self, force: bool = False) -> str:
        async with self._crumb_lock:
            if self._crumb and not force:
                return self._crumb
            # fc.yahoo.com sets the session cookie (the response itself is a 404).
            await self._http.get("https://fc.yahoo.com")
            resp = await self._http.get(f"{Q1}/v1/test/getcrumb")
            crumb = resp.text.strip()
            if resp.status_code != 200 or not crumb or "<" in crumb:
                raise YahooError("Could not obtain Yahoo session crumb")
            self._crumb = crumb
            return crumb

    async def _get_json(self, url: str, params: dict, needs_crumb: bool = False) -> dict:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                if needs_crumb:
                    params = {**params, "crumb": await self._get_crumb(force=attempt > 1)}
                async with self._sem:
                    resp = await self._http.get(url, params=params)
                if resp.status_code == 404:
                    raise YahooError("Not found")
                if resp.status_code in (401, 403) and needs_crumb:
                    raise httpx.HTTPStatusError("auth", request=resp.request, response=resp)
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
                resp.raise_for_status()
                return resp.json()
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                if attempt == MAX_ATTEMPTS:
                    raise YahooError(f"Request failed: {exc}") from exc
                await asyncio.sleep(0.5 * 2 ** (attempt - 1))
        raise YahooError("Request failed")

    async def quotes(self, symbols: list[str]) -> list[dict]:
        """Batch quote: rich fields (market cap, P/E, EPS, averages...) for many symbols."""
        data = await self._get_json(f"{Q1}/v7/finance/quote", {"symbols": ",".join(symbols)}, needs_crumb=True)
        return data.get("quoteResponse", {}).get("result") or []

    async def spark(self, symbols: list[str], range_: str = "3mo", interval: str = "1d") -> list[dict]:
        """Batch close-price history (up to 20 symbols per call)."""
        data = await self._get_json(
            f"{Q1}/v7/finance/spark", {"symbols": ",".join(symbols), "range": range_, "interval": interval}
        )
        return data.get("spark", {}).get("result") or []

    async def chart(self, symbol: str, range_: str, interval: str) -> dict:
        data = await self._get_json(
            f"{Q1}/v8/finance/chart/{symbol}", {"range": range_, "interval": interval, "includePrePost": "false"}
        )
        chart = data.get("chart", {})
        if chart.get("error") or not chart.get("result"):
            raise YahooError((chart.get("error") or {}).get("description") or f"No data for '{symbol}'")
        return chart["result"][0]

    async def quote_summary(self, symbol: str, modules: list[str]) -> dict:
        data = await self._get_json(
            f"{Q2}/v10/finance/quoteSummary/{symbol}", {"modules": ",".join(modules)}, needs_crumb=True
        )
        summary = data.get("quoteSummary", {})
        if summary.get("error") or not summary.get("result"):
            raise YahooError((summary.get("error") or {}).get("description") or f"No profile for '{symbol}'")
        return summary["result"][0]
