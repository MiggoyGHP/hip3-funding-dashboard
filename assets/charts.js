// Price + funding-study chart. One Lightweight Charts instance with two panes,
// so the time scale, zoom/pan and crosshair are shared by construction.

const LWC = window.LightweightCharts;
const signed = (v) => {
  const r = Math.round(v * 10) / 10 || 0; // avoid "-0.0"
  return (r > 0 ? "+" : "") + r.toFixed(1);
};
const pct = (v) => signed(v) + "%";
const pts = (v) => signed(v) + " pts";
const fmtFor = (line) => (line.unit === "pts" ? pts : pct);

function alpha(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export class FundingChart {
  constructor(el, readoutEl) {
    this.el = el;
    this.readoutEl = readoutEl;
    this.chart = null;
    this.lineSeries = new Map();
  }

  // spec: { times, interval, candles: [{time,open,high,low,close}] | null,
  //         lines: [{key,label,color,values,visible}], keepRange }
  draw(spec) {
    const prevRange = spec.keepRange && this.chart ? this.chart.timeScale().getVisibleRange() : null;
    if (this.chart) this.chart.remove();
    this.lineSeries.clear();
    this.spec = spec;

    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const chart = LWC.createChart(this.el, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: v("--surface") },
        textColor: v("--muted"),
        fontFamily: "Archivo, system-ui, sans-serif",
        fontSize: 12,
        panes: { separatorColor: v("--hair"), separatorHoverColor: v("--axis"), enableResize: true },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: v("--hair") } },
      rightPriceScale: { borderColor: v("--axis") },
      timeScale: { borderColor: v("--axis"), timeVisible: spec.interval !== "1d", secondsVisible: false, rightOffset: 3 },
      crosshair: { mode: LWC.CrosshairMode.Normal },
    });
    this.chart = chart;

    const fundingPane = spec.candles ? 1 : 0;
    if (spec.candles) {
      this.candleSeries = chart.addSeries(LWC.CandlestickSeries, {
        upColor: v("--up"), downColor: v("--down"),
        wickUpColor: v("--up"), wickDownColor: v("--down"),
        borderVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        priceLineVisible: false,
      }, 0);
      this.candleSeries.setData(spec.candles);
    } else {
      this.candleSeries = null;
    }

    const zeroed = new Set();
    for (const line of spec.lines) {
      const pane = fundingPane + (line.pane || 0);
      const common = {
        lineWidth: 2,
        visible: line.visible,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: v("--surface"),
        crosshairMarkerBorderWidth: 2,
        priceFormat: { type: "custom", formatter: fmtFor(line), minMove: 0.01 },
      };
      const s = line.type === "baseline"
        ? chart.addSeries(LWC.BaselineSeries, {
          ...common,
          baseValue: { type: "price", price: 0 },
          topLineColor: line.color, bottomLineColor: line.colorBelow,
          topFillColor1: alpha(line.color, 0.16), topFillColor2: alpha(line.color, 0.04),
          bottomFillColor1: alpha(line.colorBelow, 0.04), bottomFillColor2: alpha(line.colorBelow, 0.16),
        }, pane)
        : chart.addSeries(LWC.LineSeries, { ...common, color: line.color }, pane);
      this.lineSeries.set(line.key, { series: s, line });
      if (!zeroed.has(pane)) {
        zeroed.add(pane);
        s.createPriceLine({ price: 0, color: v("--axis"), lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: false });
      }
    }
    this.setLineData(spec.lines);

    const stretch = spec.paneStretch || (spec.candles ? [0.6, 0.4] : null);
    if (stretch) chart.panes().forEach((p, i) => stretch[i] != null && p.setStretchFactor(stretch[i]));

    const ts = chart.timeScale();
    if (prevRange) {
      try { ts.setVisibleRange(prevRange); } catch { this.defaultRange(); }
    } else {
      this.defaultRange();
    }

    chart.subscribeCrosshairMove((p) => this.renderReadout(p));
    this.renderReadout(null);
  }

  defaultRange() {
    const n = this.spec.times.length;
    const show = { "1h": 24 * 30, "4h": 6 * 75, "1d": Infinity }[this.spec.interval];
    if (!Number.isFinite(show) || n <= show) this.chart.timeScale().fitContent();
    else this.chart.timeScale().setVisibleLogicalRange({ from: n - show, to: n + 2 });
  }

  // Swap funding values (e.g. bucket change) without rebuilding, so zoom is preserved.
  setLineData(lines) {
    const times = this.spec.times;
    for (const line of lines) {
      const entry = this.lineSeries.get(line.key);
      if (!entry) continue;
      entry.line = line;
      entry.series.setData(times.map((time, i) =>
        line.values[i] == null ? { time } : { time, value: line.values[i] }));
    }
    this.renderReadout(null);
  }

  setVisible(key, visible) {
    const entry = this.lineSeries.get(key);
    if (!entry) return;
    entry.line.visible = visible;
    entry.series.applyOptions({ visible });
    this.renderReadout(null);
  }

  renderReadout(param) {
    const { times, interval } = this.spec;
    let idx;
    if (param && param.time != null) idx = binarySearch(times, param.time);
    else idx = times.length - 1;
    if (idx < 0) { this.readoutEl.innerHTML = ""; return; }
    const t = times[idx];
    const parts = [`<b>${fmtTime(t, interval)}</b>`];
    if (this.candleSeries) {
      const bar = param && param.time != null ? param.seriesData.get(this.candleSeries) : this.spec.candles.findLast((c) => c.time <= t);
      if (bar && bar.open != null) {
        const ch = ((bar.close - bar.open) / bar.open) * 100;
        parts.push(`O ${bar.open.toFixed(2)} H ${bar.high.toFixed(2)} L ${bar.low.toFixed(2)} C <b>${bar.close.toFixed(2)}</b> (${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%)`);
      }
    }
    const vals = [];
    for (const { line } of this.lineSeries.values()) {
      if (!line.visible) continue;
      const val = line.values[idx];
      vals.push(`<span><i class="k" style="background:${line.color}"></i>${line.label} <b>${val == null ? "–" : fmtFor(line)(val)}</b></span>`);
    }
    this.readoutEl.innerHTML = `<div class="row">${parts.join(" <span></span>")}</div><div class="row">${vals.join("")}</div>`;
  }
}

function binarySearch(arr, x) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// Chart times for 1h/4h are already shifted to New York wall-clock, so read them as UTC.
function fmtTime(t, interval) {
  const d = new Date(t * 1000);
  const date = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  if (interval === "1d") return `${date} (UTC day)`;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${date} ${hh}:00 ET`;
}
