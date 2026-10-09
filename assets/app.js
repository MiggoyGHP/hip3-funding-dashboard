import { sessionOf, etOffset } from "./sessions.js";
import { WINDOWS, windowStats, rollingLine, sampleAtCloses, diffLine } from "./metrics.js";
import { FundingChart } from "./charts.js";

const BUCKETS = { all: "All hours", open: "Market open", closed: "Market closed" };
// Buckets offered in the open-vs-closed tab. Each keeps its color wherever it is drawn.
const GAP_BUCKETS = {
  open: { label: "Market open", short: "Open", color: "--s1", hue: "blue" },
  closed: { label: "Market closed", short: "Closed", color: "--s2", hue: "orange" },
  weeknight: { label: "Weeknights", short: "Weeknights", color: "--s3", hue: "teal" },
  weekend: { label: "Weekends & holidays", short: "Weekends", color: "--s4", hue: "yellow" },
  all: { label: "All hours", short: "All", color: "--s7", hue: "violet" },
};
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
const INTERVAL_SEC = { "1h": 3600, "4h": 14400, "1d": 86400 };
const SERIES_VARS = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"];
const DEFAULT_LINES = ["7d", "30d", "60d", "90d", "itd"];
const TINT_CAP = 25; // annualized % at which the diverging tint saturates

const $ = (sel) => document.querySelector(sel);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  ticker: null,
  view: store.get("view", "all"),
  bucket: store.get("bucket", "all"),
  interval: store.get("interval", "4h"),
  showPrice: store.get("showPrice", true),
  lines: new Set(store.get("lines", DEFAULT_LINES)),
  chartTab: pick(store.get("chartTab", "windows"), ["windows", "gap"], "windows"),
  gapWindow: pick(store.get("gapWindow", "30d"), ["7d", "30d"], "30d"),
  gapA: pick(store.get("gapA", "open"), Object.keys(GAP_BUCKETS), "open"),
  gapB: pick(store.get("gapB", "closed"), Object.keys(GAP_BUCKETS), "closed"),
};
if (state.gapA === state.gapB) { state.gapA = "open"; state.gapB = "closed"; }

let meta = null;
const markets = new Map(); // ticker -> derived data
const chart = new FundingChart($("#chart"), $("#readout"));

// ---------- data ----------

function derive(raw) {
  const f = raw.funding;
  const times = f.map((r) => r[0]);
  const session = times.map(sessionOf);
  const masks = {
    all: times.map(() => true),
    open: session.map((s) => s === "open"),
    closed: session.map((s) => s !== "open"),
    weeknight: session.map((s) => s === "weeknight"),
    weekend: session.map((s) => s === "weekend"),
  };
  const stats = {};
  for (const b of Object.keys(masks)) {
    stats[b] = Object.fromEntries(WINDOWS.map((w) => [w.key, windowStats(f, masks[b], w.hours)]));
  }
  return { raw, f, times, masks, stats, rolling: {} };
}

function rolling(m, bucket) {
  if (!m.rolling[bucket]) {
    m.rolling[bucket] = Object.fromEntries(WINDOWS.map((w) => [w.key, rollingLine(m.f, m.masks[bucket], w.hours)]));
  }
  return m.rolling[bucket];
}

// Bars for the chosen interval. A bar opening at g holds the prints in (g, g + iv].
function barGrid(m, interval) {
  const iv = INTERVAL_SEC[interval];
  const first = Math.floor((m.times[0] - 1) / iv) * iv;
  const last = Math.floor((m.times[m.times.length - 1] - 1) / iv) * iv;
  const out = [];
  for (let g = first; g <= last; g += iv) out.push(g);
  return out;
}

// 1h/4h bars are displayed in New York wall-clock time; daily bars stay on their UTC day.
function displayTimes(ts, interval) {
  if (interval === "1d") return ts.slice();
  let prev = -Infinity;
  return ts.map((t) => {
    let d = t + etOffset(t);
    if (d <= prev) d = prev + 60; // repeated 1:00 hour when DST ends
    prev = d;
    return d;
  });
}

// ---------- formatting ----------

