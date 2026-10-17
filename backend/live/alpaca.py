"""Live trade prices from Alpaca's market-data WebSocket, fanned out to browsers.

Alpaca's free (Basic) plan allows ONE stream connection per account and a
limited number of symbols on it (30 at the time of writing), using the IEX
feed. So the server holds a single connection and shares it: each browser
says which symbols it wants (most important first), and the hub subscribes
to the highest-priority set that fits the limit.

Keys are read from the environment only (see backend/.env.example):
    APCA_API_KEY_ID, APCA_API_SECRET_KEY      required to enable streaming
    ALPACA_FEED=iex                            "sip" on a paid plan
    ALPACA_MAX_SYMBOLS=30                      raise on a paid plan
    ALPACA_STREAM_URL                          override (e.g. for tests)
"""

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from itertools import zip_longest

import websockets

log = logging.getLogger(__name__)

STREAM_BASE = "wss://stream.data.alpaca.markets/v2"
# Alpaca error codes that won't fix themselves by reconnecting quickly.
FATAL_CODES = {402: "Alpaca rejected the API keys (auth failed). Check APCA_API_KEY_ID / APCA_API_SECRET_KEY."}
CODE_HINTS = {
    405: "Symbol limit for your Alpaca plan reached.",
    406: "Alpaca allows one stream connection per account and another app is using it. Retrying…",
    409: "Your Alpaca plan doesn't include this feed. Use ALPACA_FEED=iex on the free plan.",
}


def to_alpaca(symbol: str) -> str:
    return symbol.replace("-", ".")


def from_alpaca(symbol: str) -> str:
    return symbol.replace(".", "-")


def streamable(symbol: str) -> bool:
    """Alpaca streams US equities only: no indices (^GSPC), futures (GC=F) or crypto (BTC-USD)."""
    return not any(ch in symbol for ch in "^=") and not symbol.endswith("-USD")


@dataclass(eq=False)  # identity hashing, so clients can live in a set
class Client:
    symbols: list[str]
    pending: dict = field(default_factory=dict)  # symbol -> latest tick since last flush
    status_dirty: bool = True
    wake: asyncio.Event = field(default_factory=asyncio.Event)


