"""User accounts: sign up, sign in, sign out, and a watchlist saved to the account.

- Passwords are hashed with scrypt (Python stdlib) and a per-user random salt.
- Sessions are random tokens in an HttpOnly, SameSite=Lax cookie; only a SHA-256
  of the token is stored, so a leaked database can't be used to log in.
- Failed sign-ins are rate-limited per email address.
"""

import base64
import hashlib
import hmac
import importlib
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from pipeline import normalise_symbol

# The module, not the `load()` function that pipeline/__init__ re-exports under the same name.
store = importlib.import_module("pipeline.load")

router = APIRouter(prefix="/api")

COOKIE = "tt_session"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"  # set true behind HTTPS
REMEMBER_DAYS = 30
SESSION_HOURS = 24  # without "remember me": browser-session cookie, 1 day on the server
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SCRYPT = {"n": 2**14, "r": 8, "p": 1}
MAX_FAILURES, FAILURE_WINDOW = 5, 15 * 60

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_watchlists (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    symbols     TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
"""


@contextmanager
def db():
    store.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(store.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ passwords


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=64, **SCRYPT)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# Used when the email doesn't exist, so a miss takes as long as a wrong password.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


# ------------------------------------------------------------------ sessions


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _start_session(conn, response: Response, user_id: int, remember: bool) -> None:
    token = secrets.token_urlsafe(32)
    lifetime = timedelta(days=REMEMBER_DAYS) if remember else timedelta(hours=SESSION_HOURS)
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (_token_hash(token), user_id, _now().isoformat(), (_now() + lifetime).isoformat()),
    )
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_now().isoformat(),))
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(lifetime.total_seconds()) if remember else None,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


def _public(user: sqlite3.Row) -> dict:
    return {"id": user["id"], "email": user["email"], "name": user["name"], "created_at": user["created_at"]}


def current_user(request: Request) -> dict | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    with db() as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
            (_token_hash(token), _now().isoformat()),
        ).fetchone()
    return _public(row) if row else None


def require_user(user: dict | None = Depends(current_user)) -> dict:
    if not user:
        raise HTTPException(401, "Please sign in.")
    return user


# ------------------------------------------------------------------ rate limiting

_failures: dict[str, list[float]] = {}


def _check_rate(email: str) -> None:
    recent = [t for t in _failures.get(email, []) if t > time.time() - FAILURE_WINDOW]
    _failures[email] = recent
    if len(recent) >= MAX_FAILURES:
        wait = int(recent[0] + FAILURE_WINDOW - time.time()) // 60 + 1
        raise HTTPException(429, f"Too many sign-in attempts. Try again in {wait} minute{'s' if wait != 1 else ''}.")


# ------------------------------------------------------------------ endpoints


class SignUp(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)
    remember: bool = True


class SignIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)
    remember: bool = False


def validate_password(password: str, email: str) -> None:
    if len(password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters.")
    if password.strip().lower() == email:
        raise HTTPException(422, "Password can't be the same as your email.")


@router.post("/auth/signup", status_code=201)
def sign_up(body: SignUp, response: Response):
    email = body.email.strip().lower()
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Please enter your name.")
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Please enter a valid email address.")
    validate_password(body.password, email)
    with db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (email, name, hash_password(body.password), _now().isoformat()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "An account with this email already exists. Try signing in.") from None
        _start_session(conn, response, cur.lastrowid, body.remember)
        user = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"user": _public(user)}


@router.post("/auth/signin")
def sign_in(body: SignIn, response: Response):
    email = body.email.strip().lower()
    _check_rate(email)
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        ok = verify_password(body.password, user["password_hash"] if user else _DUMMY_HASH)
        if not (user and ok):
            _failures.setdefault(email, []).append(time.time())
            raise HTTPException(401, "Incorrect email or password.")
        _failures.pop(email, None)
        _start_session(conn, response, user["id"], body.remember)
    return {"user": _public(user)}


@router.post("/auth/signout")
def sign_out(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
    response.delete_cookie(COOKIE, path="/", samesite="lax", secure=COOKIE_SECURE, httponly=True)
    return {"ok": True}


@router.get("/auth/me")
def me(user: dict | None = Depends(current_user)):
    return {"user": user}


class Watchlist(BaseModel):
    symbols: list[str] = Field(max_length=200)


@router.get("/me/watchlist")
def get_watchlist(user: dict = Depends(require_user)):
    with db() as conn:
        row = conn.execute("SELECT symbols FROM user_watchlists WHERE user_id = ?", (user["id"],)).fetchone()
    return {"symbols": json.loads(row["symbols"]) if row else None}


@router.put("/me/watchlist")
def put_watchlist(body: Watchlist, user: dict = Depends(require_user)):
    symbols = []
    for s in body.symbols:
        s = normalise_symbol(s)
        if s and s not in symbols:
            symbols.append(s)
    with db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_watchlists (user_id, symbols, updated_at) VALUES (?, ?, ?)",
            (user["id"], json.dumps(symbols), _now().isoformat()),
        )
    return {"symbols": symbols}
