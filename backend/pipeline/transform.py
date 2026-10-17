"""Transform stage: normalise raw Yahoo payloads into flat, frontend-ready records."""

from datetime import datetime, timezone

from .universe import INDICES


def _iso(ts) -> str | None:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None


def _round(v, n=4):
    return round(v, n) if isinstance(v, (int, float)) else None


def _raw(v):
    """quoteSummary wraps numbers as {"raw": 1.2, "fmt": "1.2"}; unwrap them."""
    if isinstance(v, dict):
        return v.get("raw")
    return v


def clean_series(raw_chart: dict | None) -> list[dict]:
    """Pair timestamps with closes, dropping gaps (Yahoo returns null for halted days)."""
    if not raw_chart:
        return []
    timestamps = raw_chart.get("timestamp") or []
    quote = ((raw_chart.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    return [
        {"date": datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat(), "close": round(c, 4)}
        for ts, c in zip(timestamps, closes)
        if c is not None
    ]


def _kind(q: dict, symbol: str) -> str:
    qt = (q.get("quoteType") or q.get("instrumentType") or "").upper()
    if symbol in INDICES or qt in ("INDEX", "FUTURE", "CRYPTOCURRENCY", "CURRENCY"):
        return "market"
    return "stock"


def transform_quote(symbol: str, q: dict | None, spark: dict | None, info: dict | None = None) -> dict:
    history = clean_series(spark)
    meta = (spark or {}).get("meta", {})
    q = q or {}
    info = info or {}

    price = q.get("regularMarketPrice", meta.get("regularMarketPrice"))
    if price is None and history:
        price = history[-1]["close"]
    if price is None:
        raise ValueError("no price")

    prev_close = q.get("regularMarketPreviousClose")
    if prev_close is None:
        prev_close = history[-2]["close"] if len(history) >= 2 else meta.get("chartPreviousClose")
    change = q.get("regularMarketChange")
    if change is None and prev_close:
        change = price - prev_close
    change_pct = q.get("regularMarketChangePercent")
    if change_pct is None and prev_close and change is not None:
        change_pct = change / prev_close * 100

    earnings = q.get("earningsTimestamp")
    return {
        "symbol": symbol,
        "name": INDICES.get(symbol) or info.get("name") or q.get("longName") or q.get("shortName") or meta.get("longName") or meta.get("shortName") or symbol,
        "kind": _kind(q or meta, symbol),
        "quote_type": q.get("quoteType") or meta.get("instrumentType"),
        "sector": info.get("sector"),
        "sub_industry": info.get("sub_industry"),
        "exchange": q.get("fullExchangeName") or meta.get("fullExchangeName") or meta.get("exchangeName"),
        "currency": q.get("currency") or meta.get("currency") or "USD",
        "market_state": q.get("marketState"),
        "price": _round(price),
        "change": _round(change),
        "change_percent": _round(change_pct),
        "previous_close": _round(prev_close),
        "open": _round(q.get("regularMarketOpen")),
        "day_high": _round(q.get("regularMarketDayHigh", meta.get("regularMarketDayHigh"))),
        "day_low": _round(q.get("regularMarketDayLow", meta.get("regularMarketDayLow"))),
        "volume": q.get("regularMarketVolume", meta.get("regularMarketVolume")),
        "avg_volume_3m": q.get("averageDailyVolume3Month"),
        "market_cap": q.get("marketCap"),
        "shares_outstanding": q.get("sharesOutstanding"),
        "pe_trailing": _round(q.get("trailingPE"), 2),
        "pe_forward": _round(q.get("forwardPE"), 2),
        "eps_trailing": _round(q.get("epsTrailingTwelveMonths"), 2),
        "eps_forward": _round(q.get("epsForward"), 2),
        "dividend_yield": _round(q.get("dividendYield"), 2),  # already a percentage
        "price_to_book": _round(q.get("priceToBook"), 2),
        "fifty_day_avg": _round(q.get("fiftyDayAverage")),
        "two_hundred_day_avg": _round(q.get("twoHundredDayAverage")),
        "fifty_two_week_high": _round(q.get("fiftyTwoWeekHigh", meta.get("fiftyTwoWeekHigh"))),
        "fifty_two_week_low": _round(q.get("fiftyTwoWeekLow", meta.get("fiftyTwoWeekLow"))),
        "fifty_two_week_change_percent": _round(q.get("fiftyTwoWeekChangePercent"), 2),
        "analyst_rating": q.get("averageAnalystRating"),
        "earnings_date": _iso(earnings),
        "market_time": _iso(q.get("regularMarketTime") or meta.get("regularMarketTime")),
        # Closes only (the table's trend line); full dated history comes from /history.
        "spark": [round(h["close"], 2) for h in history],
    }


def transform_market(raw: dict, symbols: list[str], info: dict[str, dict]) -> tuple[list[dict], dict[str, str]]:
    quotes, errors = [], dict(raw["errors"])
    for sym in symbols:
        if sym in errors:
            continue
        try:
            quotes.append(transform_quote(sym, raw["quotes"].get(sym), raw["spark"].get(sym), info.get(sym)))
        except (KeyError, TypeError, ValueError) as exc:
            errors[sym] = f"Could not parse data: {exc}"
    return quotes, errors


# ---------------------------------------------------------------- profiles


def _holders(items: list | None, limit: int = 10) -> list[dict]:
    return [
        {
            "name": h.get("organization"),
            "pct_held": _raw(h.get("pctHeld")),
            "shares": _raw(h.get("position")),
            "value": _raw(h.get("value")),
            "pct_change": _raw(h.get("pctChange")),
            "report_date": _iso(_raw(h.get("reportDate"))),
        }
        for h in (items or [])[:limit]
    ]


def transform_profile(symbol: str, raw: dict) -> dict:
    ap = raw.get("assetProfile") or {}
    sd = raw.get("summaryDetail") or {}
    ks = raw.get("defaultKeyStatistics") or {}
    fd = raw.get("financialData") or {}
    mh = raw.get("majorHoldersBreakdown") or {}
    pr = raw.get("price") or {}

    insiders = _raw(mh.get("insidersPercentHeld"))
    institutions = _raw(mh.get("institutionsPercentHeld"))
    public = None
    if insiders is not None or institutions is not None:
        public = max(0.0, 1 - (insiders or 0) - (institutions or 0))

    location = ", ".join(x for x in (ap.get("city"), ap.get("state"), ap.get("country")) if x)

    return {
        "symbol": symbol,
        "name": pr.get("longName") or pr.get("shortName") or symbol,
        "company": {
            "sector": ap.get("sectorDisp") or ap.get("sector"),
            "industry": ap.get("industryDisp") or ap.get("industry"),
            "headquarters": location or None,
            "address": ap.get("address1"),
            "phone": ap.get("phone"),
            "website": ap.get("website"),
            "ir_website": ap.get("irWebsite"),
            "employees": ap.get("fullTimeEmployees"),
            "summary": ap.get("longBusinessSummary"),
            "officers": [
                {
                    "name": o.get("name"),
                    "title": o.get("title"),
                    "age": o.get("age"),
                    "year_born": o.get("yearBorn"),
                    "total_pay": _raw(o.get("totalPay")),
                }
                for o in (ap.get("companyOfficers") or [])[:10]
            ],
            "governance": {
                "overall": ap.get("overallRisk"),
                "audit": ap.get("auditRisk"),
                "board": ap.get("boardRisk"),
                "compensation": ap.get("compensationRisk"),
                "shareholder_rights": ap.get("shareHolderRightsRisk"),
            },
        },
        "ownership": {
            "insiders_pct": insiders,
            "institutions_pct": institutions,
            "public_pct": public,
            "institutions_float_pct": _raw(mh.get("institutionsFloatPercentHeld")),
            "institutions_count": _raw(mh.get("institutionsCount")),
            "shares_outstanding": _raw(ks.get("sharesOutstanding")),
            "float_shares": _raw(ks.get("floatShares")),
            "short_pct_float": _raw(ks.get("shortPercentOfFloat")),
            "top_institutions": _holders((raw.get("institutionOwnership") or {}).get("ownershipList")),
            "top_funds": _holders((raw.get("fundOwnership") or {}).get("ownershipList")),
            "insiders": [
                {
                    "name": h.get("name"),
                    "relation": h.get("relation"),
                    "shares": _raw(h.get("positionDirect")),
                    "last_transaction": h.get("transactionDescription"),
                    "last_date": _iso(_raw(h.get("latestTransDate"))),
                }
                for h in ((raw.get("insiderHolders") or {}).get("holders") or [])[:10]
            ],
        },
        "valuation": {
            "market_cap": _raw(sd.get("marketCap")) or _raw(pr.get("marketCap")),
            "enterprise_value": _raw(ks.get("enterpriseValue")),
            "beta": _raw(sd.get("beta")),
            "trailing_pe": _raw(sd.get("trailingPE")),
            "forward_pe": _raw(sd.get("forwardPE")),
            "peg_ratio": _raw(ks.get("pegRatio")),
            "price_to_book": _raw(ks.get("priceToBook")),
            "price_to_sales": _raw(sd.get("priceToSalesTrailing12Months")),
            "dividend_yield": _raw(sd.get("dividendYield")),
            "payout_ratio": _raw(sd.get("payoutRatio")),
        },
        "financials": {
            "revenue": _raw(fd.get("totalRevenue")),
            "revenue_growth": _raw(fd.get("revenueGrowth")),
            "gross_margin": _raw(fd.get("grossMargins")),
            "operating_margin": _raw(fd.get("operatingMargins")),
            "profit_margin": _raw(fd.get("profitMargins")),
            "return_on_equity": _raw(fd.get("returnOnEquity")),
            "total_cash": _raw(fd.get("totalCash")),
            "total_debt": _raw(fd.get("totalDebt")),
            "free_cash_flow": _raw(fd.get("freeCashflow")),
        },
        "analyst": {
            "recommendation": fd.get("recommendationKey"),
            "recommendation_mean": _raw(fd.get("recommendationMean")),
            "analysts": _raw(fd.get("numberOfAnalystOpinions")),
            "target_low": _raw(fd.get("targetLowPrice")),
            "target_mean": _raw(fd.get("targetMeanPrice")),
            "target_high": _raw(fd.get("targetHighPrice")),
            "current_price": _raw(fd.get("currentPrice")),
        },
    }
