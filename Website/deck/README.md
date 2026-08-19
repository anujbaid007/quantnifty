# QuantNifty investor deck

Live at **quantnifty.com/deck**. `index.html`: 7 slides, one self-contained file. No external
assets, no build step. The founder photo and every graphic are embedded, so it
works offline and survives being emailed.

## Slides

1. Cover
2. Nobody buys a flat and leaves it empty (the analogy)
3. The Double Engine, on Apex
4. Three engines: Apex, Alpha, Whale
5. What Rs 1 crore is allowed to earn (FD vs NIFTY vs double engine)
6. Founder and the AI research process
7. Contact and custom low-risk mandates

## Viewing

Open it in any browser. The slide canvas is a fixed 1920x1080 so print output is
exact; on a smaller window the deck scales itself down to fit rather than
cropping. Printing resets it to full size.

## Printing to PDF

Ctrl+P (Cmd+P on Mac), Save as PDF.

- **Background graphics: on.** Otherwise the dark slides print white.
- **Margins: none**, scale 100%.

The page box is 20in x 11.25in, which is 1920x1080 at 96dpi, so each slide gets
its own page. You should get **7 pages**. If the dialog forces A4 and the sides
come out cropped, pick the custom paper size in the paper dropdown, or set
Scale to "Fit to printable area".

## Hosting

`index.html` serves at `/deck` (vercel.json has cleanUrls). It carries
`noindex,follow` so it does not compete with the homepage in search: the link is
meant to be sent, not found. `og-deck.png` is its own share card, separate from
the site's `og.png`.

## Numbers

Everything traces to the live site and the Alpha backtest run log:

- Apex 41.0%/yr, MDD -4.95%, Sharpe 4.67
- Alpha 75.4%/yr, MDD -4.40%, Sharpe 6.28
- Whale 25.7%/yr, MDD -1.50%, Sharpe 6.28
- Double engine assumes a 12% long-run NIFTY CAGR on the equity leg

Drawdown is flat starting capital everywhere, per the house convention.
