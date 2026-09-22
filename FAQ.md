# RiskLens — FAQ

Common questions, organized as: what it tells you, what it doesn't, how it compares to existing systems.

> **Quick legal note**: nothing in this FAQ is investment advice. The dashboard is an open-source educational project; figures shown are produced by publicly-known statistical methods on public data and should not drive investment, hedging, or position-sizing decisions. Full disclaimers in [`LEGAL.md`](./LEGAL.md).

---

## At a glance

**What is this, in one sentence?**
A daily-refresh investment risk dashboard that flags which portfolios are out of bounds, shows where each is positioned against its benchmark, runs five VaR models with formal backtests, and replays historical and hypothetical stress scenarios, with the methodology in the open.

**What is it not?**
Not a signal generator, not a trading system, not a vendor replacement. It's a monitoring and research tool that surfaces how risk is changing and which model assumptions may break, not where prices are heading.

**How do I use it day-to-day?**
- **Start on Summary** — see which portfolios are flagged and why, then click a row to drill in.
- **Mandate check** — on Positioning, is predicted active risk and beta what you'd expect for this kind of fund?
- **Position sizing reference** — if BTC's daily VaR is 12%, a bad day costs 12% of the position. Sanity-check whether that fits your sizing.
- **Regime awareness** — multiple holdings at 90%+ risk-percentile simultaneously indicates building macro stress.
- **Pre-event diligence** — before a known catalyst, look at the corresponding stress-test card to see how the book is exposed.
- **Model-disagreement diagnostic** — when EVT diverges sharply from EWMA, the tail is fatter than a normal-distribution model assumes. Weight EVT-style estimates more heavily.

**What would have helped historically?**
Mixed. Risk-percentile would have been elevated going into late 2007 and Feb 2020 — vol was building before the crashes. But VaR is procyclical: it spikes during the crash, not weeks ahead. The correlation charts and the predicted-vs-realized gap on Positioning are the more leading reads. VaR tells you how bad things are, not how bad they're about to get.

---

## Summary tab

**What is it for?**
A one-screen read across every portfolio for someone who doesn't need the factor tables. Each row shows predicted active risk against a tolerance band for that type of mandate, beta, the largest stress shortfall against the benchmark, and whether the VaR models pass their backtests. Rows are sorted worst first; click one to open that portfolio.

**Why stress vs benchmark rather than the worst crisis loss?**
An absolute crisis loss mostly restates market exposure: nearly every equity fund lost 30–40% in 2008, so "it lost a lot in the GFC" says little. The gap to the benchmark in the same scenario shows where a fund behaves worse than its mandate implies. The column takes the largest gap across all nine scenarios, historical and forward-looking. Historical crises use the fund's own price where it existed for the whole window; otherwise the modeled holdings (marked "holdings"), which for look-through funds overstate the gap. It's context, not a flag.

**How is the status light set?**
Each portfolio collects a flag for: active risk outside its band; beta more than 0.25 away from 1; high AI and semis concentration; VaR models failing (every model under-predicts) or on watch (misses cluster); or thin data (under a year of shared history, the factor model explaining under 70% of variance, or no backtest). No flags = green, one = amber, two or more = red.

**Where do the tolerance bands come from?**
They are placeholders: 0.5–3% for index-based allocation funds, 2–6% for active US large-cap, 3–8% for active global equity. Real bands would be agreed between the independent investment risk function and each portfolio manager. They are constants at the top of `frontend/src/components/SummaryPanel.jsx`.

**What are the owners and actions in the exceptions list?**
Suggested defaults (investment risk, model validation, data), so each breach reads as something with a next step rather than just a red number.

## Positioning tab

**What's the difference between ex-ante and realized?**
Ex-ante (predicted) figures come from a factor risk model, the way commercial risk systems report them. Realized figures are what actually happened over the same year, the way fund fact sheets report them. RiskLens shows both. Predicted running above realized means risk has been rising recently.

**Why don't these match the numbers on a fund's fact sheet?**
Fact sheets publish trailing 3- or 5-year figures from monthly returns. RiskLens uses the last year of daily returns. Different window and frequency, so expect differences; direction and rough size should agree.

**What model produces the predicted numbers?**
Eight factors: the five Fama-French equity factors, momentum, and two macro factors for duration and credit so stock/bond funds are modeled too. The factor covariance weights recent months more heavily (about a six-month half-life). Active risk comes from regressing the portfolio-minus-benchmark return directly on the factors. Full detail in `TECH_REVIEW.md` §5.1.

