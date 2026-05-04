# RiskLens — FAQ

Running list of questions from demos, reviews, and conversations. Updated as new ones come in.


## The basics

**Where does the data come from? Is it free?**
All price data is pulled from Yahoo Finance via a Python library called yfinance. Completely free, no API key required. It gives us daily adjusted closing prices — adjusted means splits and dividends are already baked in. There's roughly a one-day lag: if you run it after 4pm ET you get yesterday's close.

**How often does it update?**
The live site refreshes automatically every weekday at 6:30am UTC via a scheduled GitHub Actions job. The "Data as of" date in the top-right corner shows the latest trading day represented in the snapshot. You can also trigger a manual refresh any time from the GitHub Actions tab.

**Is anything being pulled from a risk data vendor?**
No. The only thing fetched externally is raw closing prices. Every single metric in the table — VaR, ES, GARCH fits, EVT tail fits, the correlation series, the risk gauge percentile, the exception rates, the scenario P&Ls — is computed locally in Python on each run. The methodology is fully open in `backend/risk_engine.py`.


## Portfolio modes

**What does the portfolio toggle do?**
It swaps the entire risk snapshot between three different portfolio definitions:
1. **Hypothetical Portfolio** — an illustrative diversified mix (60% equity, 30% fixed income, 8% real assets, 2% crypto) built from 12 sector and asset-class ETFs. This is the made-up portfolio used to demonstrate the engine's capabilities.
2. **Vanguard Target 2055 (VFFVX)** — the actual underlying allocation of Vanguard's 2055 target-date retirement fund. ~90% equity / 10% bonds, built from 4 broad passive index ETFs (VTI, VXUS, BND, BNDX).
3. **American Funds Target 2055 (AAFTX)** — Capital Group's actively-managed equivalent. ~89% equity / 11% bonds, but split across 12 actively-managed mutual funds rather than passive index funds.

When you toggle, the asset rows, weight labels, portfolio summary row, and all stress test cards rebuild using the selected portfolio's holdings.

**Why these three specifically?**
The hypothetical mode demonstrates the engine. The two real target-date funds show what professionally-managed retirement products actually look like underneath. Vanguard vs. American Funds is the cleanest passive-vs-active comparison in the industry — same risk profile (90/10 equity/bonds), very different construction philosophies. The interesting reveal is in the stress test cards: their topline P&L numbers are similar, but the per-fund contribution bars tell different stories. Capital Group's growth fund (AGTHX) gets hit much harder in the AI Bubble Burst scenario than VTI does, because active growth funds tend to be more concentrated in mega-cap tech.

**Why a 2055 vintage and not 2025 or 2045?**
2055 is the most equity-tilted vintage (longest time horizon to retirement, most aggressive). It produces the most dramatic risk and stress-test numbers, which is most useful for demoing the tool. Adding multiple vintages would be straightforward — just additional weight configs in `run.py`.

**The Vanguard mode only has 4 tickers but Capital Group has 12. Why?**
Because that's how they're actually built. Vanguard's TDF holds 4 broad passive index ETFs that each contain thousands of underlying securities (VTI alone holds ~3,700 stocks). Capital Group's TDF holds 12 actively-managed mutual funds, each making its own security selection. The wrapper-level simplicity differs by an order of magnitude even though the actual exposure breadth is similar.

**Why not just use the TDF's own ticker (VFFVX or AAFTX) as a single asset?**
Two reasons. (1) We'd lose the per-asset breakdown — the contribution bars in the stress tests would be one bar each, which is much less informative. (2) Mutual fund tickers report a single daily NAV, so we couldn't show why a fund moved on a given day. By modeling the underlying holdings directly, we can attribute portfolio P&L back to which holdings drove it.

**Are the scenarios computed using the same date ranges across modes?**
Yes for historical scenarios. The stress test for the GFC always uses the same date range (Sep 15, 2008 to Mar 9, 2009) — what changes between modes is which tickers are weighted into the portfolio. Some tickers didn't exist during all scenarios (BTC-USD pre-2014, BNDX pre-2013) — the engine excludes them and re-normalizes weights, with a note on the card showing what % of weight was covered.


## The risk table

