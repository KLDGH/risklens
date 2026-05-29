# RiskLens — Legal & Disclaimers

*Last updated: 2026*

---

## TL;DR

RiskLens is a personal, non-commercial, open-source project. It is **not** financial, investment, trading, hedging, risk-management, tax, or legal advice — for any audience, in any jurisdiction. The numbers it displays are produced by publicly-known statistical methods applied to publicly-available price data. They are for educational and methodology-illustration purposes only. **Use at your own risk.**

If you make any investment or risk-management decision based on what's shown here, you accept full responsibility for the outcome. Past performance and historical risk metrics never indicate future results.

---

## 1. No advice

Nothing on this site or in this repository constitutes:

- Investment advice or a recommendation to buy, sell, hold, or take a position in any security, fund, ETF, derivative, currency, commodity, or financial instrument.
- Financial planning, tax, accounting, legal, or actuarial advice.
- A solicitation, offer, or invitation to buy or sell anything.
- A personalized assessment of any reader's circumstances, risk tolerance, or objectives.

The author is **not** a registered investment advisor, broker-dealer, commodity trading advisor, or similar regulated entity in any jurisdiction.

If you need investment advice, talk to a qualified professional licensed in your jurisdiction.

## 2. Educational and illustrative only

The dashboard exists as a transparent reference implementation of techniques used in quantitative risk management. Its purpose is to **show how the math works**, not to drive decisions. The methodology is open in `backend/risk_engine.py`, `backend/factor_models.py`, and the supporting documents (`README.md`, `FAQ.md`, `TECH_REVIEW.md`) precisely so readers can inspect, learn from, and improve the implementation.

Any conclusion drawn from the displayed numbers should be tested against your own judgment and other sources. Don't outsource thinking to a dashboard built by one person on weekends.

## 3. No warranty — the software

This software is provided **"AS IS"**, without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, non-infringement, and accuracy. See `LICENSE` (MIT) for the formal warranty disclaimer covering the software's source code.

## 4. No warranty — the output

The MIT license disclaims warranties on the **software code**. This document additionally disclaims warranties on the **numbers the software produces**:

- The author makes no representation that any displayed risk metric, scenario P&L, factor loading, anomaly flag, or other figure is accurate, complete, current, fit for any specific use, or free from error.
- The models implemented (Historical Simulation, EWMA, GARCH-t, GJR-t, EVT, Page CUSUM, Fama-French regression, etc.) are widely-published statistical methods with well-documented limitations. They are known to fail in specific regimes, and the dashboard surfaces some of those failure modes (in the Model Validation tab) precisely because no model is universally reliable.
- Historical risk does not predict future risk. A model that has been "well-calibrated" on the trailing 504 days can fail dramatically tomorrow.

## 5. Data sources

Price data comes from **Yahoo Finance via the `yfinance` Python library**. yfinance is a community-maintained scraper, not an official Yahoo product. Data may be:

- Delayed (typically one business day)
- Incomplete (missing tickers, missing days, ticker changes)
- Inconsistent (split/dividend adjustments occasionally misapplied)
- Withdrawn (Yahoo may change or remove data without notice)

The author has no control over upstream data quality. The dashboard's "Data as of" timestamp shows the latest trading day represented in the snapshot; the actual figures may differ from the canonical source on the same day.

Factor data (Mkt-Rf, SMB, HML, RMW, CMA, MOM) comes from the **Ken French Data Library** at Dartmouth, which is publicly published and updated periodically. See https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html for the source data and its terms of use.

Active-fund holdings come from publicly-disclosed sponsor filings (Capital Group daily-holdings xlsx, Davis Advisors daily-holdings csv). These are the sponsors' own disclosures and are subject to whatever revision the sponsor makes.

## 6. Third-party trademarks and references

The dashboard references the following third-party products and trademarks, all owned by their respective holders. **No affiliation, endorsement, sponsorship, or partnership is implied or claimed.** References are illustrative — to show how the methodology applies to publicly-traded instruments — and used in a nominative-fair-use capacity:

