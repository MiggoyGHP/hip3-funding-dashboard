# HIP-3 stock perp funding dashboard

Live: https://miggoyghp.github.io/hip3-funding-dashboard/

This dashboard studies funding on Hyperliquid HIP-3 stock perps from the `xyz` DEX (trade.xyz): NVDA, GOOGL, META, MU, SNDK, CRCL, INTC and HOOD.

- **Annualized funding by window:** 24h, 7d, 30d, 60d, 90d, 1y and since inception. View it across all hours, or split into US market open and market closed.
- **Funding stability:** the share of hours in which shorts received funding (rate > 0).
- **Rolling chart:** the rolling annualized funding for every window as separate lines, so you can see crossovers. It sits as a study beneath the OHLC price chart (1h / 4h / 1D), with zoom and crosshair synced. Turn the price chart off to see the funding lines alone.
- **Cross-ticker grid:** every window for every ticker in one table.

## Definitions

| Term | Meaning |
|---|---|
| Sign | Positive = longs pay, shorts receive. |
| Annualized | Mean hourly funding rate in the window (and bucket) × 8,760. |
| Market open | NYSE regular session, 9:30–16:00 America/New_York, using the NYSE holiday and early-close calendar. A print at time T covers the hour (T−1h, T]; prints at 10:00–16:00 ET (10:00–13:00 on half-days) are "open", so the 9:00–10:00 hour containing the opening bell counts as open. |
| Window | Trails back from the latest print in the snapshot. A window longer than the market's history uses all of it and is tagged "partial". |

## Data

`data/*.json` is a one-time snapshot. To refresh it:

```sh
python scripts/fetch_data.py   # stdlib only, takes a few minutes
```

Hyperliquid's `candleSnapshot` returns only the latest 5,000 candles per interval. That means 1h price bars start in March 2026, while 4h and 1D bars reach back to each market's launch.

## Develop

```sh
npm test                 # node --test: session classification + metrics
python -m http.server    # then open http://localhost:8000
```

There is no build step. The site is plain ES modules plus [Lightweight Charts](https://www.tradingview.com/lightweight-charts/) v5 from jsDelivr.