**Why is the look-through fund's headline different from its basket?**
The basket is the fund's top 25 holdings re-normalized to 100%, which is far more concentrated than the fund. CGGO's basket predicts ~20% active risk; the fund itself runs ~10%. The headline uses the fund's own daily price; the basket number is shown for contrast, and the factor table describes the basket.

**How is growth ↔ value measured?**
By regressing the fund's active return on a growth-minus-value index spread (Russell 1000 Growth minus Value), with market moves stripped out. A tilt is only called when it is statistically significant and at least ±0.05 (roughly a 5% net growth-over-value position). The Fama-French value factor alone misreads modern growth funds as neutral, because mega-cap growth shows up as profitability and momentum.

**What are the dimmed rows in the factor table?**
Active loadings that aren't statistically distinguishable from zero (|t| < 2). They shouldn't be read as positions.

**Why is there a second beta for some portfolios?**
When the benchmark is a stock/bond blend, beta to that blend and beta to equities are different questions. The second line is the same model beta measured against ACWI.

**What does model capture mean?**
How much of the portfolio's realized variance the model reproduces. Near 100% means the eight factors describe the book well; below ~70% means it holds bets the model can't see (industry or country concentration), so read the numbers as directional.

---

## Extreme Risk and Stress tabs

### The risk table

**Why five VaR columns?**
The spread across models is itself informative. EWMA assumes normal innovations and reacts fast; GARCH-t adds heavy tails; EVT explicitly models the loss tail with a Generalized Pareto fit. When the spread is wide — usually EVT pulling high — the asset has fat-tail behavior the others miss. The "Range" column shows the spread.

**Why 1-day VaR?**
Convention, and it matches the liquidity assumption for liquid ETFs. Basel originally standardized on 10-day (scaling 1-day by √10) but the industry mostly works in 1-day and scales when needed. Multi-period VaR is a known gap in this build — see *What's missing* below.

**What does the VaR number actually mean?**
On the worst 1% of trading days, you'd lose *at least* this percentage of the position. SPY at 2.10% = a genuinely bad day costs about 2.1%. Floor estimate, not ceiling.

**VaR vs ES — what's the difference?**
VaR = where the bad days start. ES (also called CVaR) = how bad on average once you're past that threshold. ES is always larger. Regulators now prefer ES (Basel III/IV) because it describes the *shape* of the tail, not just its starting point.

