#!/usr/bin/env python3
"""Build slim per-ticker candle files for the deployed site.

Runs at GitHub Pages deploy time (not in the data workflow). Reads the committed
data/history store and writes data/candles/<TICKER>.json into the site output
for ONLY the tickers in data/trade_tickers.json — the stocks that appear in the
statement, i.e. the ones the Overview tables can pop a chart for. (The screener
gets its candles from the bundled momentum.json, so they aren't built here.)
Building just this small set keeps the deploy fast.

These files are intentionally NOT committed to git — they're derived data, built
fresh into the published site each deploy.

Usage: SITE_DIR=_site python scripts/build_candles.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_data as fd

TRADE_TICKERS = os.path.join(fd.DATA, "trade_tickers.json")


def main():
    site = os.environ.get("SITE_DIR", "_site")
    out_dir = os.path.join(site, "data", "candles")
    try:
        with open(TRADE_TICKERS) as f:
            tickers = json.load(f)
    except (OSError, ValueError):
        tickers = []
        print(f"WARNING: {TRADE_TICKERS} missing/invalid; no candle files built")
    n = fd.write_candle_files(tickers, out_dir=out_dir)
    print(f"Built {n} candle files (of {len(tickers)} trade tickers) into {out_dir}")


if __name__ == "__main__":
    main()

