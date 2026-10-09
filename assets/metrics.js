// Funding-rate math. `funding` is [[t_sec, hourlyRate], ...] sorted by time;
// `mask` is a parallel boolean array selecting the session bucket.
// All rates returned are annualized percentages (hourly x 8760 x 100).

const H = 3600;

export const WINDOWS = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7d", hours: 24 * 7 },
  { key: "30d", label: "30d", hours: 24 * 30 },
  { key: "60d", label: "60d", hours: 24 * 60 },
  { key: "90d", label: "90d", hours: 24 * 90 },
  { key: "1y", label: "1y", hours: 24 * 365 },
  { key: "itd", label: "Since inception", hours: Infinity },
];

export const annualize = (r) => r * 8760 * 100;

// Stats over the trailing `hours` window ending at the last print.
export function windowStats(funding, mask, hours) {
  const last = funding[funding.length - 1][0];
  const cutoff = last - hours * H;
  let sum = 0, n = 0, pos = 0;
  for (let i = funding.length - 1; i >= 0 && funding[i][0] > cutoff; i--) {
    if (!mask[i]) continue;
    const r = funding[i][1];
    sum += r; n++;
    if (r > 0) pos++;
  }
  const spanHours = (last - funding[0][0]) / H + 1;
  return {
    ann: n ? annualize(sum / n) : null,
    stability: n ? (pos / n) * 100 : null,
    n,
    partial: Number.isFinite(hours) && hours > spanHours,
    days: Math.round(spanHours / 24),
  };
}

// Rolling annualized mean over the calendar window (t - hours, t] at every print,
// using only prints in the bucket. null where the window holds no bucket prints.
export function rollingLine(funding, mask, hours) {
  const out = new Array(funding.length);
  const span = hours * H;
  let sum = 0, n = 0, lo = 0;
  for (let i = 0; i < funding.length; i++) {
    if (mask[i]) { sum += funding[i][1]; n++; }
    if (Number.isFinite(hours)) {
      while (funding[lo][0] <= funding[i][0] - span) {
        if (mask[lo]) { sum -= funding[lo][1]; n--; }
        lo++;
      }
    }
    out[i] = n ? annualize(sum / n) : null;
  }
  return out;
}

// Element-wise a - b; null where either side is null.
export function diffLine(a, b) {
  return a.map((v, i) => (v == null || b[i] == null ? null : v - b[i]));
}

// For each bar opening at barTimes[k] (bar covers (open, open + interval]),
// take the value of the last print inside the bar; null when there is none.
export function sampleAtCloses(times, values, barTimes, interval) {
  const out = new Array(barTimes.length).fill(null);
  let j = 0;
  for (let k = 0; k < barTimes.length; k++) {
    const open = barTimes[k], close = open + interval;
    while (j < times.length && times[j] <= open) j++;
    let last = -1;
    while (j < times.length && times[j] <= close) last = j++;
    if (last >= 0) out[k] = values[last];
  }
  return out;
}
