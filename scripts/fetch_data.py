"""Screen Hyperliquid HIP-3 stock perps and snapshot funding history and candles into data/*.json.

Usage:  python scripts/fetch_data.py            # re-screen every live market, then fetch
        python scripts/fetch_data.py --refresh  # re-fetch the markets already listed, no screen
Stdlib only. A full run re-screens every live market, so names can enter or leave the list,
and takes about 10 minutes. --refresh keeps the current list (plus WATCHLIST) and takes ~1 minute.

A market is listed when it is a US-listed stock or stock ETF and
  - trailing 7d and 30d annualized funding are both >= MIN_FUNDING, and
  - average daily notional volume over the last 30 completed UTC days is > MIN_VOLUME.
WATCHLIST coins are always listed.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.hyperliquid.xyz/info"
WATCHLIST = ["xyz:NVDA", "xyz:GOOGL", "xyz:META", "xyz:MU", "xyz:SNDK", "xyz:CRCL", "xyz:INTC", "xyz:HOOD",
             "xyz:NBIS", "io:NBIS", "io:SNDK"]
MIN_FUNDING = 10.0          # annualized %, both 7d and 30d
MIN_VOLUME = 2_000_000      # USD per day, 30-day average
CANDLE_INTERVALS = ["1d", "4h", "1h"]
PAGE = 500
PAUSE = 1.0
DAY = 86400
OUT = Path(__file__).resolve().parent.parent / "data"

# US-listed single stocks (ADRs included) and stock ETFs, by symbol. Symbols mean the
# same thing on every DEX. Anything not here is skipped by the screen.
ETFS = {"URNM", "EWY", "EWJ", "EWZ", "EWT", "XLE", "XBI", "DRAM", "SMH", "SOXL", "MAGS",
        "KSTR", "NCLD", "KORU", "IGV"}
STOCKS = {
    "TSLA", "NVDA", "HOOD", "INTC", "PLTR", "COIN", "META", "AAPL", "MSFT", "ORCL", "GOOGL",
    "AMZN", "AMD", "MU", "SNDK", "MSTR", "CRCL", "NFLX", "COST", "LLY", "TSM", "RIVN", "BABA",
    "USAR", "CRWV", "GME", "HIMS", "DKNG", "LITE", "BX", "PURRDAT", "MRVL", "RKLB", "BIRD",
    "ZM", "EBAY", "ARM", "ASML", "BB", "QNT", "DELL", "IBM", "AVGO", "NOW", "NBIS", "WDC",
    "NOK", "BE", "QCOM", "BOT", "AMAT", "GEV", "IREN", "NET", "CRWD", "RDDT", "AAOI", "MRNA",
    "BMNR", "CVX", "LRCX", "UMC", "TWST", "GLW", "COHR", "CRDO", "STX", "VST", "TER", "CIEN",
    "MELI", "SMCI", "SOFI", "TTWO", "CIFR", "IONQ", "GPRO",
}
US_EQUITY = {**{s: "stock" for s in STOCKS}, **{s: "etf" for s in ETFS}}
# Known non-equities (indices, commodities, FX, rates, crypto, pre-IPO, non-US listings).
# Only used to keep them out of the "unclassified" warning.
NOT_EQUITY = {
    "XYZ100", "GOLD", "SILVER", "JPY", "EUR", "GBP", "CL", "COPPER", "NATGAS", "PLATINUM",
    "PALLADIUM", "BRENTOIL", "HO", "SP500", "KR200", "JP225", "TLT", "STRC", "SKHX", "SMSN",
    "SOFTBANK", "HYUNDAI", "KIOXIA", "GIGADEV", "CXMT", "MINIMAX", "ZHIPU", "UNITREE", "SHEIN",
    "OURA", "TOTAL2", "OTHERS", "BTCD", "10Y", "30Y", "2Y", "ANSEM", "TREAD", "US500", "USBOND",
    "SMALL2000", "USTECH", "BVIV", "OAI", "ANTH", "TCNT", "XIAOMI",
}


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


def fetch_funding(coin, start_ms=0):
    rows, start = {}, start_ms
    while True:
        page = post({"type": "fundingHistory", "coin": coin, "startTime": start})
        for r in page:
            rows[r["time"]] = float(r["fundingRate"])
        if len(page) < PAGE:
            break
        start = page[-1]["time"] + 1
    # Store seconds, floored to the hour (prints land a few ms after the hour).
    return [[(t // 1000) // 3600 * 3600, rows[t]] for t in sorted(rows)]


def fetch_candles(coin, interval, start_ms=0):
    now_ms = int(time.time() * 1000)
    page = post({"type": "candleSnapshot",
                 "req": {"coin": coin, "interval": interval, "startTime": start_ms, "endTime": now_ms}})
    return [[c["t"] // 1000, float(c["o"]), float(c["h"]), float(c["l"]), float(c["c"]), float(c["v"])]
            for c in sorted(page, key=lambda c: c["t"])]


def annualized(funding, days):
    """Mean hourly rate over (last - days, last], annualized in %; same as the dashboard."""
    if not funding:
        return None
    cutoff = funding[-1][0] - days * DAY
    rates = [r for t, r in funding if t > cutoff]
    return sum(rates) / len(rates) * 8760 * 100


def avg_volume(daily, today, days=30):
    """Average daily notional (volume x typical price) over the last `days` completed UTC days."""
    done = [c for c in daily if c[0] < today][-days:]
    if not done:
        return 0.0
    return sum(v * (h + l + c) / 3 for _, _, h, l, c, v in done) / len(done)


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M")


def live_markets():
    coins = []
    for d in post({"type": "perpDexs"}):
        if not d:
            continue  # the main (non-HIP-3) DEX
        meta, _ = post({"type": "metaAndAssetCtxs", "dex": d["name"]})
        coins += [u["name"] for u in meta["universe"] if not u.get("isDelisted")]
    return coins


def screen(coins):
    now = int(time.time())
    today = now // DAY * DAY
    results, unclassified = {}, []
    for coin in coins:
        sym = coin.split(":", 1)[1]
        if sym not in US_EQUITY and coin not in WATCHLIST:
            if sym not in NOT_EQUITY:
                unclassified.append(coin)
            continue
        f = fetch_funding(coin, (now - 30 * DAY) * 1000)
        a7, a30 = annualized(f, 7), annualized(f, 30)
        vol = None
        if passes(a7, a30, float("inf")) or coin in WATCHLIST:
            vol = avg_volume(fetch_candles(coin, "1d", (today - 31 * DAY) * 1000), today)
        results[coin] = {"a7": a7, "a30": a30, "vol30": vol, "pass": passes(a7, a30, vol)}
        print(f"  {coin:16s} 7d {a7 or 0:7.1f}%  30d {a30 or 0:7.1f}%  "
              f"vol {'' if vol is None else f'${vol / 1e6:.1f}M':>8s}  {'PASS' if results[coin]['pass'] else ''}",
              flush=True)
    return results, unclassified


def passes(a7, a30, vol30):
    return a7 is not None and a7 >= MIN_FUNDING and a30 >= MIN_FUNDING and vol30 is not None and vol30 > MIN_VOLUME


def main():
    OUT.mkdir(exist_ok=True)
    if "--refresh" in sys.argv[1:]:
        current = [t["coin"] for t in json.loads((OUT / "index.json").read_text())["tickers"]]
        listed = current + [c for c in WATCHLIST if c not in current]
        print(f"refreshing {len(listed)} listed markets (no screen)...", flush=True)
        write_snapshot(listed, passed=None)
        return

    print("discovering live HIP-3 markets...", flush=True)
    coins = live_markets()
    print(f"{len(coins)} live markets; screening...", flush=True)
    results, unclassified = screen(coins)

    passed = sorted((c for c, r in results.items() if r["pass"]), key=lambda c: -results[c]["a30"])
    print(f"\n{len(passed)} pass (7d and 30d >= {MIN_FUNDING}%, 30d avg volume > ${MIN_VOLUME / 1e6:.0f}M):")
    for c in passed:
        r = results[c]
        print(f"  {c:16s} 7d {r['a7']:6.1f}%  30d {r['a30']:6.1f}%  vol ${r['vol30'] / 1e6:.1f}M")
    if unclassified:
        print("\nunclassified (add to US_EQUITY or NOT_EQUITY): " + ", ".join(unclassified))

    listed = passed + [c for c in WATCHLIST if c not in passed]
    missing = [c for c in WATCHLIST if c not in coins]
    if missing:
        raise RuntimeError(f"watchlist coins not live: {missing}")
    write_snapshot(listed, passed)


def write_snapshot(listed, passed):
    """Fetch full history for `listed` and write data/*.json. With passed=None (refresh), a
    market's group comes from rerunning the screen rules on its stored history."""
    meta = {"snapshot": int(time.time()),
            "rules": {"minFunding": MIN_FUNDING, "minVolume": MIN_VOLUME, "volumeWindow": "30d"},
            "tickers": []}
    today = meta["snapshot"] // DAY * DAY
    # A ticker listed on several DEXes carries its DEX on every venue, xyz included.
    tickers = [c.split(":", 1)[1] for c in listed]
    multi = {tk for tk in tickers if tickers.count(tk) > 1}
    for coin in listed:
        dex, tk = coin.split(":", 1)
        fid = f"{dex}-{tk}"
        print(f"\n{coin}: funding...", flush=True)
        funding = fetch_funding(coin)
        candles = {iv: fetch_candles(coin, iv) for iv in CANDLE_INTERVALS}
        gaps = [(funding[i - 1][0], funding[i][0]) for i in range(1, len(funding))
                if funding[i][0] - funding[i - 1][0] != 3600]
        print(f"  {len(funding)} prints {iso(funding[0][0])} -> {iso(funding[-1][0])} UTC, "
              f"{len(gaps)} gaps; candles " + ", ".join(f"{k}={len(v)}" for k, v in candles.items()))
        for a, b in gaps[:5]:
            print(f"    gap {iso(a)} -> {iso(b)} ({(b - a) // 3600}h)")
        (OUT / f"{fid}.json").write_text(json.dumps(
            {"coin": coin, "funding": funding, "candles": candles}, separators=(",", ":")))
        figs = {"a7": annualized(funding, 7), "a30": annualized(funding, 30),
                "vol30": avg_volume(candles["1d"], today)}
        ok = passes(**figs) if passed is None else coin in passed
        meta["tickers"].append({
            "id": fid, "coin": coin, "dex": dex, "ticker": tk,
            "label": tk if dex == "xyz" and tk not in multi else f"{tk} · {dex}",
            "kind": US_EQUITY.get(tk, "stock"),
            "group": "screen" if ok else "watchlist",
            # Recomputed from the stored history so they match what the dashboard shows.
            "screen": figs,
            "inception": funding[0][0], "last": funding[-1][0], "prints": len(funding),
        })

    keep = {f"{t['id']}.json" for t in meta["tickers"]} | {"index.json"}
    for p in OUT.glob("*.json"):
        if p.name not in keep:
            print(f"removing stale {p.name}")
            p.unlink()
    (OUT / "index.json").write_text(json.dumps(meta, indent=2))
    print("done")


if __name__ == "__main__":
    main()
