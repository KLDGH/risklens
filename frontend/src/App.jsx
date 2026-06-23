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
import {
  SectorSelector,
  RiskProfileCard,
  FactorRegressionPanel,
  ThematicExposurePanel,
  RollingFactorLoadingsPanel,
  AnomalySignalsPanel,
} from "./components/AnomalyDetectorPanel.jsx";
import OptimizerPanel from "./components/OptimizerPanel.jsx";
import InfoTip from "./components/InfoTip.jsx";
import "./App.css";

// Top-level tabs. Each owns a coherent slice of the dashboard so users
// don't have to scroll across 8+ sections to find what they want.
//   - portfolio: everything that responds to the active portfolio mode
//   - market:    portfolio-independent market context
//   - anomaly:   single-asset deep-dive (Sector Spotlight) — risk
//                profile, factor models, thematic exposures, anomaly
//                detectors per sector ETF. (Internal id is "anomaly"
//                for backwards-compat; user-facing label is "Sector
//                Spotlight".)
const TABS = [
  { id: "portfolio", label: "Portfolio Risk" },
  { id: "market",    label: "Market Context" },
  { id: "anomaly",   label: "Sector Spotlight" },
  // Optimizer tab hidden for now (its "reference book" benchmark concept is being
  // reconciled with a consistent app-wide benchmark treatment). Component, data,
  // and render block are all kept intact — re-add this entry + "optimizer" to
  // VALID_TABS to restore.
  // { id: "optimizer", label: "Optimizer" },
];

