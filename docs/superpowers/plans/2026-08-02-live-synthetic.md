# Live Synthetic Index Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish live put-call-parity synthetic levels for NIFTY and SENSEX from the bot machine, and show them with the basis against spot on a public `/live` page at quantnifty.com.

**Architecture:** A pure computation module and a new Kotak quote method are built and tested in isolation, then joined by a publisher loop that runs on the live-bot machine and POSTs derived numbers to a Vercel function. The site polls a public read endpoint. Broker credentials never leave the bot machine.

**Tech Stack:** Python 3 (bot machine, existing Kotak Neo SDK), Node serverless functions on Vercel, `@vercel/kv` (Upstash Redis), vanilla JS on the page to match the rest of the site.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-live-synthetic-design.md`. Read it before starting.
- **Credentials never leave the bot machine.** No Kotak key, secret, MPIN, TOTP seed or session token may appear in any file under `Projects/QuantNifty`, in any payload, in any log line, or in any commit.
- **`K + CE - PE` is the synthetic FUTURE, not spot.** Never label it "spot" in code, comments, payloads or UI copy. It is left undiscounted on purpose.
- **Legs are priced on the mid of a two-sided quote**, never LTP.
- Session: 09:15 to 15:40 IST on trading days. One boundary, no closing-auction special case.
- Max relative spread for a usable leg: `0.05`. Strike step: NIFTY 50, SENSEX 100.
- Site copy: no em dashes. Match existing type scale and colour tokens in `index.html`.
- **`Projects/GoldMine` is not a git repository.** Tasks 1 to 3 therefore end by running tests, not by committing. Tasks 4 to 6 are in `Projects/QuantNifty`, which is a git repo, and do commit.

---

### Task 1: Synthetic computation module

Pure arithmetic, no network, no broker. Built first because it is the only part that can be fully tested without a live session.

**Files:**
- Create: `/Users/anuj/Desktop/Projects/GoldMine/synthetic.py`
- Test: `/Users/anuj/Desktop/Projects/GoldMine/test_synthetic.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Leg(bid: float, ask: float)` with properties `.mid -> float` and `.usable -> bool`
  - `atm_strike(spot: float, step: int) -> int`
  - `strike_ladder(spot: float, step: int) -> list[int]`
  - `compute(spot: float, legs_by_strike: dict[int, tuple[Leg, Leg]], days_to_expiry: int) -> dict | None`
    returning keys `synthetic`, `basis`, `basis_pct`, `basis_annualised_pct`, `strikes_used`, `quality`

- [ ] **Step 1: Write the failing test**

```python
"""Synthetic index level from put-call parity. Pure arithmetic, no broker."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synthetic import Leg, atm_strike, strike_ladder, compute


def test_leg_mid_is_midpoint():
    assert Leg(bid=100.0, ask=102.0).mid == 101.0


def test_leg_unusable_without_two_sided_quote():
    assert not Leg(bid=0.0, ask=102.0).usable
    assert not Leg(bid=100.0, ask=0.0).usable


def test_leg_unusable_when_spread_too_wide():
    # 6% of mid, over the 5% ceiling
    assert not Leg(bid=97.0, ask=103.0).usable
    # 2% of mid, inside it
    assert Leg(bid=99.0, ask=101.0).usable


def test_leg_unusable_when_crossed():
    assert not Leg(bid=103.0, ask=100.0).usable


def test_atm_and_ladder_round_to_step():
    assert atm_strike(24383.60, 50) == 24400
    assert atm_strike(24374.00, 50) == 24350
    assert strike_ladder(24383.60, 50) == [24350, 24400, 24450]
    assert strike_ladder(78094.64, 100) == [78000, 78100, 78200]


def test_synthetic_is_strike_plus_call_minus_put():
    # single clean strike: 24400 + 150 - 130 = 24420
    legs = {24400: (Leg(149.0, 151.0), Leg(129.0, 131.0))}
    out = compute(spot=24400.0, legs_by_strike=legs, days_to_expiry=4)
    assert out["synthetic"] == 24420.0
    assert out["basis"] == 20.0
    assert out["strikes_used"] == 1
    assert out["quality"] == "stale"          # one usable strike is not enough to trust


def test_three_usable_strikes_average_and_flag_ok():
    legs = {
        24350: (Leg(199.0, 201.0), Leg(159.0, 161.0)),   # 24350 + 200 - 160 = 24390
        24400: (Leg(169.0, 171.0), Leg(179.0, 181.0)),   # 24400 + 170 - 180 = 24390
        24450: (Leg(139.0, 141.0), Leg(199.0, 201.0)),   # 24450 + 140 - 200 = 24390
    }
    out = compute(spot=24380.0, legs_by_strike=legs, days_to_expiry=4)
    assert out["synthetic"] == 24390.0
    assert out["basis"] == 10.0
    assert out["strikes_used"] == 3
    assert out["quality"] == "ok"


def test_wide_strike_is_dropped_and_flagged():
    legs = {
        24350: (Leg(199.0, 201.0), Leg(159.0, 161.0)),   # ok  -> 24390
        24400: (Leg(100.0, 300.0), Leg(179.0, 181.0)),   # CE spread 100% -> dropped
        24450: (Leg(139.0, 141.0), Leg(199.0, 201.0)),   # ok  -> 24390
    }
    out = compute(spot=24380.0, legs_by_strike=legs, days_to_expiry=4)
    assert out["synthetic"] == 24390.0
    assert out["strikes_used"] == 2
    assert out["quality"] == "wide"


def test_returns_none_when_nothing_usable():
    legs = {24400: (Leg(0.0, 0.0), Leg(0.0, 0.0))}
    assert compute(spot=24400.0, legs_by_strike=legs, days_to_expiry=4) is None


def test_basis_percent_and_annualised():
    legs = {24400: (Leg(149.0, 151.0), Leg(129.0, 131.0))}   # synthetic 24420
    out = compute(spot=24400.0, legs_by_strike=legs, days_to_expiry=73)
    assert round(out["basis_pct"], 6) == round(20.0 / 24400.0 * 100, 6)
    # 73 days is a fifth of a year, so annualised is five times the raw percent
    assert round(out["basis_annualised_pct"], 6) == round(out["basis_pct"] * 5.0, 6)


def test_annualised_is_zero_on_expiry_day():
    legs = {24400: (Leg(149.0, 151.0), Leg(129.0, 131.0))}
    out = compute(spot=24400.0, legs_by_strike=legs, days_to_expiry=0)
    assert out["basis_annualised_pct"] == 0.0


if __name__ == "__main__":
    import pytest, sys as _s
    _s.exit(pytest.main([__file__, "-v"]))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -m pytest test_synthetic.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'synthetic'`

- [ ] **Step 3: Write the implementation**

```python
"""Synthetic index level from put-call parity, and its basis against spot.