class LiveHub:
    def __init__(self):
        self.key = os.getenv("APCA_API_KEY_ID", "").strip()
        self.secret = os.getenv("APCA_API_SECRET_KEY", "").strip()
        self.feed = os.getenv("ALPACA_FEED", "iex").strip() or "iex"
        self.max_symbols = int(os.getenv("ALPACA_MAX_SYMBOLS", "30"))
        self.url = os.getenv("ALPACA_STREAM_URL") or f"{STREAM_BASE}/{self.feed}"
        self.enabled = bool(self.key and self.secret)

        self.clients: set[Client] = set()
        self.latest: dict[str, dict] = {}
        self.subscribed: set[str] = set()  # Yahoo-style symbols
        self.state = "connecting" if self.enabled else "disabled"
        self.message = "" if self.enabled else "Add Alpaca API keys to enable live prices."
        self._wanted_changed = asyncio.Event()
        self._task: asyncio.Task | None = None

    # ------------------------------------------------------------ clients

    def register(self, symbols: list[str]) -> Client:
        client = Client(symbols=[s for s in symbols if streamable(s)])
        self.clients.add(client)
        for s in client.symbols:  # send what we already know straight away
            if s in self.latest:
                client.pending[s] = self.latest[s]
        client.wake.set()
        self._wanted_changed.set()
        return client

    def unregister(self, client: Client) -> None:
        self.clients.discard(client)
        self._wanted_changed.set()

    def wanted(self) -> list[str]:
        """Interleave every client's priority list so each gets its top symbols first."""
        out, seen = [], set()
        for tier in zip_longest(*(c.symbols for c in self.clients)):
            for s in tier:
                if s and s not in seen:
                    seen.add(s)
                    out.append(s)
        return out[: self.max_symbols]

    def status_for(self, client: Client) -> dict:
        return {
            "state": self.state,
            "message": self.message,
            "feed": self.feed,
            "limit": self.max_symbols,
            "live": [s for s in client.symbols if s in self.subscribed],
            "over_limit": [s for s in client.symbols if s not in self.subscribed and s not in self.wanted()],
        }

    def _set_state(self, state: str, message: str = "") -> None:
        self.state, self.message = state, message
        for c in self.clients:
            c.status_dirty = True
            c.wake.set()

    def _publish(self, tick: dict) -> None:
        self.latest[tick["symbol"]] = tick
        for c in self.clients:
            if tick["symbol"] in c.symbols:
                c.pending[tick["symbol"]] = tick
                c.wake.set()

    # ------------------------------------------------------------ upstream

    def start(self) -> None:
        if self.enabled and self._task is None:
            self._task = asyncio.create_task(self._run(), name="alpaca-stream")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        backoff = 1
        while True:
            try:
                self._set_state("connecting", "Connecting to Alpaca…")
                async with websockets.connect(self.url, ping_interval=20, ping_timeout=20, max_size=2**22) as ws:
                    await self._session(ws)
                backoff = 1
            except asyncio.CancelledError:
                raise
            except _Fatal as exc:
                self._set_state("error", str(exc))
                log.error("alpaca stream stopped: %s", exc)
                return
            except _Retry as exc:
                self._set_state("error", str(exc))
                backoff = max(backoff, 30)
            except (OSError, websockets.WebSocketException, json.JSONDecodeError, asyncio.TimeoutError) as exc:
                self._set_state("reconnecting", f"Live connection lost ({exc.__class__.__name__}). Reconnecting…")
                log.warning("alpaca stream error: %s", exc)
            self.subscribed = set()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    async def _session(self, ws) -> None:
        await self._expect(ws, "connected")
        await ws.send(json.dumps({"action": "auth", "key": self.key, "secret": self.secret}))
        await self._expect(ws, "authenticated")
        self.subscribed = set()
        self._set_state("connected", "")
        self._wanted_changed.set()

        reader = asyncio.create_task(self._read(ws))
        syncer = asyncio.create_task(self._sync_loop(ws))
        try:
            done, _ = await asyncio.wait({reader, syncer}, return_when=asyncio.FIRST_EXCEPTION)
            for t in done:
                t.result()
        finally:
            reader.cancel()
            syncer.cancel()

    async def _expect(self, ws, msg: str) -> None:
        for m in json.loads(await asyncio.wait_for(ws.recv(), timeout=15)):
            if m.get("T") == "error":
                self._raise_for(m)
            if m.get("T") == "success" and m.get("msg") == msg:
                return
        raise _Retry(f"Unexpected reply from Alpaca while waiting for '{msg}'.")

    def _raise_for(self, m: dict):
        code = m.get("code")
        if code in FATAL_CODES:
            raise _Fatal(FATAL_CODES[code])
        raise _Retry(CODE_HINTS.get(code, f"Alpaca error {code}: {m.get('msg')}"))

    async def _sync_loop(self, ws) -> None:
        while True:
            await self._wanted_changed.wait()
            self._wanted_changed.clear()
            await asyncio.sleep(0.3)  # let a burst of tab opens/closes settle
            want = set(self.wanted())
            drop = self.subscribed - want
            add = want - self.subscribed
            if drop:
                await ws.send(json.dumps({"action": "unsubscribe", "trades": [to_alpaca(s) for s in drop]}))
            if add:
                await ws.send(json.dumps({"action": "subscribe", "trades": [to_alpaca(s) for s in add]}))

    async def _read(self, ws) -> None:
        async for raw in ws:
            for m in json.loads(raw):
                kind = m.get("T")
                if kind == "t":
                    self._publish(
                        {"symbol": from_alpaca(m["S"]), "price": m["p"], "size": m.get("s"), "time": m.get("t")}
                    )
                elif kind == "subscription":
                    self.subscribed = {from_alpaca(s) for s in m.get("trades", [])}
                    self._set_state("connected", "")
                elif kind == "error":
                    if m.get("code") == 405:  # over the plan's symbol limit: keep streaming what we have
                        self._set_state("connected", CODE_HINTS[405])
                    else:
                        self._raise_for(m)


class _Fatal(Exception):
    pass


class _Retry(Exception):
    pass
