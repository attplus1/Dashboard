# Trading Dashboard

A static, GitHub Pages–hosted dashboard for **ASX trading performance review** and a
**Jegadeesh–Titman momentum screener**. The UI is plain HTML/CSS/JS; daily market data
is fetched by a scheduled GitHub Action (Python + Stooq) and committed as JSON the page reads.

```
 GitHub Actions (Python + Stooq)  ──writes──▶  data/*.json
                                                   │
 Static site (HTML/CSS/JS on Pages) ──reads──▶  renders both tabs
```

## Features

**Performance Review**
- Import a broker statement (`.csv` / `.xlsx`) — trades are reconstructed into round-trips
  (entries matched to exits by order reference; stop-loss exits matched FIFO per ticker).
- Date-range slider scoping every metric and chart.
- Equity curve with the **ASX 200** benchmark rebased onto the same axis.
- KPIs: total P&L, win rate, win:loss, avg win/loss/trade, profit factor, max drawdown,
  Sharpe ratio, information ratio, avg holding period (win/loss/all), **total commissions**.
- Realised P&L bar chart per ticker, outcome and holding-period charts.
- **Open positions** table with live unrealised P&L, stop distance, days held and commission.
- `$` ⇄ `%` toggle across P&L displays.

**Momentum Screener**
- Ranks the ASX universe by the J&T **6–1** formation return (prior 6 months, skipping the
  most recent month).
- Top names shown as candlestick cards with 50/200-day moving averages.

## Data pipeline

| File | Produced by | Used for |
|------|-------------|----------|
| `data/benchmark.json` | `scripts/fetch_data.py` | ASX 200 equity overlay |
| `data/prices.json`    | `scripts/fetch_data.py` | open-position valuation |
| `data/momentum.json`  | `scripts/fetch_data.py` | screener ranking + candles |
| `data/universe.json`  | `scripts/build_universe.py` | full ASX listing to scan (auto-refreshed) |

The universe is rebuilt from the **ASX company directory** at the start of every data run,
so the screener always scans the current full market without manual maintenance.

The committed JSON ships as **placeholder data** (`"placeholder": true`) so the site renders
before the first run; the dashboard flags it. Run the workflow to replace it with live data.

## Setup

1. **Enable Pages**: Settings → Pages → Source = **GitHub Actions**. `pages.yml` deploys on
   push to `main`.
2. **First data run**: Actions → *Update market data* → *Run workflow* (also runs ~07:30 UTC
   on weekdays). Optionally run `scripts/build_universe.py` first to expand the universe.
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
- Stooq is the primary source (ASX `.au` suffix); yfinance (`.AX`) is a fallback.
