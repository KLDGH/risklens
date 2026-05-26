# RiskLens — FAQ

Common questions from demos and reviews. Organized for a PM audience: what does it tell me, what does it not tell me, how does it compare to systems I already use.

---

## At a glance

**What is this, in one sentence?**
A transparent, daily-refresh risk dashboard that runs five VaR models, a Fama-French factor regression, anomaly detectors, and historical + hypothetical stress tests across a configurable book — with the full methodology in the open instead of behind a vendor license.

**What is it not?**
Not a signal generator, not a trading system, not a vendor replacement. It's a monitoring + research tool that surfaces *how* risk is changing and *which model assumptions are at risk of breaking*, not where prices are heading next.

**How do I use it day-to-day?**
- **Position sizing reference** — if BTC VaR is $12 on $100, a bad day costs 12% of notional. Sanity-check whether that fits your sizing.
- **Regime awareness** — multiple holdings at 90%+ risk-percentile simultaneously is a macro stress signal building.
- **Pre-event diligence** — before a known catalyst, look at the corresponding stress-test card to see how the book is exposed.
- **Model-disagreement diagnostic** — when EVT diverges sharply from EWMA, you're being told the tail is fatter than your normal-distribution intuition assumes. Time to weight EVT-style estimates more heavily.

**What would have helped historically?**
Mixed. Risk-percentile would have been elevated going into late 2007 and Feb 2020 — vol was building before the crashes. But VaR is procyclical: it spikes during the crash, not weeks ahead. The correlation chart and Anomaly Detector are the more genuinely leading indicators. The honest answer: VaR tells you *how bad things are*, not how bad they're about to get.

---

## Portfolio Risk tab

### The risk table

**Why five VaR columns?**
The disagreement *is* the signal. EWMA assumes normal innovations and reacts fast; GARCH-t adds heavy tails; EVT explicitly models the loss tail with a Generalized Pareto fit. When the spread is wide — usually EVT pulling high — the asset has fat-tail behavior the others miss. A single number hides this. The "Range" column makes the spread explicit.

**Why 1-day VaR?**
Convention, and it matches the liquidity assumption for liquid ETFs. Basel originally standardized on 10-day (scaling 1-day by √10) but the industry mostly works in 1-day and scales when needed. Multi-period VaR is a known gap in this build — see *What's missing* below.

**What does the VaR number actually mean?**
On the worst 1% of trading days historically, you'd lose *at least* this many dollars on a $100 position. SPY at 2.10 = a genuinely bad day costs about 2.1% of notional. Floor estimate, not ceiling.

**VaR vs ES — what's the difference?**
VaR = where the bad days start. ES (also called CVaR) = how bad on average once you're past that threshold. ES is always larger. Regulators now prefer ES (Basel III/IV) because it describes the *shape* of the tail, not just its starting point.

