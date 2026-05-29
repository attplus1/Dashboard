#!/usr/bin/env python3
"""Daily ASX market-data pipeline for the trading dashboard.

Runs in GitHub Actions (full network), scheduled around the Australian market
open so the freshest fully-settled data — the PREVIOUS trading day's closes —
is published for viewers throughout the day. Writes three JSON files the static
dashboard reads:

    data/benchmark.json   ASX 200 (^AXJO) daily closes  -> equity-curve overlay
    data/prices.json      latest close per ticker        -> open-position valuation
    data/momentum.json    Jegadeesh-Titman 6-1 ranking   -> screener cards

PRIMARY source: yfinance (Yahoo). Yahoo's API accepts MANY tickers per request,
so the whole ASX universe is fetched in a handful of BATCH requests rather than
one-per-symbol — this avoids the per-symbol rate limits that make Stooq
unworkable for the full universe (Stooq also disabled automated bulk downloads).
Stooq per-symbol is kept only as a last-resort benchmark fallback.

ASX tickers map to Yahoo with the ".AX" suffix (e.g. NWH -> NWH.AX).
"""

import csv
import io
import json
import os
import sys
import time
from datetime import datetime

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UNIVERSE = os.path.join(DATA, "universe.json")

HEADERS = {"User-Agent": "Mozilla/5.0 (dashboard data pipeline)"}
STOOQ_URL = "https://stooq.com/q/d/l/?s={sym}&i=d"

# Jegadeesh-Titman 6-1 (approx. trading days): skip the most recent month (~21),
# measure the return over the prior 6 months (~126 days).
SKIP_DAYS = 21
LOOKBACK_DAYS = 126
MIN_HISTORY = SKIP_DAYS + LOOKBACK_DAYS + 5   # need this many bars to rank
CANDLES_OUT = 260                             # bars kept per card (MA200 + headroom)
KEEP_HISTORY = CANDLES_OUT + 210              # trim parsed history to this many bars
TOP_N = 50
BATCH = 100                                   # tickers per Yahoo batch request
PERIOD = "3y"                                 # history depth to request


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# yfinance batch (primary)
# --------------------------------------------------------------------------- #
def _candles_from_df(sub):
    import pandas as pd
    out = []
    for idx, row in sub.iterrows():
        o, h, l, c = row.get("Open"), row.get("High"), row.get("Low"), row.get("Close")
        if any(pd.isna(x) for x in (o, h, l, c)):
            continue
        out.append({"date": idx.strftime("%Y-%m-%d"),
                    "open": float(o), "high": float(h),
                    "low": float(l), "close": float(c)})
    return out


def fetch_yf_batch(tickers):
    """Batch-download many ASX tickers. Returns {TICKER: [candles...]}."""
    try:
        import yfinance as yf
    except Exception as e:
        log(f"yfinance unavailable: {e}")
        return {}

    result = {}
    syms = [f"{t}.AX" for t in tickers]
    for i in range(0, len(syms), BATCH):
        chunk = syms[i:i + BATCH]
        df = None
        for attempt in range(3):
            try:
                df = yf.download(chunk, period=PERIOD, interval="1d",
                                 group_by="ticker", auto_adjust=False,
                                 threads=True, progress=False)
                if df is not None and not df.empty:
                    break
            except Exception as e:
                log(f"  batch {i//BATCH} attempt {attempt+1} failed: {e}")
                time.sleep(2 * (attempt + 1))
        if df is None or df.empty:
            continue
        for sym in chunk:
            ticker = sym[:-3]                       # strip ".AX"
            try:
                sub = df[sym] if len(chunk) > 1 else df
                sub = sub.dropna(how="all")
                candles = _candles_from_df(sub)
            except Exception:
                continue
            if len(candles) >= MIN_HISTORY:
                result[ticker] = candles[-KEEP_HISTORY:]
        log(f"  batch {i//BATCH+1}/{(len(syms)+BATCH-1)//BATCH}: "
            f"{len(result)} tickers so far")
    return result


def fetch_yf_one(yahoo_symbol):
    """Single-symbol yfinance (used for the benchmark)."""
    try:
        import yfinance as yf
        df = yf.download(yahoo_symbol, period=PERIOD, interval="1d",
                         progress=False, auto_adjust=False)
        if df is None or df.empty:
            return []
        if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
            df.columns = df.columns.get_level_values(0)
        return _candles_from_df(df)
    except Exception as e:
        log(f"  yfinance one failed {yahoo_symbol}: {e}")
        return []


def fetch_stooq(symbol):
    """Single-symbol Stooq (benchmark fallback only)."""
    try:
        r = requests.get(STOOQ_URL.format(sym=symbol.lower()), headers=HEADERS, timeout=25)
        if r.status_code != 200 or "Date" not in r.text[:20]:
            return []
        out = []
        for row in csv.DictReader(io.StringIO(r.text)):
            try:
                out.append({"date": row["Date"], "open": float(row["Open"]),
                            "high": float(row["High"]), "low": float(row["Low"]),
                            "close": float(row["Close"])})
            except (KeyError, ValueError):
                continue
        return out
    except requests.RequestException:
        return []


# --------------------------------------------------------------------------- #
# Analytics
# --------------------------------------------------------------------------- #
def build_candles(candles):
    """Last CANDLES_OUT bars, each carrying MA50/MA200 computed over full history."""
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
def main():
    with open(UNIVERSE) as f:
        constituents = json.load(f)["constituents"]
    names = {c["ticker"]: c.get("name", c["ticker"]) for c in constituents}
    tickers = list(names.keys())
    log(f"Universe: {len(tickers)} tickers")

    history = fetch_yf_batch(tickers)
    source = "yfinance batch"
    log(f"History for {len(history)} tickers via {source}")

    prices, ranked = {}, []
    for ticker, candles in history.items():
        prices[ticker] = {"last": candles[-1]["close"], "date": candles[-1]["date"]}
        score = momentum_score(candles)
        if score is not None:
            ranked.append({
                "ticker": ticker, "name": names.get(ticker, ticker),
                "score": round(score, 4), "last": candles[-1]["close"],
                "candles": build_candles(candles),
            })

    ranked.sort(key=lambda x: x["score"], reverse=True)
    asof = datetime.utcnow().strftime("%Y-%m-%d")

    bench = fetch_yf_one("^AXJO") or fetch_stooq("^axjo")
    benchmark = {"placeholder": False, "asof": asof, "label": "ASX 200",
                 "data": [{"date": c["date"], "close": round(c["close"], 2)} for c in bench]}

    with open(os.path.join(DATA, "benchmark.json"), "w") as f:
        json.dump(benchmark, f, separators=(",", ":"))
    with open(os.path.join(DATA, "prices.json"), "w") as f:
        json.dump({"placeholder": False, "asof": asof, "source": source,
                   "prices": prices}, f, separators=(",", ":"))
    with open(os.path.join(DATA, "momentum.json"), "w") as f:
        json.dump({"placeholder": False, "asof": asof, "source": source,
                   "universe_count": len(history), "window": "6-1 month",
                   "ranked": ranked[:TOP_N]}, f, separators=(",", ":"))

    log(f"Done. scanned={len(history)} ranked={len(ranked)} "
        f"benchmark={len(bench)} bars via {source}")


if __name__ == "__main__":
    main()
