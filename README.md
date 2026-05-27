# RiskLens

A daily-refresh risk dashboard that runs **five VaR models, Fama-French factor attribution, anomaly detection,** and **historical + hypothetical stress tests** across a configurable book — diversified portfolios, target-date funds, or active ETFs (with full look-through to their disclosed holdings).

**Live:** https://kldgh.github.io/risklens/

Built as a transparent reference implementation of techniques real risk desks use, with the methodology in the open instead of behind a vendor license.

## What it answers

Three tabs, each answering a distinct question:

| Tab | Question | Key components |
|---|---|---|
| **Portfolio Risk** | *How much risk am I carrying right now, where is it concentrated, and would the models survive a real stress event?* | 5 VaR models (HS, EWMA, GARCH-t, GJR-t, EVT) · Risk-percentile gauge · Component VaR per holding · Out-of-sample backtests (Kupiec + Christoffersen) · Historical + hypothetical stress tests |
| **Market Context** | *What regime is the market in right now? Is diversification still working?* | S&P 500 risk + VIX, 1928→today · Cross-asset rolling correlation · Multi-window stock-bond correlation (20d / 60d / 252d, 4 bond proxies) · Intraday SPY×TLT correlation with QMLE noise-correction |
| **Anomaly Detector** | *Is a sector ETF behaving unusually, and what's driving its risk?* | Risk profile per ETF · Fama-French 5 + Momentum factor regression (open-data substitute for Barra) · Stacked detectors: z-score, Page CUSUM, GARCH-residual outliers |

## Portfolios supported

Switch via the top toggle on Tab 1:

- **Hypothetical** — illustrative diversified mix (60/30/8/2) built from 14 asset-class ETFs
- **Vanguard Target 2055 (VFFVX)** — passive TDF wrapper, modeled via its 4 underlying ETFs (VTI/VXUS/BND/BNDX)
- **American Funds Target 2055 (AAFTX)** — active TDF wrapper, modeled via 12 underlying mutual funds
- **CGGO Look-Through** — Capital Group Global Growth ETF, modeled as a look-through basket of its top-25 disclosed holdings
- **DWLD Look-Through** — Davis Select Worldwide ETF, same look-through treatment

For the active-fund modes, holdings are read from sponsor-disclosed xlsx/csv files refreshed quarterly. The risk pipeline runs on each underlying individually (not just the fund's NAV) so you see per-name VaR/ES/component-VaR with factor loadings, not just an aggregate.

## Methodology in 60 seconds

All five VaR/ES columns compute on a rolling 1,000-day window, expressed as **daily 1% loss on a $100 position**.

| Model | What it does | When it dominates |
|---|---|---|
| **HS** (Historical Simulation) | Empirical 1st percentile of actual returns. No distributional assumption. | When you want a non-parametric baseline immune to model misspecification |
| **EWMA** | Gaussian VaR with λ=0.94 exponential decay. The RiskMetrics industry standard. | Fast reaction to volatility regime changes. Known to under-estimate fat tails. |
| **GARCH-t** | GARCH(1,1) conditional vol with Student-t innovations. | Volatility clustering + heavy tails. Generally ~30–60% higher than EWMA at 99%. |
| **GJR-t** | GARCH-t + asymmetric (leverage) term. Negative shocks raise vol more than positive. | Equity markets, where downside volatility persists longer than upside. |
| **EVT** | Generalized Pareto fit to the loss tail directly. | Genuine tail behavior. Usually materially higher than the others — that gap *is* a signal. |

**The five-model spread is itself the signal.** Tight = models agree, fat-tails aren't a concern. Wide (usually EVT pulling high) = the asset has tail behavior the other models miss. The "Range" and "Consensus" columns surface this explicitly.

Backtested every run via **Kupiec UC** (exception-rate matches 1%?) and **Christoffersen IC** (exceptions independent or clustered?) tests on 504-day out-of-sample windows. Verdicts label *which way* a model is mis-calibrated, not just whether it passes.

## Data

- **Source:** Yahoo Finance via [yfinance](https://github.com/ranaroussi/yfinance) — free, no API key, daily adjusted closes.
- **Refresh:** scheduled GitHub Actions workflow runs every weekday at 6:30 AM UTC, after the prior US session has closed and reconciled.
- **Latency:** roughly one business day. The "Data as of" timestamp in the header shows what's actually loaded.
- **Holdings data** for active funds: sponsor-disclosed xlsx/csv files in `ext-data/`, preprocessed into a JSON the pipeline reads. Update by dropping a new file in and re-running `python backend/preprocess_holdings.py`.
- **Fama-French factors:** Ken French Data Library, daily. Fetched fresh each run, cached locally for fallback.

## Quick start

```bash
git clone https://github.com/kldgh/risklens.git
cd risklens
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.lock.txt
python backend/run.py                      # ~60s — fetches + computes everything
cd frontend && npm install && npm run dev  # http://localhost:5173
```

Or use **GitHub Codespaces** — the devcontainer auto-installs everything and runs the backend + frontend on startup.

## Stack

Backend: Python 3.10+ · pandas · numpy · scipy · arch · yfinance · openpyxl
Frontend: React 18 · Vite · Recharts · plain CSS
Hosting: GitHub Pages via GitHub Actions

## License

MIT. Free to use, modify, and distribute. Attribution back to this repo appreciated but not required beyond what the license stipulates.

## Disclaimer

Personal project. Not affiliated with, endorsed by, or supported by any employer, financial institution, or data vendor. Nothing here is investment, financial, trading, or risk-management advice. The figures shown should not drive investment, hedging, or position-sizing decisions. The models are publicly-known statistical methods applied to public price data — output is illustrative and methodological, not actionable.

Past performance and historical risk metrics are not indicative of future results.

**Full legal disclaimers** — including data-source caveats, third-party trademark references, limitation of liability, privacy, and jurisdiction — are in [`LEGAL.md`](./LEGAL.md). The MIT license covers the software code; LEGAL.md covers the output and methodology presentation.
