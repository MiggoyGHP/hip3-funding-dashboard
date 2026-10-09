# HIP-3 Stock Perp Funding Dashboard — Plan

## Context
Miguel wants to study funding on Hyperliquid HIP-3 stock perps for **NVDA, GOOGL, META, MU, SNDK, CRCL, INTC, HOOD**. The core question: is funding different when the US cash market is open versus closed, how stable is it, and do short-window funding averages crossing long-window ones line up with price moves? The result is a public static dashboard on GitHub Pages under **github.com/MiggoyGHP/hip3-funding-dashboard** (the local folder `hip3-fr-study` is empty, so this is a new project).

### Confirmed decisions
| Topic | Decision |
|---|---|
| Venue | `xyz` DEX (trade.xyz) only. Coins are `xyz:NVDA`, `xyz:GOOGL`, and so on; all 8 exist there. |
| Session split | Two views: **All hours** together, and **Split** (Open vs Closed side by side). |
| "Open" | NYSE regular session 9:30–16:00 ET, weekdays, using America/New_York time with DST. NYSE holidays count as Closed; half-days close at 13:00. |
| Annualization | Average of the hourly rates inside the bucket × 8760, shown as %. No hourly rates appear anywhere in the UI. |
| Crossovers | Only the lines are drawn; no cross detection or stats. |
| Data freshness | One-time snapshot saved as static JSON. A re-runnable fetch script is included. |
| Repo | `hip3-funding-dashboard`, public, Pages served from `main` / root. |

### API facts verified during exploration
- `POST https://api.hyperliquid.xyz/info` allows CORS (`*`). No auth is needed.
- `{"type":"fundingHistory","coin":"xyz:NVDA","startTime":ms}`: hourly prints, **500 rows per page**. Page forward from `last.time + 1` until a page has fewer than 500 rows. Fields are `fundingRate`, `premium` and `time`.
  - History starts at different dates: NVDA 2025-11-12, HOOD 2025-11-26, SNDK 2026-01-12. Each coin's inception is its first print.
- `candleSnapshot`: `1d` and `4h` go back to inception. `1h` covers only the **most recent ~5000 bars**, back to about 2026-03-14; older 1h requests return nothing.
  - So the price chart at 1h starts in March 2026. 4h and 1D cover the full history.
- `gh` is logged in as **MiggoyGHP** with the `repo` and `workflow` scopes. Python 3.14, Node 26 and git are available.

## Definitions (spec)
- **Sign:** positive rate means longs pay shorts, i.e. **shorts receive**. The UI labels this.
- **Hour attribution:** a print at time T, floored to the hour, covers (T−1h, T]. In ET, a print is **Open** when the day is an NYSE trading day and T falls in 10:00–16:00 (10:00–13:00 on half-days). So the 9:00–10:00 hour, which holds the 9:30 open, counts as Open. Every other print is **Closed**.
- **Windows:** trailing 24h, 7d, 30d, 60d, 90d and 1y, plus Since inception. All are anchored at the last print in the snapshot.
  - A window longer than the coin's history shows the inception value with a "partial · N days" tag. Today 1y is always partial.
- **Annualized rate** for (bucket, window) = mean(rate of prints in the bucket and window) × 8760 × 100%.
- **Stability** for (bucket, window) = % of prints with rate > 0, i.e. hours when shorts received funding. Zero-rate hours do not count as received. The hour count N is shown next to it.
- **Rolling lines:** for every hourly timestamp t and each window, the bucket's annualized mean over prints in (t − window, t]. "Since inception" is an expanding mean.
  - In Open/Closed mode, a window with no prints in that bucket is a gap. For example, Open 24h is empty over a weekend.
  - The calculation uses prefix sums with two pointers, O(n) per line.

## Architecture
Static site, no build step, plain ES modules. Charts use **TradingView Lightweight Charts v5** from a CDN (jsDelivr). v5 has native **panes**, so the price pane and the funding study pane share one time scale and crosshair, which gives the sync for free.

```
hip3-funding-dashboard/
├─ scripts/fetch_data.py     # stdlib only (urllib); one-time snapshot, re-runnable
├─ data/meta.json            # tickers, snapshot time, per-coin inception
├─ data/<TICKER>.json        # {coin, funding:[[t_sec, rate]...], candles:{"1d":[[t,o,h,l,c,v]],"4h":[...],"1h":[...]}}
├─ index.html
├─ assets/sessions.js        # pure: ET conversion via Intl, NYSE holiday/half-day table 2025–2027, isOpen(t)
├─ assets/metrics.js         # pure: windowStats(), rollingLines(), annualize, stability
├─ assets/charts.js          # Lightweight Charts setup: candle pane + funding study pane
├─ assets/app.js             # state (ticker, view, bucket, interval, visible lines), rendering
├─ assets/styles.css
├─ tests/sessions.test.mjs   # node --test: DST edges, holidays, half-days, 9–10 & 15–16 hours, weekends
├─ tests/metrics.test.mjs    # node --test: window means, stability, rolling vs brute force, gaps
├─ docs/superpowers/specs/2026-10-09-hip3-funding-dashboard-design.md  # this spec
├─ README.md, .nojekyll
```

