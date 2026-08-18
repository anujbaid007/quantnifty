#!/usr/bin/env python3
"""Build the hover data for the three algo card sparklines.

Each card gets one weekly grid carrying both series: the algo's own return and
the NIFTY 50 TRI, on that card's scale. The algo figure is read back off the
drawn polyline rather than from source data, so the number in the readout is
always exactly what the visible line is doing at that x, whatever resolution
the line was drawn at.

    python3 tools/gen-spark-hover.py   ->  tools/out/spark-hover.js
"""
import datetime, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "out"
DIV = 0.013
SPARK_W = 240.0
CMP_ORIGIN, CMP_SPAN = datetime.date(2022, 6, 1), 1518

CARDS = {
    "apex":  (datetime.date(2022, 6, 1), 1518, "s1"),
    "alpha": (datetime.date(2024, 1, 3), 937, "s2"),
    "whale": (datetime.date(2024, 1, 3), 937, "s3"),
}


def fetch():
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


def pts(d):
    return [(float(x), float(y)) for x, y in re.findall(r"[ML](-?[\d.]+),(-?[\d.]+)", d)]


def at_x(poly, x):
    """y on the polyline at x, clamped to its ends."""
    if x <= poly[0][0]:
        return poly[0][1]
    if x >= poly[-1][0]:
        return poly[-1][1]
    for (x0, y0), (x1, y1) in zip(poly, poly[1:]):
        if x0 <= x <= x1:
            t = 0 if x1 == x0 else (x - x0) / (x1 - x0)
            return y0 + t * (y1 - y0)
    return poly[-1][1]


def main():
    html = (ROOT / "index.html").read_text()
    rows = fetch()
    dates = [d for d, _ in rows]
    px = dict(rows)

    def close_at(d):
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

    out = {}
    for name, (base, span, grad) in CARDS.items():
        spark = pts(re.search(
            r'<linearGradient id="%s".*?<path fill="none" stroke="#[0-9A-Fa-f]{6}"[^>]*d="([^"]+)"' % grad,
            html, re.S).group(1))
        big = pts(re.search(r'<path id="c-%s"[^>]*d="([^"]+)"' % name, html, re.S).group(1))
        pct0, pct1 = [(292 - y) / 1.42 for _, y in (big[0], big[-1])]
        B = (spark[0][1] - spark[-1][1]) / (pct1 - pct0)
        A = spark[0][1] + B * pct0

        grid = [d for d in dates if base <= d <= dates[-1]][::5]
        if grid[-1] != dates[-1]:
            grid.append(dates[-1])

        offs, algo, nifty = [], [], []
        for d in grid:
            off = (d - base).days
            x = off / span * SPARK_W
            offs.append(off)
            # read the algo figure back off the drawn line, so the readout can
            # never disagree with what the visitor is looking at
            algo.append(round((A - at_x(spark, x)) / B, 1))
            nifty.append(round(tri(d, base), 1))

        out[name] = {"b": base.isoformat(), "s": span,
                     "A": round(A, 2), "B": round(B, 5),
                     "o": offs, "a": algo, "n": nifty}
        print(f"{name:6s} {len(offs):3d} pts   algo {algo[0]:+.1f}%..{algo[-1]:+.1f}%   "
              f"nifty {nifty[0]:+.1f}%..{nifty[-1]:+.1f}%")

    OUT.mkdir(parents=True, exist_ok=True)
    js = "var SPK=" + json.dumps(out, separators=(",", ":")) + ";"
    (OUT / "spark-hover.js").write_text(js)
    print(f"\n{len(js)} bytes -> {OUT / 'spark-hover.js'}")


if __name__ == "__main__":
    main()
