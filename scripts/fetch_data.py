#!/usr/bin/env python3
"""Daily ASX market-data pipeline for the trading dashboard.

Runs in GitHub Actions (full network). Pulls daily OHLC from Stooq for the
ASX universe + the ASX 200 index, then writes three JSON files the static
dashboard reads:

    data/benchmark.json   ASX 200 (^AXJO) daily closes  -> equity-curve overlay
    data/prices.json      latest price per ticker        -> open-position valuation
    data/momentum.json    Jegadeesh-Titman 6-1 ranking   -> screener cards

Source: Stooq (free, no key). ASX symbols use the ".au" suffix, e.g. nwh.au.
yfinance (Yahoo, ".AX") is used only as a fallback when Stooq returns nothing.
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

STOOQ_URL = "https://stooq.com/q/d/l/?s={sym}&i=d"
HEADERS = {"User-Agent": "Mozilla/5.0 (dashboard data pipeline)"}

# Jegadeesh-Titman 6-1 (approx. trading days): skip the most recent month (~21),
# measure the return over the prior 6 months (~126 days).
SKIP_DAYS = 21
LOOKBACK_DAYS = 126
MIN_HISTORY = SKIP_DAYS + LOOKBACK_DAYS + 5   # need this many bars to rank
CANDLES_OUT = 260                             # bars kept per card (MA200 + headroom)
TOP_N = 50
THROTTLE = 0.15                               # be polite to Stooq


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch_stooq(symbol):
    """Return list of {date,open,high,low,close} ascending, or [] on failure."""
    url = STOOQ_URL.format(sym=symbol.lower())
    try:
        r = requests.get(url, headers=HEADERS, timeout=25)
        if r.status_code != 200 or "Date" not in r.text[:20]:
            return []
        rows = list(csv.DictReader(io.StringIO(r.text)))
        out = []
        for row in rows:
            try:
                out.append({
                    "date": row["Date"],
                    "open": float(row["Open"]), "high": float(row["High"]),
                    "low": float(row["Low"]), "close": float(row["Close"]),
                })
            except (KeyError, ValueError):
                continue
        return out
    except requests.RequestException as e:
        log(f"  stooq error {symbol}: {e}")
        return []


def fetch_yf(yahoo_symbol):
    """Fallback via yfinance; returns same shape or []."""
    try:
        import yfinance as yf
        df = yf.download(yahoo_symbol, period="2y", interval="1d",
                         progress=False, auto_adjust=False)
        if df is None or df.empty:
            return []
        out = []
        for idx, row in df.iterrows():
            out.append({
                "date": idx.strftime("%Y-%m-%d"),
                "open": float(row["Open"]), "high": float(row["High"]),
                "low": float(row["Low"]), "close": float(row["Close"]),
            })
        return out
    except Exception as e:  # noqa: BLE401 - fallback must never crash the run
        log(f"  yfinance fallback failed {yahoo_symbol}: {e}")
        return []


def get_history(ticker):
    candles = fetch_stooq(f"{ticker}.au")
    if len(candles) < MIN_HISTORY:
        yf = fetch_yf(f"{ticker}.AX")
        if len(yf) > len(candles):
            candles = yf
    return candles


def build_candles(candles):
    """Return the last CANDLES_OUT bars, each carrying MA50/MA200 computed over
    the FULL history so the moving averages span the entire displayed window."""
    closes = [c["close"] for c in candles]

    def sma(i, n):
        if i < n - 1:
            return None
        return round(sum(closes[i - n + 1:i + 1]) / n, 4)

    out = []
    start = max(0, len(candles) - CANDLES_OUT)
    for i in range(start, len(candles)):
        c = candles[i]
        out.append({
            "date": c["date"], "open": round(c["open"], 4), "high": round(c["high"], 4),
            "low": round(c["low"], 4), "close": round(c["close"], 4),
            "ma50": sma(i, 50), "ma200": sma(i, 200),
        })
    return out


def momentum_score(candles):
    """6-1 formation return: close[-SKIP] / close[-(SKIP+LOOKBACK)] - 1."""
    if len(candles) < MIN_HISTORY:
        return None
    recent = candles[-(SKIP_DAYS + 1)]["close"]
    past = candles[-(SKIP_DAYS + LOOKBACK_DAYS + 1)]["close"]
    if past <= 0:
        return None
    return recent / past - 1.0


def main():
    with open(UNIVERSE) as f:
        universe = json.load(f)["constituents"]
    log(f"Universe: {len(universe)} tickers")

    prices, ranked = {}, []
    for n, item in enumerate(universe, 1):
        ticker, name = item["ticker"], item.get("name", item["ticker"])
        candles = get_history(ticker)
        time.sleep(THROTTLE)
        if not candles:
            continue
        prices[ticker] = {"last": candles[-1]["close"], "date": candles[-1]["date"]}
        score = momentum_score(candles)
        if score is not None:
            ranked.append({
                "ticker": ticker, "name": name, "score": round(score, 4),
                "last": candles[-1]["close"],
                "candles": build_candles(candles),
            })
        if n % 50 == 0:
            log(f"  processed {n}/{len(universe)}")

    ranked.sort(key=lambda x: x["score"], reverse=True)
    asof = datetime.utcnow().strftime("%Y-%m-%d")

    # ASX 200 benchmark
    bench = fetch_stooq("^axjo") or fetch_yf("^AXJO")
    benchmark = {
        "placeholder": False, "asof": asof, "label": "ASX 200",
        "data": [{"date": c["date"], "close": round(c["close"], 2)} for c in bench],
    }

    with open(os.path.join(DATA, "benchmark.json"), "w") as f:
        json.dump(benchmark, f, separators=(",", ":"))
    with open(os.path.join(DATA, "prices.json"), "w") as f:
        json.dump({"placeholder": False, "asof": asof, "prices": prices}, f, separators=(",", ":"))
    with open(os.path.join(DATA, "momentum.json"), "w") as f:
        json.dump({
            "placeholder": False, "asof": asof,
            "universe_count": len(universe),
            "window": "6-1 month",
            "ranked": ranked[:TOP_N],
        }, f, separators=(",", ":"))

    log(f"Done. benchmark={len(bench)} bars, priced={len(prices)}, ranked={len(ranked)}")


if __name__ == "__main__":
    main()