**Why are there five VaR columns? Can't you just pick one?**
The disagreement between models is itself the signal. When Historical Simulation says 2.1, EWMA says 1.9, and EVT says 6.7 — that spread tells you the asset has fat tails that normal-distribution models are missing. A single number hides that. The Range column (far right) makes the spread explicit: tight range means models agree, wide range means something structural is going on in the tail.

**Why 1-day VaR and not weekly or monthly?**
Convention, and it matches the liquidity assumption. For liquid ETFs you can exit a position in one day, so the relevant risk horizon is one day. Basel originally standardized on 10-day VaR (scaling 1-day by √10) but the industry mostly works in 1-day and scales when needed.

**What does the VaR number actually mean?**
Read it as: on the worst 1% of trading days historically, you'd lose at least this many dollars on a $100 position. SPY showing 2.10 means a genuinely bad day costs about 2.1% of notional. It's a floor estimate, not a ceiling — things can always be worse.

**What's the difference between VaR and ES? They sound the same.**
They're related but different. VaR tells you where the bad days start — the threshold. ES (also called CVaR — same thing, different name depending on who you learned it from) tells you how bad things are on average once you're past that threshold. ES is always larger than VaR. Regulators now prefer ES over VaR (Basel III/IV) precisely because it describes the shape of the tail, not just its starting point.

**Where do the Low / Elevated / High color thresholds come from?**
They're pragmatic rules of thumb, not a regulatory standard. Calibrated for daily 1% VaR on liquid ETFs: diversified US equity (SPY) historically sits around 1.5–2.5%; sector ETFs 2–3%; individual stocks 3–5%; crypto and volatile names often 5%+. There's no universal industry standard for "low/medium/high" VaR thresholds because the right level depends on asset class, horizon, and confidence. The per-asset Risk gauge (percentile rank vs 2-year history) is the more rigorous comparison on this page since it's self-calibrating per asset.

**What is the Consensus column?**
A simple average across all five VaR models. Treat it as a rough heuristic reference point, not a precise estimate — it has no theoretical grounding as a risk measure. It's useful for a quick single-number comparison across assets but the Range column is more informative.

**What is the Range column?**
Min and max VaR across all five models. When the range is tight, the models agree and standard assumptions hold. When it's wide — usually EVT pulling high — the asset's tail losses are more extreme than normal-distribution models assume. The color coding makes this visible: grey = tight, yellow = some divergence, red = EVT is seeing something significant.

**What is the α tail column?**
The tail index from Extreme Value Theory, estimated using the Hill estimator. Lower values mean fatter tails — more extreme events are possible than standard models assume. Broad equity indices (SPY, QQQ) typically sit around 3–4. Individual stocks have fatter tails than indices because index diversification smooths out idiosyncratic blowups — individual names often come in at 2–4. Gold and crypto frequently fall below 3. Long-duration treasuries like TLT can also be surprisingly fat-tailed, especially after 2022. Assets below 3 have meaningfully more tail risk than standard normal-distribution models assume.

**What is the Risk gauge?**
The most actionable number in the table. It's not absolute risk — it's the percentile rank of today's EWMA VaR vs the trailing two years of daily values for that specific asset. 85% means this asset is more volatile right now than it's been on 85% of days in the past two years. This matters because it accounts for each asset's own volatility regime: Bitcoin at 5% VaR might be perfectly normal; SPY at 5% VaR would be extreme.

**What do the arrows next to the Risk gauge mean?**
A 5-day trend indicator. ↑ in red means VaR has been rising — risk is building. ↓ in green means VaR has been falling — conditions are easing. Hover over any risk bar for the full per-asset detail including the trend explanation and exception rate.

**What are VaR exceptions?**
A day where the actual loss exceeded what the VaR model predicted. At 1% confidence, you expect roughly 1% of days to be exceptions — about 5 per year, 10 over 2 years. If an asset is running at 3-4%, EWMA is systematically underestimating tail risk for that asset and you should weight EVT estimates more heavily. You can see this in the hover tooltip on each risk bar.