**Where do the Low / Elevated / High color thresholds come from?**
Pragmatic rules of thumb, not a regulatory standard. Calibrated for daily 1% VaR on liquid ETFs: diversified US equity ~1.5–2.5%, sectors 2–3%, individual stocks 3–5%, crypto 5%+. The **Risk gauge** (percentile rank vs the asset's own 2-year history) is self-calibrating per asset.

**What does the Risk gauge mean?**
Percentile rank of today's EWMA VaR vs the trailing 504 days of EWMA VaR for that specific asset. 85% = this asset is more volatile right now than it has been on 85% of recent days. Bitcoin at 5% VaR might be perfectly normal; SPY at 5% VaR would be extreme — the gauge accounts for this.

**What's the arrow next to the Risk gauge?**
5-day VaR trend. ↑ red = building; ↓ green = easing.

**What is α (tail index)?**
Hill estimator on the return series. Lower = fatter tails. Broad equity indices typically sit around 3–4. Individual names and crypto often come in at 2–3. Below 3 indicates meaningfully more tail risk than a normal-distribution model would price in.

**What is Comp VaR?**
Component VaR — each holding's contribution to portfolio daily VaR via the EWMA covariance matrix. Numbers sum to the portfolio's EWMA VaR exactly (by construction). Negative = the holding is a *hedge* in the current regime (TLT and GLD often show negative in equity-heavy books). This decomposition shows which holdings drive portfolio VaR and which offset it.

### Portfolio modes

**What does the toggle do?**
Swaps the book behind the Positioning, Extreme Risk, and Stress tabs. Seven are visible:

1. **Sample 60/40+** — illustrative 60/30/8/2 mix from 14 asset-class ETFs. The reference engine demo.
2. **iShares Core 60/40 (AOR)** — multi-asset allocation ETF, modeled through its underlying holdings.
3. **Vanguard Target 2055 (VFFVX)** — passive target-date fund, modeled via its 4 broad index funds.
4. **American Funds Target 2035 (AAFTX)** — active target-date fund, modeled via its underlying funds.
5. **CGGO Look-Through** — Capital Group Global Growth Equity ETF as a basket of its top-25 disclosed holdings.
6. **ICA Look-Through** — The Investment Company of America (AIVSX), top 25 from its quarterly portfolio disclosure.
7. **New Perspective Look-Through** — New Perspective Fund (R-6, RNPGX), same quarterly-disclosure treatment.

A Davis Select Worldwide (DWLD) look-through is configured but hidden. When you toggle, the asset rows, weights, positioning, scenarios, backtests, and risk trajectory all rebuild against the selected book. The Summary tab reads all of them at once.

**Why model active funds via their holdings instead of just their NAV?**
NAV-based risk gives you one number per day. Look-through gives per-name VaR, per-name component VaR, and a factor decomposition of the fund's return drivers. The fund's own NAV appears as a final reference row so you can compare basket vs actual fund. The Positioning headline uses the fund's NAV; the basket is shown for contrast.

**The basket only models top-25 — what about the long tail?**
The top 25 cover ~52% of CGGO, ~64% of ICA, and ~46% of New Perspective. Re-normalized to 100%, the basket is materially more concentrated than the fund, so its active risk runs well above the fund's (CGGO basket ~20% vs fund ~10%; New Perspective ~13% vs ~4%). That's why the headline figures use the fund's own NAV. The coverage share is stated on the Fund Holdings panel.

**Which share class is used for mutual funds?**
The lowest-fee class (R-6 for New Perspective). Holdings are identical across share classes and risk is effectively identical; classes differ only in fees, which would otherwise show up as apparent underperformance against the benchmark.

**Why two TDFs at the same vintage?**
A passive-vs-active comparison at the same vintage. Same risk profile (~90/10 equity/bonds), different construction. In the stress tests, topline P&L is similar but the contribution bars differ. Capital Group's growth fund (AGTHX) gets hit harder than VTI in the AI Bubble scenario because active growth concentrates in mega-cap tech.

### Model validation (backtesting)

**What is the panel showing?**
Out-of-sample backtests of all five VaR models, over each portfolio's full available out-of-sample window (every trading day after the initial 1,000-day lookback, bounded by the youngest holding's inception — so the flagship books span ~8 years and several crises, while data-light funds get a shorter window). For each day the model gets only the prior 1,000 days to forecast that day's 1% VaR. Then we count exceptions (days the actual loss exceeded the forecast) and run two formal tests.

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
Each model has a *known* calibration drift in a specific direction. EWMA chronically under-estimates tails — that's why EVT exists. EVT chronically over-estimates — that's why HS exists. HS captures both but reacts slowly — that's why EWMA exists. The five-model approach is justified by their individually-knowable failure modes; the validation panel makes those drifts statistically visible.

### Stress tests

**Historical vs hypothetical?**
Historical (grey badge) replays actual price data — 100% data-driven, no assumptions. Hypothetical (amber badge) applies analyst-set shocks by asset class, region, and sector. Historical numbers are reproducible; hypothetical numbers are forward-looking judgments, not forecasts.

**How are the shock vectors estimated?**
By informed analyst judgment, looking at directional exposures. For a Taiwan invasion: semis hit hard (QQQ ~−22% from TSMC/NVDA exposure), Asian EM heavily exposed (EEM ~−22%), gold and Treasuries rally on flight to safety. Exact numbers are illustrative — *relative sensitivity across holdings* matters more than the absolute %s. Shocks are set per category in `backend/config/scenarios.yaml` and reach each holding through the taxonomy in `categories.yaml`.

**What do the sliders on the scenario cards do?**
Each slider scales the hand-set shock for one group of holdings (tech and semis, US equities, international developed, EM, rates and credit, gold and commodities, crypto) and the card's P&L recomputes. It's a way to test your own assumptions, not a factor model; the card says so.

**Why are some scenario cards missing assets?**
Some tickers didn't exist during all scenarios (BTC pre-2014, CGGO pre-2022, Tesla and Meta pre-2008). Funds use configured long-history proxies where possible; otherwise the engine excludes them and re-normalizes weights, with a "X% of portfolio weight covered" note on the card.

**Why does the 2022 rate shock look similar across portfolios?**
Because in 2022 there was no hedge. Stocks AND bonds both sold off. The 60/40 portfolio's traditional defense — bonds rallying when stocks fall — broke completely. The bond allocation didn't help any of the balanced portfolios. Taiwan and Recession scenarios show much bigger cross-mode differences because in those, the bond allocation matters.