Session classification happens in JS using the browser's `Intl` time zones. That avoids Python's missing `tzdata` on Windows and keeps one source of truth. The NYSE holiday and half-day table must be checked against nyse.com when it is written.

### Fetch script (`scripts/fetch_data.py`)
- For each coin, page through `fundingHistory` from startTime 0, de-duplicate by time, and store `[t_sec, float(rate)]`.
- Fetch candles for `1d` and `4h` from 0, and `1h` for the latest 5000 bars.
- Sleep about 1s between calls to stay well under the 1200 weight/min limit; total runtime is a few minutes. Retry on 429 with backoff.
- Print per-coin counts, the first and last timestamps, and any hourly gaps found.

## Dashboard layout
1. **Header:** title, snapshot time (UTC and ET), ticker tabs (8), a view toggle **All hours | Open vs Closed**, and a sign-convention note.
2. **Stats table** for the selected ticker. Rows are 24h, 7d, 30d, 60d, 90d, 1y and Since inception.
   - All-hours view: annualized %, stability %, N hours.
   - Split view: Open (annualized %, stability %) and Closed (annualized %, stability %), with All kept as a thin reference column.
   - Values are tinted on a diverging scale (receive vs pay).
3. **Chart panel**
   - Controls: price-chart toggle (on/off); interval **1h / 4h / 1D**; a bucket selector for the lines (All / Open / Closed); legend checkboxes for 24h, 7d, 30d, 60d, 90d, 1y and ITD.
   - Lines on by default: 7d, 30d, 60d, 90d and ITD. 24h and 1y are off because they are noisy or redundant today.
   - **Price on:** candlesticks in the top pane and the rolling annualized funding lines in the study pane beneath, with a 0% baseline.
     - The funding lines are sampled at each bar's close so the timestamps line up.
     - Shared crosshair and zoom/pan.
     - Times are shown shifted to ET.
   - **Price off:** the funding study fills the panel at the chosen resolution. This is the standalone "how the timeframes move" chart.
4. **Cross-ticker overview:** a grid with the 8 tickers as rows and the windows as columns. Each cell shows the annualized % for the current bucket, with stability as a small second line. Clicking a row selects that ticker.

Load the `dataviz` skill (palette, mark specs, light/dark tokens) and `frontend-design` before writing the UI.

## Implementation steps
1. In `hip3-fr-study`: `git init`, then write the spec to `docs/superpowers/specs/…` and commit it.
2. Write `fetch_data.py` and run it. Sanity-check the counts: about 24 prints per day since each coin's inception, plus the gap report.
3. Write `sessions.js` and `metrics.js` test-first, then run `node --test tests/`.
4. Build `index.html`, `charts.js`, `app.js` and `styles.css`.
5. Verify locally (see below), then commit.
6. Run `gh repo create MiggoyGHP/hip3-funding-dashboard --public --source . --push`, then enable Pages with `gh api -X POST repos/MiggoyGHP/hip3-funding-dashboard/pages -f "source[branch]=main" -f "source[path]=/"`.
7. Wait for the Pages build, then verify the live site.

## Verification
- `node --test tests/` passes. This covers DST transition days (2025-11-02, 2026-03-08, 2026-11-01), Thanksgiving 2025, the 2025-11-28 half-day, Good Friday 2026, weekends, and the 10:00 / 16:00 / 17:00 ET prints.
- An independent Python check recomputes 7d and Since-inception All/Open/Closed annualized rates and stability for NVDA and SNDK straight from `data/*.json`. They must match the dashboard to 2 decimals.
- Run a local server (`python -m http.server`) and use Playwright to:
  - load the page and check every ticker, both views, all buckets and intervals, and price on/off;
  - confirm the console is error-free;
  - confirm the crosshair and zoom stay synced between panes;
  - check the layout at 390px width;
  - take screenshots in light and dark mode.
- After publishing, `curl -I https://miggoyghp.github.io/hip3-funding-dashboard/` returns 200, and a Playwright smoke test passes on the live URL.

## Addendum (2026-10-09): Open vs closed gap view
- The chart panel has two tabs. `By window` is unchanged. `Open vs closed` plots rolling 7d **or** 30d funding for bucket A and bucket B, with the gap A − B in a lower pane (a baseline series shaded in A's color above 0 and B's color below).
- Buckets: Open, Closed, All hours, Weeknights, Weekends & holidays. They come from `sessionOf(t)` in `assets/sessions.js`, which uses the trading calendar, not the data.
- The chart samples once a day at the 00:00 UTC bar close and starts once a full window of history exists. The latest point equals the stats table's 7d/30d values.
- Picking the same bucket for A and B swaps the two, so they always differ.