K + CE - PE yields the synthetic FUTURE, not spot. Parity is
C - P = S - K*exp(-rT), so recovering spot would need the strike discounted.
That is deliberately not done here: future minus spot IS the carry, and the
carry is the number worth showing. Discounting would collapse the basis to
roughly zero.
"""
from dataclasses import dataclass

MAX_REL_SPREAD = 0.05          # a leg wider than this is not worth pricing off
STEP = {"NIFTY": 50, "SENSEX": 100}


@dataclass(frozen=True)
class Leg:
    """One option leg's top of book."""
    bid: float
    ask: float

    @property
    def mid(self):
        return (self.bid + self.ask) / 2.0

    @property
    def usable(self):
        # An ATM option's last trade can be seconds old, so mid of a live
        # two-sided quote is the only input worth trusting. No quote, a
        # crossed book, or a very wide spread all disqualify the strike.
        if self.bid <= 0 or self.ask <= 0 or self.ask < self.bid:
            return False
        mid = self.mid
        return mid > 0 and (self.ask - self.bid) / mid <= MAX_REL_SPREAD


def atm_strike(spot, step):
    return int(round(float(spot) / step) * step)


def strike_ladder(spot, step):
    """ATM and its two neighbours. Parity holds at every strike independently,
    so averaging across three cuts quote noise without introducing skew."""
    atm = atm_strike(spot, step)
    return [atm - step, atm, atm + step]


def synthetic_at_strike(strike, ce, pe):
    return strike + ce.mid - pe.mid