**Where do the Low / Elevated / High color thresholds come from?**
Pragmatic rules of thumb, not a regulatory standard. Calibrated for daily 1% VaR on liquid ETFs: diversified US equity ~1.5–2.5%, sectors 2–3%, individual stocks 3–5%, crypto 5%+. The **Risk gauge** (percentile rank vs the asset's own 2-year history) is the more rigorous metric on this page — it's self-calibrating per asset.

**What does the Risk gauge mean?**
The most actionable number in the table. Percentile rank of today's EWMA VaR vs the trailing 504 days of EWMA VaR for that specific asset. 85% = this asset is more volatile right now than it has been on 85% of recent days. Bitcoin at 5% VaR might be perfectly normal; SPY at 5% VaR would be extreme — the gauge accounts for this.

**What's the arrow next to the Risk gauge?**
5-day VaR trend. ↑ red = building; ↓ green = easing.

**What is α (tail index)?**
Hill estimator on the return series. Lower = fatter tails. Broad equity indices typically sit around 3–4. Individual names and crypto often come in at 2–3. Below 3 indicates meaningfully more tail risk than a normal-distribution model would price in.

**What is Comp VaR?**
Component VaR — each holding's contribution to portfolio daily VaR via the EWMA covariance matrix. Numbers sum to the portfolio's EWMA VaR exactly (by construction). Negative = the holding is a *hedge* in the current regime (TLT and GLD often show negative in equity-heavy books). This is the same decomposition risk teams use to decide what to trim, add, or hedge.

### Portfolio modes

**What does the toggle do?**
Swaps the entire risk snapshot between five different book definitions:

1. **Hypothetical** — illustrative 60/30/8/2 mix from 14 asset-class ETFs. The reference engine demo.
2. **Vanguard Target 2055 (VFFVX)** — passive TDF, modeled via its 4 broad index ETFs.
3. **American Funds Target 2055 (AAFTX)** — active TDF, modeled via 12 actively-managed mutual funds.
4. **CGGO Look-Through** — Capital Group Global Growth Equity ETF as a basket of its top-25 disclosed holdings.
5. **DWLD Look-Through** — Davis Select Worldwide ETF, same treatment.

When you toggle, the asset rows, weights, portfolio summary, scenarios, backtests, and risk trajectory all rebuild against the selected book.

**Why model active ETFs (CGGO/DWLD) via their holdings instead of just their NAV?**
NAV-based risk gives you one number per day. Look-through gives you per-name VaR, per-name component VaR, and a Fama-French factor decomposition that shows *why* the fund moves the way it does. The fund's own ETF appears as a final reference row in the table so you can compare basket-aggregate vs actual-NAV (the difference is the manager's discretionary trading effect plus expense ratio).

**The basket only models top-25 — what about the long tail?**
For CGGO the top 25 cover ~52% of fund weight; for DWLD ~83%. The coverage caveat is surfaced as a yellow callout on the Fund Holdings panel. Modeling the full ~100 (CGGO) or ~40 (DWLD) names would be possible but adds noisy international-listing fetches with limited marginal value — the top 25 capture the manager's actual concentrated bets.

**Why two TDFs at the same vintage?**
The cleanest passive-vs-active comparison in the industry. Same risk profile (~90/10 equity/bonds), very different construction. The interesting reveal is in the stress tests: topline P&L numbers similar, but the contribution bars tell different stories. Capital Group's growth fund (AGTHX) gets hit harder than VTI in the AI Bubble scenario because active growth concentrates in mega-cap tech.

### Model validation (backtesting)

**What is the panel showing?**
Out-of-sample backtests of all five VaR models. For each day in the last 504, the model gets only the prior 1,000 days to forecast that day's 1% VaR. Then we count exceptions (days the actual loss exceeded the forecast) and run two formal tests.

**Kupiec test:** does the actual exception rate match 1%? Null = rates equal. χ²(1).
**Christoffersen test:** do exceptions cluster? Null = exceptions independent. χ²(1).

**The four verdicts:**

| Verdict | Meaning |
|---|---|
| **CALIBRATED** | Both tests pass. Exception rate consistent with 1%, exceptions appear independent. |
| **UNDER-EST** | Exception rate significantly *above* 1%. Model is missing tails. Weight EVT-style estimates more heavily. |
| **OVER-CONSERV** | Exception rate significantly *below* 1%. Model too pessimistic. Safe failure mode but still calibration drift. |
| **CLUSTERED** | Rate may be fine but exceptions group. Time-varying vol the model isn't capturing. |

**What's the panel telling me, big picture?**
Each model has a *known* calibration drift in a specific direction. EWMA chronically under-estimates tails — that's why EVT exists. EVT chronically over-estimates — that's why HS exists. HS captures both but reacts slowly — that's why EWMA exists. The five-model approach is *justified by* their individually-knowable failure modes; the validation panel makes those drifts statistically visible instead of asking you to take them on faith.

### Stress tests

**Historical vs hypothetical?**
Historical (grey badge) replays actual price data — 100% data-driven, no assumptions. Hypothetical (amber badge) applies analyst-estimated shock vectors per asset. The visual distinction matters because historical numbers are reproducible facts; hypothetical numbers are explicit forward-looking judgments, not forecasts.

