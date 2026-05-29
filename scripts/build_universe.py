#!/usr/bin/env python3
"""Expand data/universe.json toward the full ASX market.

Best-effort: tries the ASX company-directory CSV, merges any results into the
existing seed (never shrinks it), and writes back. Safe to run in Actions
before fetch_data.py; if the source is unavailable the seed is left intact.
"""

import csv
import io
import json
import os
import sys

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIVERSE = os.path.join(ROOT, "data", "universe.json")

# Public ASX listed-companies directory (format changes occasionally).
SOURCES = [
    "https://www.asx.com.au/asx/research/ASXListedCompanies.csv",
]
HEADERS = {"User-Agent": "Mozilla/5.0 (dashboard universe builder)"}


def fetch_listed():
    for url in SOURCES:
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            if r.status_code != 200:
                continue
            text = r.text
            # File has a couple of preamble lines before the header row.
            lines = text.splitlines()
            start = next((i for i, ln in enumerate(lines)
                          if "ASX code" in ln or "ASX Code" in ln), 0)
            reader = csv.reader(io.StringIO("\n".join(lines[start:])))
            header = next(reader, None)
            if not header:
                continue
            code_i = next((i for i, h in enumerate(header) if "code" in h.lower()), 1)
            name_i = next((i for i, h in enumerate(header) if "company" in h.lower()), 0)
            out = {}
            for row in reader:
                if len(row) > max(code_i, name_i) and row[code_i].strip():
                    out[row[code_i].strip().upper()] = row[name_i].strip()
            if out:
                return out
        except requests.RequestException as e:
            print(f"  source failed {url}: {e}", file=sys.stderr)
    return {}


def main():
    with open(UNIVERSE) as f:
        doc = json.load(f)
    seed = {c["ticker"]: c["name"] for c in doc["constituents"]}

    fetched = fetch_listed()
    seed.update({k: v for k, v in fetched.items() if k not in seed})

    doc["constituents"] = [{"ticker": t, "name": n} for t, n in sorted(seed.items())]
    with open(UNIVERSE, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"Universe now {len(seed)} tickers "
          f"({'expanded from directory' if fetched else 'seed only'}).")


if __name__ == "__main__":
    main()