**What's the "Probability outlook" section?**
Curated external probability sources, plus one live computation where the methodology is rock-solid (NY Fed yield-curve recession probability — Estrella-Trubin 2006 probit on the 10Y−3M spread, refreshed every run). For Taiwan / Iran / AI Bubble we don't synthesize a single number — we link to Polymarket, Metaculus, CSIS wargames, CBOE SKEW, Shiller CAPE. A single sourceless probability would be unsupported.

---

## Market Context tab

**Why does this tab not respond to the portfolio toggle?**
By design. Market context is the same regardless of what you hold. The S&P 500 risk chart, the cross-asset correlation, and the intraday correlation are reference data — they answer "what regime is the market in," not "what does my book look like." Everything portfolio-specific lives on the Summary, Positioning, Extreme Risk, and Stress tabs.

**The S&P 500 chart shows three things — what are they?**
For each year back to 1928: the calmest day's risk (green), the most stressed day's risk (blue), and the annual return when negative (red). The VIX line (amber, right axis) overlays the market's own forward-looking fear gauge. The key reveal: blue bars spike *during* crises in real time, red bars only confirm the damage after.

**Why does VIX matter?**
VIX is forward-looking — it reflects what options traders are paying to hedge over the next 30 days. Our VaR models are backward-looking. When VIX spikes above our EWMA estimates, the market is pricing in more stress than recent realized history suggests. That divergence is the signal.

**Why is 2022 the correlation chart's peak and not the GFC?**
In the GFC, equities crashed but Treasuries and gold rallied, keeping average cross-asset correlation moderate. In 2022, the Fed's aggressive hiking cycle caused stocks AND bonds to sell off simultaneously — the 60/40 hedge broke. Correlation hit 0.70, the highest in the series. **The correlation-breakdown problem is most dangerous in inflation/rate shocks, not equity crashes.**

**Why a multi-window correlation chart?**
Same stock-bond question at three rolling-window lengths simultaneously: 20-day (fast), 60-day (medium), 252-day (slow). When the 20-day diverges sharply from the 252-day, a recent regime change is showing before longer-horizon measures register it. A "Recent intensification" callout fires when the gap exceeds 0.15. Four bond proxies are toggleable (AGG / TLT / IEF / LQD) because if the regime is real it should show across all four; if only one shows it, the signal is narrower than implied.

**Why intraday correlation rather than daily?**
Statistical power per unit time. A daily-data correlation chart is a smoothed 60-day rolling average — by the time it shifts decisively, the regime has been live for a month. Intraday gives many observations *per day*, so each daily intraday correlation value is statistically meaningful on its own. A run of consecutive same-sign days becomes a sharp regime-shift indicator: 22 consecutive positive days has roughly (0.5)²² ≈ 1-in-4-million odds under a null of zero true correlation.

**What's the QMLE toggle on the intraday chart?**
A noise-robust correlation estimator (Aït-Sahalia, Fan & Xiu 2010 polarization on Xiu 2010 univariate QMLE). Standard realized correlation can be biased by bid-ask bounce and microstructure noise; QMLE explicitly models that noise as MA(1) and recovers the latent integrated correlation. For SPY/TLT at 5–15m bars the difference is small (~0.05) because both are highly liquid — the QMLE option is a benchmark confirming the result is robust to estimator choice. It would matter more at 1-minute or for illiquid pairs.

---

## Sector Spotlight (built, hidden from navigation)

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
The spread itself tells a story. XLK (Tech) is 93% factor-driven — almost no idiosyncratic risk. XLU (Utilities) is only 30% factor-driven — utilities march to their own (rates) drum. XLF and KRE both load heavily on Market + Value + Size (small-cap tilt in KRE), exactly as theory predicts for financials. Toggle through the tickers to read each sector's exposure profile.

---

## Limits and what's missing

**How does this compare to Bloomberg PORT / MSCI Barra / FactSet?**
Methodology coverage is comparable for what's implemented (five VaR models with disagreement surfaced, EVT, formal backtesting, component VaR, historical + hypothetical scenarios, ex-ante active risk and beta, factor attribution). The actual gaps:

1. **The ex-ante model has 8 factors, not a commercial model's 40+.** No industry, country, or currency factors, no covariance shrinkage, and exposures come from a trailing regression rather than security characteristics. Concentrated industry or country bets land in residual risk, so predicted active risk runs low for concentrated books.
2. **Asset universe is liquid public ETFs and mutual funds.** No private credit, no derivatives, no structured products, no FX, no commodity futures with proper roll handling.
3. **Multi-period VaR is approximate.** Backtests are 1-day. The monthly figure is an empirical 21-day distribution and the 1-year figure uses √t scaling; neither is a rigorous multi-period model.
4. **Single-data-source dependency.** All prices from Yahoo Finance via yfinance. No vendor data, no enterprise reliability guarantees, no audit trail.
5. **Operational risk surface is small.** Personal project. No SOC 2, no SLAs, no DR plan, no logging/alerting infrastructure.