**How are the shock vectors estimated?**
By informed analyst judgment, looking at directional exposures. For a Taiwan invasion: semis hit hard (QQQ ~−22% from TSMC/NVDA exposure), Asian EM heavily exposed (EEM ~−22%), gold and Treasuries rally on flight to safety. Exact numbers are illustrative — *relative sensitivity across holdings* matters more than the absolute %s. The vectors live in `backend/risk_engine.py::HYPOTHETICAL_SCENARIOS` and are editable in one place.

**Why are some scenario cards missing assets?**
Some tickers didn't exist during all scenarios (BTC pre-2014, CGGO pre-2022). The engine excludes them and re-normalizes weights, with a "X% of portfolio weight covered" note on the card.

**Why does the 2022 rate shock look similar across portfolios?**
Because in 2022 there was no hedge. Stocks AND bonds both sold off. The 60/40 portfolio's traditional defense — bonds rallying when stocks fall — broke completely. The bond allocation didn't help any of the three portfolios. Taiwan and Recession scenarios show much bigger cross-mode differences because in those, the bond allocation matters.

**What's the "Probability outlook" section?**
Curated external probability sources, plus one live computation where the methodology is rock-solid (NY Fed yield-curve recession probability — Estrella-Trubin 2006 probit on the 10Y−3M spread, refreshed every run). For Taiwan / Iran / AI Bubble we deliberately don't synthesize a single number — we link to Polymarket, Metaculus, CSIS wargames, CBOE SKEW, Shiller CAPE. Showing "Taiwan invasion: 14%" with no source is vibes wearing the costume of quant.

---

## Market Context tab

**Why does this tab not respond to the portfolio toggle?**
By design. Market context is the same regardless of what you hold. The S&P 500 risk chart, the cross-asset correlation, and the intraday correlation are reference data — they answer "what regime is the market in," not "what does my book look like." Everything portfolio-specific lives on Tab 1.

**The S&P 500 chart shows three things — what are they?**
For each year back to 1928: the calmest day's risk (green), the most stressed day's risk (blue), and the annual return when negative (red). The VIX line (amber, right axis) overlays the market's own forward-looking fear gauge. The key reveal: blue bars spike *during* crises in real time, red bars only confirm the damage after.

**Why does VIX matter?**
VIX is forward-looking — it reflects what options traders are paying to hedge over the next 30 days. Our VaR models are backward-looking. When VIX spikes above our EWMA estimates, the market is pricing in more stress than recent realized history suggests. That divergence is the signal.

**Why is 2022 the correlation chart's peak and not the GFC?**
The most counterintuitive finding in the dataset. In the GFC, equities crashed but Treasuries and gold rallied — flight-to-safety kept average cross-asset correlation moderate. In 2022, the Fed's aggressive hiking cycle caused stocks AND bonds to sell off simultaneously — the 60/40 hedge broke. Correlation hit 0.70, the highest in the series. **The correlation-breakdown problem is most dangerous in inflation/rate shocks, not equity crashes.**

**Why a multi-window correlation chart?**
Same stock-bond question at three rolling-window lengths simultaneously: 20-day (fast), 60-day (medium), 252-day (slow). When the 20-day diverges sharply from the 252-day, you're seeing a recent regime change *before* longer-horizon measures register it. A "Recent intensification" callout fires when the gap exceeds 0.15. Four bond proxies are toggleable (AGG / TLT / IEF / LQD) because if the regime is real it should show across all four; if only one shows it, the signal is narrower than implied.

**Why intraday correlation rather than daily?**
Statistical power per unit time. A daily-data correlation chart is a smoothed 60-day rolling average — by the time it shifts decisively, the regime has been live for a month. Intraday gives many observations *per day*, so each daily intraday correlation value is statistically meaningful on its own. A run of consecutive same-sign days becomes a sharp regime-shift indicator: 22 consecutive positive days has roughly (0.5)²² ≈ 1-in-4-million odds under a null of zero true correlation. That's a categorical signal, not noise.

