# Anomaly Detection — A Primer

*An end-to-end self-study guide to the Anomaly Detector tab. Starts from the basics — what a return is, what volatility means — and builds up to the factor model and the three statistical anomaly detectors. Designed to be read straight through in about an hour, with no prior quant background assumed.*

---

## Table of contents

- **Part 1.** Foundations: returns, volatility, the Normal distribution
- **Part 2.** Why financial returns aren't actually Normal
- **Part 3.** Detector #1 — Standardized z-score
- **Part 4.** Detector #2 — Page CUSUM (sustained mean shifts)
- **Part 5.** Conditional volatility — GARCH and GJR-GARCH
- **Part 6.** Detector #3 — GARCH-residual outliers
- **Part 7.** Factor models — what they are and what they aren't
- **Part 8.** Fama-French + Carhart in detail
- **Part 9.** Reading the risk profile card
- **Part 10.** Putting it all together — a worked example
- **Part 11.** Limits, caveats, and what this primer doesn't cover
- **Glossary**

---

## Part 1 — Foundations

### 1.1 What is a return?

A **simple return** is the percentage change in price from one day to the next:

```
r_simple_t = (P_t - P_{t-1}) / P_{t-1}
```

If a stock closes at $100 yesterday and $102 today, the simple return is +2%.

A **log return** is the natural log of the price ratio:

```
r_t = ln(P_t / P_{t-1})
```

For the same example: `ln(102/100) ≈ 0.0198`, or about +1.98%.

For small returns the two are nearly identical. We use log returns throughout this primer for three reasons that matter even when the numbers look the same:

1. **They're additive across time.** The log return over a week is the sum of daily log returns. Simple returns compound multiplicatively, which makes algebra messier.
2. **They're roughly symmetric.** A simple return of +50% followed by −50% leaves you at 75% of where you started (not 100%). Log returns of +0.40 then −0.40 net to zero — symmetric. Easier to reason about.
3. **Many statistical models assume returns are roughly Normally distributed.** Log returns come closer to that assumption than simple returns, especially at longer horizons.

For the rest of this primer, "return" means log return unless otherwise noted.

### 1.2 What is volatility?

Volatility is *how much returns vary day to day*. Formally, it's the standard deviation of returns over some period. Bigger volatility = bigger typical daily move.

- **Calm asset:** daily returns mostly in ±0.5%. Standard deviation around 0.005. Annualized vol ≈ 8%.
- **Typical equity:** daily returns mostly in ±1%. Std dev around 0.01. Annualized vol ≈ 16%.
- **Volatile asset (crypto, single small-cap):** daily returns ±3-5%. Std dev around 0.04. Annualized vol ≈ 60%+.

**Annualization.** Daily standard deviation × √252 gives annualized volatility, where 252 is the number of trading days in a year. The √252 factor comes from the assumption that daily returns are independent: variance scales linearly with time, so standard deviation scales with the square root of time.

### 1.3 The Normal distribution in 60 seconds

The Normal distribution (also called the bell curve or Gaussian) is the symmetric, bell-shaped distribution defined by two numbers: a mean μ (where it's centered) and a standard deviation σ (how wide it is). It has the convenient property that:

- About **68%** of values fall within ±1σ of the mean.
- About **95%** fall within ±2σ.
- About **99.7%** fall within ±3σ.
- About **99.99%** fall within ±4σ.

This is the famous "3-sigma rule" or "six sigma" framework. If you assume returns are Normal with mean zero, then a return more than 3 standard deviations from zero should happen on about 1 day in every 370 — roughly once or twice a year.

That's a very strong assumption. Empirically, it's also wrong.

---

## Part 2 — Why financial returns aren't actually Normal

This is the single most important fact you need to internalize before reading any of the detectors below.

### 2.1 Fat tails

If you actually look at daily returns of any liquid stock or ETF over a decade, you'll see far more extreme moves than the Normal distribution predicts. The Normal says a 5σ event should happen about once every 700 years. In reality, the S&P 500 has had multiple 5σ days per decade. October 19, 1987 was a 20σ day under a Normal-distribution assumption. The Normal distribution thinks that should happen once per *10^88* years (vastly more than the age of the universe).

What's happening: financial return distributions have **heavy tails**. The probability of an extreme move falls off much more slowly than the Normal predicts. This is sometimes called **leptokurtosis** (kurtosis > 3, the Normal's kurtosis).

### 2.2 Quantifying fat tails — the kurtosis number

**Kurtosis** is a single number that measures how much weight is in the tails:

- Normal distribution: kurtosis = 3.
- Daily S&P 500 returns: kurtosis ≈ 7.
- Daily individual stock returns: often 10-30.
- Daily crypto returns: 30+.

Higher kurtosis = more probability mass in the tails = more extreme events than Normal predicts.

### 2.3 Why this matters for anomaly detection

If returns were really Normal, defining "anomaly" would be easy: |z| > 3 happens 0.3% of the time, so flag those days. Done.

In reality, |z| > 3 happens **2-3%** of the time for typical equities. That's roughly 5-7 per year, not 1 every couple of years. So calling all of them anomalies is too noisy.

This is why our detectors don't use Normal-distribution probabilities to set thresholds. We use empirical rules of thumb (|z| ≥ 3, CUSUM ≥ 5σ) chosen to flag only the most striking events, not every theoretical 3-sigma day.

### 2.4 Why this matters for VaR (and why the dashboard shows 5 models)

The Normal-distribution assumption is also what makes simple VaR models (EWMA in our suite) systematically understate tail risk. If actual returns are fatter-tailed than Normal, an "EWMA 99% VaR" of $2.00 means losses worse than $2.00 happen on more than 1% of days. The model is mis-calibrated.

