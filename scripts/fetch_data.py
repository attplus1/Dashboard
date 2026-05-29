#!/usr/bin/env python3
"""Incremental ASX market-data pipeline for the trading dashboard.

Design
------
* A per-ticker price history is stored in the repo under data/history/ starting
  from 2020. The first time a ticker is seen it is BACKFILLED from 2020; after
  that each run only fetches the LAST MONTH and appends new bars. Small daily
  pulls => far less likely to be rate-limited.
* Each ticker is fetched at most once per UTC day (tracked via "last_fetch").
  The workflow runs SEVERAL times a day, so if a run is throttled and only
  updates some tickers, later runs pick up the stragglers — "download throughout
  the day until all stocks have updated data". MAX_FETCH_PER_RUN bounds each run.
* Every run recomputes the slim outputs the dashboard reads from whatever
  history is stored, so the site is always current with best-available data:
      data/benchmark.json   ASX 200 (^AXJO)
      data/prices.json      latest close per ticker
      data/momentum.json    Jegadeesh-Titman 6-1 ranking + candle cards

Source: yfinance (Yahoo). Batch requests (many tickers per call) keep request
counts tiny. ASX tickers map to Yahoo with the ".AX" suffix.
"""

import json
import os
import sys
import time
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
HISTORY_DIR = os.path.join(DATA, "history")
UNIVERSE = os.path.join(DATA, "universe.json")

HISTORY_START = os.environ.get("HISTORY_START", "2020-01-01")
INCR_PERIOD = "1mo"                                   # incremental fetch depth
MAX_FETCH_PER_RUN = int(os.environ.get("MAX_FETCH_PER_RUN", "800"))
BATCH = 100                                           # tickers per Yahoo request

SKIP_DAYS = 21
LOOKBACK_DAYS = 126
MIN_HISTORY = SKIP_DAYS + LOOKBACK_DAYS + 5
CANDLES_OUT = 260
KEEP_HISTORY = CANDLES_OUT + 210                      # bars used for outputs/MA
TOP_N = 50

TODAY = datetime.utcnow().strftime("%Y-%m-%d")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# Per-ticker history store (candles stored as [date,o,h,l,c], one per line)
# --------------------------------------------------------------------------- #
def hist_path(ticker):
    safe = ticker.replace("^", "_").replace("/", "_")
    return os.path.join(HISTORY_DIR, f"{safe}.json")