**What's the QMLE toggle on the intraday chart?**
A noise-robust correlation estimator (Aït-Sahalia, Fan & Xiu 2010 polarization on Xiu 2010 univariate QMLE). Standard realized correlation can be biased by bid-ask bounce and microstructure noise; QMLE explicitly models that noise as MA(1) and recovers the latent integrated correlation. For SPY/TLT at 5–15m bars the difference is small (~0.05) because both are highly liquid — the QMLE option is a "show your work" benchmark confirming the regime story is robust to estimator choice. It would matter more at 1-minute or for illiquid pairs.

---

## Anomaly Detector tab

**What's the elevator pitch for this tab?**
Pick a sector ETF, see four runs at "is this asset behaving unusually right now?" alongside its standalone risk profile and a Fama-French factor regression. Single-asset deep-dive, complementary to the portfolio view.

**Why these specific sector ETFs?**
11 SPDR sectors (XLF, XLE, XLK, XLV, XLU, XLY, XLP, XLI, XLB, XLRE, XLC) + KRE (regional banks, where SVB-style events show clearly), SMH (semis), IBB (biotech). All liquid, all clean for univariate analysis.

**What do the four anomaly detectors actually catch?**

| Detector | What it catches | Method |
|---|---|---|
| **Z-score** | Outsized single days vs the asset's recent neighborhood | Standardize each return against trailing 60-day mean/std. Flag \|z\| ≥ 3. |
| **Page CUSUM** | Sustained drifts that individual days don't reveal | Two-sided CUSUM on standardized returns. Flag when accumulated drift > 5σ. |
| **GARCH-residual** | Days the conditional vol model didn't anticipate | Fit GJR-t-GARCH, take standardized residuals. Flag \|z\| ≥ 3. |

The intuition: z-score catches single-day shocks. CUSUM catches creeping drift. GARCH residual catches surprises *after* accounting for the current vol regime — different from z-score in that it normalizes by the vol the model expected, not historical vol. A date hitting multiple detectors is a stronger signal than any single one firing.

**What does the Fama-French panel show?**
Each ETF's exposures to the six standard equity factors — Market, SMB (size), HML (value), RMW (profitability), CMA (investment), Momentum — estimated via 252-day OLS on excess returns. Plus R² (factor-explained variance share), idiosyncratic vol, and a statistically-tested alpha.

**Why Fama-French and not Barra?**
Barra is licensed (~$50–500k/year). Fama-French + Carhart momentum is the open-data, peer-reviewed, free alternative used as a baseline at most institutional quant shops. The output is conceptually the same as Barra-style attribution: factor loadings, factor-explained variance, idiosyncratic risk, alpha. Less sophisticated (no industry-within-country granularity, no proprietary covariance shrinkage), but legitimate and auditable. Data from the Ken French Data Library, fetched daily.

**What's interesting about the R² across sectors?**
The spread itself tells a story. XLK (Tech) is 93% factor-driven — almost no idiosyncratic risk. XLU (Utilities) is only 30% factor-driven — utilities march to their own (rates) drum. XLF and KRE both load heavily on Market + Value + Size (small-cap tilt in KRE), exactly as theory predicts for financials. Toggle through the tickers and you can read off each sector's exposure profile in 30 seconds.

---

## Limits and what's missing

**What's the honest comparison to Bloomberg PORT / MSCI Barra / FactSet?**
Methodology coverage is comparable for what's implemented (five VaR models with disagreement surfaced, EVT, formal backtesting, component VaR, historical + hypothetical scenarios, factor regression). The actual gaps:

1. **Factor model is FF-Carhart, not Barra-class.** No industry-within-country granularity, no proprietary covariance shrinkage, no daily refit of factor loadings, no factor-tilt risk model. Adequate for a sector ETF deep-dive; not what an institutional risk team would run as their daily attribution.
2. **Asset universe is liquid public ETFs and mutual funds.** No private credit, no derivatives, no structured products, no FX, no commodity futures with proper roll handling.
3. **Multi-period VaR is missing.** Everything is 1-day. A real fund needs 1-day + 10-day + 1-month for different liquidity and regulatory requirements.
4. **Single-data-source dependency.** All prices from Yahoo Finance via yfinance. No vendor data, no enterprise reliability guarantees, no audit trail.
5. **Operational risk surface is small.** Personal project. No SOC 2, no SLAs, no DR plan, no logging/alerting infrastructure.

