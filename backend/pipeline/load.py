"""Load stage: persist pipeline runs, quotes and company profiles to SQLite.

Every market run is kept, so the store doubles as an audit log of pulls. The
API serves the most recent run. Profiles are cached per symbol with a TTL.
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "stocks.db"
KEEP_RUNS = 50  # an S&P 500 run is ~0.5 MB, so don't keep every run forever

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at  TEXT NOT NULL,
    source      TEXT NOT NULL,
    errors      TEXT NOT NULL,
    warnings    TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS quotes (
    run_id   INTEGER NOT NULL REFERENCES runs(id),
    symbol   TEXT NOT NULL,
    payload  TEXT NOT NULL,
    PRIMARY KEY (run_id, symbol)
);
CREATE TABLE IF NOT EXISTS meta (
    key         TEXT PRIMARY KEY,
    fetched_at  TEXT NOT NULL,
    payload     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
    symbol      TEXT PRIMARY KEY,
    fetched_at  TEXT NOT NULL,
    payload     TEXT NOT NULL
);
"""


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(SCHEMA)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(runs)")}
        if "warnings" not in cols:  # databases created by the first version
            conn.execute("ALTER TABLE runs ADD COLUMN warnings TEXT NOT NULL DEFAULT '[]'")
        yield conn
        conn.commit()
    finally:
        conn.close()


def load(quotes: list[dict], errors: dict, warnings: list, fetched_at: str, source: str) -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO runs (fetched_at, source, errors, warnings) VALUES (?, ?, ?, ?)",
            (fetched_at, source, json.dumps(errors), json.dumps(warnings)),
        )
        run_id = cur.lastrowid
        conn.executemany(
            "INSERT INTO quotes (run_id, symbol, payload) VALUES (?, ?, ?)",
            [(run_id, q["symbol"], json.dumps(q)) for q in quotes],
        )
        conn.execute("DELETE FROM quotes WHERE run_id <= ?", (run_id - KEEP_RUNS,))
        conn.execute("DELETE FROM runs WHERE id <= ?", (run_id - KEEP_RUNS,))
    return run_id


def latest_snapshot() -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT id, fetched_at, source, errors, warnings FROM runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        run_id, fetched_at, source, errors, warnings = row
        quotes = [
            json.loads(p)
            for (p,) in conn.execute("SELECT payload FROM quotes WHERE run_id = ? ORDER BY rowid", (run_id,))
        ]
    return {
        "run_id": run_id,
        "fetched_at": fetched_at,
        "source": source,
        "errors": json.loads(errors),
        "warnings": json.loads(warnings),
        "quotes": quotes,
    }


def save_profile(symbol: str, profile: dict) -> str:
    fetched_at = datetime.now(timezone.utc).isoformat()
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO profiles (symbol, fetched_at, payload) VALUES (?, ?, ?)",
            (symbol, fetched_at, json.dumps(profile)),
        )
    return fetched_at


def cached_profile(symbol: str, max_age_seconds: int) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT fetched_at, payload FROM profiles WHERE symbol = ?", (symbol,)).fetchone()
    if row is None:
        return None
    fetched_at, payload = row
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(fetched_at)).total_seconds()
    if age > max_age_seconds:
        return None
    return {**json.loads(payload), "fetched_at": fetched_at}
