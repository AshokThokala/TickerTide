"""Extract stage: pull raw market data from Yahoo Finance's public endpoints.

- Batch quotes (v7/quote) for rich per-symbol fields, in chunks of 50.
- Batch close-price history (v7/spark) for charts, in chunks of 20.
- Company profile + ownership (v10/quoteSummary), on demand per symbol.

If the batch-quote endpoint is unavailable, the transform stage falls back to
the price fields included in the spark metadata, so a run still succeeds.
"""

import asyncio
import logging

from .yahoo import YahooClient, YahooError

log = logging.getLogger(__name__)

PROFILE_MODULES = [
    "assetProfile",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "majorHoldersBreakdown",
    "institutionOwnership",
    "fundOwnership",
    "insiderHolders",
    "price",
]


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


async def extract_market(symbols: list[str], history_range: str = "3mo") -> dict:
    """Return {"quotes": {sym: raw}, "spark": {sym: raw}, "errors": {sym: msg}, "warnings": [...]}."""
    quotes, spark, errors, warnings = {}, {}, {}, []
    async with YahooClient() as yc:

        async def get_quotes(chunk):
            try:
                for q in await yc.quotes(chunk):
                    quotes[q["symbol"]] = q
            except YahooError as exc:
                log.warning("batch quote failed: %s", exc)
                warnings.append(f"Detailed quote fields unavailable ({exc}); showing price data only.")

        async def get_spark(chunk):
            try:
                for item in await yc.spark(chunk, history_range):
                    resp = (item.get("response") or [None])[0]
                    if resp:
                        spark[item["symbol"]] = resp
            except YahooError as exc:
                log.warning("spark failed for %s: %s", chunk, exc)

        await asyncio.gather(
            *(get_quotes(c) for c in _chunks(symbols, 50)),
            *(get_spark(c) for c in _chunks(symbols, 20)),
        )

        # Per-symbol fallback for anything the batch history call missed.
        missing = [s for s in symbols if s not in spark]

        async def get_chart(sym):
            try:
                spark[sym] = await yc.chart(sym, history_range, "1d")
            except YahooError as exc:
                if sym not in quotes:
                    errors[sym] = f"Unknown symbol or no data ({exc})"

        await asyncio.gather(*(get_chart(s) for s in missing))

    for sym in symbols:
        if sym not in quotes and sym not in spark and sym not in errors:
            errors[sym] = "Unknown symbol or no data"
    return {"quotes": quotes, "spark": spark, "errors": errors, "warnings": sorted(set(warnings))}


async def extract_profile(symbol: str) -> dict:
    async with YahooClient() as yc:
        return await yc.quote_summary(symbol, PROFILE_MODULES)


async def extract_history(symbol: str, range_: str, interval: str) -> dict:
    async with YahooClient() as yc:
        return await yc.chart(symbol, range_, interval)