const fmtPct = (v) => (v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%");
const fmtStab = (v) => (v == null ? "–" : Math.round(v) + "%");

function tint(v) {
  if (v == null) return "";
  const k = Math.min(Math.abs(v) / TINT_CAP, 1) * 50;
  const pole = v >= 0 ? "var(--pos)" : "var(--neg)";
  return `background:color-mix(in srgb, ${pole} ${k.toFixed(0)}%, var(--mid))`;
}

function stabCell(s) {
  if (s.stability == null) return `<td>–</td>`;
  return `<td><span class="stab">${fmtStab(s.stability)}<span class="bar" aria-hidden="true"><i style="width:${s.stability.toFixed(1)}%"></i></span></span></td>`;
}

function windowLabel(w, s) {
  const tag = s.partial ? `<span class="tag">partial, ${s.days} days</span>` : "";
  return `<td class="win">${w.label}${tag}</td>`;
}

// ---------- rendering ----------

function renderTickers() {
  const nav = $("#tickers");
  nav.innerHTML = meta.tickers.map(({ ticker }) => {
    const m = markets.get(ticker);
    const itd = m ? m.stats.all.itd.ann : null;
    return `<button type="button" role="tab" data-ticker="${ticker}" aria-selected="${ticker === state.ticker}">${ticker}<small>${m ? fmtPct(itd) + " since launch" : "loading"}</small></button>`;
  }).join("");
  nav.setAttribute("role", "tablist");
}

function renderStats() {
  const m = markets.get(state.ticker);
  const launch = new Date(m.times[0] * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  $("#stats-title").innerHTML = `${state.ticker} annualized funding <span class="muted">since ${launch}</span>`;
  let html;
  if (state.view === "all") {
    html = `<table><thead><tr><th>Window</th><th>Annualized</th><th>Shorts received</th><th>Hours</th></tr></thead><tbody>` +
      WINDOWS.map((w) => {
        const s = m.stats.all[w.key];
        return `<tr>${windowLabel(w, s)}<td class="rate" style="${tint(s.ann)}">${fmtPct(s.ann)}</td>${stabCell(s)}<td class="n">${s.n.toLocaleString()}</td></tr>`;
      }).join("") + `</tbody></table>`;
  } else {
    html = `<table class="compact"><thead>
      <tr class="group"><th></th><th colspan="2">Market open</th><th colspan="2" class="split-l">Market closed</th><th colspan="2" class="split-l">Compare</th></tr>
      <tr><th>Window</th><th>Annualized</th><th>Shorts recv.</th><th class="split-l">Annualized</th><th>Shorts recv.</th><th class="split-l" title="Open minus closed, annualized">Spread</th><th class="ref">All</th></tr>
      </thead><tbody>` +
      WINDOWS.map((w) => {
        const o = m.stats.open[w.key], c = m.stats.closed[w.key], a = m.stats.all[w.key];
        const spread = o.ann != null && c.ann != null ? o.ann - c.ann : null;
        return `<tr>${windowLabel(w, a)}
          <td class="rate" style="${tint(o.ann)}">${fmtPct(o.ann)}</td>${stabCell(o)}
          <td class="rate split-l" style="${tint(c.ann)}">${fmtPct(c.ann)}</td>${stabCell(c)}
          <td class="split-l">${fmtPct(spread)}</td><td class="ref">${fmtPct(a.ann)}</td></tr>`;
      }).join("") + `</tbody></table>`;
  }
  $("#stats").innerHTML = html;
}

function renderOverview() {
  const split = state.view === "split";
  $("#overview-title").textContent = split
    ? "All tickers: market open vs closed, annualized"
    : "All tickers: annualized funding, all hours";
  const head = `<tr><th>Ticker</th>${WINDOWS.map((w) => `<th>${w.label}</th>`).join("")}</tr>`;
  const rows = meta.tickers.map(({ ticker }) => {
    const m = markets.get(ticker);
    if (!m) return `<tr><td class="tk">${ticker}</td><td colspan="${WINDOWS.length}">Loading…</td></tr>`;
    const cells = WINDOWS.map((w) => {
      if (!split) {
        const s = m.stats.all[w.key];
        return `<td class="rate" style="${tint(s.ann)}">${fmtPct(s.ann)}<span class="st">${fmtStab(s.stability)} shorts recv.</span></td>`;
      }
      const o = m.stats.open[w.key], c = m.stats.closed[w.key];
      return `<td><div class="pair">
        <span style="${tint(o.ann)}"><em>Open</em>${fmtPct(o.ann)} <em>${fmtStab(o.stability)}</em></span>
        <span style="${tint(c.ann)}"><em>Closed</em>${fmtPct(c.ann)} <em>${fmtStab(c.stability)}</em></span>
      </div></td>`;
    }).join("");
    return `<tr data-ticker="${ticker}" class="${ticker === state.ticker ? "current" : ""}"><td class="tk">${ticker}</td>${cells}</tr>`;
  }).join("");
  $("#overview").innerHTML = `<table class="overview"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function lineSpecs(m) {
  const css = getComputedStyle(document.documentElement);
  const roll = rolling(m, state.bucket);
  const grid = barGrid(m, state.interval);
  const iv = INTERVAL_SEC[state.interval];
  return {
    grid,
    lines: WINDOWS.map((w, i) => ({
      key: w.key,
      label: w.key === "itd" ? "Since inception" : w.label,
      color: css.getPropertyValue(SERIES_VARS[i]).trim(),
      visible: state.lines.has(w.key),
      values: sampleAtCloses(m.times, roll[w.key], grid, iv),
    })),
  };
}

function renderLegend() {
  const css = getComputedStyle(document.documentElement);
  $("#legend").innerHTML = WINDOWS.map((w, i) => `<label><input type="checkbox" data-line="${w.key}" ${state.lines.has(w.key) ? "checked" : ""}>
    <span class="key" style="background:${css.getPropertyValue(SERIES_VARS[i]).trim()}"></span>${w.key === "itd" ? "Since inception" : w.label}</label>`).join("");
}

function renderChart(keepRange) {
  if (state.chartTab === "gap") renderGapChart(keepRange);
  else renderWindowChart(keepRange);
}

// Bucket A vs bucket B for one rolling window, sampled once a day, plus their gap.
function renderGapChart(keepRange) {
  const m = markets.get(state.ticker);
  const css = getComputedStyle(document.documentElement);
  const a = GAP_BUCKETS[state.gapA], b = GAP_BUCKETS[state.gapB];
  const colorA = css.getPropertyValue(a.color).trim(), colorB = css.getPropertyValue(b.color).trim();
  const w = state.gapWindow;
  // Start once a full window of history exists; earlier points average only a few days.
  const warm = m.times[0] - 3600 + WINDOWS.find((x) => x.key === w).hours * 3600;
  const grid = barGrid(m, "1d").filter((g) => g + INTERVAL_SEC["1d"] >= warm);
  const sample = (bucket) => sampleAtCloses(m.times, rolling(m, bucket)[w], grid, INTERVAL_SEC["1d"]);
  const A = sample(state.gapA), B = sample(state.gapB);
  chart.draw({
    times: grid, interval: "1d", candles: null, keepRange, paneStretch: [0.58, 0.42],
    lines: [
      { key: "a", label: `${w} ${a.short}`, color: colorA, visible: true, values: A },
      { key: "b", label: `${w} ${b.short}`, color: colorB, visible: true, values: B },
      { key: "gap", label: `Gap (${a.short} − ${b.short})`, color: colorA, colorBelow: colorB,
        visible: true, values: diffLine(A, B), pane: 1, type: "baseline", unit: "pts" },
    ],
  });
  $("#chart-title").textContent = `${state.ticker} rolling ${w} funding: ${a.label.toLowerCase()} vs ${b.label.toLowerCase()}`;
  $("#chart-note").textContent = `One point per day: the trailing ${parseInt(w, 10)}-day average at 00:00 UTC, starting once ${parseInt(w, 10)} days of history exist. ` +
    `Lower pane = ${a.short} − ${b.short} in percentage points, shaded ${a.hue} where ${a.short} funding is higher and ${b.hue} where ${b.short} is higher.`;
}

function renderWindowChart(keepRange) {
  const m = markets.get(state.ticker);
  const { grid, lines } = lineSpecs(m);
  const times = displayTimes(grid, state.interval);
  let candles = null;
  if (state.showPrice) {
    const raw = m.raw.candles[state.interval] || [];
    const dt = displayTimes(raw.map((c) => c[0]), state.interval);
    candles = raw.map((c, i) => ({ time: dt[i], open: c[1], high: c[2], low: c[3], close: c[4] }));
  }
  chart.draw({ times, interval: state.interval, candles, lines, keepRange });
  $("#chart-title").textContent = `${state.ticker} rolling annualized funding, ${BUCKETS[state.bucket].toLowerCase()}`;
  const notes = [];
  if (state.showPrice && state.interval === "1h" && candles && candles.length) {
    const d = new Date(m.raw.candles["1h"][0][0] * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    notes.push(`Hourly price bars start ${d}; Hyperliquid keeps only the latest 5,000 hourly candles. Switch to 4h or 1D for the full history.`);
  }
  notes.push(state.interval === "1d"
    ? "Daily bars are UTC days. Each line point is the rolling value at the bar's close."
    : "Times are New York time. Each line point is the rolling value at the bar's close.");
  $("#chart-note").textContent = notes.join(" ");
}

function updateLinesOnly() {
  const m = markets.get(state.ticker);
  chart.setLineData(lineSpecs(m).lines);
  $("#chart-title").textContent = `${state.ticker} rolling annualized funding, ${BUCKETS[state.bucket].toLowerCase()}`;
}

function syncControls() {
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-checked", b.dataset.view === state.view));
  document.querySelectorAll("[data-interval]").forEach((b) => b.setAttribute("aria-checked", b.dataset.interval === state.interval));
  document.querySelectorAll("[data-bucket]").forEach((b) => b.setAttribute("aria-checked", b.dataset.bucket === state.bucket));
  $("#show-price").checked = state.showPrice;
  const gap = state.chartTab === "gap";
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.chartTab));
  $("#window-controls").hidden = gap;
  $("#legend").hidden = gap;
  $("#gap-controls").hidden = !gap;
  document.querySelectorAll("[data-gap-window]").forEach((b) => b.setAttribute("aria-checked", b.dataset.gapWindow === state.gapWindow));
  $("#gap-a").value = state.gapA;
  $("#gap-b").value = state.gapB;
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  $("#theme-toggle").textContent = dark ? "Light theme" : "Dark theme";
}

function renderAll(keepRange = true) {
  syncControls();
  renderTickers();
  renderStats();
  renderLegend();
  renderChart(keepRange);
  renderOverview();
}

// ---------- events ----------

function selectTicker(t) {
  if (t === state.ticker || !markets.has(t)) return;
  state.ticker = t;
  store.set("ticker", t);
  renderAll(true);
}

function bind() {
  $("#tickers").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ticker]");
    if (b) selectTicker(b.dataset.ticker);
  });
  $("#tickers").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const list = meta.tickers.map((x) => x.ticker);
    const i = list.indexOf(state.ticker) + (e.key === "ArrowRight" ? 1 : -1);
    const next = list[(i + list.length) % list.length];
    selectTicker(next);
    $(`#tickers [data-ticker="${next}"]`).focus();
  });
  $("#overview").addEventListener("click", (e) => {
    const r = e.target.closest("tr[data-ticker]");
    if (r) { selectTicker(r.dataset.ticker); $("#tickers").scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    state.view = b.dataset.view; store.set("view", state.view);
    syncControls(); renderStats(); renderOverview();
  }));
  document.querySelectorAll("[data-interval]").forEach((b) => b.addEventListener("click", () => {
    if (state.interval === b.dataset.interval) return;
    state.interval = b.dataset.interval; store.set("interval", state.interval);
    syncControls(); renderChart(false);
  }));
  document.querySelectorAll("[data-bucket]").forEach((b) => b.addEventListener("click", () => {
    state.bucket = b.dataset.bucket; store.set("bucket", state.bucket);
    syncControls(); updateLinesOnly();
  }));
  $("#show-price").addEventListener("change", (e) => {
    state.showPrice = e.target.checked; store.set("showPrice", state.showPrice);
    renderChart(true);
  });
  const options = Object.entries(GAP_BUCKETS).map(([k, b]) => `<option value="${k}">${b.label}</option>`).join("");
  $("#gap-a").innerHTML = options;
  $("#gap-b").innerHTML = options;
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    if (state.chartTab === b.dataset.tab) return;
    state.chartTab = b.dataset.tab; store.set("chartTab", state.chartTab);
    syncControls(); renderChart(false);
  }));
  document.querySelectorAll("[data-gap-window]").forEach((b) => b.addEventListener("click", () => {
    if (state.gapWindow === b.dataset.gapWindow) return;
    state.gapWindow = b.dataset.gapWindow; store.set("gapWindow", state.gapWindow);
    syncControls(); renderChart(true);
  }));
  // Picking the bucket already on the other side swaps the two, so A and B always differ.
  const onPick = (side, other) => (e) => {
    const v = e.target.value;
    if (v === state[other]) state[other] = state[side];
    state[side] = v;
    store.set("gapA", state.gapA); store.set("gapB", state.gapB);
    syncControls(); renderChart(true);
  };
  $("#gap-a").addEventListener("change", onPick("gapA", "gapB"));
  $("#gap-b").addEventListener("change", onPick("gapB", "gapA"));
  $("#legend").addEventListener("change", (e) => {
    const k = e.target.dataset.line;
    if (!k) return;
    if (e.target.checked) state.lines.add(k); else state.lines.delete(k);
    store.set("lines", [...state.lines]);
    chart.setVisible(k, e.target.checked);
  });
  $("#theme-toggle").addEventListener("click", () => {
    const dark = $("#theme-toggle").textContent === "Dark theme";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
    renderAll(true);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) renderAll(true);
  });
}

// ---------- boot ----------

async function boot() {
  try {
    meta = await (await fetch("data/index.json")).json();
  } catch {
    $("#stats").textContent = "Couldn't load data/index.json. Serve this folder over HTTP (for example, python -m http.server) and reload.";
    return;
  }
  const saved = store.get("ticker", null);
  state.ticker = meta.tickers.some((t) => t.ticker === saved) ? saved : meta.tickers[0].ticker;
  bind();
  syncControls();
  renderTickers();
  renderOverview();

  const first = state.ticker;
  const load = async (t) => {
    const raw = await (await fetch(`data/${t}.json`)).json();
    markets.set(t, derive(raw));
  };
  await load(first);
  renderAll(false);
  await Promise.all(meta.tickers.map((x) => x.ticker).filter((t) => t !== first).map(load));
  renderTickers();
  renderOverview();
}

boot();
