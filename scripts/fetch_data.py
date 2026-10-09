"""Snapshot Hyperliquid HIP-3 (xyz DEX) funding history and candles into data/*.json.

Usage:  python scripts/fetch_data.py
Stdlib only. Re-run any time to refresh the snapshot.
"""
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.hyperliquid.xyz/info"
DEX = "xyz"
TICKERS = ["NVDA", "GOOGL", "META", "MU", "SNDK", "CRCL", "INTC", "HOOD"]
CANDLE_INTERVALS = ["1d", "4h", "1h"]
PAGE = 500
PAUSE = 1.0
OUT = Path(__file__).resolve().parent.parent / "data"


def post(body, retries=6):
    data = json.dumps(body).encode()
    for attempt in range(retries):
        req = urllib.request.Request(API, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                out = json.load(r)
            time.sleep(PAUSE)
            return out
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                wait = 2 ** attempt * 2
                print(f"  HTTP {e.code}, retrying in {wait}s")
                time.sleep(wait)
                continue
            raise
        except urllib.error.URLError as e:
            wait = 2 ** attempt * 2
            print(f"  {e.reason}, retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"giving up on {body}")


def fetch_funding(coin):
    rows, start = {}, 0
    while True:
        page = post({"type": "fundingHistory", "coin": coin, "startTime": start})
        for r in page:
            rows[r["time"]] = float(r["fundingRate"])
        if len(page) < PAGE:
            break
        start = page[-1]["time"] + 1
    # Store seconds, floored to the hour (prints land a few ms after the hour).
    return [[(t // 1000) // 3600 * 3600, rows[t]] for t in sorted(rows)]


def fetch_candles(coin, interval):
    now_ms = int(time.time() * 1000)
    page = post({"type": "candleSnapshot",
                 "req": {"coin": coin, "interval": interval, "startTime": 0, "endTime": now_ms}})
    return [[c["t"] // 1000, float(c["o"]), float(c["h"]), float(c["l"]), float(c["c"]), float(c["v"])]
            for c in sorted(page, key=lambda c: c["t"])]


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M")


def main():
    OUT.mkdir(exist_ok=True)
    meta = {"dex": DEX, "tickers": [], "snapshot": int(time.time())}
    for tk in TICKERS:
        coin = f"{DEX}:{tk}"
        print(f"{coin}: funding...", flush=True)
        funding = fetch_funding(coin)
        candles = {}
        for iv in CANDLE_INTERVALS:
            candles[iv] = fetch_candles(coin, iv)
        gaps = [(funding[i - 1][0], funding[i][0]) for i in range(1, len(funding))
                if funding[i][0] - funding[i - 1][0] != 3600]
        print(f"  {len(funding)} prints {iso(funding[0][0])} -> {iso(funding[-1][0])} UTC, "
              f"{len(gaps)} gaps; candles " + ", ".join(f"{k}={len(v)}" for k, v in candles.items()))
        for a, b in gaps[:5]:
            print(f"    gap {iso(a)} -> {iso(b)} ({(b - a) // 3600}h)")
        (OUT / f"{tk}.json").write_text(json.dumps(
            {"coin": coin, "funding": funding, "candles": candles}, separators=(",", ":")))
        meta["tickers"].append({"ticker": tk, "coin": coin, "inception": funding[0][0],
                                "last": funding[-1][0], "prints": len(funding)})
    (OUT / "index.json").write_text(json.dumps(meta, indent=2))
    print("done")


if __name__ == "__main__":
    main()