What it offers instead: methodology in the open, configurable portfolio definitions, every metric attributable to a peer-reviewed reference.

**Does anyone actually build their own factor model, or do most firms use Barra?**
Most firms buy. Long-only asset managers, mutual funds, pensions, insurance — they license Barra, Axioma, or similar. Vendor models are good enough, regulator/auditor comfort is built in, and a ground-up build costs more than it's worth.

The exceptions are quant hedge funds (Renaissance, Citadel, DE Shaw, Two Sigma, AQR) where the factor model is part of the alpha, not just a risk tool. They treat it as IP. Some large managers (BlackRock with Aladdin) run internal + vendor side-by-side, vendor for compliance and internal for trading decisions.

For a typical long-only shop the realistic stack is vendor primary + internal research layered on top.

**What would make this production-grade?**
In rough priority order:
1. **Multi-period VaR** (1d / 10d / 1m) with proper handling of fat-tail time-scaling.
2. **Factor model upgrade** — industry and country factors layered onto the 8-factor model, and full-holdings look-through from SEC N-PORT filings instead of the top 25.
3. **Multi-source price data** with vendor failover (e.g., Tiingo or Polygon as backup to yfinance).
4. **Options-implied risk overlay** — IV term structure, put-call skew, risk-neutral density.
5. **Realized-kernel / multivariate noise-corrected intraday covariance** — extends the QMLE we already have on SPY×TLT to the full portfolio.

---

## Data and refresh

**Where does the price data come from?**
Yahoo Finance via the `yfinance` Python library. Free, no API key. Daily adjusted closes (splits/dividends baked in). About a one-business-day lag — if you check after 4pm ET you see the prior day's close.

**Is anything pulled from a paid data vendor?**
No. The only external inputs are raw closing prices (yfinance), the Fama-French factors (Ken French Data Library, public), and sponsors' public holdings disclosures. Every metric in the dashboard is computed locally on each run; methodology is in `backend/risk_engine.py` and `backend/factor_models.py`.

**How often does it refresh?**
A scheduled GitHub Actions workflow runs every weekday at 6:30 AM UTC and rebuilds the entire dashboard. The "Data as of" timestamp in the header shows the latest trading day represented. Can also be triggered manually from the GitHub Actions tab.

**What about holdings for the active-fund modes?**
Refresh on user cadence by dropping a new sponsor disclosure in `ext-data/` and re-running `python backend/preprocess_holdings.py`. ETFs (CGGO) publish holdings daily as a spreadsheet; Capital Group mutual funds (ICA, New Perspective) publish quarterly with a lag, exported from the fund page as a Word document. Mutual-fund disclosures list names without tickers, so each needs a curated name-to-ticker map in `preprocess_holdings.py`. The dashboard reflects whatever's most recently committed.

---

## Technical

**Is the math from scratch?**
Yes for everything except the GARCH fitting (uses the `arch` Python library) and the OLS solves (numpy). Historical simulation, EWMA, EVT (Hill estimator + Generalized Pareto fit), risk-percentile gauge, exception counting, Kupiec/Christoffersen tests, scenario aggregation, component VaR via EWMA covariance, Page CUSUM, intraday QMLE polarization, and the ex-ante factor model — all implemented directly in `backend/risk_engine.py`, `backend/factor_models.py`, and `backend/exante.py`.

**Why are the GARCH backtests cached?**
Multi-year rolling refits of GARCH-t and GJR-t (one MLE fit per day over each portfolio's full out-of-sample window) take seconds-to-minutes per portfolio. Daily refresh doesn't need to recompute them — backtest verdicts are a methodology check, not a current-state metric. They're cached in `backend/cache/garch_backtests.json` and regenerated on demand via `RISKLENS_FULL_BACKTEST=1 python backend/run.py`.

**Can I add my own portfolio?**
Yes. Add an entry to `backend/config/portfolios.yaml` with an id, label, benchmark, and holdings; give each new ticker a display name there and a taxonomy entry in `categories.yaml`. The run stops with the exact missing ticker if either is absent. The toggle and Summary tab pick it up automatically; set a tolerance band for it in `SummaryPanel.jsx`. Run once with `RISKLENS_FULL_BACKTEST=1` so the new book gets GARCH backtest verdicts.
