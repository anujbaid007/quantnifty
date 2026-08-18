# QuantNifty Workspace

This directory is an organized workspace containing three independent projects:

- `Website/` — public QuantNifty website and Vercel project.
- `RVWAP Live/` — local real-money NIFTY/SENSEX execution platform.
- `RVWAP Pristine BT Engines/` — canonical NIFTY/SENSEX RVWAP backtest engines.

Run website commands and Vercel deployments from `Website/`. The Vercel project's
Git Root Directory should be set to `Website`.

The two RVWAP folders are excluded from Git and Vercel because they contain
proprietary code, broker configuration, checkpoints and recorded market data.