What's deliberately on offer instead: full methodology transparency in the open, configurable portfolio definitions you can change yourself, every metric attributable back to a peer-reviewed reference.

**Does anyone actually build their own factor model, or do most firms use Barra?**
Most firms buy. Long-only asset managers, mutual funds, pensions, insurance — they license Barra, Axioma, or similar. Vendor models are good enough, regulator/auditor comfort is built in, and a ground-up build costs more than it's worth.

The exceptions are quant hedge funds (Renaissance, Citadel, DE Shaw, Two Sigma, AQR) where the factor model is part of the alpha, not just a risk tool. They treat it as IP. Some large managers (BlackRock with Aladdin) run internal + vendor side-by-side, vendor for compliance and internal for trading decisions.

For a typical long-only shop the realistic stack is vendor primary + internal research layered on top.

**What would make this production-grade?**
In rough priority order:
1. **Multi-period VaR** (1d / 10d / 1m) with proper handling of fat-tail time-scaling.
2. **Factor model upgrade** — at minimum, sector and country-region factors layered onto FF, ideally a daily-refit covariance matrix.
3. **Multi-source price data** with vendor failover (e.g., Tiingo or Polygon as backup to yfinance).
4. **Options-implied risk overlay** — IV term structure, put-call skew, risk-neutral density.
5. **Realized-kernel / multivariate noise-corrected intraday covariance** — extends the QMLE we already have on SPY×TLT to the full portfolio.

---

## Data and refresh

**Where does the price data come from?**
Yahoo Finance via the `yfinance` Python library. Free, no API key. Daily adjusted closes (splits/dividends baked in). About a one-business-day lag — if you check after 4pm ET you see the prior day's close.

**Is anything pulled from a paid data vendor?**
No. The only external fetches are raw closing prices (yfinance) and the Fama-French factors (Ken French Data Library, public). Every metric in the dashboard is computed locally on each run; methodology is in `backend/risk_engine.py` and `backend/factor_models.py`.

**How often does it refresh?**
A scheduled GitHub Actions workflow runs every weekday at 6:30 AM UTC and rebuilds the entire dashboard. The "Data as of" timestamp in the header shows the latest trading day represented. Can also be triggered manually from the GitHub Actions tab.

**What about holdings for the active-fund modes?**
Refresh on user cadence by dropping a new sponsor-disclosed xlsx/csv in `ext-data/` and re-running `python backend/preprocess_holdings.py`. Capital Group publishes CGGO holdings daily; Davis publishes DWLD daily. The dashboard reflects whatever's most recently committed.

---

## Technical

**Is the math from scratch?**
Yes for everything except the GARCH fitting (uses the `arch` Python library) and the OLS solve in the factor regression (numpy). Historical simulation, EWMA, EVT (Hill estimator + Generalized Pareto fit), risk-percentile gauge, exception counting, Kupiec/Christoffersen tests, scenario aggregation, component VaR via EWMA covariance, Page CUSUM, intraday QMLE polarization — all implemented directly in `backend/risk_engine.py` and `backend/factor_models.py`.

**Why are the GARCH backtests cached?**
504-day rolling refits of GARCH-t and GJR-t take seconds-to-minutes per portfolio. Daily refresh doesn't need to recompute them — backtest verdicts are a methodology check, not a current-state metric. They're cached in `backend/cache/garch_backtests.json` and regenerated on demand via `RISKLENS_FULL_BACKTEST=1 python backend/run.py`.

**Can I add my own portfolio?**
Yes — `backend/run.py` has a `PORTFOLIO_MODES` dict. Add a key with your tickers and weights, the pipeline runs everything against the new mode automatically. No frontend changes needed; the toggle picks it up.
