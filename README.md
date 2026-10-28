# HIP-3 stock perp funding dashboard

Live: https://miggoyghp.github.io/hip3-funding-dashboard/

This dashboard studies funding on Hyperliquid HIP-3 stock perps, plus three commodity perps for comparison. It lists three groups:

- **Funding ≥ 10%:** every US-listed stock or stock ETF on any live HIP-3 DEX that passes both rules below. Each run of the fetch script redoes this screen, so names enter and leave over time.
  - Trailing 7d **and** 30d annualized funding are both at least 10%.
  - Average daily notional volume on Hyperliquid over the last 30 completed UTC days (volume × (H+L+C)/3) is above $2M.
- **Watchlist:** NVDA, GOOGL, META, MU, SNDK, CRCL, INTC, HOOD and NBIS on `xyz` (trade.xyz), plus NBIS and SNDK on `io`. These are always listed; any of them that pass the screen move into the first group.
- **Commodities:** GOLD, SILVER and WTIOIL on `xyz`. These are always listed and never screened. WTIOIL is the API symbol `xyz:CL`. GOLD and SILVER are priced off XAU/USD and XAG/USD spot. WTIOIL follows a WTI futures contract and rolls into the next contract over business days 5–10 of each month, 20% per day ([trade.xyz docs](https://docs.trade.xyz/xyz-perps-specification/commodities)).

When the same ticker trades on several DEXes, each venue is screened separately. A market outside `xyz` is labeled with its DEX, for example `SNDK io`. When a ticker is listed on more than one DEX, every venue is labeled, for example `NBIS xyz` and `NBIS io`. The screen leaves out indices, commodities, FX, rates and bond ETFs, crypto indices, pre-IPO names and non-US listings.

Features:

- **Ticker tabs:** each tab shows trailing 7d and 30d funding. Within each group, tabs are ordered by 30d funding.
- **Annualized funding by window:** 24h, 7d, 30d, 60d, 90d, 1y and since inception. View it across all hours, or split into US market open and market closed.
- **Funding stability:** the share of hours in which shorts received funding (rate > 0).
- **Rolling chart:** the rolling annualized funding for every window as separate lines, so you can see crossovers. It sits as a study beneath the OHLC price chart (1h / 4h / 1D), with zoom and crosshair synced. Turn the price chart off to see the funding lines alone.
- **Open vs closed tab:** the rolling 7d or 30d funding of one session bucket against another, plus the gap between them in its own pane, so you can see whether the gap is narrowing or widening. The buckets are Open, Closed, All hours, Weeknights and Weekends & holidays.
- **Cross-ticker grid:** every window for every ticker in one table, plus 30d average volume.
  - Sorted by 30d by default; click a window header to sort by it.
  - In the open vs closed view, clicking the sorted header again switches between sorting by open and by closed.

## Definitions

| Term | Meaning |
|---|---|
| Sign | Positive = longs pay, shorts receive. |
| Annualized | Mean hourly funding rate in the window (and bucket) × 8,760. |
| Market open | NYSE regular session, 9:30–16:00 America/New_York, using the NYSE holiday and early-close calendar. A print at time T covers the hour (T−1h, T]; prints at 10:00–16:00 ET (10:00–13:00 on half-days) are "open", so the 9:00–10:00 hour containing the opening bell counts as open. |
| Weeknights | Closed hours between two back-to-back trading days. |
| Weekends & holidays | Closed hours in a stretch that includes a Saturday, Sunday or NYSE holiday, from the last close before it to the next open. Weeknights + Weekends & holidays = Closed. |
| Window | Trails back from the latest print in the snapshot. A window longer than the market's history uses all of it and is tagged "partial". |

## Data

`data/*.json` is a one-time snapshot. Each market's file is `data/{dex}-{TICKER}.json`, for example `xyz-NVDA.json`. `data/index.json` lists every market with its group and the 7d, 30d and volume figures used by the screen.

To refresh the data and redo the screen:

```sh
python scripts/fetch_data.py             # stdlib only, takes about 10 minutes
```

To refresh only the markets already listed, without re-screening:

```sh
python scripts/fetch_data.py --refresh   # about 1 minute
```

`--refresh` keeps every market in `data/index.json` (plus the watchlist) and re-applies the screen rules to the new history, so a name that no longer passes moves to the Watchlist group instead of dropping out.

The script finds every live HIP-3 market and screens the ones whose symbol is in `US_EQUITY`. It prints a ranked table, then fetches full history for the passing markets and the watchlist. Files for markets that drop out are deleted. It also lists live symbols that are in neither `US_EQUITY` nor `NOT_EQUITY`. These are skipped, so classify each one in the script and re-run if it could be a US stock or stock ETF.

Hyperliquid's `candleSnapshot` returns only the latest 5,000 candles per interval. That means 1h price bars start in March 2026, while 4h and 1D bars reach back to each market's launch.

## Develop

```sh
npm test                 # node --test: session classification + metrics
python -m http.server    # then open http://localhost:8000
```

There is no build step. The site is plain ES modules plus [Lightweight Charts](https://www.tradingview.com/lightweight-charts/) v5 from jsDelivr.
