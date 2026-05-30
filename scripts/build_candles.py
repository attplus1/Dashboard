#!/usr/bin/env python3
"""Build slim per-ticker candle files for the deployed site.

Runs at GitHub Pages deploy time (not in the data workflow). Reads the committed
data/history store and writes data/candles/<TICKER>.json into the site output,
so the Overview trade/position popups can lazily fetch one ticker at a time.
These files are intentionally NOT committed to git — they're derived data and
would otherwise bloat the repo history (~1800 files changing each trading day).

Usage: SITE_DIR=_site python scripts/build_candles.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_data as fd


def main():
    site = os.environ.get("SITE_DIR", "_site")
    out_dir = os.path.join(site, "data", "candles")
    with open(fd.UNIVERSE) as f:
        tickers = [c["ticker"] for c in json.load(f)["constituents"]]
    n = fd.write_candle_files(tickers, out_dir=out_dir)
    print(f"Built {n} candle files into {out_dir}")


if __name__ == "__main__":
    main()
