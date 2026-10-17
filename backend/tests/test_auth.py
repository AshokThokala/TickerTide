"""End-to-end check of sign up / sign in / sign out and the account watchlist.

Uses a throwaway SQLite file, so it never touches backend/data/stocks.db.
Run from backend/:  python tests/test_auth.py
"""

import importlib
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["APCA_API_KEY_ID"] = ""  # keep the live stream off during the test
os.environ["APCA_API_SECRET_KEY"] = ""

store = importlib.import_module("pipeline.load")
store.DB_PATH = Path(tempfile.mkdtemp()) / "test.db"

from fastapi.testclient import TestClient  # noqa: E402

import auth  # noqa: E402
from main import app  # noqa: E402

# Test-only account; never a real password.
NAME, EMAIL, PASSWORD = "Test User", "Test.User@example.com", "tide-test-pass-1"
failed = False


def check(cond: bool, label: str) -> None:
    global failed
    print(("PASS " if cond else "FAIL ") + label)
    failed |= not cond


with TestClient(app) as c:
    r = c.get("/api/auth/me")
    check(r.status_code == 200 and r.json()["user"] is None, "signed out by default")

    r = c.post("/api/auth/signup", json={"name": NAME, "email": EMAIL, "password": "short"})
    check(r.status_code == 422 and "8 characters" in r.json()["detail"], "short password rejected")
    r = c.post("/api/auth/signup", json={"name": NAME, "email": "not-an-email", "password": PASSWORD})
    check(r.status_code == 422 and "valid email" in r.json()["detail"], "bad email rejected")

    r = c.post("/api/auth/signup", json={"name": NAME, "email": EMAIL, "password": PASSWORD})
    check(r.status_code == 201 and r.json()["user"]["email"] == EMAIL.lower(), "sign up creates account (email lower-cased)")
    cookie = r.headers.get("set-cookie", "")
    check("tt_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie, "session cookie is HttpOnly + SameSite=Lax")
    check(c.get("/api/auth/me").json()["user"]["name"] == NAME, "signed in after sign up")

    r = c.post("/api/auth/signup", json={"name": NAME, "email": EMAIL.upper(), "password": PASSWORD})
    check(r.status_code == 409, "duplicate email (any case) rejected")

    with auth.db() as conn:
        stored = conn.execute("SELECT password_hash FROM users").fetchone()[0]
        token_hashes = [row[0] for row in conn.execute("SELECT token_hash FROM sessions")]
    check(stored.startswith("scrypt$") and PASSWORD not in stored, "password stored as scrypt hash")
    raw_token = c.cookies.get("tt_session")
    check(raw_token not in token_hashes, "session token stored hashed, not raw")

    r = c.put("/api/me/watchlist", json={"symbols": ["aapl", "BRK-B", "AAPL", "bad symbol!"]})
    check(r.json()["symbols"] == ["AAPL", "BRK-B"], "watchlist saved, cleaned and de-duplicated")
    check(c.get("/api/me/watchlist").json()["symbols"] == ["AAPL", "BRK-B"], "watchlist read back")

    c.post("/api/auth/signout")
    check(c.get("/api/auth/me").json()["user"] is None, "sign out ends the session")
    check(c.get("/api/me/watchlist").status_code == 401, "watchlist needs sign-in")

    r = c.post("/api/auth/signin", json={"email": EMAIL, "password": "wrong-password"})
    check(r.status_code == 401 and r.json()["detail"] == "Incorrect email or password.", "wrong password rejected")
    r = c.post("/api/auth/signin", json={"email": "nobody@example.com", "password": PASSWORD})
    check(r.status_code == 401 and r.json()["detail"] == "Incorrect email or password.", "unknown email gets the same message")

    r = c.post("/api/auth/signin", json={"email": EMAIL.upper(), "password": PASSWORD, "remember": True})
    check(r.status_code == 200, "sign in works (email case-insensitive)")
    check("Max-Age=" in r.headers.get("set-cookie", ""), "remember me sets a persistent cookie")
    check(c.get("/api/me/watchlist").json()["symbols"] == ["AAPL", "BRK-B"], "watchlist follows the account")

    for _ in range(5):
        c.post("/api/auth/signin", json={"email": "victim@example.com", "password": "guess"})
    r = c.post("/api/auth/signin", json={"email": "victim@example.com", "password": "guess"})
    check(r.status_code == 429, "repeated failures are rate-limited")

print("\nALL PASSED" if not failed else "\nSOME CHECKS FAILED")
sys.exit(1 if failed else 0)
