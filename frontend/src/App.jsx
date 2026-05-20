import { useEffect, useState, useMemo } from "react";
import RiskTable from "./components/RiskTable.jsx";
import HistoricalChart from "./components/HistoricalChart.jsx";
import CorrelationChart from "./components/CorrelationChart.jsx";
import MultiWindowCorrelationChart from "./components/MultiWindowCorrelationChart.jsx";
import IntradayCorrelationChart from "./components/IntradayCorrelationChart.jsx";
import PortfolioRiskChart from "./components/PortfolioRiskChart.jsx";
import BacktestPanel from "./components/BacktestPanel.jsx";
import ScenarioPanel from "./components/ScenarioPanel.jsx";
import FundDisclosurePanel from "./components/FundDisclosurePanel.jsx";
import InfoTip from "./components/InfoTip.jsx";
import "./App.css";

const NAV_LINKS = [
  { id: "risk-snapshot",   label: "Risk Snapshot" },
  { id: "fund-disclosure", label: "Fund Holdings", activeFundOnly: true },
  { id: "risk-trajectory", label: "Risk Trajectory" },
  { id: "model-validation", label: "Model Validation" },
  { id: "stress-tests",    label: "Stress Tests" },
  { id: "sp500-history",   label: "S&P 500 History" },
  { id: "correlation",     label: "Correlation" },
  { id: "multi-window-corr", label: "Multi-Window" },
  { id: "intraday-corr",   label: "Intraday Corr" },
];

// Short label shown on the portfolio summary row of the risk table.
// Falls back to a generic "PORTFOLIO" label for any unknown mode.
const PORTFOLIO_SHORT_LABELS = {
  hypothetical: "HYPOTHETICAL PORTFOLIO",
  tdf_2055:     "VANGUARD 2055",
  cg_2055:      "AF TARGET 2055",
  cggo_active:  "CGGO TOP-25 BASKET",
  dwld_active:  "DWLD TOP-25 BASKET",
};

