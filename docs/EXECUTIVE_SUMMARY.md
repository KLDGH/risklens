# RiskLens: Executive Summary

## What it is

RiskLens is a daily-refresh investment risk dashboard built from public data, with every method in the open rather than behind a vendor license. It covers seven portfolios: an illustrative diversified book, a 60/40 allocation ETF, two target-date funds (one passive, one active), and three Capital Group equity funds modeled through their disclosed holdings: the CGGO global growth ETF, The Investment Company of America, and New Perspective Fund.

For each portfolio it answers four questions a risk function asks, in this order: which books need attention, where each book is positioned against its benchmark, how bad a day, month, or year can get, and what a replay of a past crisis would do to today's holdings. Refresh is automatic every weekday.

**Live at https://kldgh.github.io/risklens/**

## Five tabs, five questions

**Summary**: *Which portfolios need attention, and why?* One row per portfolio, worst first. Each is read against a tolerance band for its mandate type, with its beta, its largest stress shortfall against the benchmark, and whether its risk models pass their backtests. Every breach becomes a line in an exceptions list with a suggested owner and next step. This is the view built for a senior reader who doesn't need the factor tables.

**Positioning**: *Where is this portfolio positioned, right now?* Predicted (ex-ante) active risk and beta against the benchmark, each shown next to what actually happened over the same year, plus a growth ↔ value read and the factor exposures driving the active risk. Also shows how much of the book's risk comes from AI and semiconductors.

**Extreme Risk**: *How bad can it get, and do the models hold up?* Five loss models per holding and per portfolio, monthly and one-year downside, each holding's contribution to portfolio risk, and formal backtests of every model against realized losses.

**Stress**: *What would past crises and plausible shocks do?* Five historical crises replayed on today's holdings, plus four forward-looking scenarios whose assumptions can be adjusted with sliders.

**Market Context**: *What regime is the market in?* Long-run S&P 500 risk and VIX, cross-asset correlation, and whether stocks and bonds are still diversifying each other.

## What makes it useful

- **Exception-first.** The Summary tab shows what is out of bounds and who owns it, rather than a wall of metrics. This mirrors how large managers report investment risk upward: agreed ranges per portfolio, breaches flagged, escalation tracked.
- **Predicted and realized side by side.** Commercial risk systems report predicted figures; fund fact sheets report trailing realized ones. RiskLens shows both, and the gap between them is itself a signal that risk is rising or falling.
- **Fund-level truth, holding-level detail.** For the Capital Group funds, headline risk comes from the fund's own daily price, while the factor and holding breakdowns come from its top 25 disclosed holdings. The page states how much of the fund those 25 names cover.
- **Differences that matter.** CGGO and New Perspective share a style family and a benchmark, yet CGGO runs roughly two and a half times the active risk and a higher beta. That is the kind of contrast a risk review should surface.
- **Model governance built in.** Every loss model is backtested against what actually happened, with a verdict on how it fails (too low, or slow to react when volatility jumps), not just whether.

## Methodology in brief

- **Positioning model.** Eight factors: the five Fama-French equity factors, momentum, and two macro factors for duration and credit so stock/bond funds are modeled too. The factor covariance weights recent months more heavily (about a six-month half-life), so predictions lean toward the current regime.
- **Growth ↔ value.** Measured directly against a growth-minus-value index spread, with market moves stripped out, and only called a tilt when statistically significant. The standard value factor alone misreads modern growth funds as neutral.
- **Loss models.** Historical simulation, EWMA, GARCH with fat tails, an asymmetric GARCH variant, and extreme value theory, each on a 1,000-day window. When they disagree, the disagreement is information.
- **Backtesting.** Standard frequency and clustering tests (Kupiec, Christoffersen) on the full available out-of-sample history.
- **Stress.** Historical scenarios replay actual prices. Forward scenarios apply analyst-set shocks by asset class, region, and sector; the sliders scale those assumptions and say plainly that this is not a factor model.

## What it's good for

- **A senior-level risk read** on a handful of portfolios in one screen.
- **Mandate checks**: is each fund running the kind of risk its mandate implies?
- **Pre-event diligence**: how exposed is a book to the scenario you're worried about?
- **Model skepticism**: when the loss models disagree, or fail their backtests, the numbers deserve less weight.
- **A reference implementation** of institutional techniques that can be read line by line.

## What it's not

Not a signal generator, not a trading system, and not a replacement for a vendor risk platform. It monitors how risk is changing and which model assumptions are under strain. Risk figures describe how bad things are, not how bad they are about to get.

Tolerance bands on the Summary tab are placeholders. Real limits belong to the independent investment risk function, agreed with each portfolio manager.

## Position vs commercial risk systems

| | RiskLens | Vendor systems (Barra, Axioma, Aladdin, Bloomberg PORT) |
|---|---|---|
| Ex-ante model | 8 factors, estimated from returns | 40+ factors incl. industry, country, currency; estimated from security characteristics |
| Loss models | 5 (HS, EWMA, GARCH-t, GJR-t, EVT) | Same families, often with proprietary refinements |
| Backtesting | Kupiec + Christoffersen on all 5 | Same plus regulatory-format reports |
| Holdings | Public disclosures; mutual funds quarterly with a lag | Daily holdings feeds |
| Asset universe | Liquid public ETFs, mutual funds, and their holdings | Thousands of asset types incl. private credit, derivatives |
| Transparency | Fully open source | Licensed, largely opaque |
| Data | Yahoo Finance + Ken French Data Library | Bloomberg / Refinitiv / proprietary |
| Operational maturity | Personal project, no SLA | Enterprise-grade with audit and compliance |

The trade: every method is exposed and every number is reproducible, at the cost of a smaller factor model, lagged public holdings, and no enterprise reliability. The known gaps (no industry or country factors, top-25 look-through, trailing-regression exposures) are stated on the page where they affect a number.

## Bottom line

RiskLens shows what an exception-first investment risk view looks like on real Capital Group funds, using only public data: which funds are out of bounds, why, and whether the models behind that call can be trusted. It is best used as a demonstration and discussion tool for a risk function, a teaching reference, or an inspection layer alongside a vendor system that handles production.
