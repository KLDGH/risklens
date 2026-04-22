# RiskLens

A quantitative market risk dashboard that computes daily Value-at-Risk (VaR) and Expected Shortfall (ES) across 12 major assets using five statistical models. Displayed in a dark quant-terminal UI with an S&P 500 historical risk chart dating back to 1990.

Live at: **https://kldgh.github.io/risklens/**

---

## What it shows

- **1% VaR** — on a bad day (worst 1% historically), how much do you lose on a $100 position?
- **Expected Shortfall (ES/CVaR)** — given it *is* a bad day, what's the average loss?
- **Tail index (α)** — how fat are the tails? Lower = more extreme events possible.
- **Risk Gauge** — where does today's volatility sit relative to the past 2 years? 85% means risk is elevated, not just high in absolute terms.
- **S&P 500 historical chart** — 35+ years of daily VaR and annual returns with major crisis labels (Dot-com, GFC, COVID, etc.).

---

## Data sources

### Where the data comes from

All price data is fetched via **[yfinance](https://github.com/ranaroussi/yfinance)**, a Python library that wraps the Yahoo Finance public API.

| Question | Answer |
|----------|--------|
| **Cost** | Free — no API key required |
| **Data type** | Daily adjusted closing prices (OHLCV, auto-adjusted for splits/dividends) |
| **Frequency** | Daily bars only — not intraday |
| **Lag** | Typically 1 business day. Running after ~4 PM ET gives you the previous day's close; running before market close gives you the prior day. |
| **History fetched** | 10 years for the 12 portfolio tickers; maximum available (back to 1927) for the S&P 500 historical chart |
| **Reliability** | Yahoo Finance is a best-effort free service. Occasional data gaps, ticker changes, or API outages can cause missing data. The backend forward-fills short gaps (e.g. BTC weekends vs equity holidays). |

### Tickers covered

| Ticker | Name | Notes |
|--------|------|-------|
| SPY | S&P 500 ETF | SPDR, most liquid US equity ETF |
| QQQ | Nasdaq 100 ETF | Invesco, large-cap tech |
| GLD | Gold ETF | SPDR, physically-backed |
| TLT | 20yr Treasury ETF | iShares, long-duration rates exposure |
| EEM | Emerging Markets ETF | iShares, broad EM equities |
| BTC-USD | Bitcoin / USD | Spot price, trades 24/7 |
| IWM | Russell 2000 ETF | iShares, US small-cap equities |
| HYG | High Yield Bond ETF | iShares, US junk bonds |
| LQD | Investment Grade Bond ETF | iShares, US IG corporate bonds |
| XLF | Financial Sector ETF | SPDR, US financials |
| VNQ | Real Estate ETF | Vanguard, US REITs |
| CGUS | Capital Group Core Equity ETF | Active ETF, launched Feb 2022 — shorter history |

### How data is fetched

Each ticker is downloaded individually (not in bulk) to avoid SQLite lock issues in yfinance's local cache. Gaps are forward-filled — this means Bitcoin's Sunday prices carry forward into Monday if equity markets are closed, keeping the return series aligned. The S&P 500 index (`^GSPC`) is fetched separately with the full available history for the historical chart.

---

## Risk models

Five models are computed for every ticker on every run, using a **1,000-day rolling window** of log returns.

| Model | Description |
|-------|-------------|
| **HS** (Historical Simulation) | Empirical 1st percentile of the last 1,000 daily returns. No assumptions — just ranks actual history. Honest but slow to react to volatility regime changes. |
| **EWMA** | Exponentially Weighted Moving Average volatility (λ=0.94), assuming normally distributed returns. Weights recent days heavily — reacts quickly to volatility spikes. The industry standard for daily risk desks. |
| **GARCH(1,1)** | Models volatility as a mean-reverting process. Captures volatility clustering: bad days tend to follow bad days. Fit via the `arch` library. |
| **tGARCH** (GJR-GARCH) | Extends GARCH to treat negative shocks differently from positive ones. Empirically, bad news raises volatility more than equally-sized good news. More realistic for equity markets. |
| **EVT** (Extreme Value Theory) | Fits a Generalised Pareto Distribution to the tail of losses only. Most rigorous for rare, extreme events. Often materially higher than the others — that gap is a signal, not noise. |

All figures are **dollar loss on a $100 portfolio** at **1% confidence** (worst 1% of days).

**Risk Gauge** — percentile rank of today's EWMA VaR vs the trailing 2-year daily history of EWMA VaR for that ticker. 0% = historically calm, 100% = historically extreme for that asset.

**Tail index (α)** — Hill estimator on the return series. Equities typically sit around 3–4; values below 3 indicate meaningfully fatter tails than standard normal models assume.

---

## Setup

### Requirements

- Python 3.10+
- Node.js 18+

### 1. Clone the repo

```bash
git clone https://github.com/kldgh/risklens.git
cd risklens
```

### 2. Python environment

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.lock.txt
```

> `requirements.lock.txt` has exact version pins for reproducibility.
> Use `requirements.txt` if you want loose bounds.

### 3. Generate risk data

```bash
python backend/run.py
```

Fetches ~10 years of price data and writes `frontend/public/data/risk_output.json`.
Takes ~30–60 seconds. Requires an internet connection.

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## GitHub Codespaces

Click **Code → Codespaces → Create codespace** on the repo page. The devcontainer installs all dependencies and auto-runs the backend + dev server on startup. The port 5173 preview opens automatically in your browser.

---

## Deployment (GitHub Pages)

The repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that:

1. Runs `python backend/run.py` to fetch fresh data
2. Builds the React frontend with `npm run build`
3. Deploys the static output to GitHub Pages

**Triggers:** every push to `main`, plus a daily cron at 6:30 AM UTC on weekdays (after US pre-market).

To enable: go to **Settings → Pages → Source → GitHub Actions** in your repo.

---

## Output schema

`frontend/public/data/risk_output.json` (generated on each run, not committed):

```json
{
  "generated_at": "2026-04-22T06:30:00Z",
  "assets": [
    {
      "ticker": "SPY",
      "name": "S&P 500 ETF",
      "last_price": 704.08,
      "last_return_pct": -0.66,
      "var_hs": 2.08,
      "es_hs": 2.71,
      "var_ewma": 1.91,
      "es_ewma": 2.40,
      "var_garch": 1.72,
      "es_garch": 2.16,
      "var_tgarch": 1.89,
      "es_tgarch": 2.38,
      "var_evt": 3.41,
      "es_evt": 4.92,
      "tail_index": 3.21,
      "mean_var": 2.20,
      "risk_level": 0.59
    }
  ],
  "sp500_history": [
    {
      "year": 2023,
      "min_var": 1.12,
      "max_var": 2.84,
      "annual_return_pct": 24.2
    }
  ]
}
```

---

## Stack

- **Backend:** Python · yfinance · pandas · numpy · scipy · arch
- **Frontend:** React 18 · Vite · Recharts · plain CSS (no UI framework)
- **Hosting:** GitHub Pages via GitHub Actions
- **Data:** Yahoo Finance (free, via yfinance) · No API key required