This is why we show five VaR models side-by-side. The Normal-based ones (EWMA) will read low; the heavy-tail ones (GARCH-t with Student-t innovations, EVT with a Generalized Pareto distribution) will read higher. The gap between them is the cost of assuming Normal.

### 2.5 The skewness wrinkle

Equity returns aren't just fat-tailed — they're also slightly **negatively skewed**. The downside is fatter than the upside. The worst days are worse than the best days are good. This is consistent with what every market participant feels: crashes are sharper than rallies.

Our detectors generally use symmetric thresholds (|z| ≥ 3 captures both directions) but the asymmetry shows up elsewhere: the GJR variant of GARCH explicitly models the fact that negative shocks raise volatility more than equally-sized positive shocks. We'll get to that in Part 5.

---

## Part 3 — Detector #1: Standardized z-score

The simplest detector. Asks: *was today's return unusually big relative to recent normal behavior?*

### 3.1 The naive z-score

If returns are roughly Normal with mean μ and standard deviation σ, then the **z-score** of return r is just:

```
z = (r - μ) / σ
```

A z-score of +2 means today's return was 2 standard deviations above the mean. A z-score of −4 means today was 4 standard deviations below.

### 3.2 The "what window of history?" question

You can't compute z-score without choosing what counts as "normal." Three reasonable answers:

1. **Full history mean and std.** μ and σ over every day available. Stable but doesn't adapt to changing regimes.
2. **Fixed long window.** Last 2 years, say. Mostly stable.
3. **Short rolling window.** Last 60 trading days. Adapts quickly to recent volatility, but a recent spike can artificially boost σ and *hide* future spikes.

The dashboard uses **rolling 60-day window** with a minimum of 20 days. This is a standard choice for trading-style outlier detection — long enough to be statistically meaningful, short enough to adapt to recent vol regimes.

So for each trading day:

```
μ_60d_t = mean of returns over days [t-59, t]
σ_60d_t = standard deviation of returns over days [t-59, t]
z_t = (r_t - μ_60d_t) / σ_60d_t
```

### 3.3 The threshold — |z| ≥ 3

Under a Normal distribution, |z| ≥ 3 should happen about 0.3% of the time (once every ~370 days). In reality with fat-tailed equity returns, it happens 2-3% of the time (about 5-7 per year).

We use **|z| ≥ 3** as the flag threshold because:
- It corresponds to the textbook "3-sigma" rule that quants and traders recognize at a glance.
- Even with fat tails, 2-3% of days flagged is sparse enough to be informative.
- Setting it tighter (|z| ≥ 2) would flag ~5% of days — too noisy.

### 3.4 What z-score catches

- Sharp single-day shocks: earnings surprises, M&A announcements, sudden geopolitical events, major Fed pivots.
- Days where one asset moves much more than its recent neighborhood.

### 3.5 What z-score *misses*

This is the critical limitation. **A slow accumulation of small moves in one direction is invisible to z-score.** If a stock drifts down 0.5% per day for 20 days, that's a 10% drawdown — but no single day will register |z| > 3. Each day is unremarkable on its own; the cumulative drift is the story.

That's exactly what the next detector is built to catch.

### 3.6 What z-score also misses

Z-score also fails when the volatility regime itself changes. If σ has been 1% for months and suddenly the asset enters a high-vol regime where σ is 3%, the first day of the new regime might be a 5% move — clearly extreme. But the *rolling* σ won't catch up immediately, so z = 5%/1% = 5, definitely flagged. Good.

But the *next* day at 4% will already have σ rising (say to 1.5%), so z = 2.7, not flagged. The detector quietly "adapts" to the new regime by inflating σ. This is sometimes a feature (it stops you from flagging every day in a volatile regime), sometimes a bug (you genuinely want to know vol is structurally higher).

Detector #3 (GARCH residuals) is built to handle this regime question more rigorously.

---

## Part 4 — Detector #2: Page CUSUM

Designed to catch what z-score misses: **sustained drift away from baseline**.

### 4.1 The intuition

Imagine you're watching a stream of returns and you want to know if their *average* has shifted away from its long-run mean. The naive approach: compute a rolling 20-day mean and see if it's far from zero. Problem: rolling means are smoothed estimates with their own lag.

CUSUM (cumulative sum) is more elegant. It keeps a **running tally** of how far returns have drifted from baseline, and triggers when the tally crosses a threshold. The brilliance is that it can detect a shift in the mean much earlier than a rolling-mean approach, especially when the shift is small but persistent.

### 4.2 Mathematical setup — the one-sided version

Let's say we expect the mean of standardized returns to be roughly zero (the asset isn't drifting up or down on average). Define:

```
S_t = max(0, S_{t-1} + z_t - k)
```

where:
- `z_t` is today's standardized return (z-score)
- `k` is the **allowance** (typically 0.5 in standard-deviation units) — how much drift we're willing to ignore before accumulating
- `S_0 = 0`

What this does:
- On a day when z_t is small (close to zero), z_t - k is negative, so S_t shrinks or stays at zero.
- On a day when z_t is large positive (above the allowance k), S_t grows.
- S_t **never goes negative** because of the max(0, ...) — if the running tally would go negative, it resets to zero.

We **trigger** when S_t crosses a threshold h (typically 4-6 in standard-deviation units).

### 4.3 Why the max(0, ...) reset matters

Without the reset, a long string of small negative z-scores would push the running tally arbitrarily negative. Then a small positive shift would take many days to push it back. The reset to zero means the detector is always ready to flag a *new* upward shift — it doesn't carry "history credit" from a quiet period.

### 4.4 The two-sided version

For symmetric detection (catch both upward and downward shifts), we run two parallel CUSUMs:

```
S⁺_t = max(0, S⁺_{t-1} + z_t - k)         # detects upward shifts
S⁻_t = min(0, S⁻_{t-1} + z_t + k)         # detects downward shifts (mirror)
```

The dashboard shows both lines on the same chart, with `S⁺` (red) trending up when there's an upward drift and `S⁻` (yellow/blue) trending down when there's a downward drift. Flag fires when:

- `S⁺_t ≥ h` (typically h = 5) — sustained positive drift detected
- `S⁻_t ≤ -h` — sustained negative drift detected

### 4.5 Why k = 0.5 and h = 5?

These are textbook defaults from the statistical process control literature. The intuition:

- **k = 0.5** means we're willing to ignore drifts up to 0.5 standard deviations as noise. Anything bigger starts accumulating.
- **h = 5** means we wait until the accumulated drift is 5 standard-deviation units above the allowance before triggering.

Smaller k or h = more sensitive but more false positives. Larger = less sensitive but fewer false flags.

Combined, with the data assumption of standardized returns, the **average run length** (expected number of days until a false flag under no actual shift) under these defaults is roughly 200-400 days. So one false positive per year-ish under a null of no real shift.

### 4.6 What CUSUM catches

- **Trending markets:** when an asset slowly drifts in one direction over weeks rather than blowing up in a day. Z-score misses these; CUSUM catches them after the drift has built up enough cumulative evidence.
- **Regime shifts in the mean:** if an asset transitions from a 0% daily-mean regime to a +0.2% daily-mean regime, CUSUM detects this within ~20-30 days even though no single day is unusual.

### 4.7 What CUSUM misses

CUSUM operates on the *mean* of returns, not on the magnitude. A series of equal +z then −z then +z would average to zero — CUSUM stays asleep. Only sustained drift in one direction wakes it up.

CUSUM also has a delay built in (you need cumulative evidence before triggering). It's a sustained-shift detector, not a shock detector — that's z-score's job.

### 4.8 Historical note — Page (1954) and Roberts (1959)

CUSUM was invented by **E. S. Page** in 1954 for industrial quality control. The setup was watching a manufacturing process: are the parts coming off the assembly line drifting away from spec? It then became standard in epidemiology (catching disease outbreaks early), finance (catching trend changes), and any application where you want to detect a sustained shift in a noisy stream.

The two-sided CUSUM and the standard parameter choices come from **S. W. Roberts (1959)** and **G. A. Lucas (1976)**. The textbook reference is Montgomery's *Introduction to Statistical Quality Control* — the formal name in industry is "tabular CUSUM."

---

## Part 5 — Conditional volatility (GARCH and GJR-GARCH)

Detector #3 needs a model of how volatility changes day-to-day. That's GARCH. Let's build the intuition.

### 5.1 The observation: vol clusters

Look at daily S&P 500 returns over decades and you'll see something obvious: volatile days **cluster**. Big moves come in bunches. After a bad day, the next few days tend to also be volatile (either direction). After a calm stretch, the next stretch tends to be calm too.

This **volatility clustering** is one of the most reliable empirical facts in financial time series. Models that ignore it will mis-forecast risk.

### 5.2 GARCH(1,1) — the simplest model that captures clustering

GARCH = **Generalized Autoregressive Conditional Heteroskedasticity**. Don't let the name scare you. It's a one-line equation:

```
σ²_t = ω + α · r²_{t-1} + β · σ²_{t-1}
```

In English: today's variance depends on (a) a constant baseline ω, (b) how big yesterday's return was, α-scaled, and (c) how high yesterday's variance was, β-scaled.

- If yesterday's return was large in absolute value, today's variance forecast rises.
- If yesterday's variance was already elevated, today's stays elevated (mean-reversion happens but slowly via β).

The (1,1) notation means we use one lag of squared returns and one lag of variance. There are GARCH(2,2), GARCH(p,q) variants, but (1,1) is the workhorse and almost always sufficient.

### 5.3 What the parameters tell you

- **ω** is the long-run baseline variance.
- **α** measures how much new information (the latest return) moves the variance forecast.
- **β** measures how persistent variance is — how slowly it decays back to baseline.
- For equity returns, typical values are α ≈ 0.05-0.10, β ≈ 0.85-0.93, ω small. Note that α + β is usually close to 1 (around 0.95-0.99) — variance is highly persistent.

### 5.4 The leverage effect — GJR adds asymmetry

