"""S&P 500 constituents: who is in the index, with GICS sector and company basics.

Sources, in order:
  1. datasets/s-and-p-500-companies CSV on GitHub (auto-updated from Wikipedia)
  2. Wikipedia's "List of S&P 500 companies" table
  3. The last list saved in SQLite (any age)
  4. The small built-in universe, so the app still works fully offline
"""

import csv
import io
import json
import logging
from datetime import datetime, timezone
from html.parser import HTMLParser

import httpx

from .load import connect
from .universe import SECTORS

log = logging.getLogger(__name__)

CSV_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
TTL_SECONDS = 24 * 3600
HEADERS = {"User-Agent": "TickerTide/1.0 (stock dashboard pipeline)"}
COLUMNS = ["Symbol", "Security", "GICS Sector", "GICS Sub-Industry", "Headquarters Location", "Date added", "CIK", "Founded"]


def _record(row: dict) -> dict:
    return {
        # Yahoo writes share classes with a dash (BRK-B); the index lists use a dot (BRK.B).
        "symbol": row["Symbol"].strip().replace(".", "-"),
        "name": row["Security"].strip(),
        "sector": row["GICS Sector"].strip(),
        "sub_industry": row["GICS Sub-Industry"].strip(),
        "headquarters": row["Headquarters Location"].strip(),
        "date_added": row["Date added"].strip() or None,
        "founded": row["Founded"].strip() or None,
    }


def _parse_csv(text: str) -> list[dict]:
    return [_record(r) for r in csv.DictReader(io.StringIO(text)) if r.get("Symbol")]


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(self.cell.strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data


def _parse_wikipedia(html: str) -> list[dict]:
    start = html.find('id="constituents"')
    if start < 0:
        raise ValueError("constituents table not found")
    parser = _TableParser()
    parser.feed(html[start : html.find("</table>", start)])
    header, *body = parser.rows
    if header[: len(COLUMNS)] != COLUMNS:
        raise ValueError(f"unexpected columns: {header}")
    return [_record(dict(zip(COLUMNS, r))) for r in body if len(r) >= len(COLUMNS)]


def _save(items: list[dict], source: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, fetched_at, payload) VALUES ('sp500', ?, ?)",
            (datetime.now(timezone.utc).isoformat(), json.dumps({"source": source, "items": items})),
        )


def _cached(max_age: float | None) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT fetched_at, payload FROM meta WHERE key = 'sp500'").fetchone()
    if not row:
        return None
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(row[0])).total_seconds()
    if max_age is not None and age > max_age:
        return None
    return {**json.loads(row[1]), "fetched_at": row[0]}


def _fallback() -> dict:
    items = [
        {"symbol": s, "name": s, "sector": sector, "sub_industry": None, "headquarters": None, "date_added": None, "founded": None}
        for sector, syms in SECTORS.items()
        for s in syms
    ]
    return {"source": "built-in list (S&P 500 sources unreachable)", "items": items, "fetched_at": None}


async def get_constituents(force: bool = False) -> dict:
    """Return {"source", "items": [...], "fetched_at"}; cached for a day."""
    if not force and (cached := _cached(TTL_SECONDS)):
        return cached
    async with httpx.AsyncClient(headers=HEADERS, timeout=15.0, follow_redirects=True) as http:
        for name, url, parse in (("GitHub datasets CSV", CSV_URL, _parse_csv), ("Wikipedia", WIKI_URL, _parse_wikipedia)):
            try:
                resp = await http.get(url)
                resp.raise_for_status()
                items = parse(resp.text)
                if len(items) < 450:  # sanity check: a truncated or changed page
                    raise ValueError(f"only {len(items)} rows")
                _save(items, name)
                return _cached(None)
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                log.warning("S&P 500 list from %s failed: %s", name, exc)
    return _cached(None) or _fallback()
