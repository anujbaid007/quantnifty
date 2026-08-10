#!/usr/bin/env python3
"""Regenerate the NIFTY 50 TRI benchmark data baked into index.html.

The benchmark curves on the hero and comparison charts are static SVG paths, the
same as every other curve on the site. This script rebuilds them from NSE closes
so the data can be refreshed when the chart windows move.

    python3 tools/gen-nifty-benchmark.py

Writes hero-path / hero-vals / cmp-path into tools/out/ for pasting into
index.html, replacing:

  * the `d` of the hero `path.bmdraw`
  * the `NF=[...]` array in the hero chart script
  * the `d` of `#c-nifty` in the comparison chart

Total return is approximated by compounding a flat dividend yield onto the price
index, which tracks the published NIFTY 50 TRI to within about 0.1%/yr.
"""
import datetime, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "out"

DIV = 0.013                                  # assumed dividend yield, per year
HERO_BASE, HERO_SPAN = datetime.date(2024, 1, 3), 937    # to 2026-07-28
CMP_BASE, CMP_SPAN = datetime.date(2022, 6, 1), 1518     # to 2026-07-28
CMP_STRIDE = 5                               # weekly sample; no hover to serve

# y=8 is 200% and y=292 is 0% on both charts, so one mapping covers each.
def y_of(pct):
    return 292 - pct * 1.42


def fetch():
    """NIFTY 50 daily closes. curl, not urllib: the system Python has no CA bundle."""
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI"
           "?period1=1653955200&period2=1785283200&interval=1d")
    raw = subprocess.run(
        ["curl", "-sS", "-m", "45", "-H", "User-Agent: Mozilla/5.0", url],
        capture_output=True, check=True,
    ).stdout
    r = json.loads(raw)["chart"]["result"][0]
    rows = sorted(
        (datetime.datetime.fromtimestamp(t, datetime.UTC).date(), float(c))
        for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"])
        if c is not None
    )
    if len(rows) < 900:
        sys.exit(f"only {len(rows)} closes returned; refusing to regenerate")
    return rows


def main():
    rows = fetch()
    dates = [d for d, _ in rows]
    px = dict(rows)

    def close_at(d):
        """Last close at or before d, so index holidays fall back a session."""
        lo, hi = 0, len(dates) - 1
        if d <= dates[0]:
            return px[dates[0]]
        while lo < hi:
            mid = (lo + hi + 1) // 2
            lo, hi = (mid, hi) if dates[mid] <= d else (lo, mid - 1)
        return px[dates[lo]]

    def tri(d, base):
        v = close_at(d) / close_at(base) * (1 + DIV) ** ((d - base).days / 365.25)
        return (v - 1) * 100

    def path(points):
        return " ".join(("M" if i == 0 else "L") + f"{x:.1f},{y:.1f}"
                        for i, (x, y) in enumerate(points))

    # hero: one point per date already in the HP array, so the crosshair can
    # index both series with the same i
    hp_src = re.search(r"var HP=\[(.*?)\], NF=", (ROOT / "index.html").read_text(), re.S)
    if not hp_src:
        sys.exit("could not find the HP array in index.html")
    hp_dates = [datetime.datetime.strptime(s, "%d %b %Y").date()
                for s in re.findall(r'"(\d\d \w\w\w \d{4})"', hp_src.group(1))]

    # the path keeps full precision; only the tooltip array is rounded, since
    # rounding first would visibly coarsen the curve
    exact = [tri(d, HERO_BASE) for d in hp_dates]
    vals = [round(p, 1) for p in exact]
    hero = [((d - HERO_BASE).days / HERO_SPAN * 1000, y_of(p))
            for d, p in zip(hp_dates, exact)]

    weekly = [d for d in dates if d >= CMP_BASE][::CMP_STRIDE]
    if weekly[-1] != dates[-1]:
        weekly.append(dates[-1])
    cmp_pts = [((d - CMP_BASE).days / CMP_SPAN * 1000, y_of(tri(d, CMP_BASE)))
               for d in weekly]

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "hero-path.txt").write_text(path(hero))
    (OUT / "hero-vals.txt").write_text("[" + ",".join(map(str, vals)) + "]")
    (OUT / "cmp-path.txt").write_text(path(cmp_pts))

    print(f"closes   {len(rows)}  {dates[0]} -> {dates[-1]}")
    print(f"hero     {len(hero)} pts   final {vals[-1]:+.1f}%  "
          f"peak {max(vals):+.1f}%  trough {min(vals):+.1f}%")
    print(f"cmp      {len(cmp_pts)} pts   final {tri(dates[-1], CMP_BASE):+.1f}%")
    print(f"written  {OUT}")


if __name__ == "__main__":
    main()