Empirically, equity volatility doesn't react symmetrically to good and bad news. A 5% drop raises tomorrow's expected volatility more than a 5% gain does. This is sometimes called the **leverage effect** (the older theory attributed it to corporate leverage; in practice it's also a behavioral/news-driven phenomenon).

GJR-GARCH (named for **Glosten, Jagannathan, and Runkle 1993**) adds an asymmetric term:

```
σ²_t = ω + α · r²_{t-1} + γ · r²_{t-1} · I(r_{t-1} < 0) + β · σ²_{t-1}
```

The new term, `γ · r²_{t-1} · I(r_{t-1} < 0)`, only fires when yesterday's return was negative (I is the indicator function). So negative shocks get an extra γ-weighted contribution to today's variance forecast.

For equities, γ is typically positive and meaningful — bad days really do raise vol more than good days.

### 5.5 The innovation distribution — Normal vs Student-t

GARCH gives you a model for σ_t (the *conditional volatility*). To produce actual VaR or detect anomalies, you also need to assume something about the *distribution* of standardized returns z_t = r_t / σ_t.

The original GARCH papers assumed **Normal** innovations. This is wrong for equities — even after removing volatility clustering, the standardized residuals are still fat-tailed.

The dashboard uses **Student-t innovations**. The Student-t distribution is bell-shaped like the Normal but with an additional parameter ν (degrees of freedom) that controls tail fatness. As ν → ∞ the t becomes Normal; at small ν (3-6) the t has noticeably heavier tails. For daily equity returns the MLE typically picks ν ≈ 5-8, indicating heavy tails.

This switch matters concretely: switching from Normal-innovation GARCH to Student-t innovations raises the 99% VaR estimate by roughly 30-60% on typical equity data. The dashboard's GARCH-t and GJR-t columns both use this Student-t assumption.

### 5.6 Why this matters for anomaly detection

The point of GARCH for the anomaly detector isn't VaR — it's the **standardized residual**:

```
z̃_t = r_t / σ̂_t
```

where σ̂_t is the GARCH-forecasted conditional volatility for day t. If GARCH has correctly captured the asset's volatility regime, the z̃_t series should look approximately like Student-t innovations: roughly mean-zero, variance-one, with heavy tails matching the estimated ν.

An anomaly in this framework is a day where **|z̃_t| is large relative to what the volatility model expected**. This is different from raw z-score in a crucial way: raw z uses *historical* volatility (rolling 60-day), GARCH residual uses *forecasted* conditional volatility for *that specific day*.

If a stock has been quiet for months (low σ̂_t) and suddenly has a 4% move, raw z-score might say it's 4σ (using the high recent rolling σ would be a smaller z, but if rolling σ has been low too, z = 4 is plausible). GARCH residual on the same day might say z̃ = 8 — because the model was confidently forecasting low vol, and the move blew through that. The GARCH-residual flag catches *surprise relative to expectation*, not just unusual-relative-to-recent-history.

---

## Part 6 — Detector #3: GARCH-residual outliers

Combines everything from Part 5 into a sharp anomaly signal.

### 6.1 The detector definition

1. Fit a **GJR-GARCH(1,1,1)** model with **Student-t innovations** to the full return series of the asset.
2. Extract the **standardized residuals** z̃_t = (r_t − μ̂_t) / σ̂_t where μ̂ and σ̂ are model-implied conditional mean and standard deviation.
3. Flag any day with |z̃_t| ≥ 3.

The threshold of 3 has the same intuition as the raw z-score detector (a recognizable "extreme by standard rules of thumb" cutoff). Because residuals are standardized against the *correct* volatility forecast for that day, the residuals should be much closer to truly Normal-like than raw returns. So |z̃| ≥ 3 actually means something stronger here than |z| ≥ 3 in the raw z-score detector.

### 6.2 What this detector catches

- **Surprises after accounting for the current vol regime.** A 2% move on a day when σ̂_t was forecasting 0.3% is a 6.7σ residual — a genuine anomaly the GARCH model didn't see coming.
- **The opposite of "expected" — events that defy the conditional vol forecast.** This is qualitatively different from "big day relative to a flat rolling average."

### 6.3 What this detector misses

- **Days that fit the current vol regime, even if the regime itself is alarming.** If the asset has been in a chaotic regime with σ̂_t = 5%/day and today is another 5% day, the residual is z̃ = 1 — not flagged. Even though the asset is *itself* in stress.
- **Sustained drifts in the mean.** GARCH models variance, not mean. A series of 0.5% positive returns won't fire this detector even though CUSUM would.

### 6.4 The trinity — z-score, CUSUM, GARCH residual

The three detectors aren't redundant. They answer three different questions:

| Detector | Question | Fails when |
|---|---|---|
| Z-score | Was today big vs the recent neighborhood? | Vol regime has shifted; drift accumulated |
| CUSUM | Has the mean drifted from baseline? | Vol regime change; sharp single shocks |
| GARCH residual | Did today defy the conditional-vol forecast? | Drift in the mean; broad regime change at correct vol level |

A date hitting **multiple** detectors is a much stronger signal than any one firing alone. This is why the dashboard shows all three side-by-side and lists the recent-anomaly dates with which detectors fired.

---

## Part 7 — Factor models — what they are and what they aren't

The other big panel on the Anomaly Detector tab is a Fama-French + Momentum factor regression. Before we get to the math, let's build the intuition.

### 7.1 The motivating question

Why does any asset move on any given day? Different answers depending on the asset:

- **SPY** moves because the broad US equity market moves. If you wanted to forecast SPY's return tomorrow, "what is the market doing" explains nearly all of it.
- **A specific tech stock** moves partly because of the market, partly because of "tech-sector news," partly because of company-specific news (earnings, product launches, etc.).
- **A regional bank ETF** moves partly because of the market, partly because of "banking-sector news," partly because of "small-cap risk premium," partly because of company-specific news.

A **factor model** is a decomposition of returns into a small number of broad drivers (factors) plus a residual specific to each asset. Formally:

```
r_t = α + β₁·F₁_t + β₂·F₂_t + ... + β_k·F_k_t + ε_t
```

Where F_i are factor returns (e.g., "the market"), β_i are loadings (how sensitive the asset is to each factor), α is the average return after all factor exposures are accounted for, and ε_t is the **idiosyncratic** residual.

### 7.2 What this lets you do

- **Attribute risk:** what fraction of an asset's daily variance is explained by exposure to common factors vs idiosyncratic? Some sectors are nearly all factor-driven (XLK at 93% R² in our dashboard); others are heavily idiosyncratic (XLU at 30%).
- **Hedge:** if you know an asset's β to the market is 1.2, you can short 1.2 dollars of SPY per dollar of position to neutralize market risk.
- **Stress-test:** if you have a view that a particular factor (say "value") will fall 5%, you can compute the expected impact on any asset given its loading on that factor.
- **Find idiosyncratic alpha:** filter out factor-driven returns to isolate what's actually specific to the manager's stock picks.

### 7.3 What factor models aren't

A factor model is **not a forecast**. It's a decomposition of historical returns into pieces. It tells you what loadings the asset *has had*; whether those loadings are stable into the future is a separate question (usually they're roughly stable, but not always — that's the limitation of static-loadings models).

A factor model is also **not magic**. The factors you pick determine the decomposition you get. If you only include the market factor, every other exposure becomes "alpha + idiosyncratic noise." Adding factors moves stuff from the residual into structural exposures.

### 7.4 The simplest possible factor model — CAPM

The Capital Asset Pricing Model (Sharpe 1964) is the original factor model with exactly one factor: the market.

```
r_t - r_f = α + β · (r_market_t - r_f) + ε_t
```

Where r_f is the risk-free rate (Treasury bill yield). Both sides are excess returns over the risk-free rate. β is the asset's "market beta."

This is the simplest possible thing that works. Empirically, β explains a lot — for most stocks the market is the biggest single driver. But it leaves a lot in α + ε that turned out to have *structure*.

### 7.5 Beyond CAPM — what Fama and French noticed

In the early 1990s, **Eugene Fama** and **Kenneth French** showed that two characteristics of stocks systematically explain returns beyond what β captures:

- **Size:** small-cap stocks earn higher average returns than large-caps, beyond what their (typically higher) betas predict.
- **Value:** stocks with high book-to-market ratios ("value" stocks) earn higher returns than low book-to-market ("growth") stocks, beyond what β predicts.

Fama-French (1992, 1993) proposed a three-factor model:

```
r - r_f = α + β_mkt · (Mkt - r_f) + β_smb · SMB + β_hml · HML + ε
```

Where:
- **SMB** = "Small Minus Big" — the return of small-cap stocks minus large-cap stocks
- **HML** = "High Minus Low" — the return of high book-to-market (value) stocks minus low book-to-market (growth) stocks

This three-factor model became the standard baseline in academic finance and (more importantly for our purposes) practitioner risk modeling.

### 7.6 Carhart added momentum

**Carhart (1997)** showed that on top of FF3, a fourth factor explains additional variance:

- **MOM** (or UMD, "Up Minus Down") — the return of recent winners minus recent losers (typically stocks ranked on 12-month return)

The 4-factor "Carhart" model is FF3 + MOM. The dashboard includes this as the "Momentum" factor.

### 7.7 Fama-French 2015 added two more

**Fama-French (2015)** extended their original three-factor model by adding two more:

- **RMW** ("Robust Minus Weak") — the return of high-profitability firms minus low-profitability firms
- **CMA** ("Conservative Minus Aggressive") — the return of firms with conservative investment policies minus aggressive ones

The dashboard uses the full **FF5 + MOM** specification (six factors total). This is essentially the modern academic baseline.

### 7.8 Where do the factor returns come from?

Kenneth French maintains a free public data library at Dartmouth that publishes daily, monthly, and annual factor returns going back to 1926 (for the older factors) or 1963 (for the more recent ones). The dashboard fetches this directly on each backend run.

The construction is standard: every June each US stock is ranked on the relevant characteristic (size, book-to-market, etc.), portfolios are formed at quintile or tercile breakpoints, and the factor return is the difference between long-and-short legs. So **SMB on a given day = (return of small-cap portfolio) − (return of large-cap portfolio)** on that day.

Importantly, these are **risk premia** (returns to taking exposure to a characteristic), not market signals. They're not "the value style is up today" — they're "on a portfolio that's long value and short growth in equal weights, here's what you'd have earned today."

---

## Part 8 — Fama-French + Carhart, in detail

Now the math of fitting the model.

### 8.1 OLS regression — what it does

You have a sample of daily returns over some lookback window (the dashboard uses 252 trading days). For each day you have:

- The asset's excess return: r_t - r_f_t
- The factor returns for that day: F1_t, F2_t, ..., F6_t (six factors)

You want to find coefficients α, β1, ..., β6 such that:

```
r_t - r_f_t ≈ α + β1·F1_t + β2·F2_t + ... + β6·F6_t
```

OLS (**Ordinary Least Squares**) is the procedure that picks the coefficients to minimize the sum of squared residuals:

```
minimize Σ_t [ (r_t - r_f_t) - (α + Σ_i β_i · F_i_t) ]²
```

There's a closed-form solution involving matrix algebra — you can compute it in one numpy `lstsq` call. The dashboard does exactly that.

### 8.2 The output — what the numbers mean

For each factor you get back a **loading** β_i. The interpretation is precise:

> "If factor F_i rises by 1% on a given day, this asset's return is expected to rise by β_i × 1%, holding all other factors constant."

So a market β of 1.2 means a 1% market gain typically corresponds to a 1.2% gain in this asset. A negative HML loading of -0.3 means a 1% gain in value stocks corresponds to a 0.3% loss in this asset — i.e., the asset is growth-tilted.

**The intercept α** is the average daily return left over after all factor exposures are accounted for. If α is statistically significantly different from zero, the asset is earning a return that no combination of these six factors explains.

### 8.3 Statistical significance — t-stats and p-values

OLS gives you a coefficient β for each factor. But how sure are you that β isn't really zero (i.e., the asset doesn't actually have exposure to that factor)?

