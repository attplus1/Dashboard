#!/usr/bin/env python3
"""Build slim per-ticker candle files for the deployed site.

Runs at GitHub Pages deploy time (not in the data workflow). Reads the committed
data/history store and writes data/candles/<TICKER>.json into the site output.

Coverage = the UNION of:
  * data/trade_tickers.json — names in the statement (Overview chart popups), and
  * data/universe.json      — the full ASX directory, so the Screener's ticker
                              search can pop a chart for any name it can surface.

Only names that actually have history produce a file (write_candle_files skips
the rest), so the universe contributes ~the 800 history-backed names. Files are
fetched lazily by the browser, so this only affects the deploy artifact size,
not per-page load.

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


def _load_list(path, extract):
    try:
        with open(path) as f:
            return extract(json.load(f))
    except (OSError, ValueError, KeyError, TypeError):
        print(f"WARNING: {path} missing/invalid; skipping")
        return []


def main():
    site = os.environ.get("SITE_DIR", "_site")
    out_dir = os.path.join(site, "data", "candles")

    trade = _load_list(TRADE_TICKERS, lambda d: list(d))
    universe = _load_list(fd.UNIVERSE, lambda d: [c["ticker"] for c in d["constituents"]])

    # Union, trade tickers first so the most-used names build even if something
    # later fails; dict.fromkeys preserves order and de-dupes.
    tickers = list(dict.fromkeys(list(trade) + list(universe)))

    n = fd.write_candle_files(tickers, out_dir=out_dir)
    print(f"Built {n} candle files (of {len(tickers)} requested: "
          f"{len(trade)} trade + {len(universe)} universe) into {out_dir}")


if __name__ == "__main__":
    main()