**What is the bottom row labeled "HYPOTHETICAL PORTFOLIO" (or the active mode's name)?**
The portfolio summary row. It's not an individual asset — it's the result of running all five VaR models on the daily weighted portfolio return series. The diversification benefit is visible directly: portfolio VaR is meaningfully lower than the weighted average of individual VaRs because correlated holdings offset each other. The "Range" column tells you how much the models agree on the portfolio's tail behavior.

**What is the Comp VaR column?**
Component VaR — each holding's contribution to the portfolio's total daily VaR. Computed using an EWMA covariance matrix of returns: `Component VaR_i = w_i × (Σw)_i / σ_p × z × portfolio_value`. The numbers sum to the portfolio's parametric (EWMA) VaR shown on the bottom row, which is why the bottom row shows it as `Σ X.XX`. Reading it: a +0.41 means SPY contributes $0.41 of the portfolio's daily VaR. A negative number means the holding is acting as a hedge — its covariance with the rest of the portfolio actually reduces total risk. This decomposition is what professional risk teams actually use to size positions and decide what to trim or add.

**Why does Comp VaR sometimes show a hedge (negative number) and sometimes not?**
It depends on each holding's covariance with the rest of the portfolio. In the hypothetical portfolio, TLT and GLD often show as hedges (negative component VaR) because they're typically negatively correlated with equity holdings — when stocks fall, treasuries and gold rally, reducing portfolio risk. But in 2022, those same assets fell *with* equities, so their component VaR turned positive temporarily. The contribution is regime-dependent.

**Doesn't the sum of component VaRs differ from the portfolio EWMA VaR shown in the row?**
It shouldn't — the math is constructed so they match exactly. Sum of components = `Σ_i w_i × (Σw)_i / σ_p × z = (w'Σw) / σ_p × z = σ_p × z` = portfolio VaR. If you see a discrepancy on screen it's at most a rounding difference (we round to 4 decimal places before summing).


## Model validation (backtesting)

**What is the Model Validation panel showing?**
For the active portfolio's daily return series, we backtest three of the five VaR models — HS, EWMA, and EVT — over the most recent **504 trading days** (~2 years). For each day in that evaluation window the model is given only the prior **1000 days** to forecast that day's 1% VaR (strict out-of-sample). We then count how many days the actual loss exceeded the forecast and run two statistical tests on the result.

**What is the Kupiec test?**
The Kupiec unconditional coverage test asks: *does the model's actual exception rate match the expected 1%?* The null hypothesis is that the rates are equal; the test returns a likelihood-ratio statistic distributed χ²(1) under the null. A p-value above 0.05 means we fail to reject the null — the rate is statistically consistent with 1%. A p-value at or below 0.05 means the rate is statistically distinguishable from 1%, and the verdict column tells you the *direction* (rate too high or too low).

**What is the Christoffersen test?**
The Christoffersen independence test asks: *do exceptions cluster?* Even if a model's overall exception rate is correct, it can still misbehave if violations bunch together (e.g. five exceptions in five consecutive days followed by no violations for a year). That's a sign of time-varying volatility that the model isn't capturing. The test uses a two-state Markov chain on the violation indicator and returns LR ~ χ²(1). A p-value above 0.05 means no clustering detected. Below 0.05 means we have evidence that exceptions are not independent.

**What do the four verdict labels mean?**
The verdict column names *how* a model is mis-calibrated, not just whether it "fails" something:
- **CALIBRATED** — both tests pass. The model's exception rate is statistically consistent with 1% and exceptions appear independently. This is the well-behaved case.
- **UNDER-EST** — exception rate is significantly *above* 1%. The model is missing tails. The dashboard's most likely diagnostic role here is "weight EVT-style estimates more heavily in this regime."
- **OVER-CONSERV** — exception rate is significantly *below* 1%. The model is too pessimistic — it forecasts losses that don't materialize. From a risk-management standpoint that's a "safe" failure mode (you're prepared for events that don't happen) but it's still calibration drift worth knowing about.
- **CLUSTERED** — overall rate may be fine but exceptions group together rather than appearing independently. A sign that the model isn't capturing time-varying volatility.

**Why does EWMA usually show UNDER-EST?**
EWMA's exception rate is consistently around 2.5–3% in the backtests versus the expected 1%. This is a well-known limitation: EWMA assumes returns are normally distributed, but real return distributions have fatter tails than normal. When a true 5σ event happens, normal-distribution VaR has already been blown through. This is why our table also shows EVT VaR — it captures the tail directly. EWMA showing UNDER-EST while HS shows CALIBRATED is exactly what the literature predicts, and is the reason we display all five models rather than picking one.

**Why does EVT usually show OVER-CONSERV?**
EVT typically over-shoots — its exception rate is closer to 0–0.2% versus the 1% target. The Generalized Pareto fit to the worst-loss tail produces VaR estimates that are pessimistic enough that real losses rarely exceed them. That's a feature for risk management (you're prepared for tail events) but a statistical failure for calibration testing. Combine EVT with EWMA and HS to get a fuller picture: EWMA gives you the "baseline" rate, HS gives you the empirical reality, EVT gives you the conservative tail bound.

**Are GARCH and tGARCH also backtested?**
Yes, with one architectural caveat. Both run on the same 504-day eval window with the same Kupiec + Christoffersen tests as HS, EWMA, and EVT. The implementation uses warm-started MLE — each rolling refit starts from the previous day's fitted parameters, which drops convergence iterations from ~30+ to ~3–10 and makes the full backtest take seconds rather than minutes. Convergence failures (rare) fall back to EWMA.

The architectural caveat: GARCH/tGARCH backtest results are **cached** in `backend/cache/garch_backtests.json` rather than recomputed on every backend run. The daily refresh just reads the cache. To regenerate them (e.g., after a methodology change or to incorporate new data), run `RISKLENS_FULL_BACKTEST=1 python backend/run.py`. Backtest verdicts are a methodology check, not a current-state metric, so they don't need daily refresh.

**What do GARCH and tGARCH actually show in the panel?**
Both typically show **UNDER-EST** in this dataset — exception rates around 2.2–3% versus the 1% target. That's the expected pattern for parametric volatility models: GARCH-family forecasts react to recent realized vol but still underestimate fat-tail events because the underlying distribution assumption is normal. **tGARCH is usually slightly better than plain GARCH** (lower exception rate) because its asymmetric term — extra weight on negative shocks — reacts faster to volatility regime changes. That's exactly what the literature predicts and the panel surfaces it cleanly.

**What's the panel telling me, big picture?**
Not "these models are good or bad" — it's revealing each model's calibration behavior in the recent regime. EWMA chronically under-estimates tails; that's why EVT exists. EVT chronically over-estimates them; that's why HS exists. HS empirically captures both directions but reacts slowly to regime changes; that's why EWMA exists. The five-model approach in the snapshot table is justified precisely *because* each model has a known calibration drift in a specific direction. The validation panel surfaces those drifts statistically rather than asking you to take them on faith.


## Stress tests & scenarios

**What's the difference between historical and hypothetical scenarios?**
Historical scenarios (grey badge) replay actual price data from a defined date range — they're 100% data-driven and require no assumptions. Hypothetical scenarios (amber badge) apply analyst-estimated shock vectors per asset — they're forward-looking estimates, not forecasts. The visual distinction matters because the historical numbers are reproducible facts; the hypothetical numbers are illustrative judgments.

**How are the hypothetical shock vectors estimated?**
By informed analyst judgment, looking at directional exposures. For a Taiwan invasion: semiconductors get hit hard (so QQQ -22% because of TSMC/NVDA exposure), Asia EM is heavily exposed (EEM -22%), gold and Treasuries rally on flight to safety. The exact percentages are illustrative — what matters more than the absolute numbers is the *relative* sensitivity across holdings. The shock vectors live in `backend/risk_engine.py` under `HYPOTHETICAL_SCENARIOS` and can be edited by anyone with a working group's perspective on the scenario.

**Why these specific scenarios?**
The historical set covers regimes that hit different parts of a portfolio differently: GFC (credit-driven equity crash), COVID (panic-driven equity crash with bond rally), 2022 rate shock (the famous 60/40 breakdown — both stocks and bonds sold off), Russia-Ukraine (commodity shock), Q4 2018 (Fed-driven sell-off). The hypothetical set covers near-term geopolitical and macro tail risks: Taiwan invasion (semiconductor + Asia), Iran conflict (oil), US recession (Fed pivot scenario), AI bubble burst (mega-cap tech repricing).

**Why is the 2022 rate shock the same number across all three portfolio modes?**
Because in 2022 there was no hedge. Stocks AND bonds both sold off simultaneously. The 60/40 portfolio's traditional defense — bonds rallying when stocks fall — broke completely. Whether your portfolio is 90/10 (Vanguard TDF), 89/11 (Capital Group TDF), or 60/30 (hypothetical), the bonds didn't help. The Taiwan invasion or US recession scenarios show much bigger differences across modes precisely because in those, the bond allocation matters.

**What does the "% of portfolio weight covered" note mean on some cards?**
It appears when some assets in the active portfolio didn't exist during the historical scenario's date range. For the GFC scenario in hypothetical mode, BTC-USD (launched 2014) didn't exist, so it's excluded and the remaining weights are renormalized. The note tells you what fraction of the portfolio's weight was actually covered.

**Why does the portfolio toggle change the scenarios?**
Because each scenario is computed against the *active portfolio*, not against the market in aggregate. A scenario is an answer to "what would happen to *my* holdings during this event." Different holdings → different P&L → different contribution breakdown. This is what makes the toggle interesting — same scenarios, very different stories.

**What's the "Probability outlook" section on each hypothetical card?**
Curated external probability sources, plus one live computation where the methodology is rock-solid. The deliberate choice is **not** to put a single made-up percentage on each card — that's a strong claim with weak evidence. Instead:

- **US Recession**: live calculation using the NY Fed's yield-curve recession probability (Estrella-Trubin 2006 probit model on the 10Y - 3M Treasury yield spread). This is a public Federal Reserve methodology, the formula is documented, and the inputs are pulled fresh on every backend run. The current value is computed and shown directly.
- **Taiwan Invasion / Iran Conflict / AI Bubble Burst**: links to external sources (Polymarket, Metaculus, CSIS war-game reports, CBOE SKEW, Shiller CAPE, etc.) where you can find current probability estimates from money-backed prediction markets, structured forecaster aggregations, or implied-probability indicators. The dashboard doesn't try to synthesize these into a single number because doing so would introduce subjective judgment that quants will rightly question.

This is the most quant-credible framing: live numbers where the methodology is defensible, transparent attribution where it isn't.

**Why not just attach a probability percentage to every card?**
Because most "probability of geopolitical event" estimates are vibes wearing the costume of quant. The honest choices are: use a published methodology with a real formula (NY Fed for recession), use money-backed prediction markets (Polymarket / Manifold), or use options-implied measures (CBOE SKEW, put skew). For Taiwan invasion specifically, no clean historical base rate exists and prediction markets often have low liquidity for the relevant time horizons. Showing "Taiwan invasion: 14%" with no source kills credibility for any quant audience. Showing curated source links lets the reader form their own probability view from data they trust.


## Market context charts

**What is the S&P 500 Risk and Losses chart showing?**
Three things at once for each year back to 1990: the calmest day's risk estimate (green bar), the most stressed day's risk estimate (blue bar), and the annual return when it was negative (red bar). The VIX line (amber, right axis) shows the market's own fear gauge — the annual average implied volatility priced into options. The key insight is that the blue bars spike during crises — the model sees stress building in real time — while the red bars only confirm the damage after the fact.

**Why does the VIX line matter?**
VIX is forward-looking in a way that our other models aren't. It reflects what options traders are paying to hedge — it's a market consensus on expected volatility for the next 30 days. Our VaR models are backward-looking (based on historical returns). When VIX spikes above our EWMA VaR estimates, the market is pricing in more stress than recent history suggests. That divergence is worth paying attention to.

**Why doesn't the S&P 500 chart change when I toggle portfolios?**
It's market context, not portfolio analytics. The S&P 500 is the same regardless of what you hold. Same with the correlation chart. The reorganized section order (Risk Snapshot and Stress Tests at top, market charts at bottom) reflects this — everything that responds to the toggle is grouped above, market reference data lives below.

**What is the Cross-Asset Correlation chart?**
Rolling 60-day average pairwise correlation across 10 core ETFs (SPY, QQQ, GLD, TLT, EEM, IWM, HYG, LQD, XLF, VNQ) going back to 2007. In normal markets this sits around 0.15–0.35 — assets move somewhat independently and diversification works. When it spikes, everything is moving together and diversification collapses.

**Why is 2022 the peak and not the GFC?**
This is the most counterintuitive finding in the data. In the GFC (2008-09), equities crashed but treasuries and gold surged — flight to safety kept average pairwise correlation moderate. In 2022, the Fed's aggressive rate hiking cycle caused stocks AND bonds to sell off simultaneously, breaking the traditional 60/40 hedge. The correlation hit 0.70 — the highest in the dataset. The correlation breakdown problem is most dangerous in inflation and rate shocks, not just in equity crashes.

**What is the multi-window stock-bond correlation chart showing?**
The same stock-bond correlation question, looked at through three different rolling-window lengths simultaneously: **20-day** (fast, picks up regime changes within weeks), **60-day** (medium), and **252-day** (slow, roughly a one-year average). Plotted on the same chart for one bond proxy at a time, with a toggle to switch bonds (AGG / TLT / IEF / LQD).

The point is to compare time scales. The 20-day line moves quickly when news hits; the 252-day line is dominated by the prior year's history and only shifts decisively after a regime has been live for a long time. **When the 20-day line diverges sharply above the 252-day line, you're seeing a recent regime change before longer-horizon measures register it.** That's a common situation when a regime is in its early stages: short windows catch it, long windows haven't caught up.

A "Recent intensification" callout fires when the 20-day correlation exceeds the 252-day by 0.15 or more — a heuristic for "the recent regime is meaningfully different from the trailing-year average." The opposite (20d below 252d) triggers a "Recent normalization" callout.

**Why four bond proxies?**
Because the bond market isn't monolithic, and different parts have meaningfully different relationships with equities:

- **AGG** (iShares Core US Aggregate Bond) — the broad investment-grade aggregate, ~7-year duration, mostly Treasuries + corporates + MBS. This is what most retail and long-only PMs actually hold as their bond exposure. The cleanest "is the bond portfolio diversifying me?" signal.
- **TLT** (iShares 20+ Year Treasury) — long-duration. Most rate-sensitive, biggest mover in either direction.
- **IEF** (iShares 7-10 Year Treasury) — intermediate Treasury. The "typical" duration risk most diversified bond portfolios center around.
- **LQD** (iShares Investment Grade Corporate) — IG corporate. Carries equity-like credit-spread behavior, so historically shows higher equity correlation than pure Treasuries.

If the regime is real, it should show up across all four. If only one bond proxy shows it, the signal is narrower than implied. The toggle lets you check.


**What is the Intraday Stock-Bond Correlation chart?**
A leading version of the daily-data correlation chart above. Each bar is one trading day's SPY × TLT correlation computed from intraday log returns within that day. Red bars are positive correlation days (rates regime — the dominant news driver moves stocks and bonds the same direction); green bars are negative (growth regime — classic flight-to-safety). The chart shows the last 60 trading days, which is the limit on free intraday data via yfinance.

**Why intraday rather than daily for correlation?**
Statistical power per unit time. A daily-data correlation chart is a smoothed 60-day rolling average — by the time it shifts decisively, the regime has been live for a month or more. With intraday bars, each *single trading day* gives many observations, making each daily intraday correlation value a statistically meaningful estimate on its own. A run of consecutive same-sign days is therefore a much sharper regime-shift indicator. Under a null hypothesis of zero true correlation, the probability of e.g. 22 consecutive positive days by chance is roughly (0.5)^22 ≈ 1 in 4 million — so a streak like that is essentially a categorical signal, not noise.

**Why does the chart have a 5-min / 15-min toggle?**
Different sampling frequencies show genuinely different things:

- **5-minute** gives 78 observations per US session — tight per-day estimates that catch even weakly positive (or negative) regimes as long streaks. Trade-off: more microstructure noise (bid-ask bounce) and slight Epps-effect attenuation, so individual correlation magnitudes are biased modestly toward zero.
- **15-minute** gives 26 observations per session — fewer per-day data points (so individual days are noisier and more likely to flip sign on weak regimes), but cleaner magnitudes (less microstructure noise, asynchrony already negligible for liquid ETFs at this frequency). This is the academic-literature standard for cross-asset correlation.

Toggle between them and you should see the same regime story in both: similar percentage of positive days, similar overall direction. If the regime is strong, both will show clean streaks. If the regime is weakly positive (true corr ≈ +0.1), 5-min will show longer consistent streaks while 15-min will show more day-to-day flip-flopping. Seeing this difference is itself diagnostic — it tells you whether the regime is decisive or marginal. Default is 15-min (cleaner magnitudes, more literature-defensible).

**Why does the chart only go back 60 days?**
yfinance limits free 5-minute data to the last 60 calendar days. That's actually the right window for "is there a current regime?" — you don't need 5 years of intraday history to detect today's regime. For longer intraday history you'd need a paid feed (Alpha Vantage, Polygon, IBKR, Refinitiv).

**What does a "rates regime" actually mean?**
The dominant news driver hitting markets each day is rates-related: inflation surprises, Fed expectations, fiscal/issuance news. In a rates regime, both stocks and bonds respond to the same news in the same direction (an upside inflation surprise sends stocks down AND bonds down). Contrast with a growth regime where bad economic news sends stocks down but rallies bonds (flight to safety). The 2022 Fed hiking cycle was the textbook rates regime; what the chart shows now is whether we're in another one.


## What would I actually do with this?

**What actions should I take based on these numbers?**
This is a monitoring tool, not a signal generator. What it's useful for:
- **Position sizing**: if BTC VaR is $12 on $100, a bad day costs 12% of notional — you might reduce size
- **Risk budget allocation**: no single asset should represent more than X% of portfolio daily loss
- **Regime awareness**: multiple assets at 90%+ risk gauge simultaneously is a macro stress signal
- **Scenario checks**: before an event you're worried about, look at the corresponding stress test card to see how your portfolio is exposed

**Would this have helped historically?**
Mixed. The risk gauge would have been elevated going into 2008 and March 2020 — volatility was building before the crash peaks. But VaR is procyclical: it's low when markets are calm and spikes during the crash, not before it. You'd have seen the warning as it was already happening, not weeks ahead. The correlation chart is more interesting as a leading indicator — correlation was rising in late 2007 before the GFC peaked. The honest answer: VaR tells you how bad things are, not how bad they're about to get.

**What would make it genuinely predictive?**
A few additions with actual forward-looking evidence:
1. **VaR trajectory** — is risk trending up or down over 5 days? Already implemented via the arrows
2. **VaR exceptions** — is the model systematically underestimating for a given asset? Already implemented in the hover tooltip
3. **VIX as a forward-looking overlay** — already on the historical chart
4. **Term structure** — comparing 1-day vs 20-day VaR ratios to detect structural stress building. Not yet built
5. **Options-implied vol per asset** from the options chain — most forward-looking but most complex to implement

**What's missing to make this production-ready for a real fund?**
Two remaining gaps, in rough priority order:
1. **Multi-period VaR** — everything is currently 1-day. A real fund needs 1-day, 10-day, and 1-month VaR for different liquidity assumptions and Basel/regulatory requirements. This involves either time-scaling (multiplying by √N — fine for normal returns, broken for fat tails) or directly fitting models to multi-day overlapping returns.
2. **Factor decomposition** — Bloomberg PORT, MSCI Barra, and FactSet all decompose risk into named factors (style, sector, geography, currency, duration, credit spread). RiskLens currently shows per-asset risk and component contributions but doesn't attribute to underlying factors. This is a meaningful build — needs factor return estimates, regression machinery, and care around regime stability.

**Component VaR and GARCH/tGARCH backtesting (formerly listed here)** are now built. All five model types (HS, EWMA, GARCH, tGARCH, EVT) are validated in the panel with directional Kupiec + Christoffersen verdicts. GARCH-family backtests use warm-started MLE refits and are cached separately so they don't slow the daily refresh.

**How does this compare to professional risk systems like Bloomberg PORT or MSCI Barra?**
The methodology is comparable for what's covered (five VaR models with disagreement surfaced, EVT, exception tracking, stress tests both historical and hypothetical, component VaR risk attribution, formal Kupiec + Christoffersen backtesting on all five model types). The gaps are: (1) those systems use **factor models** that decompose risk into named factors (style, sector, geography, currency, duration, credit spread) rather than just per-asset attribution, (2) they have decades of curated alternative data and proprietary risk factor definitions, (3) they cover thousands of asset classes including private credit, derivatives, and structured products. RiskLens is a deliberately scoped subset focused on liquid public ETFs and mutual funds, with full methodology transparency you don't get from a vendor system.

**Where's the factor model? Why isn't risk decomposed by style, sector, and country like Barra does?**
Because I haven't built one. Component VaR (the rightmost column on the risk table) decomposes portfolio VaR per holding via an EWMA covariance matrix — that's a correct decomposition, just per-asset rather than per-factor. A factor model would name the underlying drivers (Value, Growth, Quality, Momentum, sector exposures, country/region, duration, credit spread, FX) and tell you which factor bets are explaining today's risk. That's the layer Barra/Axioma sells and RiskLens doesn't replicate.

Building one is real work: define a factor universe, estimate factor returns and time-varying loadings per holding, split systematic from idiosyncratic risk, build attribution UIs. Months of effort to do well. Anyone coming from the factor-model world will see this page as a competent VaR-and-stress-test dashboard that's missing the layer they actually live in. That's a fair read.

**Does anyone actually build their own factor model, or do most firms use Barra/MSCI?**
Most firms buy. Long-only asset managers, mutual funds, pensions, insurance — they license Barra (MSCI), Axioma (SimCorp), or similar. Vendor models are good enough, regulator/auditor comfort is built in, and a ground-up build costs more than it's worth.

The exceptions are quant hedge funds — Renaissance, Citadel, DE Shaw, Two Sigma, Hudson River, AQR — where the factor model isn't just a risk tool, it's a proprietary alpha source. They believe their definitions or estimation methods are sharper than commercial offerings and treat the model as IP. Some large asset managers (BlackRock with Aladdin) run internal models alongside vendor models, often using the vendor for compliance reporting and the internal model for trading decisions.

For a typical long-only shop the realistic stack is: vendor model as the primary risk system, internal research layered on top for specific applications (custom factors, alternative data integration, strategy-specific risk views). Building a ground-up factor model from scratch at a long-only manager would be a strange use of headcount.


## Technical

**Is all the math done from scratch?**
Yes for everything except the GARCH fitting, which uses the `arch` Python library. Historical simulation, EWMA, EVT, the Hill estimator, the risk gauge percentile rank, VaR exceptions, rolling correlation, scenario aggregation — all implemented directly in `backend/risk_engine.py`.

**Why five models? Isn't that redundant?**
They span fundamentally different approaches: non-parametric (HS), parametric with fast decay (EWMA), conditional volatility (GARCH), asymmetric volatility (tGARCH), and tail-specific (EVT). They make different assumptions and fail in different regimes. Having all five lets you see model disagreement directly rather than trusting a single number. When EVT diverges significantly from the others, that's a specific, actionable signal about tail behavior.

**Why does the correlation chart only go back to 2007 and not further?**
The shortest-history ticker in the correlation basket is HYG (launched April 2007). We exclude BTC-USD (launched 2014) from the correlation calculation specifically to preserve the longer history — otherwise the series would start in 2014 and miss the GFC entirely.

**Doesn't the high correlation between SPY and QQQ distort the average — double counting equity exposure?**
It influences the absolute level of the average but not the signal. SPY and QQQ are typically 0.95+ correlated, so that pair is always pulling the average up. But since it's always there, its contribution to the level is constant — what changes the average over time is when normally uncorrelated pairs start moving together. The most informative pairs in the basket are the cross-asset ones: SPY/GLD, TLT/SPY, HYG/TLT. In normal markets those correlations are low or negative. When they spike — as in 2022 when stocks and bonds both sold off — that's what drives the chart up. The SPY/QQQ pair being perpetually high is almost irrelevant to the regime signal.

A more rigorous version would use a weighted average that downweights highly collinear pairs — for example weighting each pair inversely by its long-run average correlation, or using PCA to weight by independent variance explained. That would lower the baseline level and give more signal weight to cross-asset relationships. A reasonable version 2 enhancement if the methodology gets scrutinized closely.

**How accurate are the target-date fund weights?**
Within a few percentage points of the published fact sheets. Both Vanguard and Capital Group disclose their TDF holdings publicly — Vanguard quarterly, Capital Group monthly. The exact allocation drifts slightly over time as part of the glide path (gradually shifting toward bonds as retirement approaches). The numbers in `run.py` are anchored to mid-2024 disclosures and would be ~1pp off as of any given run. For risk modeling purposes this is well within the noise of the analyst-estimated shock vectors used in hypothetical scenarios.
