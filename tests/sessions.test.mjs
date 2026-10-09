import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenPrint, etParts, sessionOf } from "../assets/sessions.js";

// Helper: unix seconds for an ET wall-clock time, given the UTC offset in hours (-4 EDT, -5 EST).
const et = (y, mo, d, h, off) => Date.UTC(y, mo - 1, d, h - off) / 1000;

test("etParts converts across DST", () => {
  assert.deepEqual(etParts(et(2026, 3, 9, 10, -4)), { y: 2026, m: 3, d: 9, h: 10, dow: 1 });
  assert.deepEqual(etParts(et(2026, 3, 6, 10, -5)), { y: 2026, m: 3, d: 6, h: 10, dow: 5 });
});

test("regular weekday: prints 10:00..16:00 ET are open", () => {
  // Wed 2026-01-14 (EST)
  for (let h = 0; h < 24; h++) {
    assert.equal(isOpenPrint(et(2026, 1, 14, h, -5)), h >= 10 && h <= 16, `hour ${h}`);
  }
});

test("EDT weekday uses the same ET hours", () => {
  // Wed 2026-06-10 (EDT)
  assert.equal(isOpenPrint(et(2026, 6, 10, 9, -4)), false);
  assert.equal(isOpenPrint(et(2026, 6, 10, 10, -4)), true);
  assert.equal(isOpenPrint(et(2026, 6, 10, 16, -4)), true);
  assert.equal(isOpenPrint(et(2026, 6, 10, 17, -4)), false);
});

test("DST transition days", () => {
  // Sun 2025-11-02 and Sun 2026-03-08 are weekends -> closed; following Mondays open at 10:00 print
  assert.equal(isOpenPrint(et(2025, 11, 2, 12, -5)), false);
  assert.equal(isOpenPrint(et(2025, 11, 3, 10, -5)), true);
  assert.equal(isOpenPrint(et(2025, 11, 3, 9, -5)), false);
  assert.equal(isOpenPrint(et(2026, 3, 9, 10, -4)), true);
  assert.equal(isOpenPrint(et(2026, 3, 9, 9, -4)), false);
  // Friday before 2026-11-01 change (EDT) and Monday after (EST)
  assert.equal(isOpenPrint(et(2026, 10, 30, 16, -4)), true);
  assert.equal(isOpenPrint(et(2026, 11, 2, 16, -5)), true);
  assert.equal(isOpenPrint(et(2026, 11, 2, 17, -5)), false);
});

test("weekends closed", () => {
  assert.equal(isOpenPrint(et(2026, 1, 17, 12, -5)), false); // Sat
  assert.equal(isOpenPrint(et(2026, 1, 18, 12, -5)), false); // Sun
});

test("holidays closed", () => {
  assert.equal(isOpenPrint(et(2025, 11, 27, 12, -5)), false); // Thanksgiving 2025
  assert.equal(isOpenPrint(et(2025, 12, 25, 12, -5)), false); // Christmas 2025
  assert.equal(isOpenPrint(et(2026, 4, 3, 12, -4)), false);   // Good Friday 2026
  assert.equal(isOpenPrint(et(2026, 7, 3, 12, -4)), false);   // Independence Day observed
  assert.equal(isOpenPrint(et(2026, 4, 2, 12, -4)), true);    // day before Good Friday
});

test("half-days close at 13:00", () => {
  // Fri 2025-11-28
  assert.equal(isOpenPrint(et(2025, 11, 28, 10, -5)), true);
  assert.equal(isOpenPrint(et(2025, 11, 28, 13, -5)), true);
  assert.equal(isOpenPrint(et(2025, 11, 28, 14, -5)), false);
  // Thu 2026-12-24
  assert.equal(isOpenPrint(et(2026, 12, 24, 13, -5)), true);
  assert.equal(isOpenPrint(et(2026, 12, 24, 14, -5)), false);
});

test("sessionOf: normal week", () => {
  // Fri 2026-01-09 .. Tue 2026-01-13 (EST)
  assert.equal(sessionOf(et(2026, 1, 9, 16, -5)), "open");
  assert.equal(sessionOf(et(2026, 1, 9, 17, -5)), "weekend");
  assert.equal(sessionOf(et(2026, 1, 10, 12, -5)), "weekend");
  assert.equal(sessionOf(et(2026, 1, 12, 0, -5)), "weekend"); // covers Sun 23:00-24:00
  assert.equal(sessionOf(et(2026, 1, 12, 9, -5)), "weekend");
  assert.equal(sessionOf(et(2026, 1, 12, 10, -5)), "open");
  assert.equal(sessionOf(et(2026, 1, 13, 0, -5)), "weeknight");
  assert.equal(sessionOf(et(2026, 1, 13, 9, -5)), "weeknight");
  assert.equal(sessionOf(et(2026, 1, 13, 17, -5)), "weeknight");
});

test("sessionOf: holidays and half-days extend the weekend bucket", () => {
  assert.equal(sessionOf(et(2025, 11, 26, 17, -5)), "weekend"); // night before Thanksgiving
  assert.equal(sessionOf(et(2025, 11, 28, 13, -5)), "open");    // half-day
  assert.equal(sessionOf(et(2025, 11, 28, 14, -5)), "weekend"); // after half-day close, Sat next
  assert.equal(sessionOf(et(2026, 1, 19, 12, -5)), "weekend");  // MLK Day
  assert.equal(sessionOf(et(2026, 1, 20, 9, -5)), "weekend");   // morning after MLK Day
  assert.equal(sessionOf(et(2026, 12, 23, 17, -5)), "weeknight"); // next day is a half-day, still trading
});