For each coefficient, OLS also gives you a **standard error** SE(β) — an estimate of how variable β would be if you re-ran the experiment with a different sample. From these you compute:

```
t-statistic: t = β / SE(β)
p-value: probability of seeing |t| this large under the null hypothesis that the true β is zero
```

Conventional interpretation:

- **t > 2** (or p < 0.05): statistically significant. The factor loading is meaningfully non-zero.
- **t > 2.6** (or p < 0.01): strongly significant.
- **t > 3.3** (or p < 0.001): very strongly significant.

The dashboard marks these with asterisks: *, **, ***. Non-significant rows are dimmed to indicate the loading isn't reliably different from zero.

### 8.4 R² — how much does the model explain?

The **R-squared** value is the fraction of the asset's return variance explained by the factors. Formally:

```
R² = 1 - (residual sum of squares) / (total sum of squares)
```

R² close to 1 means the factors explain almost everything. R² close to 0 means the factors barely matter for this asset.

Real-world spread:
- **XLK (Tech)**: R² ≈ 93% — almost entirely factor-driven.
- **XLI (Industrials)**: R² ≈ 85%
- **XLY (Consumer Disc)**: R² ≈ 83%
- **XLP (Consumer Staples)**: R² ≈ 31% — mostly idiosyncratic.
- **XLU (Utilities)**: R² ≈ 30% — utilities are heavily rates-driven, and rates aren't one of these six factors.

