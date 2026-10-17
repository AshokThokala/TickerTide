"""FastAPI server exposing the TickerTide pipeline to the React frontend.

Run:  uvicorn main:app --reload --port 8000
"""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Secrets (Alpaca keys) come from the environment or backend/.env, never from code.
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException, Query, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from auth import router as auth_router  # noqa: E402
from live import LiveHub  # noqa: E402
from pipeline import (  # noqa: E402
    HISTORY_RANGES,
    INDICES,
    get_history,
    get_profile,
    get_sp500,
    latest_snapshot,
    normalise_symbol,
    run_pipeline,
)
from pipeline.yahoo import YahooError  # noqa: E402

MAX_LIVE_SYMBOLS_PER_CLIENT = 50


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.hub = LiveHub()
    app.state.hub.start()
    yield
    await app.state.hub.stop()


app = FastAPI(title="TickerTide API", lifespan=lifespan)
app.include_router(auth_router)
app.add_middleware(GZipMiddleware, minimum_size=1024)  # the S&P 500 snapshot is ~0.7 MB raw
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RefreshRequest(BaseModel):
    symbols: list[str] | None = None  # extra (watchlist) symbols on top of the default universe


def _symbol_or_400(symbol: str) -> str:
    s = normalise_symbol(symbol)
    if not s:
        raise HTTPException(400, "Invalid symbol")
    return s


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/universe")
async def get_universe():
    """Tracked indices plus the S&P 500 constituents grouped by GICS sector."""
    return {"indices": INDICES, "sp500": await get_sp500()}


@app.get("/api/stocks")
async def get_stocks():
    """Latest stored snapshot; runs the pipeline first if nothing is stored yet."""
    return latest_snapshot() or await run_pipeline()


@app.post("/api/refresh")
async def refresh(body: RefreshRequest | None = None):
    """Run the pipeline now and return the fresh snapshot."""
    return await run_pipeline(body.symbols if body else None)


@app.get("/api/stocks/{symbol}/profile")
async def stock_profile(symbol: str, refresh: bool = False):
    """Company profile, people and shareholder breakdown ("demographics")."""
    try:
        return await get_profile(_symbol_or_400(symbol), force=refresh)
    except YahooError as exc:
        raise HTTPException(502, f"Profile unavailable: {exc}") from exc


@app.get("/api/stocks/{symbol}/history")
async def stock_history(symbol: str, range: str = Query("6mo", pattern="|".join(HISTORY_RANGES))):
    try:
        return {"symbol": symbol.upper(), "range": range, "history": await get_history(_symbol_or_400(symbol), range)}
    except YahooError as exc:
        raise HTTPException(502, f"History unavailable: {exc}") from exc


# ------------------------------------------------------------------ live prices


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.get("/api/live/status")
def live_status():
    hub: LiveHub = app.state.hub
    return {
        "enabled": hub.enabled,
        "state": hub.state,
        "message": hub.message,
        "feed": hub.feed,
        "limit": hub.max_symbols,
        "subscribed": sorted(hub.subscribed),
        "clients": len(hub.clients),
    }


@app.get("/api/live/stream")
async def live_stream(request: Request, symbols: str = ""):
    """Server-Sent Events: `status` when the connection state changes, `ticks` with new trade prices.

    `symbols` is comma-separated, most important first (the open stock page, then the watchlist).
    """
    hub: LiveHub = app.state.hub
    wanted = []
    for raw in symbols.split(","):
        s = normalise_symbol(raw)
        if s and s not in wanted:
            wanted.append(s)
    client = hub.register(wanted[:MAX_LIVE_SYMBOLS_PER_CLIENT])

    async def events():
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    await asyncio.wait_for(client.wake.wait(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                await asyncio.sleep(0.25)  # coalesce bursts of trades into one message
                client.wake.clear()
                if client.status_dirty:
                    client.status_dirty = False
                    yield _sse("status", hub.status_for(client))
                if client.pending:
                    ticks, client.pending = list(client.pending.values()), {}
                    yield _sse("ticks", ticks)
        finally:
            hub.unregister(client)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
