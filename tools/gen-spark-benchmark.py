#!/usr/bin/env python3
"""Build the NIFTY 50 TRI benchmark sparklines for the three algo cards.

Each card's sparkline is normalised to its own return range, so +170% on Apex
and +66% on Whale both fill the same 60-unit box. The benchmark therefore has
to be mapped card by card: it is drawn on that card's scale, which is why it
looks nearly flat next to Alpha and much taller next to Whale. That difference
is the honest reading, not an artefact.

Each card's y = A - B*pct is recovered from the algo's own spark path, using
the two ends of the matching curve in the comparison chart as the anchor.

    python3 tools/gen-spark-benchmark.py
"""
import datetime, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "out"
DIV = 0.013
SPARK_W = 240.0
# every curve on the comparison chart shares this x scale, whatever date it starts on
CMP_ORIGIN, CMP_SPAN = datetime.date(2022, 6, 1), 1518

CARDS = {
    # id, base date, calendar-day span, gradient id of the card's spark
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

    OUT.mkdir(parents=True, exist_ok=True)
    for name, (base, span, grad) in CARDS.items():
        # the card's own curve, and the same curve on the comparison chart where
        # the percentage scale is known (y=292 is 0%, 1.42 units per percent)
        spark = pts(re.search(
            r'<linearGradient id="%s".*?<path fill="none" stroke="[^"]+"[^>]*d="([^"]+)"' % grad,
            html, re.S).group(1))
        big = pts(re.search(r'<path id="c-%s"[^>]*d="([^"]+)"' % name, html, re.S).group(1))
        pct0, pct1 = [(292 - y) / 1.42 for _, y in (big[0], big[-1])]

        B = (spark[0][1] - spark[-1][1]) / (pct1 - pct0)
        A = spark[0][1] + B * pct0

        # Confidence check: the mapping was fitted to the two ends, so prove it
        # also reproduces the algo's own spark in between. Every curve on the
        # comparison chart shares one x scale, anchored at 2022-06-01 over 1518
        # days, whatever date that curve itself begins on.
        def big_pct_at(d):
            xc = (d - CMP_ORIGIN).days / CMP_SPAN * 1000
            for (x0, y0), (x1, y1) in zip(big, big[1:]):
                if x0 <= xc <= x1:
                    t = 0 if x1 == x0 else (xc - x0) / (x1 - x0)
                    return (292 - (y0 + t * (y1 - y0))) / 1.42
            return None

        # Judge the fit on mean error, not the worst point: a 60-sample spark
        # skips spikes that the daily curve shows, so isolated gaps of a few
        # units are expected. A drifting mean would mean the mapping is wrong.
        errs = [abs((A - B * p) - y) for x, y in spark
                if (p := big_pct_at(base + datetime.timedelta(
                    days=round(x / SPARK_W * span)))) is not None]
        mean_err = sum(errs) / len(errs)
        flag = "" if mean_err < 1.5 else f"   <-- CHECK, mean {mean_err:.1f} off"

        weekly = [d for d in dates if base <= d <= dates[-1]][::5]
        if weekly[-1] != dates[-1]:
            weekly.append(dates[-1])
        path = " ".join(
            ("M" if i == 0 else "L")
            + f"{(d - base).days / span * SPARK_W:.1f},{A - B * tri(d, base):.1f}"
            for i, d in enumerate(weekly)
        )
        (OUT / f"spark-{name}.txt").write_text(path)

        final = tri(dates[-1], base)
        print(f"{name:6s} y = {A:6.2f} - {B:.5f}*pct   algo {pct0:+.1f}%..{pct1:+.1f}%   "
              f"nifty {final:+.1f}% -> y {A - B * final:.1f}{flag}")

    print(f"written  {OUT}")


if __name__ == "__main__":
    main()
