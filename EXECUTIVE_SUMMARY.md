# RiskLens — Executive Summary

## What it is

RiskLens is a daily-refresh quantitative risk dashboard built as a transparent reference implementation of techniques real risk desks use, with the methodology in the open instead of behind a vendor license. The current build covers five distinct portfolios — a synthetic 60/30/8/2 diversified mix, two target-date funds (Vanguard and American Funds 2055), and two active equity ETFs (CGGO and DWLD) modeled as look-through baskets of their disclosed holdings.

Across each portfolio it computes five VaR/ES models, formal out-of-sample backtests, component-VaR risk attribution, historical and hypothetical stress tests, and (for individual sector ETFs) a Fama-French six-factor regression and a univariate anomaly-detector view. Refresh is daily via a scheduled GitHub Actions workflow.

**Live at https://kldgh.github.io/risklens/**

## Three tabs, three questions

**Portfolio Risk** — *How much risk am I carrying right now, where is it concentrated, would the models survive a real stress event?* Five VaR/ES models per holding (HS, EWMA, GARCH-t, GJR-t, EVT), risk-percentile gauge, component VaR per holding, formal Kupiec + Christoffersen backtesting with directional verdicts, historical (replay-actual-prices) and hypothetical (analyst-shock-vector) stress tests.

**Market Context** — *What regime is the market in right now? Is diversification still working?* S&P 500 risk and VIX back to 1928, cross-asset rolling correlation, multi-window stock-bond correlation across four bond proxies, intraday SPY×TLT correlation with QMLE noise-correction toggle.

**Anomaly Detector** — *Is a sector ETF behaving unusually, and what's driving its risk?* Per-ticker risk profile with same VaR/ES models, Fama-French 5 + Momentum factor regression (open-data substitute for Barra-style attribution), three stacked detectors on the same timeline: standardized z-score, Page CUSUM mean-shift, GARCH-residual outliers.

## Methodology in 60 seconds

All VaR/ES is daily 1% loss on a $100 position, computed on a rolling 1,000-day window:

- **HS** — empirical 1st percentile of actual returns. No distributional assumption.
- **EWMA** — Gaussian, λ=0.94 RiskMetrics standard. Fast reaction, known fat-tail miss.
- **GARCH-t** — GARCH(1,1) with **Student-t innovations** (not Normal). Captures heavy tails.
- **GJR-t** — GARCH-t plus leverage term (negative shocks raise vol more than positive).
- **EVT** — Generalized Pareto fit to the loss tail directly.

The five-model spread is itself the signal. Tight = models agree, fat tails not a concern. Wide (usually EVT pulling high) = the asset has tail behavior the other models miss. The "Range" and "Consensus" columns surface this.

**Backtesting** runs Kupiec UC and Christoffersen IC tests on 504-day out-of-sample windows for all five models. The verdict column tells you *how* a model is mis-calibrated, not just whether it fails — CALIBRATED, UNDER-EST, OVER-CONSERV, CLUSTERED.

**Factor attribution** uses Fama-French 5 + Momentum daily factors (Ken French Data Library, public). For each sector ETF: regression on 252-day excess returns, per-factor loadings with t-stats and significance, R² and variance decomposition (factor vol vs idiosyncratic vol). Same output shape as Barra-style attribution; less granular but legitimate and auditable.

## What it's good for

- **Position sizing reference** — sanity-checking whether your typical position fits the asset's risk profile.
- **Regime awareness** — multiple holdings at 90%+ risk-percentile simultaneously is a macro stress signal building.
- **Pre-event diligence** — looking at the stress-test card for the next event you're worried about and seeing how the book is exposed.
- **Model-disagreement diagnostic** — when EVT diverges from EWMA, you're being told the tail is fatter than the normal assumption — time to weight EVT estimates more heavily.
- **Sector deep-dive** — anomaly detector reveals which sectors are factor-driven (XLK, 93% R²) vs which are doing their own thing (XLU, 30% R²).

## What it's not

Not a signal generator, not a trading system, not a vendor replacement. It's a monitoring + research tool that surfaces *how* risk is changing and *which model assumptions are at risk of breaking*. The honest framing: **VaR tells you how bad things are, not how bad they're about to get.**

## Position vs Bloomberg PORT / MSCI Barra / FactSet

| | RiskLens | Vendor systems |
|---|---|---|
| VaR / ES models | 5 (HS, EWMA, GARCH-t, GJR-t, EVT) | Same families, often with proprietary refinements |
| Backtesting | Kupiec + Christoffersen on all 5 | Same plus regulatory-format reports |
| Component VaR | EWMA-covariance based | Same plus factor-decomposed components |
| Factor model | Fama-French 5 + Momentum (open data) | Barra-class (industry-within-country, daily refit factor loadings) |
| Asset universe | Liquid public ETFs + mutual funds | Thousands of asset classes incl. private credit, derivatives, structured |
| Stress tests | Historical + hypothetical | Same plus regulator-prescribed scenario libraries |
| Methodology transparency | Fully open in source | Vendor-licensed black box |
| Data sources | Yahoo Finance + Ken French | Bloomberg / Refinitiv / proprietary |
| Operational maturity | Personal-project, no SLA | Enterprise-grade with audit + compliance |

The deliberate trade: methodology fully exposed, source fully auditable, every metric attributable back to a peer-reviewed reference. The cost: smaller asset universe, single-source data dependency, no enterprise reliability.

## Bottom line

RiskLens is a working multi-model risk monitor that goes deeper than most demo dashboards (formal backtesting, look-through baskets for active ETFs, factor attribution, anomaly detection) while keeping the methodology fully open. It's complementary to vendor risk systems — same conceptual output for what's implemented, methodologically transparent in a way licensed products aren't, deliberately scoped to liquid public assets. Best used as a research tool, a teaching reference, or as the inspection layer for a methodology a vendor system handles in production.
