"""Stock market data pipeline: extract -> transform -> load."""

import asyncio
import re
from datetime import datetime, timezone

from .constituents import get_constituents
from .extract import extract_history, extract_market, extract_profile
from .load import cached_profile, latest_snapshot, load, save_profile
from .transform import clean_series, transform_market, transform_profile
from .universe import INDICES

SOURCE = "Yahoo Finance (public API)"
SYMBOL_RE = re.compile(r"^[A-Z0-9.^=\-]{1,15}$")
PROFILE_TTL_SECONDS = 6 * 3600

# range -> candle interval for the on-demand history endpoint
HISTORY_RANGES = {"5d": "30m", "1mo": "1d", "3mo": "1d", "6mo": "1d", "1y": "1d", "5y": "1wk", "max": "1mo"}

_lock = asyncio.Lock()


def normalise_symbol(s: str) -> str | None:
    s = s.strip().upper()
    return s if SYMBOL_RE.match(s) else None


MAX_EXTRA_SYMBOLS = 100


def universe(constituents: list[dict], extra: list[str] | None = None) -> list[str]:
    """Indices + every S&P 500 constituent + any extra (watchlist) symbols."""
    symbols = list(INDICES) + [c["symbol"] for c in constituents]
    known = set(symbols)
    added = 0
    for s in extra or []:
        s = normalise_symbol(s)
        if s and s not in known and added < MAX_EXTRA_SYMBOLS:
            symbols.append(s)
            known.add(s)
            added += 1
    return symbols


async def run_pipeline(extra_symbols: list[str] | None = None) -> dict:
    """Run one full extract/transform/load pass and return the stored snapshot."""
    async with _lock:  # one run at a time, so concurrent refresh clicks don't pile up
        index = await get_constituents()
        symbols = universe(index["items"], extra_symbols)
        info = {c["symbol"]: c for c in index["items"]}
        raw = await extract_market(symbols)
        quotes, errors = transform_market(raw, symbols, info)
        fetched_at = datetime.now(timezone.utc).isoformat()
        load(quotes, errors, raw["warnings"], fetched_at, SOURCE)
        return latest_snapshot()


async def get_sp500() -> dict:
    index = await get_constituents()
    sectors: dict[str, list[str]] = {}
    for c in index["items"]:
        sectors.setdefault(c["sector"], []).append(c["symbol"])
    return {"source": index["source"], "fetched_at": index["fetched_at"], "count": len(index["items"]), "sectors": sectors}


async def get_profile(symbol: str, force: bool = False) -> dict:
    """Company profile and ownership breakdown, cached for PROFILE_TTL_SECONDS."""
    if not force:
        cached = cached_profile(symbol, PROFILE_TTL_SECONDS)
        if cached:
            return cached
    profile = transform_profile(symbol, await extract_profile(symbol))
    fetched_at = save_profile(symbol, profile)
    return {**profile, "fetched_at": fetched_at}


async def get_history(symbol: str, range_: str) -> list[dict]:
    raw = await extract_history(symbol, range_, HISTORY_RANGES[range_])
    series = clean_series(raw)
    if HISTORY_RANGES[range_].endswith("m"):  # intraday: keep the time, not just the date
        quote = ((raw.get("indicators") or {}).get("quote") or [{}])[0]
        series = [
            {"date": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(), "close": round(c, 4)}
            for ts, c in zip(raw.get("timestamp") or [], quote.get("close") or [])
            if c is not None
        ]
    return series


__all__ = [
    "run_pipeline",
    "latest_snapshot",
    "get_profile",
    "get_history",
    "normalise_symbol",
    "universe",
    "HISTORY_RANGES",
    "INDICES",
    "get_sp500",
]
