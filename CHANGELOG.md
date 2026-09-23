# Changelog

## How versions work

RiskLens uses `MAJOR.MINOR.PATCH`, adapted for a dashboard rather than a code library. The question behind each number is what a returning reader has to do differently.

| Bump | When | Examples |
|---|---|---|
| **MAJOR** | A returning reader has to relearn something: the numbers mean something different, or views, tabs, or links move or disappear | tab restructure; a methodology change that shifts a headline figure; retired `?tab=` links |
| **MINOR** | Something new to read, and everything that was there still means the same | a new portfolio, section, or metric; a new scenario |
| **PATCH** | Nothing new to read | bug fixes, styling, copy, a quarterly holdings refresh |

The daily data refresh never changes the version; the "Data as of" date in the header covers that. The version shown in the header comes from `frontend/package.json`, and each release is tagged in git as `vX.Y.Z`.

## 2.0.0 — 2026-09

Reorganized around a risk function's questions.

**Changed (the reasons for the major bump)**
- Tabs are now Summary, Positioning, Extreme Risk, Stress, and Market Context. Summary is the landing view.
- Performance & Skill, Sector Spotlight, and the Optimizer are hidden from navigation. Links using `?tab=anomaly`, `?tab=performance`, or `?tab=optimizer` now open the Summary.
- Ex-ante figures come from a new 8-factor model (Fama-French 5, momentum, duration, credit) with an EWMA covariance, and each is shown beside its realized value.
- Growth ↔ value is measured against a growth-minus-value index spread instead of the value factor alone.
- For look-through funds, headline figures use the fund's own NAV, not the top-25 basket.

**Added**
- Summary tab: tolerance bands per mandate type (placeholders), beta, stress shortfall vs benchmark, VaR model check, exceptions list with owner and next step.
- Positioning tab: ex-ante active risk and beta vs realized, equity beta for stock/bond benchmarks, active factor exposures with t-stats.
- New Perspective Fund (R-6) look-through, from the quarterly portfolio disclosure.
- Stress scenarios also run on each benchmark; historical crises replayed on the fund's own price where it covers the whole window.

**Removed**
- DWLD look-through (still configured, hidden).

**Renamed**
- "Hypothetical Portfolio" is now "Sample 60/40+".
- Supporting documents moved into `docs/`; `TECH_REVIEW.md` is now `docs/ARCHITECTURE.md`.

## 1.0.0 — 2026-04

First release. The 1.x line was never bumped while features were added (factor risk decomposition, AI and semis exposure, scenario sliders, the ICA look-through, light theme); those are all included in 2.0.0.
