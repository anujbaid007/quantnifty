# NIFTY 50 benchmark on the curve charts

Date: 2026-08-10

## Problem

The site shows three algo return curves with nothing to measure them against. A
reader has no way to tell whether +194% over 2.6 years is remarkable or merely
what the market did. Every performance claim on the page is unanchored.

## Goal

Put a NIFTY 50 benchmark curve on both line charts so the algo curves are read
against the index rather than against nothing.

## Scope

In scope:

- Hero chart (Alpha, Jan 2024 to Jul 2026)
- Comparison chart (Apex / Alpha / Whale, Jun 2022 to Jul 2026)
- Stronger year rules and year labels on both charts

Out of scope, with reasons:

- SENSEX. Roughly 99% correlated with NIFTY, so a second line adds paint, not
  information.
- The Sharpe bar chart. It already carries a "NIFTY 50, buy & hold" row at ~0.6.
- The risk dial. Its curve is an illustrative shape scaled by the drawdown
  slider, not a dated series, so a benchmark has nothing to align to.
- `live.html`. Cards only, no charts.

## Data

Source is NSE NIFTY 50 daily closes (Yahoo symbol `^NSEI`), 2022-06-01 through
2026-07-28. That span covers both chart windows exactly.

Total return is approximated by compounding a flat 1.3%/yr dividend yield onto
the price series:

```
tri(d) = close(d) / close(base) * (1.013 ^ (days_since_base / 365.25))
```

The approximation lands within about 0.1%/yr of the published NIFTY 50 TRI over
this window. It is labelled as approximated wherever it appears.

Resulting figures:

| Window                      | TRI final | TRI peak | max drawdown |
| --------------------------- | --------- | -------- | ------------ |
| Jan 2024 to Jul 2026 (hero) | +15.2%    | +25.6%   | -15.3%       |
| Jun 2022 to Jul 2026 (cmp)  | +52.2%    | +65.8%   | -15.3%       |

Values are baked into the HTML as static path data and a static JS array, the
same way every other curve on the site is stored. No runtime fetch, no new
dependency, no new failure mode.

## Coordinate systems

Both charts share the y mapping. Gridlines already sit at y=8 for 200% and
y=292 for 0%, so:

```
y = 292 - pct * 1.42
```

x is proportional to calendar days, not sessions:

- Hero: `x = days_since(2024-01-03) / 937 * 1000`
- Comparison: `x = days_since(2022-06-01) / 1518 * 1000`

Both were derived from the existing paths and confirmed against the existing
year rules: hero's rules at x=388.5 and x=778.0 land on 2025-01-01 and
2026-01-01, and the comparison's Alpha-start rule at x=382.7 lands on
2024-01-03.

## Rendering

The benchmark is a thin dashed grey line, drawn before the algo curves so it
always sits behind them. It is never selectable and never dims: a benchmark
that disappears when you filter is not a benchmark.

Hero chart:

- 364 points aligned 1:1 with the existing `HP` date array, so the crosshair
  reads both series from one index
- drawn behind the gradient area fill
- tooltip gains a second row showing NIFTY TRI at the hovered date
- header chip row gains `vs NIFTY 50 TRI`

Comparison chart:

- weekly sampled, about 205 points across the full Jun 2022 span
- drawn first, so all three algo curves overlay it
- fourth legend entry: `NIFTY 50 TRI, +52% over 4.2 yrs`
- stays visible in every tab state, including single-algo views

NIFTY TRI ends at +52% against Whale's +66%, so the two lines run close together
near the right edge. Grey dashed under solid green reads cleanly, and the
comparison it invites is a favourable one.

## Year emphasis

Today the hero has two dashed verticals at `rgba(147,186,255,.12)` and the
comparison has a single one. Both charts get:

- a rule at every January boundary, brightened to about `.22` alpha
- the year set inline at the top of the plot, mono, uppercase, tracked
- comparison: the three-label footer becomes a real year axis reading
  `Jun 2022 · 2023 · 2024 · 2025 · 2026 · Jul 2026`
- comparison: the existing "Alpha starts · Jan 2024" marker merges into the 2024
  rule instead of sitting a pixel beside it

## Disclosure

The footnote under each chart names the source and the TRI approximation, and
states plainly that the algo curves are backtested while the benchmark is actual
index data. Mixing modelled and actual series on one axis is defensible only if
the difference is stated.

## Verification

- Both charts render in a browser at desktop and phone widths
- Hero crosshair reports a NIFTY value at every hovered date
- Benchmark stays visible across all four comparison tab states
- `npm test` still passes