The R² spread itself tells you something: the factors here are *equity* factors. They don't capture rates or commodities-specific risk. Sectors that load on non-equity drivers (XLU on rates, XLE on oil) get lower R² because the model is incomplete *for them*.

### 8.5 The volatility decomposition

If R² is the fraction of variance explained by factors, then **1 − R²** is the fraction left over as idiosyncratic. From this:

```
σ_total = total daily return volatility (sample stdev)
σ_factor = σ_total · sqrt(R²)
σ_idio = σ_total · sqrt(1 − R²)
```

So if XLF has 20% annual total volatility and R² = 80%, then:
- Factor-attributable annualized vol = 20% · √0.80 ≈ 17.9%
- Idiosyncratic annualized vol = 20% · √0.20 ≈ 8.9%

This is exactly the breakdown the panel shows ("Annualized vol decomposition: total 20% · factor 18% · idiosyncratic 9%"). The vol decomposition is mathematically equivalent to the R² but it's more intuitive when discussing "how much risk is factor-driven vs name-specific."

### 8.6 What this dashboard does and what Barra-style adds

The dashboard's factor model:
- Six factors (Mkt-Rf, SMB, HML, RMW, CMA, MOM)
- 252-day lookback, OLS regression, daily return data
- Constant loadings within the lookback window
- Idiosyncratic risk inferred from R²

A Barra-style commercial factor model adds:
- **Many more factors** — sectors (11), countries (40+), currencies, duration, credit spread, style/quality refinements
- **Time-varying loadings** — daily-refit factor exposures
- **Specific-risk model** — separately estimated idiosyncratic risk model that accounts for company-specific characteristics (size, sector, etc.) rather than just inferring it from R²
- **Factor covariance shrinkage** — robust estimation methods for the factor-return covariance matrix
- **Pre-computed factor returns** with proprietary methodologies (Barra USE4M factors, e.g.)

So Fama-French here is conceptually doing the same job (decompose into factor + idiosyncratic) at a fraction of the granularity. For *equity sector ETFs* this is mostly enough because the dominant factors are already in the model. For *individual stocks*, sectors, countries, and currency exposures aren't captured — that's where Barra adds value.

### 8.7 Honest caveats

