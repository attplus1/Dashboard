#!/usr/bin/env python3
"""Build/refresh data/universe.json with the full current ASX listing.

Primary source is the ASX company-directory file the asx.com.au site itself
uses (Markit Digital API), which returns a CSV of every listed entity. A
legacy ASX CSV and the existing seed are used as fallbacks so the file is
never left empty or shrunk.

Run standalone, or automatically before fetch_data.py in the GitHub Action.
"""

import csv
import io
import json
import os
import sys
from datetime import datetime

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIVERSE = os.path.join(ROOT, "data", "universe.json")

# The ASX website loads its company directory from this Markit Digital endpoint.
# The access token is the public one embedded in asx.com.au.
ASX_DIRECTORY = (
    "https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file"
    "?access_token=83ff96335c2d45a094df02a206a39ff4"
)
LEGACY_CSV = "https://www.asx.com.au/asx/research/ASXListedCompanies.csv"
HEADERS = {"User-Agent": "Mozilla/5.0 (dashboard universe builder)"}

# Skip non-ordinary lines (warrants/options etc.) by code length; ASX ordinary
# codes are 3 letters (a few 3-char alphanumerics like MI6/G50 are kept).
def _valid_code(code):
    return 2 <= len(code) <= 4 and code.isalnum()


def _parse_csv(text):
    """Return {code: name} from an ASX-style CSV with a code/company header."""
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines)
                  if "code" in ln.lower() and "company" in ln.lower()), 0)
    reader = csv.reader(io.StringIO("\n".join(lines[start:])))
    header = next(reader, None)
    if not header:
        return {}
    code_i = next((i for i, h in enumerate(header) if "code" in h.lower()), 1)
    name_i = next((i for i, h in enumerate(header) if "company" in h.lower()
                   or "name" in h.lower()), 0)
    out = {}
    for row in reader:
        if len(row) <= max(code_i, name_i):
            continue
        code = row[code_i].strip().upper()
        name = row[name_i].strip().strip('"')
        if _valid_code(code) and name:
            out[code] = name
    return out


def fetch_directory():
    for url in (ASX_DIRECTORY, LEGACY_CSV):
        try:
            r = requests.get(url, headers=HEADERS, timeout=40)
            if r.status_code != 200 or not r.text.strip():
                print(f"  {url} -> HTTP {r.status_code}", file=sys.stderr)
                continue
            parsed = _parse_csv(r.text)
            if len(parsed) > 100:        # sanity: a real full list is large
                print(f"  fetched {len(parsed)} codes from {url.split('//')[1][:40]}…",
                      file=sys.stderr)
                return parsed
        except requests.RequestException as e:
            print(f"  source failed {url}: {e}", file=sys.stderr)
    return {}


def main():
    with open(UNIVERSE) as f:
        doc = json.load(f)
    seed = {c["ticker"]: c["name"] for c in doc["constituents"]}

    fetched = fetch_directory()
    if fetched:
        # Full directory wins; keep any seed names it is missing.
        merged = dict(fetched)
        for t, n in seed.items():
            merged.setdefault(t, n)
        source = "asx directory"
    else:
        merged = seed
        source = "seed only (directory unreachable)"

    doc["constituents"] = [{"ticker": t, "name": n} for t, n in sorted(merged.items())]
    doc["count"] = len(merged)
    doc["updated"] = datetime.utcnow().strftime("%Y-%m-%d")
    doc["source"] = source
    with open(UNIVERSE, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"Universe now {len(merged)} tickers ({source}).")


if __name__ == "__main__":
    main()
