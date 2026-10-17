"""Run the pipeline from the command line (e.g. from a scheduler/cron).

Usage:  python run_pipeline.py [EXTRA_SYMBOL ...]
"""

import asyncio
import sys

from pipeline import run_pipeline


def main() -> None:
    snapshot = asyncio.run(run_pipeline(sys.argv[1:] or None))
    print(f"Run #{snapshot['run_id']} at {snapshot['fetched_at']} from {snapshot['source']}")
    print(f"  {len(snapshot['quotes'])} instruments loaded")
    for q in snapshot["quotes"]:
        pct = q["change_percent"]
        pct_str = f"{pct:+.2f}%" if pct is not None else "n/a"
        cap = f"{q['market_cap'] / 1e9:,.0f}B" if q.get("market_cap") else ""
        print(f"  {q['symbol']:<8} {q['price']:>12,.2f} {q['currency']}  {pct_str:>8}  {cap:>8}  {len(q['spark'])}d")
    for w in snapshot["warnings"]:
        print(f"  WARNING: {w}")
    for symbol, err in snapshot["errors"].items():
        print(f"  {symbol:<8} ERROR: {err}")


if __name__ == "__main__":
    main()