// Curated literature references per section. Each entry is the canonical
// reference for the methodology in that section — not exhaustive, just the
// paper or book a reader would actually want to look at first.
const SECTION_REFERENCES = {
  "risk-snapshot": [
    { label: 'J.P. Morgan, "RiskMetrics — Technical Document" (1996)' },
    { label: 'Litterman, "Hot Spots and Hedges" (Goldman Sachs, 1996)' },
    { label: 'McNeil, Frey & Embrechts, "Quantitative Risk Management" (Princeton, 2015)' },
    { label: 'Hill, "A Simple General Approach to Inference About the Tail of a Distribution" (Annals of Statistics, 1975)', url: "https://doi.org/10.1214/aos/1176343247" },
  ],
  "risk-trajectory": [
    { label: 'Engle, "Autoregressive Conditional Heteroscedasticity" (Econometrica, 1982)', url: "https://doi.org/10.2307/1912773" },
    { label: 'Bollerslev, "Generalized ARCH" (J. Econometrics, 1986)', url: "https://doi.org/10.1016/0304-4076(86)90063-1" },
    { label: 'J.P. Morgan, "RiskMetrics — Technical Document" (1996)' },
  ],
  "model-validation": [
    { label: 'Kupiec, "Techniques for Verifying the Accuracy of Risk Measurement Models" (FRB FEDS, 1995)', url: "https://www.federalreserve.gov/econresdata/feds/1995/index.htm" },
    { label: 'Christoffersen, "Evaluating Interval Forecasts" (Int. Econ. Review, 1998)', url: "https://doi.org/10.2307/2527341" },
    { label: 'Glosten, Jagannathan & Runkle, "On the Relation between Expected Value and Volatility" (J. Finance, 1993)', url: "https://doi.org/10.1111/j.1540-6261.1993.tb05128.x" },
  ],
  "stress-tests": [
    { label: 'Berkowitz, "A Coherent Framework for Stress-Testing" (J. Risk, 1999)', url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=181931" },
    { label: 'BIS, "Stress testing principles" (Basel Committee on Banking Supervision, 2018)', url: "https://www.bis.org/bcbs/publ/d450.htm" },
    { label: 'Estrella & Trubin, "The Yield Curve as a Leading Indicator" (NY Fed Current Issues, 2006)', url: "https://www.newyorkfed.org/research/current_issues/ci12-5.html" },
  ],
  "sp500-history": [
    { label: 'Schwert, "Why Does Stock Market Volatility Change Over Time?" (J. Finance, 1989)', url: "https://doi.org/10.1111/j.1540-6261.1989.tb02647.x" },
    { label: 'CBOE, "VIX Index Methodology — White Paper"', url: "https://cdn.cboe.com/api/global/us_indices/governance/Volatility_Index_Methodology_Cboe_Volatility_Index.pdf" },
  ],
  "correlation": [
    { label: 'Forbes & Rigobon, "No Contagion, Only Interdependence" (J. Finance, 2002)', url: "https://doi.org/10.1111/0022-1082.00494" },
    { label: 'Longin & Solnik, "Extreme Correlation of International Equity Markets" (J. Finance, 2001)', url: "https://doi.org/10.1111/0022-1082.00340" },
    { label: 'Campbell, Pflueger & Viceira, "Macroeconomic Drivers of Bond and Equity Risks" (JPE, 2020)', url: "https://doi.org/10.1086/710552" },
  ],
  "multi-window-corr": [
    { label: 'Campbell, Sunderam & Viceira, "Inflation Bets or Deflation Hedges?" (Critical Finance Review, 2017)', url: "https://www.nber.org/papers/w14701" },
    { label: 'Pflueger, Siriwardane & Sunderam, "A Measure of Risk Appetite for the Macroeconomy" (NBER WP 27906, 2020)', url: "https://www.nber.org/papers/w27906" },
    { label: 'Engle, "Dynamic Conditional Correlation" (J. Bus. & Econ. Stat., 2002)', url: "https://doi.org/10.1198/073500102288618487" },
    { label: 'Ilmanen, "Expected Returns" (Wiley, 2011) — Ch. 19 on stock-bond correlation regimes' },
  ],
  "intraday-corr": [
    { label: 'Epps, "Comovements in Stock Prices in the Very Short Run" (JASA, 1979)', url: "https://doi.org/10.1080/01621459.1979.10481593" },
    { label: 'Andersen, Bollerslev, Diebold & Labys, "The Distribution of Realized Exchange Rate Volatility" (JASA, 2001)' },
    { label: 'Pflueger, Siriwardane & Sunderam, "A Measure of Risk Appetite for the Macroeconomy" (NBER WP 27906, 2020)', url: "https://www.nber.org/papers/w27906" },
    { label: 'Campbell, Pflueger & Viceira, "Macroeconomic Drivers of Bond and Equity Risks" (JPE, 2020)', url: "https://doi.org/10.1086/710552" },
  ],
};

function SectionReferences({ sectionId }) {
  const refs = SECTION_REFERENCES[sectionId];
  if (!refs?.length) return null;
  return (
    <div className="section-refs">
      <span className="section-refs-label">Literature</span>
      {refs.map((r, i) => (
        <span key={i} className="section-refs-item">
          {r.url
            ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a>
            : <span>{r.label}</span>}
          {i < refs.length - 1 ? <span className="section-refs-sep"> · </span> : null}
        </span>
      ))}
    </div>
  );
}

// Reusable section wrapper: collapsed-by-default description + literature.
// Title and chart are always visible; clicking the small button next to the
// title reveals the description above the chart and the references below.
function Section({ id, title, question, description, children }) {
  const [expanded, setExpanded] = useState(false);
  const hasRefs = SECTION_REFERENCES[id]?.length > 0;
  const hasMeta = description || hasRefs;

  return (
    <section id={id} className="section">
      <div className="section-header">
        <div className="section-title-row">
          <span className="section-title">{title}</span>
          {question && (
            <span className="section-question">({question})</span>
          )}
          {hasMeta && (
            <button
              className={`section-meta-toggle${expanded ? " open" : ""}`}
              onClick={() => setExpanded((o) => !o)}
              aria-expanded={expanded}
              title="Toggle description and references"
            >
              {expanded ? "▾ Hide details" : "ⓘ About this section"}
            </button>
          )}
        </div>
        {expanded && description && (
          <span className="section-desc">{description}</span>
        )}
        {expanded && hasRefs && <SectionReferences sectionId={id} />}
      </div>
      {children}
    </section>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("hypothetical");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/risk_output.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (!json.portfolios) {
          throw new Error("No portfolio data — run the backend first.");
        }
        setData(json);
        setMode(json.default_mode ?? "hypothetical");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const fmtDate = (iso) => {
    if (!iso) return "";
    // Parse YYYY-MM-DD as a date-only value (no time-zone fiddling)
    const [y, m, d] = iso.split("-").map(Number);
    const dateStr = new Date(y, m - 1, d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    // All US assets reference the 4:00 PM ET market close — standard data-as-of convention
    return `${dateStr} · 4:00 PM ET`;
  };

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Active portfolio bundle (assets + scenarios + weights for selected mode)
  const portfolio = data?.portfolios?.[mode];
  const modeKeys = data ? Object.keys(data.portfolios) : [];

  // Pre-compute cross-mode comparison data for each scenario id
  // (lets the headline P&L hover show "this portfolio vs others")
  const scenarioComparisons = useMemo(() => {
    if (!data?.portfolios) return {};
    const map = {};
    for (const [key, mode] of Object.entries(data.portfolios)) {
      for (const s of mode.scenarios ?? []) {
        if (!map[s.id]) map[s.id] = {};
        map[s.id][key] = { label: mode.label, pnl: s.portfolio_pnl };
      }
    }
    return map;
  }, [data]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo">RISK<span className="logo-accent">LENS</span></span>
        </div>
        {data && (
          <div className="generated-at">
            <span className="label">Data as of</span>
            <span className="value">{fmtDate(data.data_as_of)}</span>
          </div>
        )}
      </header>

      {data && (
        <nav className="page-nav">
          <span className="nav-label">Sections:</span>
          {NAV_LINKS
            .filter(({ activeFundOnly }) => !activeFundOnly || portfolio?.is_active_fund_spotlight)
            .map(({ id, label }) => (
              <button key={id} className="nav-btn" onClick={() => scrollTo(id)}>
                {label}
              </button>
            ))}
          <a
            href="https://github.com/KLDGH/risklens/blob/main/FAQ.md"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-btn nav-external"
          >
            Methodology &amp; FAQ ↗
          </a>
        </nav>
      )}

      {portfolio && (
        <div className="mode-bar">
          <div className="mode-toggle">
            {modeKeys.map((k) => (
              <button
                key={k}
                className={`mode-btn ${mode === k ? "active" : ""}`}
                onClick={() => setMode(k)}
              >
                {data.portfolios[k].label}
              </button>
            ))}
          </div>
          <div className="mode-info">
            <span className="mode-label">Active portfolio</span>
            <span className="mode-name">{portfolio.label}</span>
            <span className="mode-desc">{portfolio.description}</span>
          </div>
        </div>
      )}

      <div className="legend">
        <span className="legend-item"><span className="dot green" />Low risk (&lt;2.5)</span>
        <span className="legend-item"><span className="dot yellow" />Elevated (2.5–5)</span>
        <span className="legend-item"><span className="dot red" />High (&gt;5)<InfoTip text="These thresholds are pragmatic rules of thumb, not a regulatory standard. Calibrated for daily 1% VaR on liquid ETFs: diversified US equity (SPY) historically sits around 1.5–2.5%; sector ETFs 2–3%; individual stocks 3–5%; crypto and volatile names often 5%+. Different asset classes warrant different thresholds, which is why the per-asset Risk gauge (percentile rank vs 2-year history) is the more rigorous comparison on this page." /></span>
        <span className="legend-item legend-note">VaR expressed as $ loss on $100 portfolio</span>
      </div>

      <main className="main">
        {loading && (
          <div className="state-msg">
            <span className="blink">█</span> Loading risk data...
          </div>
        )}
        {error && (
          <div className="state-msg error">
            <span className="label">ERROR</span> {error}
            <div className="hint">Run <code>python backend/run.py</code> to generate data.</div>
          </div>
        )}
        {portfolio && (
          <Section
            id="risk-snapshot"
            title="Current Risk Snapshot"
            question="How risky is each asset today vs. its own recent history?"
            description="How risky is each asset today, relative to its own two-year history? Rows default-sorted by risk level. VaR = the minimum expected loss on the worst 1% of trading days, on a $100 position. Five models are shown spanning Normal-vs-heavy-tailed and constant-vs-conditional-volatility assumptions — disagreement between them is itself the signal. EWMA assumes Normal innovations; GARCH/tGARCH use Student-t (heavy-tailed, fit per asset); EVT explicitly models the tail with a generalized Pareto distribution. The EWMA-vs-GARCH gap is roughly the heavy-tail premium for that asset."
          >
            <RiskTable
              assets={portfolio.assets}
              portfolioWeights={portfolio.weights}
              disclosedWeights={portfolio.disclosed_weights}
              fundTicker={portfolio.fund_ticker}
              portfolioLabel={PORTFOLIO_SHORT_LABELS[mode] ?? "PORTFOLIO"}
            />
          </Section>
        )}
        {portfolio?.is_active_fund_spotlight && portfolio?.fund_disclosure && (
          <Section
            id="fund-disclosure"
            title="Fund Holdings — Disclosed"
            question="What is this active fund actually holding right now?"
            description="Reference panel for the spotlighted active ETF: sponsor metadata, concentration stats, and the full disclosed holdings list. The Risk Snapshot above models a *look-through basket* of the top 25 disclosed holdings (re-normalized to sum to 100%), so each underlying has its own VaR/ES/EVT row. The fund's own ETF appears as a final reference row in that table — its NAV-based risk vs. the basket is itself an interesting comparison (basket is static at disclosure date and ignores expense ratio; fund NAV reflects continuous trading + costs)."
          >
            <FundDisclosurePanel
              disclosure={portfolio.fund_disclosure}
              coverageMeta={portfolio.coverage_meta}
            />
          </Section>
        )}
        {portfolio?.risk_history?.length > 0 && (
          <Section
            id="risk-trajectory"
            title="Portfolio Risk Trajectory"
            question="How has the portfolio's daily risk moved over time?"
            description="How has the active portfolio's daily risk evolved over time? This is the same EWMA VaR as the portfolio summary row in the table above, computed every trading day rather than just today's snapshot. Spikes line up with crises; the gradual return to baseline shows how regimes resolve. The history depth depends on which mode is selected — Vanguard reaches back to 2014, American Funds to 2007."
          >
            <PortfolioRiskChart data={portfolio.risk_history} portfolioLabel={portfolio.label} />
          </Section>
        )}
        {portfolio?.backtests && (
          <Section
            id="model-validation"
            title="VaR Model Validation"
            question="Are these risk models well-calibrated?"
            description="Out-of-sample backtest of HS, EWMA, and EVT VaR models on the active portfolio. For each of the last 504 trading days, the model is given only the prior 1000 days to forecast that day's 1% VaR; we then compare against actual realized losses. The Kupiec test checks whether the observed exception rate matches the expected 1%; the Christoffersen test checks whether exceptions cluster (a sign of time-varying risk the model misses)."
          >
            <BacktestPanel data={portfolio.backtests} portfolioLabel={portfolio.label} />
          </Section>
        )}
        {portfolio?.scenarios && (
          <Section
            id="stress-tests"
            title="Historical Stress Tests & Scenarios"
            question="How would the portfolio handle past crises and plausible shocks?"
            description="How would the active portfolio have performed during major market crises (data-driven), and how might it respond to forward-looking scenarios (assumption-driven)? Each card shows total P&L and which holdings hurt — or helped — the most."
          >
            <ScenarioPanel
              scenarios={portfolio.scenarios}
              weights={portfolio.weights}
              comparisons={scenarioComparisons}
              currentMode={mode}
            />
          </Section>
        )}
        {data?.sp500_history && (
          <Section
            id="sp500-history"
            title="Market Context — S&P 500 Historical Risk"
            question="How does today's equity stress compare to history?"
            description="How has U.S. equity market stress evolved year by year? Each bar shows the range of modeled daily loss estimates for that year. Reference data — does not change with portfolio toggle."
          >
            <HistoricalChart data={data.sp500_history} />
          </Section>
        )}
        {data?.correlation_history && (
          <Section
            id="correlation"
            title="Market Context — Cross-Asset Correlation"
            question="Is diversification still working across asset classes?"
            description="Are markets moving in lockstep? When assets rise together, diversification breaks down and portfolio risk is higher than any single holding suggests. Reference data — does not change with portfolio toggle."
          >
            <CorrelationChart data={data.correlation_history} />
          </Section>
        )}
        {data?.multi_window_corr && Object.keys(data.multi_window_corr).length > 0 && (
          <Section
            id="multi-window-corr"
            title="Market Context — Stock-Bond Correlation Across Time Scales"
            question="Has the stock-bond relationship shifted recently?"
            description="SPY × bond correlation at three rolling-window lengths simultaneously, across four bond proxies. Different windows reveal different time scales of regime change. The 20-day line picks up recent shifts; the 252-day line is a slow-moving annual average. When the two diverge sharply, you're seeing a regime change before slower measures register it. Toggle the bond proxy to see how the regime shows up across the bond-market spectrum (broad aggregate AGG, long-duration TLT, intermediate IEF, IG corporate LQD)."
          >
            <MultiWindowCorrelationChart data={data.multi_window_corr} />
          </Section>
        )}
        {data?.intraday_corr_history && (
          Array.isArray(data.intraday_corr_history)
            ? data.intraday_corr_history.length > 0
            : Object.values(data.intraday_corr_history).some((s) => s?.length > 0)
        ) && (
          <Section
            id="intraday-corr"
            title="Market Context — Intraday Stock-Bond Correlation"
            question="Is the very recent regime different from the daily-data picture?"
            description="A leading version of the chart above. Each bar is one trading day's SPY-TLT correlation computed from intraday bars — so each daily value is statistically meaningful on its own. A run of consecutive same-sign days is a much sharper regime-shift signal than the smoothed 60-day daily-data correlation can produce. Free intraday data via yfinance, limited to the last 60 trading days."
          >
            <IntradayCorrelationChart data={data.intraday_corr_history} />
          </Section>
        )}
      </main>

      <footer className="footer">
        <span>VaR models: Historical Simulation · EWMA (λ=0.94) · GARCH(1,1)</span>
        <span>Data via yfinance · Not financial advice</span>
      </footer>
    </div>
  );
}