- **Bloomberg PORT**, **MSCI BarraOne**, **FactSet**, **Aladdin**, **Axioma** — referenced as commercial risk systems for comparison purposes.
- **SPDR**, **iShares**, **Vanguard**, **Invesco**, **PowerShares**, **Capital Group**, **American Funds**, **Davis Advisors**, **Dimensional**, **T. Rowe Price**, **Fidelity**, **JPMorgan**, **Polen Capital** — referenced as ETF/fund sponsors of instruments included in one or more portfolio modes.
- Specific tickers (SPY, QQQ, GLD, TLT, EEM, BTC-USD, IWM, HYG, LQD, XLF, VNQ, EFA, IEF, TIP, DBC, BND, BNDX, VTI, VXUS, KRE, SMH, IBB, XLK, XLE, XLV, XLY, XLP, XLU, XLB, XLRE, XLC, AGTHX, AIVSX, ANCFX, AWSHX, AMRMX, ANWPX, AEPGX, CWGIX, NEWFX, SMCWX, ABNDX, AMUSX, CGGO, DWLD, ...).
- **Yahoo Finance** — the data source via yfinance.
- **MIT License** for the open-source code.
- Quantitative methods named after their academic originators (Fama-French, Carhart, Glosten-Jagannathan-Runkle, Aït-Sahalia–Fan–Xiu, Christoffersen, Kupiec, Page, Roberts, Engle, Bollerslev, Hill, Estrella-Trubin, Hamilton, Rabiner, and others) are public-domain methodologies; citation is by reference, not for any commercial purpose.

If you are a holder of any trademark referenced here and would like the reference removed or modified, open an issue on the GitHub repository and the author will address it.

## 7. Hypothetical scenarios are illustrative

The four hypothetical stress-test scenarios (Taiwan Invasion, Iran Conflict / Oil Shock, U.S. Recession, AI Bubble Burst) use **analyst-estimated shock vectors** — informed guesses about how prices might move conditional on each scenario occurring. These are **not forecasts**. They are not based on any proprietary model, market signal, or insider information. They are illustrative of the methodology's *form*, not predictions of the world's behavior.

The probability links shown alongside each hypothetical scenario (Polymarket, Metaculus, CSIS war-game reports, CBOE SKEW, Shiller CAPE, NY Fed yield-curve model) are public references the reader can consult to form their own probability views. The dashboard does not endorse any of these sources and does not synthesize them into a single probability estimate.

## 8. User responsibility

By accessing the dashboard or this repository, you agree that:

- You are using it at your own risk and on your own initiative.
- You will not rely on it as the sole or primary basis for any financial, investment, hedging, or risk-management decision.
- You understand that all figures are subject to estimation error, model risk, data error, and the inherent unpredictability of financial markets.
- You will not hold the author liable for any loss, damage, missed opportunity, regulatory consequence, or other adverse outcome arising from your use of, reliance on, or interpretation of anything displayed.
- If you redistribute, modify, fork, or build on the code under the MIT license, you are responsible for the use and presentation of your derived work in your jurisdiction.

## 9. Limitation of liability

To the maximum extent permitted by applicable law, the author shall not be liable for any direct, indirect, incidental, consequential, special, exemplary, or punitive damages arising out of or in connection with the use of, or inability to use, the RiskLens software, its output, or this repository — including but not limited to lost profits, lost opportunities, business interruption, loss of data, or any other commercial or non-commercial damages or losses, even if advised of the possibility of such damages.

Some jurisdictions do not allow the exclusion or limitation of certain damages, so the above limitations may not apply in your jurisdiction.

## 10. Privacy

The deployed dashboard at https://kldgh.github.io/risklens/ is a **static site** hosted on GitHub Pages. The author does not operate any backend server, database, analytics pipeline, or user-tracking infrastructure of their own. GitHub itself collects standard request logs as part of running its Pages service — those are subject to GitHub's own privacy policy (see https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

The dashboard does not set cookies, use local-storage telemetry, or transmit any user data to the author. The only local-storage usage is to remember the user's theme preference (`risklens-theme: dark | light`) — this is stored only in the user's own browser and never transmitted anywhere.

## 11. Jurisdiction

This project is published in the United States by an individual. The dashboard is accessible globally via GitHub Pages but is not specifically targeted at, marketed in, or available to investors in any specific jurisdiction. Visitors are responsible for ensuring that their use complies with their local law.

The MIT License covering the source code is interpreted under its standard terms. To the extent a court of competent jurisdiction holds that any provision of this document is unenforceable, the remainder of the document remains in effect.

## 12. Changes to this document

This document may be updated from time to time. The version in the `main` branch of the repository at https://github.com/KLDGH/risklens is the current version. Significant changes will be reflected in the commit history.

---

## License (re-statement)

The software is licensed under the MIT License. See `LICENSE` in the repository root for the formal text. In summary: you may use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the software, free of charge, including for commercial purposes, provided that the original copyright notice and the MIT permission notice are preserved.

The MIT License covers the **software code** only. The disclaimers in this document apply additionally to the **output, data, and methodology presentation** of the dashboard, and persist whether or not the code is forked or redistributed.

---

## Contact

Questions, takedown requests for any third-party reference, or other legal correspondence: open an issue at https://github.com/KLDGH/risklens/issues.
