# TickerTide

Market data for every S&P 500 stock, sector trends, company demographics and live
prices. Python (FastAPI) backend with an extract → transform → load pipeline over
Yahoo Finance's public endpoints, live trade streaming from Alpaca, and a multi-page
React (Vite + React Router) website.

```
backend/
  pipeline/constituents.py  # S&P 500 members (GitHub CSV -> Wikipedia -> last saved copy), cached daily
  pipeline/universe.py   # 8 indices/commodities, plus an offline fallback stock list
  pipeline/yahoo.py      # async Yahoo client: session cookie + crumb, retries, concurrency limit
  pipeline/extract.py    # batch quotes (50/call), batch history (20/call), profiles on demand
  pipeline/transform.py  # ~30 fields per quote; profile -> company, ownership, people, financials
  pipeline/load.py       # SQLite: last 50 runs kept; profiles cached for 6 hours
  live/alpaca.py         # one Alpaca WebSocket shared by all browsers, up to the plan's symbol limit
  auth.py                # accounts: sign up / sign in / sign out, sessions, account watchlist
  main.py                # API (see below), including the live Server-Sent Events stream
  run_pipeline.py        # CLI entry point (for cron / Task Scheduler)
  tests/test_live_stream.py  # end-to-end live test against a fake Alpaca server
  tests/test_auth.py     # end-to-end account test (uses a throwaway database)
  .env.example           # copy to .env for your Alpaca keys (never commit .env)
frontend/src/
  auth.jsx               # who is signed in; sign in / sign up / sign out
  market.jsx             # shared data: fresh pipeline run on open, Refresh, watchlist, live prices
  components/Layout.jsx  # header, dropdown menus, mobile menu, search, ticker tape, footer
  components/StockTable.jsx  # scrollable, sortable rows with sticky header
  pages/ListPages.jsx    # Overview, All stocks, Watchlist, Movers, Sectors, About
  pages/StockPage.jsx    # chart with ranges + Demographics / Leadership / Financials / Key stats
  pages/AuthPages.jsx    # Sign in, Sign up, Account
```

## Run

Requires Python 3.10+ and Node 18+.

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Live prices (Alpaca, free tier)

1. Create a free account at https://alpaca.markets and generate API keys
   (Paper Trading → API Keys; paper keys work for market data).
2. Copy `backend/.env.example` to `backend/.env` and fill in:
   ```
   APCA_API_KEY_ID=your-key-id
   APCA_API_SECRET_KEY=your-secret
   ```
   (Or set them as real environment variables; those take precedence.)
3. Restart the backend. The header badge turns green: **Live · N**.

What streams: the stock page you're viewing first, then your watchlist, up to 30 symbols.
Each trade updates the price and change, and the cell flashes. Other rows still update on
**Refresh**. Free-plan limits:

- **IEX feed only.** Prices are real-time, but they're only IEX's trades, so they can differ
  slightly from the consolidated price. With a paid plan, set `ALPACA_FEED=sip` and
  raise `ALPACA_MAX_SYMBOLS`.
- **One stream connection per account.** The backend holds one connection and shares it
  with every open tab. If another app uses the same keys, the badge says so.
- **US stocks only.** Indices, futures and crypto aren't streamed.
- **Trades arrive only while IEX is open,** roughly 8:00–17:00 ET on weekdays.

The keys stay on the server; the browser only receives prices. To test the live path without
keys, run `python tests/test_live_stream.py` from `backend/`.

## Accounts

`/signup`, `/signin` and `/account`. Signing in is optional: everything works signed out, and an
account keeps your watchlist on every device. The browser's list merges into the account's
on sign-in.

- Passwords are hashed with scrypt and a per-user salt, using only the Python standard library.
- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie. Only a SHA-256 of each
  token is stored. "Keep me signed in" lasts 30 days; otherwise the session ends when the
  browser closes (one day at most on the server).
- A wrong password and an unknown email get the same message. After 5 failed attempts for an
  email, sign-in is paused for 15 minutes.
- Behind HTTPS, set `COOKIE_SECURE=true` in `backend/.env`.

Not included yet: password reset by email (it needs an email service) and sign-in with
Google/Apple.

## API

| Method | Path | What it does |
|---|---|---|
| POST | `/api/refresh` | Runs the pipeline over the S&P 500 now; body `{"symbols": [...]}` adds watchlist symbols |
| GET | `/api/stocks` | Latest stored snapshot |
| GET | `/api/stocks/{symbol}/profile` | Company profile, shareholder breakdown, top holders, executives, financials (`?refresh=true` skips the cache) |
| GET | `/api/stocks/{symbol}/history?range=6mo` | Price history; ranges `5d 1mo 3mo 6mo 1y 5y max` |
| GET | `/api/universe` | Tracked indices and S&P 500 members by GICS sector |
| GET | `/api/live/stream?symbols=AAPL,MSFT` | Server-Sent Events: `status` and coalesced `ticks` (trade prices) |
| GET | `/api/live/status` | Live connection state (never includes keys) |
| POST | `/api/auth/signup` | `{name, email, password, remember}` → creates account, signs in |
| POST | `/api/auth/signin` | `{email, password, remember}` |
| POST | `/api/auth/signout` | Ends the session |
| GET | `/api/auth/me` | `{user}` or `{user: null}` |
| GET/PUT | `/api/me/watchlist` | The signed-in user's watchlist |

## Site

- **Markets ▾**: Overview (indices, breadth, movers, sector bars, all stocks), All stocks, Indices & commodities
- **Watchlist**: star any row, or add any Yahoo symbol; saved in the browser, or to your account when signed in
- **Sign in / Sign up** (top right), or the avatar menu with Account and Sign out
- **Movers ▾**: top gainers, top losers, most active
- **Sectors ▾**: market-cap weighted sector performance, one page per sector
- **Stock page**: opens on the **Demographics** tab (sector, industry, headquarters, employees,
  who owns the shares, top institutional/fund/insider holders), then Leadership (executives,
  governance risk), Financials & analysts, and Key statistics

All ~500 stocks are pulled fresh (about 3 seconds) every time the site opens and whenever
**Refresh** is pressed. Watched stocks then update live between refreshes. Quotes may be
delayed ~15 minutes. Not investment advice.
