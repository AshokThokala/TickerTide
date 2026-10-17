"""End-to-end check of the live stream against a fake Alpaca server.

Starts a WebSocket server that speaks Alpaca's v2 market-data protocol, runs
the real API (uvicorn) pointed at it, and reads the browser-facing SSE stream.

Run from backend/:  python tests/test_live_stream.py
"""

import asyncio
import json
import os
import random
import subprocess
import sys
from pathlib import Path

import httpx
import websockets

BACKEND = Path(__file__).resolve().parent.parent
FAKE_PORT, API_PORT = 8765, 8011
GOOD_KEY, GOOD_SECRET = "test-key", "test-secret"
LIMIT = 30


async def fake_alpaca(ws):
    """Minimal Alpaca stream: connected -> auth -> subscribe -> trades every 100ms."""
    await ws.send(json.dumps([{"T": "success", "msg": "connected"}]))
    auth = json.loads(await ws.recv())
    if auth.get("key") != GOOD_KEY or auth.get("secret") != GOOD_SECRET:
        await ws.send(json.dumps([{"T": "error", "code": 402, "msg": "auth failed"}]))
        return
    await ws.send(json.dumps([{"T": "success", "msg": "authenticated"}]))
    subs: set[str] = set()

    async def trades():
        while True:
            await asyncio.sleep(0.1)
            msgs = [
                {"T": "t", "S": s, "p": round(100 + random.random(), 2), "s": 10, "t": "2026-10-19T14:30:00Z"}
                for s in subs
            ]
            if msgs:
                await ws.send(json.dumps(msgs))

    pump = asyncio.create_task(trades())
    try:
        async for raw in ws:
            m = json.loads(raw)
            if m["action"] == "subscribe":
                subs |= set(m.get("trades", []))
                if len(subs) > LIMIT:
                    await ws.send(json.dumps([{"T": "error", "code": 405, "msg": "symbol limit exceeded"}]))
            elif m["action"] == "unsubscribe":
                subs -= set(m.get("trades", []))
            await ws.send(json.dumps([{"T": "subscription", "trades": sorted(subs), "quotes": [], "bars": []}]))
    finally:
        pump.cancel()


def start_api(key: str, secret: str) -> subprocess.Popen:
    env = {
        **os.environ,
        "APCA_API_KEY_ID": key,
        "APCA_API_SECRET_KEY": secret,
        "ALPACA_STREAM_URL": f"ws://127.0.0.1:{FAKE_PORT}",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--port", str(API_PORT), "--log-level", "warning"],
        cwd=BACKEND,
        env=env,
    )


async def wait_up():
    async with httpx.AsyncClient() as http:
        for _ in range(50):
            try:
                if (await http.get(f"http://127.0.0.1:{API_PORT}/api/health")).status_code == 200:
                    return
            except httpx.TransportError:
                pass
            await asyncio.sleep(0.2)
    raise RuntimeError("API did not start")


async def read_sse(symbols: str, seconds: float) -> list[tuple[str, object]]:
    events, event = [], None
    async with httpx.AsyncClient(timeout=None) as http:
        async with http.stream("GET", f"http://127.0.0.1:{API_PORT}/api/live/stream", params={"symbols": symbols}) as r:
            assert r.headers["content-type"].startswith("text/event-stream"), r.headers["content-type"]

            async def consume():
                nonlocal event
                async for line in r.aiter_lines():
                    if line.startswith("event: "):
                        event = line[7:]
                    elif line.startswith("data: "):
                        events.append((event, json.loads(line[6:])))

            try:
                await asyncio.wait_for(consume(), timeout=seconds)
            except asyncio.TimeoutError:
                pass
    return events


def check(cond: bool, label: str) -> None:
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        check.failed = True


check.failed = False


async def main():
    server = await websockets.serve(fake_alpaca, "127.0.0.1", FAKE_PORT)

    # 1. Good keys: ticks flow, BRK-B maps to Alpaca's BRK.B and back, index is skipped.
    api = start_api(GOOD_KEY, GOOD_SECRET)
    try:
        await wait_up()
        events = await read_sse("AAPL,BRK-B,^GSPC", seconds=3)
        statuses = [d for e, d in events if e == "status"]
        ticks = [t for e, d in events if e == "ticks" for t in d]
        last = statuses[-1] if statuses else {}
        check(last.get("state") == "connected", f"status connected (got {last.get('state')!r})")
        check(set(last.get("live", [])) == {"AAPL", "BRK-B"}, f"live symbols AAPL, BRK-B (got {last.get('live')})")
        check({t["symbol"] for t in ticks} == {"AAPL", "BRK-B"}, f"ticks for AAPL and BRK-B (got {sorted({t['symbol'] for t in ticks})})")
        check(len(ticks) >= 4, f"several coalesced ticks arrived ({len(ticks)})")
        check(all(isinstance(t["price"], float) for t in ticks), "tick prices are numbers")

        # 2. Symbol limit: 40 requested, at most 30 subscribed, the rest reported as over the limit.
        many = ",".join(f"S{i:02d}" for i in range(40))
        events = await read_sse(many, seconds=2)
        last = [d for e, d in events if e == "status"][-1]
        check(len(last["live"]) == LIMIT, f"capped at {LIMIT} live symbols (got {len(last['live'])})")
        check(len(last["over_limit"]) == 10, f"10 symbols reported over limit (got {len(last['over_limit'])})")

        async with httpx.AsyncClient() as http:
            st = (await http.get(f"http://127.0.0.1:{API_PORT}/api/live/status")).json()
        check(st["enabled"] and st["state"] == "connected", "status endpoint reports connected")
        sse_text = json.dumps(events)
        check(
            all(secret not in json.dumps(st) + sse_text for secret in (GOOD_KEY, GOOD_SECRET)),
            "keys never exposed by the API",
        )
    finally:
        api.terminate()
        api.wait()

    # 3. Bad keys: clear error, no retry storm.
    api = start_api("wrong", "wrong")
    try:
        await wait_up()
        events = await read_sse("AAPL", seconds=2)
        last = [d for e, d in events if e == "status"][-1]
        check(last["state"] == "error" and "auth" in last["message"].lower(), f"bad keys -> auth error ({last['message']!r})")
    finally:
        api.terminate()
        api.wait()

    # 4. No keys: disabled, explains how to enable.
    api = start_api("", "")
    try:
        await wait_up()
        events = await read_sse("AAPL", seconds=1.5)
        last = [d for e, d in events if e == "status"][-1]
        check(last["state"] == "disabled", f"no keys -> disabled ({last['message']!r})")
    finally:
        api.terminate()
        api.wait()

    server.close()
    print("\nALL PASSED" if not check.failed else "\nSOME CHECKS FAILED")
    sys.exit(1 if check.failed else 0)


async def serve_forever():
    """`--fake-server`: run only the fake Alpaca stream, for trying the UI without real keys.

    Start the API with APCA_API_KEY_ID=test-key APCA_API_SECRET_KEY=test-secret
    ALPACA_STREAM_URL=ws://127.0.0.1:8765 to point it here.
    """
    async with websockets.serve(fake_alpaca, "127.0.0.1", FAKE_PORT):
        print(f"fake Alpaca stream on ws://127.0.0.1:{FAKE_PORT}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(serve_forever() if "--fake-server" in sys.argv else main())
