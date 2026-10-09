import { test } from "node:test";
import assert from "node:assert/strict";
import { annualize, windowStats, rollingLine, sampleAtCloses } from "../assets/metrics.js";

const H = 3600;
// 10 consecutive hourly prints
const funding = Array.from({ length: 10 }, (_, i) => [1_000_000 * H + i * H, (i - 3) * 1e-5]);
const all = funding.map(() => true);
const even = funding.map((_, i) => i % 2 === 0);

test("annualize: hourly rate x 8760 as percent", () => {
  assert.equal(annualize(0.0000125), 0.0000125 * 8760 * 100);
});

test("windowStats over trailing window, all hours", () => {
  // last 4 prints: i=6..9 -> rates 3,4,5,6 e-5
  const s = windowStats(funding, all, 4);
  assert.equal(s.n, 4);
  assert.ok(Math.abs(s.ann - annualize(4.5e-5)) < 1e-9);
  assert.equal(s.stability, 100);
  assert.equal(s.partial, false);
});

test("windowStats with bucket mask and stability", () => {
  // ITD, even indices: rates -3,-1,1,3,5 e-5 ; positives 3 of 5
  const s = windowStats(funding, even, Infinity);
  assert.equal(s.n, 5);
  assert.ok(Math.abs(s.ann - annualize(1e-5)) < 1e-9);
  assert.equal(s.stability, 60);
  assert.equal(s.partial, false);
});

test("zero rate is not counted as shorts receiving", () => {
  const s = windowStats(funding, all, Infinity); // contains one zero (i=3)
  assert.equal(s.stability, 60); // i=4..9 positive
});

test("window longer than history is flagged partial", () => {
  const s = windowStats(funding, all, 24);
  assert.equal(s.partial, true);
  assert.equal(s.n, 10);
});

test("empty bucket returns nulls", () => {
  const s = windowStats(funding, funding.map(() => false), 4);
  assert.equal(s.n, 0);
  assert.equal(s.ann, null);
  assert.equal(s.stability, null);
});

test("rollingLine matches brute force (random data, gaps in bucket)", () => {
  const n = 500;
  const f = Array.from({ length: n }, (_, i) => [i * H, Math.sin(i / 7) * 1e-4 + (i % 11) * 1e-6]);
  const mask = f.map((_, i) => i % 24 >= 14 && i % 24 <= 20);
  for (const hours of [24, 168, Infinity]) {
    const line = rollingLine(f, mask, hours);
    for (let i = 0; i < n; i++) {
      let sum = 0, c = 0;
      for (let j = 0; j <= i; j++) {
        if (mask[j] && f[j][0] > f[i][0] - hours * H) { sum += f[j][1]; c++; }
      }
      const want = c ? annualize(sum / c) : null;
      if (want === null) assert.equal(line[i], null, `i=${i} h=${hours}`);
      else assert.ok(Math.abs(line[i] - want) < 1e-9, `i=${i} h=${hours}`);
    }
  }
});

test("sampleAtCloses takes last value at or before each bar close", () => {
  const times = [0, H, 2 * H, 3 * H, 4 * H, 5 * H];
  const values = [1, 2, null, 4, 5, 6];
  // bars of 2h opening at 0, 2H, 4H, 6H -> closes at 2H, 4H, 6H, 8H
  const out = sampleAtCloses(times, values, [0, 2 * H, 4 * H, 6 * H], 2 * H);
  assert.deepEqual(out, [null, 5, 6, null]);
});
