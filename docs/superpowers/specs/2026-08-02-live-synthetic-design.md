# Live synthetic index prices on quantnifty.com

Date: 2026-08-02
Status: approved, not yet implemented

## Goal

A public **Live** page on quantnifty.com showing, for NIFTY and SENSEX:

- the **synthetic** index level implied by option prices via put-call parity
- the **actual spot**
- the **basis** between them

Two numbers alone would look like any quote site. The basis is the point: it is the
market's implied cost of carry, and showing it demonstrates that something non-trivial
is being computed rather than a quote feed being mirrored.

## Audience

Public, ungated, on the marketing site. Indexed by search engines (unlike `/deck`),
because the content is unique rather than a restatement of the homepage.

**Noted, accepted by the owner:** exchange market data normally requires a licence to
redistribute publicly. Kotak's feed is licensed for the account holder's own use. A
derived value is a grey area, but exchanges generally treat live derived data as still
covered. This is a business decision that has been taken, not an oversight.

## Architecture

```
live-bot machine (market hours only)
  └─ synthetic_publisher.py        reuses the existing Kotak session
       every ~5s: quote ATM CE/PE + index spot → compute → POST
                     │
                     ▼   POST /api/live/publish      x-qn-key: <shared secret>
              Vercel KV  (key: live:latest, TTL 24h)
                     │
                     ▼   GET /api/live               public, s-maxage=5
              quantnifty.com/live                    polls every 5s
```

Broker credentials never leave the bot machine. Vercel holds only derived numbers and
one shared secret.

### Why the bot machine publishes

That machine already holds a live, verified Kotak session during market hours. A Vercel
serverless function would re-run a TOTP login on every cold start, which is slow and
rate-limited, and would need its own session cache to be viable at all. Reusing the
existing session removes that whole problem.

**Consequence to accept:** the page is live only while the bot is running. If the bot is
down, `/live` degrades to a "last updated" state, publicly.

## The computation

Per index, every publish cycle:

```
step        NIFTY 50, SENSEX 100
atm         round(spot / step) * step
strikes     [atm - step, atm, atm + step]
leg price   MID of bid/ask, not LTP
synth_k     K + CE_mid − PE_mid              per strike
synthetic   mean(synth_k over usable strikes)
basis       synthetic − spot
basis_pct   basis / spot * 100
annualised  basis_pct * 365 / days_to_expiry
```

Expiry: **nearest weekly**, resolved through the existing
`KotakBroker.resolve_option(strike, opt_type, underlying)`, which already picks the
nearest expiry and caches per day.

### Mid, not LTP

An ATM option's last trade can be seconds old. That staleness lands directly in the
synthetic and therefore entirely in the basis, which is a small number being read to a
fraction of a point. Mid of a two-sided quote is the correct input.

### Three strikes, not one

Averaging ATM and its two neighbours cuts quote noise without introducing skew, since
put-call parity holds at every strike independently.

### Usability guard

A strike is dropped from the average when either leg has:

- no two-sided quote (`bid <= 0` or `ask <= 0`), or
- a relative spread `(ask - bid) / mid > 0.05`

Quality flag on the payload:

| flag | meaning |
|---|---|
| `ok` | all three strikes usable |
| `wide` | one strike dropped; synthetic from the remaining two |
| `stale` | fewer than two usable strikes; the UI shows the last good value greyed |

### Not discounted, and labelled accordingly

`K + CE − PE` yields the **synthetic future**, not spot. Put-call parity is
`C − P = S − K·e^(−rT)`, so recovering spot would need the strike discounted.

Discounting is deliberately **not** done here, because the undiscounted figure is the one
worth showing: `synthetic future − spot` **is** the carry, and that is the whole point of
the page. Discounting would collapse the basis to roughly zero and make the display
pointless. The UI labels it as the synthetic future so the number is not misread.

## Session calendar

