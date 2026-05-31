# Trading Dashboard

A static, GitHub Pages–hosted dashboard for **ASX trading performance review** and a
**Jegadeesh–Titman momentum screener**. The UI is plain HTML/CSS/JS; daily market data
is fetched by a scheduled GitHub Action (Python + yfinance) and committed as JSON the page reads.

```
 GitHub Actions (Python + yfinance)  ──writes──▶  data/*.json
                                                     │
 Static site (HTML/CSS/JS on Pages) ──reads──▶  renders both tabs
```

## Features

**Overview (performance review)**
- Import a broker statement (`.csv` / `.xlsx`) by button or drag-and-drop — trades are
  reconstructed into round-trips (entries matched to exits by order reference; stop-loss
  exits matched FIFO per ticker). Parsed entirely in the browser; the last upload is cached
  in `localStorage` and restored on the next visit.
- Date-range slider scoping every metric and chart, and a `$` ⇄ `%` (P&L / return) toggle.
- Account-equity curve with the **ASX 200** benchmark rebased onto the same axis.
- KPI cards: Net P&L (with gross / commission / funding), trade activity (totals + averages),
  risk-adjusted ratios (Sharpe, Sortino, Calmar, information ratio), profit factor, max
  drawdown, and most-profitable entry day / hour.
- Charts: realised P&L per ticker, P&L by entry weekday and by entry hour, win/loss split,
  holding period, and a returns distribution with a kernel-density curve.
- Clicking any trade / open position / top trade opens a candlestick popup with entry and
  exit markers (per-ticker price files fetched lazily and cached per browser).
- **Open positions** table with live unrealised P&L, stop distance, days held and commission.

**Momentum Screener**
- Ranks the ASX universe by the J&T **6–1** formation return (prior 6 months, skipping the
  most recent month). The universe can be narrowed to the top 200 / top 500 by market cap.
- Top names shown as candlestick cards with 50/200-day moving averages and a full-history
  expand view.

## Data pipeline

| File | Produced by | Used for |
|------|-------------|----------|
| `data/benchmark.json` | `scripts/fetch_data.py` | ASX 200 equity overlay |
| `data/prices.json`    | `scripts/fetch_data.py` | open-position valuation |
| `data/momentum.json`  | `scripts/fetch_data.py` | screener ranking + candles (per universe tier) |
| `data/marketcap.json` | `scripts/fetch_data.py` | market caps for the top-200 / top-500 tiers |
| `data/universe.json`  | `scripts/build_universe.py` | full ASX listing to scan (auto-refreshed) |
| `data/candles/*.json` | `scripts/build_candles.py` | per-ticker OHLC for trade popups (built at deploy time) |

The universe is rebuilt from the **ASX company directory** at the start of every data run,
so the screener always scans the current full market without manual maintenance.

### How market data is fetched

`fetch_data.py` keeps a **per-ticker price history under `data/history/`** (from 2020). A new
ticker is **backfilled** once; after that each run fetches only the **last month** and appends
new bars — so daily pulls from yfinance are tiny and unlikely to be rate-limited. Data comes
from **yfinance** (Yahoo) using **batch requests** (many tickers per call), so the whole ASX
universe is a handful of requests, not one-per-symbol.

Each ticker is fetched at most once per UTC day. The workflow runs **every 3 hours**, so if a
run is throttled and only updates some tickers, **later runs catch up the stragglers** until all
are current (`momentum.json` carries a `complete` flag and a running `universe_count`). Every run
recomputes the slim JSON the dashboard reads, so the site always shows best-available data. The
bulky `data/history/` store is excluded from the Pages deploy.

The committed JSON ships as **placeholder data** (`"placeholder": true`) so the site renders
before the first run; the dashboard flags it. Run the workflow to replace it with live data.

## Setup

1. **Enable Pages**: Settings → Pages → Source = **GitHub Actions**. `pages.yml` deploys on
   push to `main`.
2. **First data run**: Actions → *Update market data* → *Run workflow* (also runs daily at
   ~00:30 UTC ≈ ASX open).
3. Open the published URL. Use **Import trades** to load your own statement (parsed entirely
   in the browser — nothing is uploaded).

## Local preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
A server is required (the page `fetch()`es `data/`); opening `index.html` via `file://` won't load data.

## Notes & assumptions

- Realised P&L is read from the statement's `AMOUNT` column; it is **gross**, with commissions
  tracked separately.
- Per-trade return % = P&L ÷ notional entry value (entry price × shares) — no leverage/margin.
- Sharpe uses an annual risk-free rate set in `js/config.js` (`RISK_FREE_ANNUAL`); the daily
  return series is sampled on benchmark trading dates.
- yfinance (`.AX` suffix) is the primary source for all market data.