- **Factor returns are based on US stocks ranked at June each year.** International stock exposures aren't directly captured. A holding that's mostly European value stocks will have its returns regressed onto a US-based HML factor, which is similar but not identical.
- **Static loadings.** Real-world factor exposures drift over time (a company's size or value classification changes). The model assumes constant β over the 252-day window.
- **Backward-looking.** R² and loadings describe what's been the case for the last year. Going forward they're usually close but not guaranteed.
- **OLS is a single-period regression.** Time-series methods (rolling regression, Kalman filter) could let loadings evolve continuously, but they introduce noise.

---

## Part 9 — Reading the risk profile card

Above the factor regression in the Anomaly Detector tab is a "risk profile card" with a row of stat boxes. Quick translation of each.

### 9.1 60-day annualized vol

Sample standard deviation of the last 60 daily log returns × √252, in percent. The standard measure of how much an asset has been moving recently.

- **Low** (sector ETFs in calm markets): 10-15%
- **Typical equity** (S&P 500-like): 14-20%
- **Single liquid stocks**: 25-40%
- **Crypto / leveraged ETFs**: 50-100%+

### 9.2 β vs SPY

Beta of the asset against SPY over a 252-day OLS regression. The same idea as the "Market" factor loading in the FF model, but using SPY (a real tradable ETF) instead of the Mkt-Rf factor (an academic construct).

- **β = 1**: moves with SPY 1:1
- **β > 1**: amplified (riskier in market direction). XLK is typically 1.2-1.3.
- **β < 1**: muted. XLP and XLU are typically 0.4-0.7.
- **β < 0**: inversely correlated (rare for equity, common for inverse-leveraged ETFs and some Treasury positions).

### 9.3 VaR (HS), VaR (EWMA), VaR (GARCH-t), VaR (EVT)

The five VaR models from the Portfolio Risk tab, applied to the single ETF. All daily 1% VaR on a $100 position, in dollars.

- **HS** is empirical-tail (1st percentile of trailing 1,000 returns, no distributional assumption).
- **EWMA** is Gaussian-tail (RiskMetrics standard, λ = 0.94).
- **GARCH-t** is conditional-vol with Student-t innovations.
- **EVT** is GPD-fit to the worst losses.

For most equities you'll see HS ≤ EWMA ≤ GARCH-t ≤ EVT. The spread (especially EVT vs the others) is itself a signal of how heavy the tail is for that asset.

### 9.4 Tail α (Hill estimator)

A measure of how heavy the tail is, computed using the Hill estimator. Lower α = heavier tail.

- **α ≥ 4**: relatively well-behaved tail.
- **α ≈ 3-4**: typical for broad equity indices.
- **α ≈ 2-3**: noticeable fat-tail behavior, common for individual stocks and crypto.
- **α < 2**: extreme fat tails. Even the variance is theoretically undefined for α ≤ 2 in a true Pareto distribution.

If the tail α is below 3, weight the EVT VaR estimate more heavily than the Gaussian-based ones.

---

## Part 10 — A worked example: KRE (Regional Banks)

Walking through one ticker to bring everything together.

### 10.1 Pick the ticker

KRE = SPDR S&P Regional Banking ETF. About 130 underlying regional banks. Historically known for high market beta and significant value tilt. Episodic stress (e.g., the SVB collapse in March 2023).

### 10.2 Risk profile card readings (illustrative)

- 60d annualized vol: ~25%
- β vs SPY: ~1.1 (slightly amplified, regional banks aren't quite as cyclical as you'd guess)
- VaR (HS): $2.50
- VaR (EWMA): $2.20
- VaR (GARCH-t): $3.40
- VaR (EVT): $5.80
- Tail α: ~2.4 (heavy tails)

**Read:** The EVT-vs-EWMA gap ($5.80 vs $2.20, almost 3×) and the low α (2.4) both confirm KRE has fat tails. The EWMA number significantly understates true 99% loss. Take the GARCH-t or EVT estimates more seriously.

### 10.3 Factor regression readings (illustrative)

```
Loadings (KRE, 252-day lookback):
  Market (Mkt-Rf):  β = +1.23  ***
  SMB (size):       β = +0.82  ***       (small-cap tilt — regional banks)
  HML (value):      β = +1.24  ***       (deep value tilt — classic financials)
  RMW (profit):     β = +0.06              (no clear tilt)
  CMA (investment): β = -0.18              (slight aggressive tilt)
  Momentum (MOM):   β = +0.01              (no momentum exposure)
  α (intercept):   -0.07%/day, t = -1.54  (not significant)

R² = 84.5%
Vol decomp (annualized): total 28.3% · factor 26.0% · idiosyncratic 11.3%
```

**Read:** The asset's risk is 84.5% explained by factors, with the three big drivers being market (β = 1.23), small-cap exposure (β = 0.82), and deep value tilt (β = 1.24). Quality (RMW) and momentum exposures are flat. This profile is exactly what financial-economics theory predicts for a regional-banks fund. If you trade KRE you're essentially making a leveraged bet on small-cap value + market.

### 10.4 Anomaly detector readings (illustrative — March 2023 SVB event)

```
March 9 (Thu):  z = -3.8       (single-day shock)  → z-score fires
March 10 (Fri): z = -5.2       (catastrophic single-day) → all three fire
                CUSUM_neg = -7.4
                GARCH residual = -6.1
```

**Read:** On March 10, all three detectors fired simultaneously. Z-score caught the single-day shock. CUSUM caught that the drift had been building (March 9 already pushed S⁻ near threshold). GARCH residual caught that the move was extreme relative to KRE's *forecasted* conditional volatility for that day (the previous quiet weeks meant GARCH was expecting low vol).

Triple-firing on a single day is the strongest signal the detector suite can produce. The combination tells you: this wasn't just a big day (z-score), wasn't just a trending market (CUSUM), wasn't just an unexpected move (GARCH residual) — it was *all three*, which is what regime breaks look like.

---

## Part 11 — Limits, caveats, and what this primer doesn't cover

### 11.1 The detectors are univariate

Each detector operates on a single asset's return series. They don't know about cross-asset correlations or co-movement. A day where many assets all have moderate moves in the same direction (a "broad market" day) might not trigger anomaly detection on any single asset even though the joint event is rare. Detecting this requires multivariate methods (e.g., Mahalanobis distance, multivariate CUSUM, or copula-based approaches) which the dashboard doesn't implement.

### 11.2 The factor model is a single regression

We fit one OLS regression over 252 days. Real risk models use time-varying loadings — typically rolling regression or Kalman filtering. Static loadings can mis-attribute risk when the asset's actual exposure has shifted recently (e.g., during a sector rotation).

### 11.3 The factor model is US-equity-centric

All factor returns come from US stock portfolios. International exposures aren't captured. A "global" fund's HML loading will conflate US-value behavior with international-value behavior, which are correlated but not identical.

### 11.4 We don't cover regime-switching models

There's a richer family of models — **Hidden Markov Models, Markov-Switching GARCH, regime-switching regressions** — that explicitly classify each time period into one of a small number of "regimes" (calm, volatile, crisis). The dashboard's three detectors are simpler and don't explicitly model regime as a hidden variable. HMMs would be a natural next addition.

### 11.5 We don't cover multivariate tail dependence

Whether two assets crash together in the worst 1% of days is a different question than their correlation in calm times. Copula models, especially extreme-value copulas (Gumbel, Clayton, joint Hill), capture this. Out of scope here; the dashboard's correlation chart shows simple Pearson correlation across all market regimes.

### 11.6 We don't cover forward-looking risk

All metrics on the dashboard are backward-looking (computed from realized returns). Forward-looking risk would use options-implied volatility, term-structure measures, or risk-neutral density estimation. None of this is currently in the dashboard; it's a real gap for predictive use.

### 11.7 Statistical significance ≠ economic significance

A t = 3.0 loading is statistically significant but might be economically tiny (β = 0.03). Don't read every significance star as a "real" exposure — look at the β magnitude too.

### 11.8 Anomaly detection ≠ prediction

A flag means "today was unusual." It doesn't tell you what to do tomorrow. The detector is a **monitoring** tool — it surfaces events for human attention, not a directional signal you trade off.

---

## Glossary

- **α (alpha):** in the factor regression, the intercept — average return left over after all factor exposures are accounted for. Statistically significant alpha is rare and worth scrutinizing.
- **β (beta):** in the factor regression, the loading on a factor. β = 1 against the market means moves 1:1 with the market.
- **CUSUM:** Cumulative Sum chart. A statistical-process-control technique for detecting sustained shifts in the mean of a stream of measurements.
- **EVT:** Extreme Value Theory. The branch of statistics dealing with extreme events. Used here to fit a Generalized Pareto distribution to the worst losses for a more accurate tail-VaR estimate.
- **Fama-French (FF) factors:** Risk factors constructed by Eugene Fama and Kenneth French (1993, 2015) to explain stock returns beyond CAPM. Five-factor specification used here: market excess return, SMB (size), HML (value), RMW (profitability), CMA (investment).
- **Fat tails / heavy tails:** A distribution where extreme events are more likely than under a Normal distribution. Daily equity returns are universally fat-tailed.
- **GARCH:** Generalized Autoregressive Conditional Heteroskedasticity. A class of models for time-varying volatility. GARCH(1,1) is the most common and the workhorse model in the dashboard.
- **GJR-GARCH:** Glosten-Jagannathan-Runkle (1993) variant of GARCH that adds an asymmetric term — negative shocks raise volatility more than equally-sized positive shocks.
- **Hill estimator:** A method for estimating the tail index α of a heavy-tailed distribution. Lower α = heavier tail.
- **HML (High Minus Low):** Fama-French value factor. Returns of high book-to-market stocks (value) minus low book-to-market (growth).
- **Idiosyncratic risk:** The portion of an asset's risk that's specific to the asset itself, not explained by common factors. Computed as σ_total × √(1 − R²).
- **Kurtosis:** A single number measuring how heavy a distribution's tails are. Normal = 3; daily equity returns typically 5-15.
- **Log return:** Natural log of the price ratio: ln(P_t / P_{t-1}). Preferred over simple returns for statistical work because they're additive across time and more closely Normal.
- **Loading:** The coefficient (β) on a factor in a factor regression. Tells you how sensitive the asset is to that factor.
- **MOM (Momentum):** Carhart (1997) momentum factor. Returns of recent winners minus recent losers.
- **OLS (Ordinary Least Squares):** The standard regression procedure for fitting a linear model. Closed-form solution that minimizes sum of squared residuals.
- **p-value:** Probability of observing a test statistic at least as extreme as what was observed, under a null hypothesis. p < 0.05 is the conventional "significant" threshold.
- **R² (R-squared):** Fraction of variance in the response variable explained by the model. R² = 1 = perfect fit, R² = 0 = no explanatory power.
- **Residual:** The difference between a value predicted by a model and the value actually observed. In GARCH residual anomaly detection, the "anomaly" is when |residual| / σ is large.
- **RMW (Robust Minus Weak):** Fama-French (2015) profitability factor. Returns of high-profit firms minus low-profit firms.
- **SMB (Small Minus Big):** Fama-French size factor. Returns of small-cap stocks minus large-cap stocks.
- **Standard deviation (σ):** A measure of dispersion. For daily returns, the typical magnitude of day-to-day moves.
- **Standardized return / z-score:** Return divided by its standard deviation. Has units of "standard deviations from the mean."
- **Student-t distribution:** A bell-shaped distribution like the Normal but with heavier tails. Used as the innovation distribution in the dashboard's GARCH-t and GJR-t models because it better matches empirical equity-return tails.
- **Tail index (α):** Parameter measuring how fast a heavy-tailed distribution's tail decays. Lower = heavier.
- **Volatility:** Standard deviation of returns, often annualized.
- **z-score:** See standardized return.

---

## Further reading

If you want to go deeper, here's a roadmap of canonical references — books before papers.

**Books**

- **McNeil, Frey & Embrechts**, *Quantitative Risk Management* (Princeton, 2015). The standard reference for everything in this primer. Chapters 2-4 cover all the VaR / ES / EVT / Hill content; chapter 5 covers volatility models in depth.
- **Tsay**, *Analysis of Financial Time Series* (Wiley, 3rd ed). The standard quant-finance time-series book. Chapter on GARCH is the textbook treatment.
- **Embrechts, Klüppelberg & Mikosch**, *Modelling Extremal Events* (Springer, 1997). The mathematical reference for EVT.
- **Montgomery**, *Introduction to Statistical Quality Control* (Wiley). The textbook treatment of CUSUM and related SPC techniques.
- **Ilmanen**, *Expected Returns* (Wiley, 2011). Practitioner-style coverage of factor investing.

**Foundational papers (in approximately chronological reading order)**

- Markowitz (1952), "Portfolio Selection." Where modern portfolio theory begins.
- Sharpe (1964), "Capital Asset Prices." CAPM.
- Page (1954), "Continuous Inspection Schemes." Original CUSUM paper.
- Hill (1975), "A Simple General Approach to Inference About the Tail of a Distribution." The Hill estimator.
- Engle (1982), "Autoregressive Conditional Heteroscedasticity." Original ARCH paper.
- Bollerslev (1986), "Generalized Autoregressive Conditional Heteroskedasticity." GARCH(p,q).
- Fama & French (1993), "Common Risk Factors in the Returns on Stocks and Bonds." Three-factor model.
- Glosten, Jagannathan & Runkle (1993), "On the Relation between the Expected Value and the Volatility." GJR-GARCH.
- Carhart (1997), "On Persistence in Mutual Fund Performance." Momentum factor.
- Christoffersen (1998), "Evaluating Interval Forecasts." Backtesting independence test.
- Fama & French (2015), "A Five-Factor Asset Pricing Model." FF5.

**Web references**

- **Ken French Data Library** — https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html — free daily/monthly/annual factor data, the source for the regression in the dashboard.

---

*End of primer. Print double-sided. Highlight liberally.*