Options and cash both close at **15:40 IST** under the current CAS rules, so there is a
single session boundary and no window where one side is frozen while the other moves.

| window | state |
|---|---|
| 09:15–15:40 IST, trading day | `open`, publishing |
| after 15:40 | `closed`, last values frozen and stamped |
| weekend / exchange holiday | `closed`, previous session's close |

## Transport

### `POST /api/live/publish`

- Auth: `x-qn-key` header, compared against `QN_LIVE_PUBLISH_KEY` in Vercel env, using a
  constant-time comparison
- Rejects bodies over 4 KB, and rejects unknown top-level fields
- Validates shape and numeric ranges before writing
- Writes to Vercel KV key `live:latest`, TTL 24h

### `GET /api/live`

- Public, no auth
- Returns the stored payload verbatim
- `Cache-Control: public, s-maxage=5, stale-while-revalidate=30`
- Returns 204 when nothing has ever been published

### Payload

```json
{
  "ts": "2026-08-02T11:34:07+05:30",
  "session": "open",
  "indices": {
    "NIFTY": {
      "spot": 24383.60,
      "synthetic": 24401.25,
      "basis": 17.65,
      "basis_pct": 0.0724,
      "basis_annualised_pct": 5.31,
      "expiry": "2026-08-06",
      "strikes_used": 3,
      "quality": "ok"
    },
    "SENSEX": { }
  }
}
```

Individual strike prices are **not** published. The page shows the ATM strike and expiry
as context; the CE and PE quotes behind them stay on the bot machine.

## The page

New page at `/live`, nav item **Live** added to the island header, the mobile sheet and
the footer.

A separate page rather than a homepage section: a live section on the homepage would have
every visitor polling the API every five seconds, for a number most of them did not come
for.

Two cards, NIFTY and SENSEX, each showing:

- synthetic, large
- spot beneath it
- basis in points and percent, and annualised
- ATM strike and expiry used, small
- last update time

Freshness indicator:

| age of `ts` | shown |
|---|---|
| under 15s, session open | green pulsing dot, "live" |
| 15s to 120s | amber dot, "delayed" |
| over 120s, or session closed | grey dot, "last updated HH:MM" |

Site theme, existing type scale and colour tokens. Flat-basis convention and the standard
backtested / not-SEBI-registered footer do not apply here, since nothing on this page is a
performance claim; a short line explaining what a synthetic price is does.

## Failure modes

| failure | behaviour |
|---|---|
| bot machine down | payload ages out; page shows "last updated HH:MM" |
| Kotak session drops | publisher calls the existing `ensure()` re-login path; on repeated failure it stops publishing rather than emitting wrong numbers |
| a leg has no two-sided quote | that strike is dropped; quality flag reflects it |
| all strikes unusable | publisher skips the cycle; last good value stays, marked stale |
| KV empty (first deploy) | `GET` returns 204; page shows a "starting up" state |
| browser fetch fails | last rendered values stay on screen, marked stale |

Nothing in this list renders a wrong number as though it were correct.

## New work required on the Kotak side

`KotakBroker` currently exposes `login`, `verify`, `ensure`, `resolve_option`, and the
order methods. **It has no quote method.** Live quotes in the existing stack come from
Kite, not Kotak.

A `quotes(tokens)` method must be added to `kotak_neo.py`, following the established
`_authed_call` + `_validate_response` pattern so it inherits the re-login and error
handling that the rest of the class already has.

## Out of scope

- historical or intraday charting on the live page
- per-strike or full option-chain display
- websockets; five-second polling is sufficient for a number that moves in fractions
- indices beyond NIFTY and SENSEX
- any write path from the website back to the broker

## To verify during implementation

- the exact Neo SDK market-data method name and its response shape
- whether Kotak returns two-sided quotes for index options at the depth required
- the Kotak instrument tokens for NIFTY 50 and SENSEX spot
- the source for the exchange holiday calendar
