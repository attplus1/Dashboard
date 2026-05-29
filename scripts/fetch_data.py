#!/usr/bin/env python3
"""Daily ASX market-data pipeline for the trading dashboard.

Runs in GitHub Actions (full network), scheduled around the Australian market
open so the freshest fully-settled data — the PREVIOUS trading day's closes —
is published for viewers throughout the day. Writes three JSON files the static
dashboard reads:

    data/benchmark.json   ASX 200 (^AXJO) daily closes  -> equity-curve overlay
    data/prices.json      latest close per ticker        -> open-position valuation
    data/momentum.json    Jegadeesh-Titman 6-1 ranking   -> screener cards

PRIMARY source: Stooq's BULK daily archive (one download covers the whole
market, so there is no per-symbol rate limit — essential for scanning the full
ASX universe of ~2,000 names). If the bulk archive can't be retrieved, the
pipeline FALLS BACK to per-symbol Stooq requests over the seed universe (kept
small enough to stay within Stooq's per-IP daily quota). yfinance is the final
fallback for the benchmark.
"""

import csv
import io
import json
import os
import sys
import time
import zipfile
from datetime import datetime

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UNIVERSE = os.path.join(DATA, "universe.json")

HEADERS = {"User-Agent": "Mozilla/5.0 (dashboard data pipeline)"}
STOOQ_URL = "https://stooq.com/q/d/l/?s={sym}&i=d"

# Stooq bulk daily archives (tried in order). The world archive is large but is
# the reliable, well-known artifact; we read only the Australian (.au) members.
BULK_URLS = [
    "https://static.stooq.com/db/h/d_au_txt.zip",      # AU-only daily (if present)
    "https://stooq.com/db/h/?b=d_au_txt",              # AU-only daily (alt)
    "https://static.stooq.com/db/h/d_world_txt.zip",   # world daily (fallback)
]

# Jegadeesh-Titman 6-1 (approx. trading days): skip the most recent month (~21),
# measure the return over the prior 6 months (~126 days).
SKIP_DAYS = 21
LOOKBACK_DAYS = 126
MIN_HISTORY = SKIP_DAYS + LOOKBACK_DAYS + 5   # need this many bars to rank
CANDLES_OUT = 260                             # bars kept per card (MA200 + headroom)
KEEP_HISTORY = CANDLES_OUT + 210              # trim parsed history to this many bars
TOP_N = 50
FALLBACK_THROTTLE = 0.15                      # per-symbol pacing if bulk fails


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# Bulk archive (primary)
# --------------------------------------------------------------------------- #
def download_bulk():
    """Download the first reachable bulk archive; return raw zip bytes or None."""
    for url in BULK_URLS:
        try:
            log(f"Bulk: trying {url}")
            r = requests.get(url, headers=HEADERS, timeout=180, stream=True)
            if r.status_code != 200:
                log(f"  HTTP {r.status_code}")
                continue
            content = r.content
            if len(content) < 10_000 or content[:2] != b"PK":
                log(f"  not a zip ({len(content)} bytes)")
                continue
            log(f"  got {len(content)//1_000_000} MB")
            return content
        except requests.RequestException as e:
            log(f"  error: {e}")
    return None


def _parse_stooq_txt(text):
    """Parse a Stooq ASCII daily file -> list of {date,o,h,l,c} ascending."""
    out = []
    for line in text.splitlines():
        if not line or line[0] in "<#" or line.upper().startswith("TICKER"):
            continue
        f = line.split(",")
        if len(f) < 8:
            continue
        try:
            d = f[2].strip()                       # YYYYMMDD
            date = f"{d[0:4]}-{d[4:6]}-{d[6:8]}"
            out.append({"date": date, "open": float(f[4]), "high": float(f[5]),
                        "low": float(f[6]), "close": float(f[7])})
        except (ValueError, IndexError):
            continue
    out.sort(key=lambda c: c["date"])
    return out


def parse_bulk(zip_bytes):
    """Extract Australian (.au) symbols from the bulk archive.

    Returns {TICKER: [candles...]} for files with enough history to be useful.
    """
    result = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".au.txt")]
        log(f"Bulk: {len(names)} Australian files in archive")
        for n in names:
            ticker = os.path.basename(n)[:-len(".au.txt")].upper()
            if not ticker:
                continue
            try:
                candles = _parse_stooq_txt(zf.read(n).decode("utf-8", "ignore"))
            except Exception:
                continue
            if len(candles) >= MIN_HISTORY:
                result[ticker] = candles[-KEEP_HISTORY:]
    return result


# --------------------------------------------------------------------------- #
# Per-symbol (fallback) + benchmark
# --------------------------------------------------------------------------- #
def fetch_stooq(symbol):
    url = STOOQ_URL.format(sym=symbol.lower())
    try:
        r = requests.get(url, headers=HEADERS, timeout=25)
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


def fetch_yf(yahoo_symbol):
    try:
        import yfinance as yf
        df = yf.download(yahoo_symbol, period="3y", interval="1d",
                         progress=False, auto_adjust=False)
        if df is None or df.empty:
            return []
        return [{"date": idx.strftime("%Y-%m-%d"), "open": float(r["Open"]),
                 "high": float(r["High"]), "low": float(r["Low"]),
                 "close": float(r["Close"])} for idx, r in df.iterrows()]
    except Exception as e:
        log(f"  yfinance failed {yahoo_symbol}: {e}")
        return []


def fallback_per_symbol():
    """Per-symbol scan over the seed universe (small enough for Stooq's quota)."""
    with open(UNIVERSE) as f:
        universe = json.load(f)["constituents"]
    log(f"Fallback: per-symbol over {len(universe)} seed tickers")
    result = {}
    for item in universe:
        t = item["ticker"]
        candles = fetch_stooq(f"{t}.au")
        time.sleep(FALLBACK_THROTTLE)
        if len(candles) >= MIN_HISTORY:
            result[t] = candles[-KEEP_HISTORY:]
    return result


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
        names = {c["ticker"]: c.get("name", c["ticker"])
                 for c in json.load(f)["constituents"]}

    zip_bytes = download_bulk()
    if zip_bytes:
        history = parse_bulk(zip_bytes)
        source = "stooq bulk archive"
    else:
        history = {}
    if not history:                       # bulk unavailable/empty -> graceful fallback
        history = fallback_per_symbol()
        source = "stooq per-symbol (fallback)"
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

    bench = fetch_stooq("^axjo") or fetch_yf("^AXJO")
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