// Short label shown on the portfolio summary row of the risk table.
// Falls back to a generic "PORTFOLIO" label for any unknown mode.
const PORTFOLIO_SHORT_LABELS = {
  aor:          "ISHARES CORE 60/40 (AOR)",
  hypothetical: "HYPOTHETICAL PORTFOLIO",
  tdf_2055:     "VANGUARD 2055",
  cg_2035:      "AF TARGET 2035",
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
  "optimizer": [
    { label: 'Markowitz, "Portfolio Selection" (J. Finance, 1952)', url: "https://doi.org/10.2307/2975974" },
    { label: 'Ledoit & Wolf, "A Well-Conditioned Estimator for Large-Dimensional Covariance Matrices" (J. Multivariate Analysis, 2004)', url: "https://doi.org/10.1016/S0047-259X(03)00096-4" },
    { label: 'Maillard, Roncalli & Teïletche, "The Properties of Equally Weighted Risk Contribution Portfolios" (J. Portfolio Mgmt, 2010)', url: "https://doi.org/10.3905/jpm.2010.36.4.060" },
    { label: 'DeMiguel, Garlappi & Uppal, "Optimal Versus Naive Diversification" (RFS, 2009)', url: "https://doi.org/10.1093/rfs/hhm075" },
    { label: 'Michaud, "The Markowitz Optimization Enigma: Is Optimized Optimal?" (FAJ, 1989)', url: "https://doi.org/10.2469/faj.v45.n1.31" },
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
  // Collapse hides the section's content (chart/table/panel) while keeping the
  // header, so you can fold away e.g. the VaR table and focus on the chart
  // below. Persisted per-section in localStorage so it sticks across reloads
  // and portfolio switches.
  const storageKey = `risklens.collapsed.${id}`;
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const hasRefs = SECTION_REFERENCES[id]?.length > 0;
  const hasMeta = description || hasRefs;

  return (
    <section id={id} className={`section${collapsed ? " collapsed" : ""}`}>
      <div className="section-header">
        {/* The whole title row is the accordion control: click anywhere to
            collapse/expand, with a rotating chevron on the right as the
            indicator. The "About this section" button stops propagation so it
            doesn't also toggle the collapse. */}
        <div
          className="section-title-row"
          onClick={toggleCollapsed}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          aria-label={`${title} section, ${collapsed ? "collapsed" : "expanded"}`}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCollapsed(); } }}
        >
          <span className="section-title">{title}</span>
          {question && (
            <span className="section-question">({question})</span>
          )}
          {hasMeta && !collapsed && (
            <button
              className={`section-meta-toggle${expanded ? " open" : ""}`}
              onClick={(e) => { e.stopPropagation(); setExpanded((o) => !o); }}
              aria-expanded={expanded}
              title="Toggle description and references"
            >
              {expanded ? "▾ Hide details" : "ⓘ About this section"}
            </button>
          )}
          <span className="section-collapse-chevron" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </span>
        </div>
        {!collapsed && expanded && description && (
          <span className="section-desc">{description}</span>
        )}
        {!collapsed && expanded && hasRefs && <SectionReferences sectionId={id} />}
      </div>
      {!collapsed && children}
    </section>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── URL-stateful view selectors ──
  // The dashboard's shareable state lives in the URL query string:
  //   ?tab=<portfolio|market|anomaly>
  //   ?portfolio=<mode_id>
  //   ?ticker=<sector_etf>
  // So a URL like https://kldgh.github.io/risklens/?tab=anomaly&ticker=KRE
  // takes the recipient straight to KRE's Sector Spotlight view. We use
  // history.replaceState so URL updates don't pile up in browser history
  // (clicking around fills the back button with junk otherwise).
  const readUrlParams = () => {
    if (typeof window === "undefined") return {};
    const p = new URLSearchParams(window.location.search);
    return {
      tab:       p.get("tab"),
      portfolio: p.get("portfolio"),
      ticker:    p.get("ticker"),
    };
  };
  const initialParams = readUrlParams();
  const VALID_TABS = ["portfolio", "market", "anomaly"];  // "optimizer" hidden for now

  const [mode, setMode] = useState(initialParams.portfolio || "hypothetical");
  const [activeTab, setActiveTab] = useState(
    VALID_TABS.includes(initialParams.tab) ? initialParams.tab : "portfolio"
  );
  const [selectedTicker, setSelectedTicker] = useState(initialParams.ticker || null);

  // Theme preference persisted across sessions. Defaults to "light" — the
  // dashboard is data-dense (small tabular numbers, fine gridlines), which
  // reads more clearly on a light background in a normally-lit office, and
  // it matches the institutional context the tool lives in. Returning users
  // who flip the tab-bar toggle keep their choice via localStorage.
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("risklens-theme") || "light";
    } catch {
      return "light";
    }
  });

  // Sync theme to <html data-theme=...> so the CSS variables under
  // :root[data-theme="light"] (in index.css) get picked up.
  useEffect(() => {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem("risklens-theme", theme);
    } catch {
      // localStorage blocked — no big deal, theme just won't persist
    }
  }, [theme]);

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
        // Only fall back to the default mode if the URL didn't supply
        // a valid one. This way ?portfolio=cggo_active in the URL wins
        // over the JSON's `default_mode`.
        setMode((current) =>
          current && json.portfolios[current] ? current : (json.default_mode ?? "hypothetical")
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // After data loads, validate the URL-supplied ticker. If invalid (or
  // missing), fall back to the first available sector ETF so the
  // dropdown always has a sensible default — but only once the JSON
  // is loaded, so we don't clobber a valid pending URL parameter.
  useEffect(() => {
    if (!data?.anomaly_views?.tickers) return;
    const tickers = data.anomaly_views.tickers;
    if (!selectedTicker || !tickers.includes(selectedTicker)) {
      setSelectedTicker(tickers[0] ?? null);
    }
  }, [data]);

  // Sync state -> URL whenever tab / portfolio / ticker change. Uses
  // replaceState so URL updates don't pollute the browser history;
  // omits parameters at their defaults to keep URLs clean. The hash
  // (used internally by Section anchor IDs, etc.) is preserved.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (activeTab && activeTab !== "portfolio") params.set("tab", activeTab);
    if (mode && mode !== "aor") params.set("portfolio", mode);
    if (selectedTicker && activeTab === "anomaly") {
      params.set("ticker", selectedTicker);
    }
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`;
    if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState({}, "", newUrl);
    }
  }, [activeTab, mode, selectedTicker]);

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
        <nav className="tab-bar">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              className={`tab-btn ${activeTab === id ? "active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
          <button
            className={`theme-toggle theme-toggle--${theme}`}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            role="switch"
            aria-checked={theme === "dark"}
          >
            {/* Scene toggle: a sunny day pill in light mode, a starry night
                pill in dark mode. Shows the current theme; clicking flips it. */}
            <svg className="theme-toggle-svg" viewBox="0 0 72 32" width="62" height="28" aria-hidden="true">
              <defs>
                <linearGradient id="ttDay" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#5cc4dc" />
                  <stop offset="1" stopColor="#9bd8e6" />
                </linearGradient>
                <linearGradient id="ttNight" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#27406a" />
                  <stop offset="1" stopColor="#0d1a30" />
                </linearGradient>
                {/* Knobs use a soft top-left-lit radial fill so the sun/moon
                    read as a raised toggle handle rather than a flat bright disc. */}
                <radialGradient id="ttSun" cx="0.38" cy="0.34" r="0.72">
                  <stop offset="0" stopColor="#fff0bf" />
                  <stop offset="1" stopColor="#ecb838" />
                </radialGradient>
                <radialGradient id="ttMoon" cx="0.38" cy="0.34" r="0.75">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#dde3ee" />
                </radialGradient>
                <radialGradient id="ttMoonGlow" cx="0.5" cy="0.5" r="0.5">
                  <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.40" />
                  <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
                <filter id="ttKnob" x="-60%" y="-60%" width="220%" height="220%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodColor="#000000" floodOpacity="0.35" />
                </filter>
              </defs>
              <rect x="0.5" y="0.5" width="71" height="31" rx="15.5"
                fill={theme === "dark" ? "url(#ttNight)" : "url(#ttDay)"}
                stroke="rgba(0,0,0,0.18)" />
              {theme === "dark" ? (
                <g>
                  <circle cx="13" cy="9"  r="1"   fill="#fff" opacity="0.9" />
                  <circle cx="21" cy="15" r="0.8" fill="#fff" opacity="0.7" />
                  <circle cx="17" cy="22" r="0.9" fill="#fff" opacity="0.8" />
                  <circle cx="29" cy="10" r="0.7" fill="#fff" opacity="0.6" />
                  <circle cx="33" cy="20" r="1"   fill="#fff" opacity="0.85" />
                  <circle cx="39" cy="14" r="0.7" fill="#fff" opacity="0.6" />
                  <circle cx="54" cy="16" r="11" fill="url(#ttMoonGlow)" />
                  <g filter="url(#ttKnob)">
                    <circle cx="54" cy="16" r="8" fill="url(#ttMoon)" />
                  </g>
                  <circle cx="50.5" cy="13" r="1.5" fill="#cdd5e2" />
                  <circle cx="57"   cy="18" r="1.9" fill="#cdd5e2" />
                  <circle cx="55"   cy="12" r="1"   fill="#cdd5e2" />
                </g>
              ) : (
                <g>
                  <g fill="#ffffff">
                    <ellipse cx="45" cy="21" rx="9" ry="5" />
                    <circle cx="41" cy="19" r="4" />
                    <circle cx="47" cy="17" r="5" />
                  </g>
                  <g fill="#ffffff" opacity="0.9">
                    <ellipse cx="57" cy="12" rx="6" ry="3.2" />
                    <circle cx="55" cy="11" r="2.6" />
                    <circle cx="59" cy="10.5" r="3" />
                  </g>
                  <g filter="url(#ttKnob)">
                    <circle cx="18" cy="16" r="8" fill="url(#ttSun)" />
                  </g>
                </g>
              )}
            </svg>
          </button>
          <a
            href="https://github.com/KLDGH/risklens/blob/main/FAQ.md"
            target="_blank"
            rel="noopener noreferrer"
            className="tab-btn tab-external"
          >
            Methodology &amp; FAQ ↗
          </a>
        </nav>
      )}

      {/* Portfolio mode toggle + legend are scoped to Tab 1 — they don't
          apply to market-context charts (reference data) or to the
          anomaly-detector single-asset view. */}
      {activeTab === "portfolio" && portfolio && (
        <div className="mode-bar">
          <div className="mode-toggle-row">
            <span className="mode-toggle-label">
              Switch portfolio <span className="mode-toggle-arrow">→</span>
            </span>
            <div className="mode-toggle">
              {modeKeys.map((k) => (
                <button
                  key={k}
                  className={`mode-btn ${mode === k ? "active" : ""}`}
                  onClick={() => setMode(k)}
                >
                  {data.portfolios[k].label}
                  {mode === k && <InfoTip text={portfolio.description} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
        {/* =============================================================
            TAB 1 — Portfolio Risk
            All sections that depend on the active portfolio mode.
            ============================================================= */}
        {activeTab === "portfolio" && portfolio && (
          <Section
            id="risk-snapshot"
            title="Current Risk Snapshot"
            question="How risky is each asset today vs. its own recent history?"
            description={
              <>
                Your at-a-glance read on every holding: which positions are running hot, and the loss to expect on a bad day (worst 1%, as a % of the position). The <span className="desc-accent">five shaded VaR columns</span> are meant to disagree — when they spread apart (usually EVT pulling high), that name's tail is fatter than standard models assume, and that gap is the signal, not noise. The EWMA-vs-GARCH gap is the heavy-tail premium you're carrying in the name. Sort by the Risk gauge to surface what's most stretched against its own 2-year range. (Per-model definitions live in each column's ⓘ.)
              </>
            }
          >
            {portfolio.is_active_fund_spotlight && portfolio.fund_disclosure && portfolio.coverage_meta && (
              <FundDisclosurePanel
                disclosure={portfolio.fund_disclosure}
                coverageMeta={portfolio.coverage_meta}
              />
            )}
            {/* Legend for the Risk gauge column. Lives inside the section
                rather than at the page level so it visually belongs to the
                table it explains (it used to float untethered above the
                section header, which made it look like a standalone widget). */}
            <div className="legend section-legend">
              <span className="legend-item legend-caption">Daily VaR risk level:</span>
              <span className="legend-item"><span className="dot green" />Low (&lt;2.5)</span>
              <span className="legend-item"><span className="dot yellow" />Elevated (2.5–5)</span>
              <span className="legend-item"><span className="dot red" />High (&gt;5)<InfoTip text="Color thresholds for the daily VaR columns (HS, EWMA, GARCH, tGARCH, EVT) only — NOT the YearVaR column, whose 1-year losses sit on a different scale and render in neutral text. These are pragmatic rules of thumb, not a regulatory standard. Calibrated for daily 1% VaR on liquid ETFs: diversified US equity (SPY) historically sits around 1.5–2.5%; sector ETFs 2–3%; individual stocks 3–5%; crypto and volatile names often 5%+. Different asset classes warrant different thresholds, which is why the per-asset Risk gauge (percentile rank vs 2-year history) is the more rigorous comparison on this page." /></span>
              <span className="legend-item legend-sep">·</span>
              <span className="legend-item">each cell: VaR on top, <span className="legend-es-key">ES</span> below</span>
            </div>
            <div className="legend-twolayer">
              Two reads: VaR-column color = <strong>absolute</strong> daily-loss size (comparable across holdings) · <strong>Risk</strong> = how elevated each asset is vs its own 2-yr history (self-normalizing, so a crypto and a bond are judged each against its own normal).
            </div>
            <RiskTable
              assets={portfolio.assets}
              portfolioWeights={portfolio.weights}
              disclosedWeights={portfolio.disclosed_weights}
              fundTicker={portfolio.fund_ticker}
              portfolioLabel={PORTFOLIO_SHORT_LABELS[mode] ?? "PORTFOLIO"}
              benchmark={portfolio.benchmark}
            />
          </Section>
        )}
        {activeTab === "portfolio" && portfolio?.risk_history?.length > 0 && (
          <Section
            id="risk-trajectory"
            title="Portfolio Risk Trajectory"
            question="How has the portfolio's daily risk moved over time?"
            description="How the portfolio's daily risk has risen and fallen over time, so today's reading has context: near a calm-regime floor, or climbing toward crisis levels. The line is EWMA VaR, which is fast-reacting and cheap enough to recompute every trading day across the full history; that's also why its level runs a little below the heavy-tailed models in the snapshot above. Spikes mark known shocks, and the slow decay after each shows how fast that regime resolved. History reaches back as far as the portfolio's youngest holding allows."
          >
            <PortfolioRiskChart data={portfolio.risk_history} portfolioLabel={portfolio.label} />
          </Section>
        )}
        {activeTab === "portfolio" && portfolio?.backtests && (
          <Section
            id="model-validation"
            title="VaR Model Validation"
            question="Are these risk models well-calibrated?"
            description="Can you trust the VaR numbers above? This is their out-of-sample report card (HS, EWMA, EVT). For each of the last 504 days the model saw only the prior 1000 days, forecast that day's 1% VaR, and we checked it against what actually happened. Kupiec asks: did losses breach VaR roughly 1% of the time, as promised? Christoffersen asks: did breaches cluster — the tell of a model blind to fast-changing risk? Passing both means the snapshot above is well-calibrated for this portfolio; failing flags which model to discount."
          >
            <BacktestPanel data={portfolio.backtests} portfolioLabel={portfolio.label} />
          </Section>
        )}
        {activeTab === "portfolio" && portfolio?.scenarios && (
          <Section
            id="stress-tests"
            title="Historical Stress Tests & Scenarios"
            question="How would the portfolio handle past crises and plausible shocks?"
            description="What happens to this portfolio when markets break. Two kinds of test: real crises replayed from history (data-driven), and forward-looking shocks you can't observe yet but should be sized for (assumption-driven). Each card shows total P&L plus the holdings that hurt — or hedged — the most, so you can see where the damage concentrates before it happens and what's actually diversifying you."
          >
            <ScenarioPanel
              scenarios={portfolio.scenarios}
              weights={portfolio.weights}
              comparisons={scenarioComparisons}
              currentMode={mode}
            />
          </Section>
        )}
        {/* =============================================================
            TAB 2 — Market Context
            Portfolio-independent reference charts.
            ============================================================= */}
        {activeTab === "market" && data?.sp500_history && (
          <Section
            id="sp500-history"
            title="S&P 500 Historical Risk"
            question="How does today's equity stress compare to history?"
            description="Where today's equity risk sits in the long arc of market history. Each bar is the span of modeled daily-loss estimates for that year — tall bars are crisis years (2008, 2020), short bars are the calm stretches. Use it to gut-check whether the current regime is historically benign or already stretched before you read too much into a quiet snapshot."
          >
            <HistoricalChart data={data.sp500_history} />
          </Section>
        )}
        {activeTab === "market" && data?.correlation_history && (
          <Section
            id="correlation"
            title="Cross-Asset Correlation"
            question="Is diversification still working across asset classes?"
            description="Is diversification actually working right now? When cross-asset correlations climb toward 1, the positions you hold to offset each other stop doing so — and your real portfolio risk is higher than any single holding's VaR implies. Rising correlation is the quiet way a diversified book turns into a concentrated one."
          >
            <CorrelationChart data={data.correlation_history} />
          </Section>
        )}
        {activeTab === "market" && data?.multi_window_corr && Object.keys(data.multi_window_corr).length > 0 && (
          <Section
            id="multi-window-corr"
            title="Stock-Bond Correlation Across Time Scales"
            question="Has the stock-bond relationship shifted recently?"
            description="Do your bonds still hedge your equities — and is that relationship shifting? Stock-bond correlation at three window lengths at once. The 20-day line catches regime changes early; the 252-day line is the slow annual baseline. When the fast line breaks away from the slow one, the hedge is changing before standard measures notice — the 2022 flip to positive correlation (bonds and stocks falling together) is the cautionary case every balanced book felt. Toggle the bond proxy to see whether it holds across the curve."
          >
            <MultiWindowCorrelationChart data={data.multi_window_corr} />
          </Section>
        )}
        {activeTab === "market" && data?.intraday_corr_history && (
          Array.isArray(data.intraday_corr_history)
            ? data.intraday_corr_history.length > 0
            : Object.values(data.intraday_corr_history).some((s) => s?.length > 0)
        ) && (
          <Section
            id="intraday-corr"
            title="Intraday Stock-Bond Correlation"
            question="Is the very recent regime different from the daily-data picture?"
            description="The earliest warning on the stock-bond hedge. Each bar is a single day's SPY-TLT correlation built from intraday bars, so one day's reading already means something — no 60-day smoothing lag to wait out. A run of same-sign days flags a regime shift days to weeks before the daily-data chart above can confirm it. Last 60 trading days only (free intraday data via yfinance)."
          >
            <IntradayCorrelationChart data={data.intraday_corr_history} />
          </Section>
        )}

        {/* =============================================================
            TAB 3 — Sector Spotlight
            Single-asset deep-dive view across 14 sector ETFs. Per ticker:
            full risk profile, Fama-French + Momentum factor regression,
            thematic-basket exposure regression, rolling factor loadings
            over time, and three anomaly detectors (z-score, Page CUSUM,
            GARCH-residual) on a shared timeline.
            ============================================================= */}
        {activeTab === "anomaly" && data?.anomaly_views?.tickers?.length > 0 && (() => {
          // Single-asset deep-dive, split into distinct collapsible sections all
          // driven by one ETF selector. The selector resolves the active view;
          // each section renders one facet of it.
          const views  = data.anomaly_views;
          const ticker = (selectedTicker && views.data[selectedTicker]) ? selectedTicker : views.tickers[0];
          const view   = views.data[ticker];
          if (!view) return null;
          return (
            <>
              <SectorSelector views={views} ticker={ticker} setTicker={setSelectedTicker} view={view} />
              <Section
                id="sector-risk-profile"
                title="Risk Profile"
                question="How risky is this ETF on its own, today?"
                description="Standalone risk metrics for the selected ETF's NAV, mirroring the Portfolio Risk snapshot: recent realized volatility, market beta vs SPY, the daily 1% VaR (GJR-t and EVT), the 1-year YearVaR, and the Hill tail-α. HS and EWMA estimates are on hover. Curated expected-range bands (from the literature) are available as a tooltip on the title to sanity-check the live numbers."
              >
                <RiskProfileCard profile={view.risk_profile} ticker={ticker} />
              </Section>
              <Section
                id="sector-factor-model"
                title="Factor Risk Model"
                question="Which systematic factors drive its returns?"
                description="Fama-French 5 + Carhart momentum regression on the ETF's daily excess returns — an open-data substitute for a Barra-style multi-factor decomposition. Per-factor loadings with bootstrapped 95% CIs, t-stats and significance, plus R², alpha, and the total/factor/idiosyncratic volatility decomposition."
              >
                <FactorRegressionPanel model={view.factor_model} />
              </Section>
              <Section
                id="sector-thematic"
                title="Thematic Risk Exposures"
                question="Which narrative risk drivers actually move it?"
                description="Regression against a panel of sector/thematic ETF baskets that each proxy a real-world risk driver (oil shock, regional-banking stress, duration, China sensitivity). Non-market loadings are computed on market-orthogonalized basket residuals, so they read as exposure beyond plain market beta — more actionable than abstract academic factor loadings."
              >
                <ThematicExposurePanel thematic={view.thematic_exposures} />
              </Section>
              <Section
                id="sector-factor-drift"
                title="Factor Loadings Over Time"
                question="Is it still doing what it was bought to do?"
                description="Rolling 252-day factor loadings stepped monthly over the last ~5 years, one mini-chart per factor with its long-run mean. A loading drifting more than 1σ from its own long-run mean is flagged as style drift — the months-to-years horizon at which sector rotations and thesis drift play out."
              >
                <RollingFactorLoadingsPanel rolling={view.factor_model_rolling} />
              </Section>
              <Section
                id="sector-anomalies"
                title="Anomaly Detection"
                question="When did it behave abnormally — and do the detectors agree?"
                description="Three detectors on a shared timeline over the closing-price series: standardized z-score flags outsized single days, Page CUSUM catches sustained mean shifts, and GARCH-residual outliers flag days the conditional-vol model didn't anticipate. A date hitting multiple detectors is the strong signal — disagreement between them is informative."
              >
                <AnomalySignalsPanel view={view} ticker={ticker} />
              </Section>
            </>
          );
        })()}
        {activeTab === "optimizer" && (
          <Section
            id="optimizer"
            title="Portfolio Optimizer"
            question="What happens if we rebuild the strategy systematically?"
            description="Systematic portfolio construction on a real, publicly-traded fund: the iShares Core 60/40 Balanced Allocation ETF (AOR), modeled directly from its seven underlying iShares ETFs at their disclosed weights (the full fund, not a partial reconstruction). AOR's current allocation is the reference book (the benchmark). It runs a small set of mean-variance / risk-based optimizers — global min-variance, equal-risk-contribution, max-diversification, and two PM tilts (a concentrated tight-tracking-error variant and a lower-risk variant kept close to the fund) — plus an opt-in max-Sharpe shown only to illustrate estimation fragility. For each it reports the deltas a PM cares about: return, vol, Sharpe, active return, information ratio, tracking error, concentration (effective N), turnover, and the risk budget, plus an equity-beta diagnostic. Risk-based objectives use no return forecasts; all return / Sharpe / active-return figures are realized in-sample and descriptive only. A transparent prototype, not a replacement for a production optimizer."
          >
            {data?.portfolios?.aor?.optimizer
              ? <OptimizerPanel opt={data.portfolios.aor.optimizer} />
              : <p className="opt-empty">The optimizer view isn't in this data build yet — re-run the backend to populate it.</p>}
          </Section>
        )}
      </main>

      <footer className="footer">
        <span>VaR models: Historical Simulation · EWMA (λ=0.94) · GARCH · tGARCH · EVT</span>
        <span>
          Data via yfinance + Ken French Library ·{" "}
          <a
            href="https://github.com/KLDGH/risklens/blob/main/LEGAL.md"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            Legal &amp; disclaimers
          </a>
        </span>
      </footer>
    </div>
  );
}
