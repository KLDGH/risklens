# RiskLens

A daily-refresh market-risk dashboard that runs **five VaR/ES models, a monthly empirical downside, Fama-French factor attribution, anomaly detection,** and **historical + hypothetical stress tests** across a configurable book — diversified portfolios, allocation and target-date funds, or active ETFs (with full look-through to their disclosed holdings).

**Live:** https://kldgh.github.io/risklens/ · **Version:** v1.0.0

A reference implementation of techniques real risk desks use, with the methodology in the open rather than behind a vendor license. Every figure is reproducible from public data and readable code.

## What it answers

Three tabs, each answering a distinct question:

| Tab | Question | Key components |
|---|---|---|
| **Portfolio Risk** | How much risk am I carrying, where is it concentrated, and would the models survive a real stress event? | 5 VaR/ES models (HS, EWMA, GARCH-t, GJR-t, EVT) · monthly (21-day) empirical downside · 1-year parametric VaR · risk-percentile gauge · component VaR per holding · policy-benchmark comparison row · out-of-sample backtests (Kupiec + Christoffersen) · historical + hypothetical stress tests |
| **Market Context** | What regime is the market in, and is diversification still working? | S&P 500 risk + VIX, 1928 → today · cross-asset rolling correlation · multi-window stock-bond correlation (20d / 60d / 252d, four bond proxies) · intraday SPY×TLT correlation with a QMLE noise correction |
| **Sector Spotlight** | Is a sector ETF behaving unusually, and what is driving its risk? | risk profile per ETF · Fama-French 5 + momentum regression with bootstrap CIs · stacked detectors: z-score, Page CUSUM, GARCH-residual outliers |

## Portfolios

Switch via the toggle on the Portfolio Risk tab:

- **Hypothetical Portfolio** — illustrative ~60/40 diversified book, 14 holdings across equities, bonds, gold, and crypto (the default)
- **iShares Core 60/40 (AOR)** — multi-asset allocation ETF, modeled through its underlying holdings
- **Vanguard Target 2055 (VFFVX)** — passive target-date fund, modeled via its four underlying index funds (VTI / VXUS / BND / BNDX)
- **American Funds Target 2035 (AAFTX)** — active target-date fund, modeled via its underlying funds
- **CGGO Look-Through** — Capital Group Global Growth ETF, modeled as a basket of its top disclosed holdings and validated against the fund's own NAV
- **DWLD Look-Through** — Davis Select Worldwide ETF, same look-through treatment

For the fund modes the pipeline models each underlying individually — per-name VaR/ES, component VaR, and factor loadings — not just the fund's aggregate NAV. The share of fund weight modeled is stated in the app, and the synthetic basket is pinned next to the fund's actual NAV so the gap is visible rather than assumed away.

## Methodology in 60 seconds

The five VaR/ES columns compute on a rolling 1,000-day window, expressed as the **daily 1% loss as a percent of the position**.

| Model | What it does | When it dominates |
|---|---|---|
| **HS** (Historical Simulation) | Empirical 1st percentile of actual returns. No distributional assumption. | A non-parametric baseline immune to model misspecification |
| **EWMA** | Gaussian VaR with λ=0.94 exponential decay (RiskMetrics). | Fast reaction to volatility regime changes; under-estimates fat tails |
| **GARCH-t** | GARCH(1,1) conditional vol with Student-t innovations. | Volatility clustering plus heavy tails; typically ~30–60% above EWMA at 99% |
| **GJR-t** | GARCH-t with an asymmetric (leverage) term. | Equity downside, where negative shocks raise vol more than positive |
| **EVT** | Generalized Pareto fit to the loss tail directly. | Genuine tail behavior; usually the highest, and that gap is information |

**The five-model spread is the signal.** Tight means the models agree; wide (usually EVT pulling high) means tail behavior the Gaussian models miss. The Range and Consensus columns surface it.

Two more horizons sit beside the daily numbers: a **monthly downside** — the empirical 5th percentile and worst of rolling 21-day returns, with no scaling assumption — and a **1-year parametric VaR** (Student-t, σ scaled by √252), kept collapsed by default since √t scaling assumes iid returns.

Each model is backtested over the book's **full available out-of-sample history** — up to ~2,000 trading days (~8 years, spanning COVID, 2022, and the 2025 tariff shock) for the flagship books — using a strict 1,000-day rolling lookback before each tested day. **Kupiec UC** (is the exception rate 1%?) and **Christoffersen IC** (are exceptions independent or clustered?) verdicts label which way a model is mis-calibrated, not just pass/fail.

## Configuration

Assumptions live in versioned YAML under `backend/config/`, not in code:

- `portfolios.yaml` — the books, their holdings and weights, display names, and benchmarks
- `scenarios.yaml` — historical stress windows and forward hypothetical shocks, expressed by asset class and sector
- `categories.yaml` — the security → asset-class → parent taxonomy that scenario shocks resolve through

Loaders validate these at build time (every security maps to a category, every book's holdings are covered), so a bad edit fails fast rather than silently mis-modeling.

## Data

- **Prices:** Yahoo Finance via [yfinance](https://github.com/ranaroussi/yfinance) — free, no API key, daily adjusted closes.
- **Factors:** Ken French Data Library, daily; fetched each run and cached for fallback.
- **Holdings** for the allocation and active-fund books: sponsor-disclosed files, preprocessed into `backend/data/active_fund_holdings.json` by `python backend/preprocess_holdings.py`.
- **Refresh:** a scheduled GitHub Actions workflow runs every weekday at 06:30 UTC, regenerates the data, and redeploys. The "Data as of" timestamp in the header shows what is loaded — roughly one business day of latency.

## Quick start

```bash
git clone https://github.com/kldgh/risklens.git
cd risklens
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.lock.txt
python backend/run.py                       # ~2–3 min (GARCH backtests cached)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

`run.py` writes a single static `risk_output.json` that the frontend reads. Set `RISKLENS_FULL_BACKTEST=1` to recompute the GARCH backtests from scratch (~15 min). GitHub Codespaces works too — the devcontainer installs and runs both on startup.

## Stack

- **Backend:** Python 3.10+ · pandas · numpy · scipy · arch · yfinance · openpyxl · PyYAML
- **Frontend:** React 18 · Vite · Recharts · plain CSS
- **Hosting:** GitHub Pages via GitHub Actions. No server, no database — the entire risk state is one versionable JSON artifact.

## License

MIT. Free to use, modify, and distribute.

## Disclaimer

Personal project. Not affiliated with, endorsed by, or supported by any employer, financial institution, or data vendor. Nothing here is investment, financial, trading, or risk-management advice, and the figures should not drive investment, hedging, or position-sizing decisions. The models are publicly-known statistical methods applied to public price data; the output is illustrative and methodological, not actionable. Past performance and historical risk metrics are not indicative of future results.

**Full legal disclaimers** — data-source caveats, third-party trademark references, limitation of liability, privacy, and jurisdiction — are in [`LEGAL.md`](./LEGAL.md). The MIT license covers the code; LEGAL.md covers the output and methodology presentation.