def compute(spot, legs_by_strike, days_to_expiry):
    """Return the synthetic future and its basis, or None if nothing is usable.

    legs_by_strike: {strike: (ce_leg, pe_leg)}
    """
    usable = [
        (k, ce, pe)
        for k, (ce, pe) in sorted(legs_by_strike.items())
        if ce.usable and pe.usable
    ]
    n = len(usable)
    if n == 0:
        return None

    synthetic = sum(synthetic_at_strike(k, ce, pe) for k, ce, pe in usable) / n
    basis = synthetic - float(spot)
    basis_pct = (basis / float(spot) * 100.0) if spot else 0.0
    annualised = (basis_pct * 365.0 / days_to_expiry) if days_to_expiry > 0 else 0.0

    quality = "ok" if n >= 3 else ("wide" if n == 2 else "stale")
    return {
        "synthetic": round(synthetic, 2),
        "basis": round(basis, 2),
        "basis_pct": round(basis_pct, 4),
        "basis_annualised_pct": round(annualised, 2),
        "strikes_used": n,
        "quality": quality,
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -m pytest test_synthetic.py -v`
Expected: PASS, 10 passed

- [ ] **Step 5: Verify no secret can reach this module**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && grep -icE "kotak|token|mpin|totp|secret" synthetic.py`
Expected: `0`. This module is arithmetic only; if it grows a broker reference, the layering is wrong.

---

### Task 2: Kotak quote method

`KotakBroker` has `login`, `verify`, `ensure`, `resolve_option` and the order helpers, but **no quote method**. Live quotes in the existing stack come from Kite. One has to be added before anything can be published.

**Files:**
- Modify: `/Users/anuj/Desktop/Projects/GoldMine/Kotak/kotak_adapter.py` (add `quotes` near `scrip_lookup`, around line 237)
- Modify: `/Users/anuj/Desktop/Projects/GoldMine/kotak_neo.py` (add `quotes` to `KotakBroker`, after `resolve_option`)
- Test: `/Users/anuj/Desktop/Projects/GoldMine/test_kotak_quotes.py`

**Interfaces:**
- Consumes: `KotakBroker._authed_call(operation, call)`, `KotakAdapter.exchange_segment(exchange)`, the `_rows()` helper already in `kotak_neo.py`
- Produces: `KotakBroker.quotes(instruments) -> dict[str, dict]` keyed by instrument token, each value `{"bid": float, "ask": float, "ltp": float}`. `instruments` is a list of `{"instrument_token": str, "exchange": str}`.

- [ ] **Step 1: Write the failing test**

```python
"""KotakBroker.quotes: parsing and auth-retry behaviour, with a fake adapter.

No network, no session. The point is that quotes() inherits the existing
re-login handling and returns a flat, predictable shape.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kotak_neo
from kotak_neo import KotakBroker, KotakUnauthorizedError


class FakeAdapter:
    def __init__(self, payload, fail_first=False):
        self.payload = payload
        self.fail_first = fail_first
        self.calls = 0

    def exchange_segment(self, exchange):
        return {"NSE": "nse_cm", "BSE": "bse_cm",
                "NFO": "nse_fo", "BFO": "bse_fo"}[exchange]

    def quotes(self, instrument_tokens, quote_type=""):
        self.calls += 1
        if self.fail_first and self.calls == 1:
            return {"stat": "Not_Ok", "errMsg": "Invalid Session"}
        return self.payload


def _broker_with(adapter):
    b = KotakBroker.__new__(KotakBroker)      # skip __init__, no session wanted
    b.adapter = adapter
    b.logged_in = True
    b._session_generation = 0
    b._last_reauth_at = 0.0
    b.ensure = lambda: adapter
    return b


DEPTH_PAYLOAD = {"data": [
    {"instrument_token": "43210", "bp": "149.50", "sp": "151.50", "ltp": "150.00"},
    {"instrument_token": "43211", "bp": "129.00", "sp": "131.00", "ltp": "130.25"},
]}


def test_quotes_returns_bid_ask_ltp_keyed_by_token():
    b = _broker_with(FakeAdapter(DEPTH_PAYLOAD))
    out = b.quotes([{"instrument_token": "43210", "exchange": "NFO"},
                    {"instrument_token": "43211", "exchange": "NFO"}])
    assert out["43210"] == {"bid": 149.50, "ask": 151.50, "ltp": 150.00}
    assert out["43211"]["ask"] == 131.00


def test_quotes_tolerates_alternate_field_names():
    payload = {"data": [{"tk": "999", "bidPrice": "10.0", "askPrice": "12.0", "last_price": "11.0"}]}
    b = _broker_with(FakeAdapter(payload))
    out = b.quotes([{"instrument_token": "999", "exchange": "NFO"}])
    assert out["999"] == {"bid": 10.0, "ask": 12.0, "ltp": 11.0}


def test_missing_instrument_is_simply_absent():
    b = _broker_with(FakeAdapter(DEPTH_PAYLOAD))
    out = b.quotes([{"instrument_token": "55555", "exchange": "NFO"}])
    assert "55555" not in out


def test_unauthorized_triggers_one_retry_then_succeeds():
    adapter = FakeAdapter(DEPTH_PAYLOAD, fail_first=True)
    b = _broker_with(adapter)
    b._refresh_after_unauthorized = lambda generation: adapter
    out = b.quotes([{"instrument_token": "43210", "exchange": "NFO"}])
    assert adapter.calls == 2                  # rejected once, retried once
    assert out["43210"]["bid"] == 149.50


def test_empty_instrument_list_short_circuits():
    adapter = FakeAdapter(DEPTH_PAYLOAD)
    b = _broker_with(adapter)
    assert b.quotes([]) == {}
    assert adapter.calls == 0                  # never troubles the broker


if __name__ == "__main__":
    import pytest, sys as _s
    _s.exit(pytest.main([__file__, "-v"]))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -m pytest test_kotak_quotes.py -v`
Expected: FAIL, `AttributeError: 'KotakBroker' object has no attribute 'quotes'`

- [ ] **Step 3: Add `quotes` to the adapter**

In `Kotak/kotak_adapter.py`, directly after `scrip_lookup` (which ends near line 246):

```python
    def quotes(self, instrument_tokens, quote_type=""):
        """Top-of-book for a list of instruments.

        instrument_tokens: [{"instrument_token": "...", "exchange_segment": "..."}]
        quote_type "" asks the SDK for the full quote, which is what carries
        bid and ask. "ltp" would not.
        """
        return self.client.quotes(
            instrument_tokens=list(instrument_tokens),
            quote_type=quote_type,
            isIndex=False,
        )
```

- [ ] **Step 4: Add `quotes` to `KotakBroker`**

In `kotak_neo.py`, immediately after `resolve_option` ends (just before the `# ---- orders (Kite-shaped) ----` comment):

```python
    # ---- market data ----
    def quotes(self, instruments):
        """Top-of-book for instruments, keyed by token.

        instruments: [{"instrument_token": str, "exchange": "NFO"|"BFO"|"NSE"|"BSE"}]
        returns:     {token: {"bid": float, "ask": float, "ltp": float}}

        Goes through _authed_call so it inherits the same single re-login retry
        as every other broker call. A token the broker did not return is simply
        absent from the result; callers decide what to do about it.
        """
        if not instruments:
            return {}

        def call(adapter):
            payload = [
                {"instrument_token": str(i["instrument_token"]),
                 "exchange_segment": adapter.exchange_segment(i["exchange"])}
                for i in instruments
            ]
            return adapter.quotes(payload)

        raw = self._authed_call("quotes", call)
        out = {}
        for row in _rows(raw):
            token = _first(row, ["instrument_token", "tk", "token", "pSymbol"])
            if token is None:
                continue
            bid = _f(_first(row, ["bp", "bidPrice", "bid_price", "bid"]), 0.0)
            ask = _f(_first(row, ["sp", "askPrice", "ask_price", "ask", "offer_price"]), 0.0)
            ltp = _f(_first(row, ["ltp", "last_price", "lp"]), 0.0)
            out[str(token)] = {"bid": bid, "ask": ask, "ltp": ltp}
        return out
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -m pytest test_kotak_quotes.py -v`
Expected: PASS, 5 passed

- [ ] **Step 6: Confirm nothing else broke**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -m pytest test_rvwap_basic.py test_poc_basic.py -q`
Expected: the same result as before this task. `kotak_neo.py` was only added to, so these must be unaffected.

- [ ] **Step 7: Verify the SDK signature against the real client**

The exact Neo SDK quote method name and response field names are the one thing this plan could not verify offline. With a live session on the bot machine:

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -c "
import kotak_neo
b = kotak_neo.KotakBroker(); ok, msg = b.login(); print(msg)
info = b.resolve_option(24400, 'CE', 'NIFTY'); print(info['trading_symbol'], info['instrument_token'])
print(b.quotes([{'instrument_token': info['instrument_token'], 'exchange': info['exchange']}]))
"`
Expected: a dict with non-zero `bid` and `ask`. If the SDK method is named differently or the fields differ, fix the two mappings added in Steps 3 and 4 and re-run Step 5. **Do not proceed past this step with a guessed field name.**

---

### Task 3: Publisher loop

Joins Tasks 1 and 2 and pushes the result. Runs on the bot machine only.

**Files:**
- Create: `/Users/anuj/Desktop/Projects/GoldMine/synthetic_publisher.py`
- Test: `/Users/anuj/Desktop/Projects/GoldMine/test_synthetic_publisher.py`

**Interfaces:**
- Consumes: `synthetic.Leg`, `synthetic.compute`, `synthetic.strike_ladder`, `synthetic.STEP`, `KotakBroker.quotes`, `KotakBroker.resolve_option`
- Produces:
  - `session_state(now_ist: datetime) -> "open" | "closed"`
  - `build_index_block(broker, underlying, spot, today) -> dict | None`
  - `build_payload(broker, spots, now_ist) -> dict`
  - `publish(payload, url, key) -> int` (HTTP status)

- [ ] **Step 1: Write the failing test**

```python
"""Publisher: session windows, payload shape, and that no secret leaks into it."""
import os, sys
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synthetic_publisher as sp


def test_session_open_only_inside_the_window():
    assert sp.session_state(datetime(2026, 8, 3, 9, 15)) == "open"     # Monday open
    assert sp.session_state(datetime(2026, 8, 3, 12, 0)) == "open"
    assert sp.session_state(datetime(2026, 8, 3, 15, 40)) == "open"    # CAS close
    assert sp.session_state(datetime(2026, 8, 3, 15, 41)) == "closed"
    assert sp.session_state(datetime(2026, 8, 3, 9, 14)) == "closed"


def test_weekend_is_closed():
    assert sp.session_state(datetime(2026, 8, 1, 12, 0)) == "closed"   # Saturday
    assert sp.session_state(datetime(2026, 8, 2, 12, 0)) == "closed"   # Sunday


def test_holiday_is_closed():
    sp.HOLIDAYS.add("2026-08-05")
    try:
        assert sp.session_state(datetime(2026, 8, 5, 12, 0)) == "closed"
    finally:
        sp.HOLIDAYS.discard("2026-08-05")


class FakeBroker:
    """resolve_option and quotes, wired so 24400 is ATM with a 20 point carry."""
    def resolve_option(self, strike, opt_type, underlying="NIFTY"):
        return {"instrument_token": f"{strike}{opt_type}",
                "exchange": "NFO", "expiry": "2026-08-06"}

    def quotes(self, instruments):
        book = {
            "24350CE": (199.0, 201.0), "24350PE": (159.0, 161.0),
            "24400CE": (169.0, 171.0), "24400PE": (179.0, 181.0),
            "24450CE": (139.0, 141.0), "24450PE": (199.0, 201.0),
        }
        out = {}
        for i in instruments:
            tok = i["instrument_token"]
            if tok in book:
                bid, ask = book[tok]
                out[tok] = {"bid": bid, "ask": ask, "ltp": (bid + ask) / 2}
        return out


def test_index_block_has_the_expected_numbers():
    block = sp.build_index_block(FakeBroker(), "NIFTY", spot=24380.0,
                                 today=datetime(2026, 8, 2).date())
    assert block["synthetic"] == 24390.0
    assert block["basis"] == 10.0
    assert block["strikes_used"] == 3
    assert block["quality"] == "ok"
    assert block["expiry"] == "2026-08-06"
    assert block["spot"] == 24380.0


def test_index_block_publishes_no_leg_prices():
    block = sp.build_index_block(FakeBroker(), "NIFTY", spot=24380.0,
                                 today=datetime(2026, 8, 2).date())
    leaked = {"bid", "ask", "ltp", "ce", "pe", "legs", "instrument_token", "token"}
    assert leaked.isdisjoint(block.keys())


def test_payload_shape():
    payload = sp.build_payload(FakeBroker(), {"NIFTY": 24380.0},
                               now_ist=datetime(2026, 8, 3, 12, 0))
    assert set(payload) == {"ts", "session", "indices"}
    assert payload["session"] == "open"
    assert payload["ts"].endswith("+05:30")
    assert set(payload["indices"]) == {"NIFTY"}


def test_payload_carries_no_credentials():
    import json
    payload = sp.build_payload(FakeBroker(), {"NIFTY": 24380.0},
                               now_ist=datetime(2026, 8, 3, 12, 0))
    blob = json.dumps(payload).lower()
    for banned in ("token", "mpin", "totp", "consumer", "ucc", "secret", "session_id"):
        assert banned not in blob


if __name__ == "__main__":
    import pytest, sys as _s
    _s.exit(pytest.main([__file__, "-v"]))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -m pytest test_synthetic_publisher.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'synthetic_publisher'`

- [ ] **Step 3: Write the implementation**

```python
"""Publish put-call-parity synthetics for NIFTY and SENSEX to quantnifty.com.

Runs on the live-bot machine, which already holds a verified Kotak session.
Only derived numbers leave this process: no credentials, no session state, and
no individual leg prices.
"""
import json, os, time, urllib.request
from datetime import datetime, date, timedelta

import synthetic
from synthetic import Leg, STEP

OPEN_MIN = 9 * 60 + 15            # 09:15 IST
CLOSE_MIN = 15 * 60 + 40          # 15:40 IST, CAS close
HOLIDAYS = set()                  # "YYYY-MM-DD"; load from the exchange calendar

PUBLISH_URL = os.environ.get("QN_LIVE_PUBLISH_URL", "https://quantnifty.com/api/live/publish")
PUBLISH_KEY = os.environ.get("QN_LIVE_PUBLISH_KEY", "")
INTERVAL_SEC = float(os.environ.get("QN_LIVE_INTERVAL_SEC", "5"))


def session_state(now_ist):
    if now_ist.weekday() >= 5:
        return "closed"
    if now_ist.date().isoformat() in HOLIDAYS:
        return "closed"
    minutes = now_ist.hour * 60 + now_ist.minute
    return "open" if OPEN_MIN <= minutes <= CLOSE_MIN else "closed"


def build_index_block(broker, underlying, spot, today):
    """One index's derived numbers, or None when nothing is usable."""
    step = STEP[underlying]
    strikes = synthetic.strike_ladder(spot, step)

    resolved, wanted = {}, []
    for k in strikes:
        for opt in ("CE", "PE"):
            info = broker.resolve_option(k, opt, underlying)
            resolved[(k, opt)] = info
            wanted.append({"instrument_token": info["instrument_token"],
                           "exchange": info["exchange"]})

    book = broker.quotes(wanted)

    legs_by_strike = {}
    for k in strikes:
        pair = []
        for opt in ("CE", "PE"):
            q = book.get(str(resolved[(k, opt)]["instrument_token"]))
            pair.append(Leg(q["bid"], q["ask"]) if q else Leg(0.0, 0.0))
        legs_by_strike[k] = tuple(pair)

    expiry = resolved[(strikes[1], "CE")].get("expiry")
    dte = (date.fromisoformat(expiry) - today).days if expiry else 0

    out = synthetic.compute(spot, legs_by_strike, dte)
    if out is None:
        return None
    out["spot"] = round(float(spot), 2)
    out["expiry"] = expiry
    out["atm"] = synthetic.atm_strike(spot, step)
    return out


def build_payload(broker, spots, now_ist):
    indices = {}
    today = now_ist.date()
    for underlying, spot in spots.items():
        block = build_index_block(broker, underlying, spot, today)
        if block is not None:
            indices[underlying] = block
    return {
        "ts": now_ist.strftime("%Y-%m-%dT%H:%M:%S+05:30"),
        "session": session_state(now_ist),
        "indices": indices,
    }


def publish(payload, url=None, key=None):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url or PUBLISH_URL, data=body, method="POST",
        headers={"content-type": "application/json",
                 "x-qn-key": key or PUBLISH_KEY})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -m pytest test_synthetic_publisher.py -v`
Expected: PASS, 7 passed

- [ ] **Step 5: Confirm the publish key is only ever read from the environment**

Run: `cd /Users/anuj/Desktop/Projects/GoldMine && grep -nE "PUBLISH_KEY|x-qn-key" synthetic_publisher.py`
Expected: the key appears only as `os.environ.get(...)` and as a header value. No literal key anywhere.

---

### Task 4: Vercel storage and API routes

First task in `Projects/QuantNifty`, which is a git repo, so this one commits.

**Files:**
- Create: `/Users/anuj/Desktop/Projects/QuantNifty/package.json`
- Create: `/Users/anuj/Desktop/Projects/QuantNifty/api/live/publish.js`
- Create: `/Users/anuj/Desktop/Projects/QuantNifty/api/live/index.js`

**Interfaces:**
- Consumes: the payload shape produced by `synthetic_publisher.build_payload`
- Produces: `POST /api/live/publish` (204 on success) and `GET /api/live` (200 with payload, 204 when nothing published)

- [ ] **Step 1: Enable Vercel KV and set the shared secret**

Run:
```bash
cd /Users/anuj/Desktop/Projects/QuantNifty
# Dashboard: Storage -> Create -> KV, link it to this project. That injects
# KV_REST_API_URL and KV_REST_API_TOKEN automatically.
openssl rand -hex 32          # copy the output
vercel env add QN_LIVE_PUBLISH_KEY production      # paste it
```
Then put the same value in the bot machine's environment as `QN_LIVE_PUBLISH_KEY`. It must never be written into any file in this repo.

**Budget note:** publishing every 5s during market hours is about 4,620 writes a day. The Upstash free tier is 10,000 commands a day, and reads count too. If that gets tight, raise `QN_LIVE_INTERVAL_SEC` to 10, which halves it to about 2,310.

- [ ] **Step 2: Create package.json**

```json
{
  "name": "quantnifty",
  "private": true,
  "type": "module",
  "dependencies": {
    "@vercel/kv": "^3.0.0"
  }
}
```

- [ ] **Step 3: Write the publish route**

```js
// api/live/publish.js
// Write side. Authenticated with a shared secret; the bot machine is the only caller.
import { kv } from '@vercel/kv';
import { timingSafeEqual } from 'node:crypto';

const KEY = 'live:latest';
const TTL = 60 * 60 * 24;
const ALLOWED_TOP = new Set(['ts', 'session', 'indices']);
const ALLOWED_INDEX = new Set([
  'spot', 'synthetic', 'basis', 'basis_pct', 'basis_annualised_pct',
  'expiry', 'atm', 'strikes_used', 'quality',
]);

function secretOk(given) {
  const want = process.env.QN_LIVE_PUBLISH_KEY || '';
  if (!want || !given || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!secretOk(req.headers['x-qn-key'])) return res.status(401).end();

  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).end();
  if (JSON.stringify(body).length > 4096) return res.status(413).end();

  // Reject anything not in the agreed shape rather than storing it. This
  // endpoint is public-facing; it should never become a way to park data.
  for (const k of Object.keys(body)) {
    if (!ALLOWED_TOP.has(k)) return res.status(400).end();
  }
  if (typeof body.ts !== 'string' || !['open', 'closed'].includes(body.session)) {
    return res.status(400).end();
  }
  if (!body.indices || typeof body.indices !== 'object') return res.status(400).end();
  for (const block of Object.values(body.indices)) {
    for (const k of Object.keys(block)) {
      if (!ALLOWED_INDEX.has(k)) return res.status(400).end();
    }
    if (!Number.isFinite(block.synthetic) || !Number.isFinite(block.spot)) {
      return res.status(400).end();
    }
  }

  await kv.set(KEY, body, { ex: TTL });
  return res.status(204).end();
}
```

- [ ] **Step 4: Write the read route**

```js
// api/live/index.js
// Read side. Public, cached at the edge so the store is not hit per visitor.
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const payload = await kv.get('live:latest');
  if (!payload) return res.status(204).end();
  res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=30');
  return res.status(200).json(payload);
}
```

- [ ] **Step 5: Deploy and verify both routes end to end**

```bash
cd /Users/anuj/Desktop/Projects/QuantNifty
npm install
vercel deploy --prod --yes

# unauthenticated write must be refused
curl -s -o /dev/null -w "no key -> %{http_code} (want 401)\n" \
  -X POST https://quantnifty.com/api/live/publish \
  -H 'content-type: application/json' -d '{"ts":"x","session":"open","indices":{}}'

# a junk field must be refused
curl -s -o /dev/null -w "bad shape -> %{http_code} (want 400)\n" \
  -X POST https://quantnifty.com/api/live/publish \
  -H "x-qn-key: $QN_LIVE_PUBLISH_KEY" -H 'content-type: application/json' \
  -d '{"ts":"x","session":"open","indices":{},"evil":1}'

# a good payload must be accepted and then readable
curl -s -o /dev/null -w "good -> %{http_code} (want 204)\n" \
  -X POST https://quantnifty.com/api/live/publish \
  -H "x-qn-key: $QN_LIVE_PUBLISH_KEY" -H 'content-type: application/json' \
  -d '{"ts":"2026-08-02T12:00:00+05:30","session":"open","indices":{"NIFTY":{"spot":24380,"synthetic":24390,"basis":10,"basis_pct":0.041,"basis_annualised_pct":3.7,"expiry":"2026-08-06","atm":24400,"strikes_used":3,"quality":"ok"}}}'

curl -s https://quantnifty.com/api/live | head -c 200; echo
```
Expected: 401, 400, 204, then the payload back.

- [ ] **Step 6: Confirm the static site still serves**

Run: `curl -s -o /dev/null -w "home %{http_code}\ndeck %{http_code}\n" https://quantnifty.com https://quantnifty.com/deck`
Expected: 200 and 200. Adding `package.json` must not have turned the deployment into a build that drops the static files.

- [ ] **Step 7: Commit**

```bash
cd /Users/anuj/Desktop/Projects/QuantNifty
git add package.json package-lock.json api/
git commit -m "Add the live publish and read endpoints

Write side takes a shared secret and rejects any field outside the agreed
shape, so a public endpoint cannot become somewhere to park data. Read side
is cached at the edge so visitors do not each hit the store."
git push origin main
```

---

### Task 5: The /live page

**Files:**
- Create: `/Users/anuj/Desktop/Projects/QuantNifty/live.html`
- Modify: `/Users/anuj/Desktop/Projects/QuantNifty/sitemap.xml`

**Interfaces:**
- Consumes: `GET /api/live`
- Produces: a page served at `/live` by the existing `cleanUrls` setting

- [ ] **Step 1: Write the page**

Create `live.html`. It reuses `legal.css` for the shell, then adds its own block. Colour tokens and type scale come from `index.html`; do not invent new ones.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live synthetic NIFTY and SENSEX | QuantNifty</title>
<meta name="description" content="Live synthetic NIFTY and SENSEX levels implied by option prices through put-call parity, shown against actual spot with the basis between them.">
<link rel="canonical" href="https://quantnifty.com/live">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<meta name="theme-color" content="#04091A">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:title" content="Live synthetic NIFTY and SENSEX | QuantNifty">
<meta property="og:description" content="What the option market implies the index is worth, against what it actually costs.">
<meta property="og:url" content="https://quantnifty.com/live">
<meta property="og:image" content="https://quantnifty.com/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Inter+Tight:wght@400;500;600;650&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/legal.css">
<style>
body{background:#04091A;color:#fff}
.mast{background:none;border-bottom:1px solid rgba(147,186,255,.12)}
.mast h1{color:#fff}.mast .sub{color:#8FA0C2}
header{background:rgba(6,13,34,.86);border-bottom-color:rgba(147,186,255,.12)}
header .brand{color:#fff}.hd nav a{color:rgba(233,240,255,.72)}
.lv{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:38px 0 30px}
.lc{border:1px solid rgba(147,186,255,.15);border-radius:16px;padding:28px 30px;
  background:linear-gradient(180deg,rgba(46,107,255,.07),rgba(46,107,255,.01))}
.lc h2{font-size:1.05rem;color:#8FA0C2;font-family:'JetBrains Mono',monospace;
  font-weight:500;letter-spacing:.14em;text-transform:uppercase;margin:0 0 18px}
.big{font-family:'JetBrains Mono',monospace;font-size:clamp(2rem,4.4vw,2.9rem);
  font-weight:600;color:#fff;letter-spacing:-.02em;line-height:1}
.cap{font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.14em;
  text-transform:uppercase;color:#64789F;margin-top:8px}
.row{display:flex;justify-content:space-between;align-items:baseline;
  padding:13px 0;border-bottom:1px solid rgba(147,186,255,.09);font-size:14.5px;color:#8FA0C2}
.row:last-child{border-bottom:0}
.row b{font-family:'JetBrains Mono',monospace;font-weight:500;color:#fff}
.row b.pos{color:#19D39A}.row b.neg{color:#FF9A4D}
.meta{margin-top:20px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#4A5B7D}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;background:#64789F}
.dot.live{background:#19D39A;animation:p 1.8s ease-in-out infinite}
.dot.delayed{background:#FF9A4D}
@keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
.status{font-family:'JetBrains Mono',monospace;font-size:12px;color:#8FA0C2;margin-bottom:6px}
.note{border:1px solid rgba(147,186,255,.14);background:rgba(147,186,255,.04);color:#8FA0C2}
.note p{color:#8FA0C2}
@media(max-width:760px){.lv{grid-template-columns:1fr;gap:16px}}
@media(prefers-reduced-motion:reduce){.dot.live{animation:none}}
</style>
</head>
<body>

<header><div class="hd">
  <a href="/" class="brand">
    <span class="blogo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16l5-6 4 4 8-9"/></svg></span>
    QuantNifty
  </a>
  <nav><a href="/">Home</a><a href="/live">Live</a><a href="/#faq">FAQ</a><a href="/#contact">Contact</a></nav>
</div></header>

<div class="mast"><div class="wrap">
  <span class="kicker">Live</span>
  <h1>What the option market<br>says the index is worth.</h1>
  <p class="sub">Put-call parity gives a synthetic index level from option prices alone. Shown here against the actual spot, with the gap between them.</p>
</div></div>

<main><div class="wrap">
  <div class="status"><span class="dot" id="dot"></span><span id="statusText">connecting</span></div>
  <div class="lv" id="cards"></div>

  <div class="note">
    <b class="lab">What this is</b>
    <p><b>K + CE &minus; PE</b> gives the synthetic <b>future</b>, not spot. The gap against spot is the market's implied cost of carry, and that gap is the interesting number, so it is deliberately left undiscounted. Legs are priced on the mid of a two-sided quote rather than the last trade, and each figure averages the at-the-money strike with its two neighbours.</p>
    <p>Nearest weekly expiry. Market data via Kotak Neo. This page is informational and is not a quote service, not a recommendation, and not investment advice.</p>
  </div>
</div></main>

<footer><div class="wrap">
  <div class="frow">
    <a href="/" class="brand" style="color:#fff">
      <span class="blogo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16l5-6 4 4 8-9"/></svg></span>
      QuantNifty
    </a>
    <nav class="fnav">
      <a href="/">Home</a><a href="/live">Live</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
    </nav>
  </div>
  <div class="fb">
    <span>&copy; 2026 QuantNifty. All rights reserved.</span>
    <span>Not a SEBI-registered Research Analyst or Investment Adviser.</span>
  </div>
</div></footer>

<script>
(function(){
  var cards=document.getElementById('cards'),
      dot=document.getElementById('dot'),
      statusText=document.getElementById('statusText'),
      last=null;

  function num(v,d){return v==null?'--':v.toFixed(d===undefined?2:d)}
  function signed(v){return (v>0?'+':'')+num(v)}

  function card(name,b){
    var cls=b.basis>0?'pos':(b.basis<0?'neg':'');
    return '<div class="lc">'
      + '<h2>'+name+'</h2>'
      + '<div class="big">'+num(b.synthetic)+'</div>'
      + '<div class="cap">Synthetic future, from option prices</div>'
      + '<div style="margin-top:22px">'
      + '<div class="row"><span>Spot</span><b>'+num(b.spot)+'</b></div>'
      + '<div class="row"><span>Basis</span><b class="'+cls+'">'+signed(b.basis)+'</b></div>'
      + '<div class="row"><span>Basis, annualised</span><b class="'+cls+'">'+signed(b.basis_annualised_pct)+'%</b></div>'
      + '<div class="row"><span>ATM strike</span><b>'+b.atm+'</b></div>'
      + '<div class="row"><span>Expiry</span><b>'+(b.expiry||'--')+'</b></div>'
      + '</div>'
      + '<div class="meta">'+b.strikes_used+' of 3 strikes used &middot; '+b.quality+'</div>'
      + '</div>';
  }

  function render(p){
    cards.innerHTML=['NIFTY','SENSEX']
      .filter(function(k){return p.indices&&p.indices[k]})
      .map(function(k){return card(k,p.indices[k])}).join('');
  }

  function stamp(p){
    var age=(Date.now()-new Date(p.ts).getTime())/1000;
    var t=new Date(p.ts).toLocaleTimeString('en-IN',
        {timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});
    dot.className='dot';
    if(p.session==='open'&&age<15){dot.classList.add('live');statusText.textContent='live';}
    else if(p.session==='open'&&age<120){dot.classList.add('delayed');statusText.textContent='delayed';}
    else{statusText.textContent='last updated '+t+' IST';}
  }

  function tick(){
    fetch('/api/live',{cache:'no-store'})
      .then(function(r){return r.status===204?null:r.json()})
      .then(function(p){
        if(!p){statusText.textContent='starting up';return}
        last=p; render(p); stamp(p);
      })
      .catch(function(){
        // keep whatever is on screen rather than blanking it
        if(last){dot.className='dot';statusText.textContent='connection lost';}
      });
  }
  tick(); setInterval(tick,5000);
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Add the page to the sitemap**

In `sitemap.xml`, before `</urlset>`:

```xml
  <url>
    <loc>https://quantnifty.com/live</loc>
    <lastmod>2026-08-02</lastmod>
    <changefreq>always</changefreq>
    <priority>0.6</priority>
  </url>
```

- [ ] **Step 3: Deploy and verify the page renders against real stored data**

```bash
cd /Users/anuj/Desktop/Projects/QuantNifty
vercel deploy --prod --yes
curl -s -o /dev/null -w "live page %{http_code}\n" https://quantnifty.com/live
curl -s https://quantnifty.com/live | grep -c 'id="cards"'
```
Expected: 200, and 1. Open the page in a browser: with the seed payload from Task 4 still in KV, two cards should render and the dot should read "last updated".

- [ ] **Step 4: Verify no leg prices reach the browser**

Run: `curl -s https://quantnifty.com/api/live | python3 -c "import json,sys; d=json.load(sys.stdin); print(sorted(set(k for b in d['indices'].values() for k in b)))"`
Expected: exactly `['atm', 'basis', 'basis_annualised_pct', 'basis_pct', 'expiry', 'quality', 'spot', 'strikes_used', 'synthetic']`. No bid, ask, ltp or token.

- [ ] **Step 5: Commit**

```bash
cd /Users/anuj/Desktop/Projects/QuantNifty
git add live.html sitemap.xml
git commit -m "Add the live synthetic page

Synthetic future from put-call parity against spot, with the basis. The
figure is labelled as a future rather than spot because it is undiscounted
on purpose: the gap against spot is the carry, which is the point of the
page."
git push origin main
```

---

### Task 6: Navigation, and the first real publish

**Files:**
- Modify: `/Users/anuj/Desktop/Projects/QuantNifty/index.html` (island nav, mobile sheet, footer Explore column)
- Modify: `/Users/anuj/Desktop/Projects/GoldMine/dashboard_server.py` (start the publisher thread)

**Interfaces:**
- Consumes: everything above
- Produces: nothing new

- [ ] **Step 1: Add the Live pill to the island header**

The island already carries eight items. A ninth would crowd it, and `/live` is a page rather than a section anchor, so give it its own treatment. In `index.html`, immediately after `</nav>` and before `<a href="#contact" class="pill">Talk to us</a>`:

```html
      <a href="/live" class="livepill"><i></i>Live</a>
```

And with the other `.pill` rules in the stylesheet:

```css
.livepill{display:inline-flex;align-items:center;gap:7px;padding:8px 15px;border-radius:999px;
  font-size:13px;font-weight:600;color:#93BAFF;border:1px solid rgba(147,186,255,.28);
  background:rgba(147,186,255,.06);white-space:nowrap;transition:border-color .25s,color .25s}
.livepill:hover{color:#fff;border-color:rgba(147,186,255,.5)}
.livepill i{width:6px;height:6px;border-radius:50%;background:#19D39A;animation:lp 1.8s ease-in-out infinite}
.island.pinned .livepill{color:var(--b600);border-color:rgba(27,79,216,.22)}
@keyframes lp{0%,100%{opacity:1}50%{opacity:.35}}
@media(max-width:960px){.livepill{display:none}}
@media(prefers-reduced-motion:reduce){.livepill i{animation:none}}
```

- [ ] **Step 2: Add Live to the mobile sheet and the footer**

In the mobile sheet, before `<a href="#concept">Double engine</a>`:

```html
  <a href="/live">Live</a>
```

In the footer Explore column, before `<a href="#concept">Double engine</a>`:

```html
        <a href="/live">Live</a>
```

- [ ] **Step 3: Deploy and verify the nav on both widths**

```bash
cd /Users/anuj/Desktop/Projects/QuantNifty
vercel deploy --prod --yes
H=$(curl -s "https://quantnifty.com?cb=$RANDOM")
echo "livepill:    $(echo "$H" | grep -c 'class="livepill"')"
echo "links to /live: $(echo "$H" | grep -o 'href="/live"' | wc -l)"
```
Expected: 1 and 3. Then load the site at 390px wide and confirm the pill is hidden and the sheet carries Live, and at 1440px that the island has not wrapped.

- [ ] **Step 4: Wire the publisher into the bot process**

In `dashboard_server.py`, alongside the other background threads:

```python
import synthetic_publisher

def _publish_synthetics():
    """Push derived synthetic levels to quantnifty.com/live while the market is open.

    Spot comes from the existing Kite tick globals, which are already updated
    tick by tick; only the option legs need a Kotak call. Every failure is
    swallowed: this is a marketing page and must never disturb trading.
    """
    while True:
        try:
            now = datetime.now()
            if synthetic_publisher.session_state(now) == "open":
                spots = {}
                if nifty_spot_ltp:
                    spots["NIFTY"] = float(nifty_spot_ltp)
                if sensex_spot_ltp:
                    spots["SENSEX"] = float(sensex_spot_ltp)
                if spots:
                    payload = synthetic_publisher.build_payload(
                        kotak_neo.BROKER, spots, now)
                    if payload["indices"]:
                        synthetic_publisher.publish(payload)
        except Exception as exc:
            logging.warning("synthetic publish skipped: %s", exc)
        time.sleep(synthetic_publisher.INTERVAL_SEC)

threading.Thread(target=_publish_synthetics, daemon=True).start()
```

Place the `threading.Thread(...)` line next to the existing
`threading.Thread(target=feed_fallback_poller, daemon=True).start()` around line 758,
so it starts on the same path as the other background workers.

`kotak_neo.BROKER` is the shared logged-in singleton this file already uses at lines
5478 and 5542. `nifty_spot_ltp` and `sensex_spot_ltp` are the module globals declared at
lines 26 and 27 and updated by the tick handler. Both need `global` visibility inside the
function, which they have as module-level reads.

**Do not create a second `KotakBroker`.** A second session would compete with the trading
one for the same login and could get both throttled.

- [ ] **Step 5: Verify end to end during market hours**

With the bot running between 09:15 and 15:40 IST:

```bash
curl -s https://quantnifty.com/api/live | python3 -m json.tool
```
Expected: `session` is `open`, `ts` within the last few seconds, and both indices present with a `basis` in the low tens of points for a near expiry. Open `https://quantnifty.com/live` and confirm the dot is green and the numbers move.

- [ ] **Step 6: Verify the page degrades when the publisher stops**

Stop the publisher thread, wait two minutes, reload `/live`.
Expected: the last numbers stay on screen, the dot turns grey, and the status reads "last updated HH:MM IST". Nothing blank, nothing wrong presented as live.

- [ ] **Step 7: Commit the site side**

```bash
cd /Users/anuj/Desktop/Projects/QuantNifty
git add index.html
git commit -m "Link the live page from the nav

Given as its own pill rather than a ninth nav item: the island already
carries eight, and /live is a page rather than a section anchor."
git push origin main
```

---

## Verification checklist

Run before calling this done.

- [ ] `cd /Users/anuj/Desktop/Projects/GoldMine && python3 -m pytest test_synthetic.py test_kotak_quotes.py test_synthetic_publisher.py -v` all pass
- [ ] `grep -rniE "mpin|totp|consumer_key|access_token|KOTAK_" /Users/anuj/Desktop/Projects/QuantNifty --exclude-dir=.git` returns nothing
- [ ] `POST /api/live/publish` without the key returns 401
- [ ] `GET /api/live` exposes no bid, ask, ltp or instrument token
- [ ] `/live` shows two cards during market hours with a green dot
- [ ] `/live` shows "last updated" and keeps the last numbers when the publisher stops
- [ ] home page and `/deck` still return 200 after `package.json` was added
- [ ] no em dashes in any new site copy