def load_hist(ticker):
    try:
        with open(hist_path(ticker)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save_hist(ticker, last_fetch, candles):
    os.makedirs(HISTORY_DIR, exist_ok=True)
    lines = ",\n".join(json.dumps([c["date"], c["open"], c["high"], c["low"], c["close"]])
                       for c in candles)
    with open(hist_path(ticker), "w") as f:
        f.write('{"ticker":%s,"last_fetch":%s,"candles":[\n%s\n]}\n'
                % (json.dumps(ticker), json.dumps(last_fetch), lines))


def candles_of(obj):
    """Stored arrays -> list of {date,open,high,low,close} ascending."""
    if not obj:
        return []
    out = []
    for a in obj.get("candles", []):
        try:
            out.append({"date": a[0], "open": float(a[1]), "high": float(a[2]),
                        "low": float(a[3]), "close": float(a[4])})
        except (IndexError, ValueError, TypeError):
            continue
    return out


def merge(old, new):
    by_date = {c["date"]: c for c in old}
    for c in new:
        by_date[c["date"]] = c
    return [by_date[d] for d in sorted(by_date)]


# --------------------------------------------------------------------------- #
# yfinance
# --------------------------------------------------------------------------- #
def _candles_from_df(sub):
    import pandas as pd
    out = []
    for idx, row in sub.iterrows():
        o, h, l, c = row.get("Open"), row.get("High"), row.get("Low"), row.get("Close")
        if any(pd.isna(x) for x in (o, h, l, c)):
            continue
        out.append({"date": idx.strftime("%Y-%m-%d"), "open": float(o),
                    "high": float(h), "low": float(l), "close": float(c)})
    return out


def _flatten_df(df, sym=None):
    """Flatten a MultiIndex yfinance DataFrame to plain OHLCV columns.

    yfinance ≥0.2.x may return (Ticker, OHLCV) or (OHLCV, Ticker) multi-level
    columns depending on the version and whether one or many symbols were
    requested. We detect which level holds the OHLCV names and collapse to that.
    """
    import pandas as pd
    if not isinstance(df.columns, pd.MultiIndex):
        return df
    ohlcv = {"Open", "High", "Low", "Close", "Volume", "Adj Close"}
    # Try selecting by symbol (works when symbol is a top-level key)
    if sym:
        try:
            return df[sym]
        except (KeyError, TypeError):
            pass
    # Find the level whose values overlap with known OHLCV names
    for lvl in range(df.columns.nlevels):
        if set(str(v) for v in df.columns.get_level_values(lvl)) & ohlcv:
            out = df.copy()
            out.columns = df.columns.get_level_values(lvl)
            return out
    return df


def yf_download(symbols, **kw):
    """Return DataFrame or None, with a few retries."""
    import yfinance as yf
    for attempt in range(3):
        try:
            df = yf.download(symbols, interval="1d", group_by="ticker",
                             auto_adjust=False, threads=True, progress=False, **kw)
            if df is not None and not df.empty:
                return df
        except Exception as e:
            log(f"    download attempt {attempt+1} failed: {e}")
        time.sleep(2 * (attempt + 1))
    return None


def fetch_group(tickers, backfill):
    """Fetch a set of ASX tickers (backfill from 2020, else last month).

    Returns {ticker: [candles]} for tickers whose batch call SUCCEEDED (so we
    don't mark throttled tickers as fetched). Missing members of a successful
    batch map to [] (no new data) so they are still marked fetched.
    """
    syms = [f"{t}.AX" for t in tickers]
    got = {}
    kw = {"start": HISTORY_START} if backfill else {"period": INCR_PERIOD}
    for i in range(0, len(syms), BATCH):
        chunk = syms[i:i + BATCH]
        df = yf_download(chunk, **kw)
        if df is None:
            continue                                   # throttled: leave for later run
        for sym in chunk:
            t = sym[:-3]
            try:
                sub = _flatten_df(df, sym)
                got[t] = _candles_from_df(sub.dropna(how="all"))
            except Exception:
                got[t] = []
        log(f"    batch {i//BATCH+1}/{(len(syms)+BATCH-1)//BATCH} ok")
    return got


# --------------------------------------------------------------------------- #
# Analytics
# --------------------------------------------------------------------------- #
def build_candles(candles):
    closes = [c["close"] for c in candles]

    def sma(i, n):
        return None if i < n - 1 else round(sum(closes[i - n + 1:i + 1]) / n, 4)

    start = max(0, len(candles) - CANDLES_OUT)
    return [{
        "date": candles[i]["date"], "open": round(candles[i]["open"], 4),
        "high": round(candles[i]["high"], 4), "low": round(candles[i]["low"], 4),
        "close": round(candles[i]["close"], 4),
        "ma50": sma(i, 50), "ma200": sma(i, 200),
    } for i in range(start, len(candles))]


def momentum_score(candles):
    if len(candles) < MIN_HISTORY:
        return None
    recent = candles[-(SKIP_DAYS + 1)]["close"]
    past = candles[-(SKIP_DAYS + LOOKBACK_DAYS + 1)]["close"]
    return None if past <= 0 else recent / past - 1.0


# --------------------------------------------------------------------------- #
def update_histories(tickers):
    """Update stale tickers (≤ MAX_FETCH_PER_RUN), backfilling new ones."""
    stale = []
    for t in tickers:
        obj = load_hist(t)
        if obj is None or obj.get("last_fetch") != TODAY:
            stale.append((t, obj))
    log(f"Stale tickers: {len(stale)} (cap {MAX_FETCH_PER_RUN}/run)")
    batch = stale[:MAX_FETCH_PER_RUN]

    backfill = [t for t, o in batch if not (o and o.get("candles"))]
    incr     = [t for t, o in batch if (o and o.get("candles"))]
    log(f"  backfill={len(backfill)} incremental={len(incr)}")

    updated = 0
    for group, is_backfill in ((backfill, True), (incr, False)):
        if not group:
            continue
        got = fetch_group(group, is_backfill)
        for t in group:
            if t not in got:
                continue                               # batch was throttled
            old = candles_of(load_hist(t))
            merged = merge(old, got[t])[-(KEEP_HISTORY if not is_backfill else 100000):]
            save_hist(t, TODAY, merged)
            updated += 1
    remaining = len(stale) - updated
    log(f"  updated {updated} tickers; {remaining} still stale (later runs will catch up)")
    return remaining


def update_benchmark():
    obj = load_hist("^AXJO")
    if obj is None or obj.get("last_fetch") != TODAY:
        df = yf_download(["^AXJO"], **({"start": HISTORY_START}
                         if not (obj and obj.get("candles")) else {"period": INCR_PERIOD}))
        if df is not None:
            new = _candles_from_df(_flatten_df(df, "^AXJO"))
            merged = merge(candles_of(obj), new)
            # Only persist (and mark as fetched) if we actually got data — an
            # empty merge keeps last_fetch unset so the next run retries.
            if merged:
                save_hist("^AXJO", TODAY, merged)
                obj = load_hist("^AXJO")
    return candles_of(obj)


def build_outputs(tickers, names):
    prices, ranked = {}, []
    for t in tickers:
        candles = candles_of(load_hist(t))
        if not candles:
            continue
        prices[t] = {"last": candles[-1]["close"], "date": candles[-1]["date"]}
        score = momentum_score(candles[-KEEP_HISTORY:])
        if score is not None:
            ranked.append({
                "ticker": t, "name": names.get(t, t), "score": round(score, 4),
                "last": candles[-1]["close"], "candles": build_candles(candles[-KEEP_HISTORY:]),
            })
    ranked.sort(key=lambda x: x["score"], reverse=True)
    return prices, ranked


def main():
    with open(UNIVERSE) as f:
        constituents = json.load(f)["constituents"]
    names = {c["ticker"]: c.get("name", c["ticker"]) for c in constituents}
    tickers = list(names.keys())
    log(f"Universe: {len(tickers)} tickers; history start {HISTORY_START}")

    remaining = update_histories(tickers)
    bench = update_benchmark()
    prices, ranked = build_outputs(tickers, names)

    benchmark = {"placeholder": False, "asof": TODAY, "label": "ASX 200",
                 "data": [{"date": c["date"], "close": round(c["close"], 2)} for c in bench]}
    with open(os.path.join(DATA, "benchmark.json"), "w") as f:
        json.dump(benchmark, f, separators=(",", ":"))
    with open(os.path.join(DATA, "prices.json"), "w") as f:
        json.dump({"placeholder": False, "asof": TODAY, "source": "yfinance",
                   "prices": prices}, f, separators=(",", ":"))
    with open(os.path.join(DATA, "momentum.json"), "w") as f:
        json.dump({"placeholder": False, "asof": TODAY, "source": "yfinance",
                   "universe_count": len(prices), "window": "6-1 month",
                   "complete": remaining == 0, "ranked": ranked[:TOP_N]},
                  f, separators=(",", ":"))

    log(f"Done. priced={len(prices)} ranked={len(ranked)} benchmark={len(bench)} "
        f"stale_remaining={remaining}")


if __name__ == "__main__":
    main()
