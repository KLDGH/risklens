# RiskLens

A daily-refresh investment risk dashboard: an **exception-first summary** across portfolios, **ex-ante active risk and beta** from an 8-factor model beside their realized values, **five VaR/ES models** with formal backtests, and **historical + hypothetical stress tests**, across a configurable book of diversified portfolios, allocation and target-date funds, and active Capital Group funds modeled through their disclosed holdings.

**Live:** https://kldgh.github.io/risklens/ · **Version:** v2.0.0 ([changelog](./CHANGELOG.md))

A reference implementation of techniques real risk desks use, with the methodology in the open rather than behind a vendor license. Every figure is reproducible from public data and readable code.

## What it answers

Five tabs, each answering a distinct question:

| Tab | Question | Key components |
|---|---|---|
| **Summary** | Which portfolios need attention, and why? | one row per portfolio, worst first · predicted active risk against a tolerance band per mandate type (placeholder bands) · beta · largest stress shortfall vs benchmark · VaR model check · exceptions list with owner and next step · click through to any portfolio |
| **Positioning** | Where is this portfolio positioned, right now? | ex-ante active risk and beta from an 8-factor model (FF5 + momentum + orthogonalized duration and credit, EWMA covariance), each beside its realized value · growth ↔ value from a growth-minus-value spread · active factor exposures with t-stats · AI and semis exposure · factor risk decomposition |
| **Extreme Risk** | How bad can a day, a month, or a year get, and do the models hold up? | 5 VaR/ES models (HS, EWMA, GARCH-t, GJR-t, EVT) · monthly (21-day) empirical downside · 1-year parametric VaR · component VaR per holding · risk trajectory · out-of-sample backtests (Kupiec + Christoffersen) |
| **Stress** | How would the portfolio handle past crises and plausible shocks? | historical crisis replays on today's holdings · hypothetical scenarios with adjustable analyst assumptions |
| **Market Context** | What regime is the market in, and is diversification still working? | S&P 500 risk + VIX, 1928 → today · cross-asset rolling correlation · multi-window stock-bond correlation (20d / 60d / 252d, four bond proxies) · intraday SPY×TLT correlation with a QMLE noise correction |

Performance & Skill and Sector Spotlight views are built but hidden from the navigation; see `TABS` in `frontend/src/App.jsx`.

## Portfolios

Switch via the toggle on the Positioning, Extreme Risk, and Stress tabs:

- **Sample 60/40+** — illustrative ~60/40 diversified book, 14 holdings across equities, bonds, gold, and crypto (the default)
- **iShares Core 60/40 (AOR)** — multi-asset allocation ETF, modeled through its underlying holdings
- **Vanguard Target 2055 (VFFVX)** — passive target-date fund, modeled via its four underlying index funds (VTI / VXUS / BND / BNDX)
- **American Funds Target 2035 (AAFTX)** — active target-date fund, modeled via its underlying funds
- **CGGO Look-Through** — Capital Group Global Growth ETF, modeled as a basket of its top disclosed holdings and validated against the fund's own NAV
- **ICA Look-Through** — The Investment Company of America (AIVSX), modeled from its quarterly portfolio disclosure
- **New Perspective Look-Through** — New Perspective Fund (R-6, RNPGX), same quarterly-disclosure treatment

A Davis Select Worldwide (DWLD) look-through is configured but hidden (`visible: false` in `backend/config/portfolios.yaml`).

For the fund modes the pipeline models each underlying individually — per-name VaR/ES, component VaR, and factor loadings — and runs the same models on the fund's own NAV. Headline positioning figures use the fund's NAV; the top-25 basket, which is more concentrated than the fund, is shown for contrast. The share of fund weight modeled and the disclosure date are stated in the app.

## Methodology in 60 seconds

**Positioning.** Predicted (ex-ante) active risk and beta come from an 8-factor model: the five Fama-French factors, momentum, and orthogonalized duration (TLT) and credit (HYG − TLT) factors so stock/bond funds are modeled too. The factor covariance is EWMA-weighted with a ~6-month half-life. Active risk regresses the portfolio-minus-benchmark return directly on the factors, so every active loading carries a t-stat. Growth ↔ value is the active loading on a growth-minus-value spread (IWF − IWD), called only when significant. Each predicted figure sits beside its realized value over the same year.

**Loss models.** The five VaR/ES columns compute on a rolling 1,000-day window, expressed as the **daily 1% loss as a percent of the position**.

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
- **Holdings** for the active-fund books: sponsor disclosures in `ext-data/` (daily xlsx for Capital Group ETFs; the quarterly Word portfolio export for Capital Group mutual funds, which lists names without tickers and uses a curated per-fund ticker map), preprocessed into `backend/data/active_fund_holdings.json` by `python backend/preprocess_holdings.py`. Mutual funds use the lowest-fee (R-6) share class for NAV.
- **Refresh:** a scheduled GitHub Actions workflow runs every weekday at 06:30 UTC, regenerates the data, and redeploys. The "Data as of" timestamp in the header shows what is loaded — roughly one business day of latency.

## Quick start

```bash
git clone https://github.com/kldgh/risklens.git
cd risklens
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.lock.txt
python backend/run.py                       # ~5–7 min (GARCH backtests cached)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

`run.py` writes a single static `risk_output.json` that the frontend reads. Set `RISKLENS_FULL_BACKTEST=1` to recompute the GARCH backtests from scratch (slow); do this once after adding a portfolio, since the cache is keyed by portfolio. GitHub Codespaces works too — the devcontainer installs and runs both on startup.

## Documentation

In [`docs/`](./docs):

- [Executive summary](./docs/EXECUTIVE_SUMMARY.md) — what it is and who it's for, in two pages
- [FAQ](./docs/FAQ.md) — common questions, tab by tab
- [Architecture](./docs/ARCHITECTURE.md) — architecture, JSON contract, and full methodology
- [Legal](./docs/LEGAL.md) — disclaimers

At the root:

- [`CHANGELOG.md`](./CHANGELOG.md) — versions, and what each version number means

## Stack

- **Backend:** Python 3.10+ · pandas · numpy · scipy · arch · yfinance · openpyxl · PyYAML
- **Frontend:** React 18 · Vite · Recharts · plain CSS
- **Hosting:** GitHub Pages via GitHub Actions. No server, no database — the entire risk state is one versionable JSON artifact.

## License

MIT. Free to use, modify, and distribute.

## Disclaimer

Personal project. Not affiliated with, endorsed by, or supported by any employer, financial institution, or data vendor. Nothing here is investment, financial, trading, or risk-management advice, and the figures should not drive investment, hedging, or position-sizing decisions. The models are publicly-known statistical methods applied to public price data; the output is illustrative and methodological, not actionable. Past performance and historical risk metrics are not indicative of future results.

**Full legal disclaimers** — data-source caveats, third-party trademark references, limitation of liability, privacy, and jurisdiction — are in [`docs/LEGAL.md`](./docs/LEGAL.md). The MIT license covers the code; LEGAL.md covers the output and methodology presentation.
