// US cash-session classification for hourly funding prints.
// A print at time T (unix seconds, on the hour) covers the hour (T-1h, T].
// It counts as "open" when T, in New York time, is 10:00..16:00 on an NYSE
// trading day (10:00..13:00 on early-close days), so the 9:00-10:00 hour that
// contains the 9:30 open is included and the 16:00-17:00 hour is not.

// NYSE full closures and 1:00 p.m. early closes (source: nyse.com/markets/hours-calendars).
const HOLIDAYS = new Set([
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const EARLY_CLOSES = new Set([
  "2025-07-03", "2025-11-28", "2025-12-24",
  "2026-11-27", "2026-12-24",
  "2027-11-26",
]);

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", weekday: "short", hourCycle: "h23",
});
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etParts(t) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(t * 1000))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, dow: DOW[p.weekday] };
}

const pad = (n) => String(n).padStart(2, "0");

export function isOpenPrint(t) {
  const { y, m, d, h, dow } = etParts(t);
  if (dow === 0 || dow === 6) return false;
  const day = `${y}-${pad(m)}-${pad(d)}`;
  if (HOLIDAYS.has(day)) return false;
  const lastPrint = EARLY_CLOSES.has(day) ? 13 : 16;
  return h >= 10 && h <= lastPrint;
}

// Calendar-day check on a New York date, shifted by `offset` days.
function isTradingDay(y, m, d, offset = 0) {
  const dt = new Date(Date.UTC(y, m - 1, d + offset));
  const dow = dt.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const day = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  return !HOLIDAYS.has(day);
}

// "open", "weeknight" (closed between two consecutive trading days) or
// "weekend" (closed stretch that spans a weekend or NYSE holiday).
export function sessionOf(t) {
  if (isOpenPrint(t)) return "open";
  const { y, m, d, h } = etParts(t);
  if (!isTradingDay(y, m, d)) return "weekend";
  const beforeOpen = h < 10;
  return isTradingDay(y, m, d, beforeOpen ? -1 : 1) ? "weeknight" : "weekend";
}

// Offset (seconds) to add to a UTC timestamp so it displays as New York wall-clock time.
export function etOffset(t) {
  const { y, m, d, h } = etParts(t);
  const wall = Date.UTC(y, m - 1, d, h) / 1000;
  return wall - Math.floor(t / 3600) * 3600;
}
