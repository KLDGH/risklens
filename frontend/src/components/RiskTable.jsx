import { useState, useCallback } from "react";
import RiskBar from "./RiskBar.jsx";
import InfoTip from "./InfoTip.jsx";
import "./RiskTable.css";

// Build a multi-line sanity-check tooltip from the per-asset references
// dict produced by backend/reference_values.py. Returns null if the dict
// is empty (unknown asset class). Lines appear in a stable order so the
// tooltip layout is consistent across all rows.
const REF_LABELS = [
  ["var_1d_99",      "1-day 99% VaR"],
  ["year_var_10",    "YearVaR (10%)"],
  ["hill_alpha",     "Hill tail α"],
  ["ff_market_beta", "FF Market β"],
  ["ff_smb",         "FF SMB"],
  ["ff_hml",         "FF HML"],
  ["ff_rmw",         "FF RMW"],
  ["ff_cma",         "FF CMA"],
  ["ff_mom",         "FF MOM"],
];
function buildReferenceTip(ticker, references) {
  if (!references || Object.keys(references).length === 0) return null;
  const lines = REF_LABELS
    .filter(([key]) => references[key])
    .map(([key, label]) => `• ${label}: ${references[key]}`);
  if (lines.length === 0) return null;
  return `Expected ranges for ${ticker} (curated from the literature — sanity-check the live numbers against these bands):\n\n${lines.join("\n\n")}`;
}

const TIPS = {
  ret:       "Yesterday's log return for this asset.",
  YearVaR:   "1-year VaR at 10% confidence. The 10th-percentile worst loss expected over a 1-year horizon, on a $100 position. Computed via Student-t parametric scaling: fit Student-t degrees of freedom (ν) to daily returns, scale daily volatility by √252, then take the standardized t-quantile at q=0.10. This is an annualized parametric proxy, not a path simulation — and it falls back to a Normal tail when the Student-t fit degenerates (ν≤2) on very low-volatility series like aggregate bonds. Interpretation: '10% chance of losing more than $X over the next year.' The consumer / long-horizon-PM complement to the 1-day 1% VaR columns (which are pro / trading-floor framing). Bottom number is the expected shortfall — average loss conditional on the loss exceeding VaR.",
  hs:        "Historical Simulation. Top number = VaR (1% worst daily loss). Bottom number = ES (average loss across the worst 1%). Both drawn directly from the last 1000 trading days; no distribution assumption.",
  ewma:      "EWMA model. Top = VaR; bottom = ES. Computed with exponentially weighted volatility (λ=0.94) under a normal-distribution assumption. Recent days weigh more than older ones.",
  garch:     "GARCH(1,1) with Student-t innovations. Top = VaR; bottom = ES. The conditional volatility process is GARCH(1,1); the innovation distribution is Student-t (degrees of freedom estimated per fit) rather than Normal. This matches the empirical kurtosis of daily equity returns and produces tail-VaR estimates ~30–60% larger than Normal-innovation GARCH at 99% confidence. The EWMA column to the left assumes Normal innovations, so the EWMA-vs-GARCH gap *is* the heavy-tail premium. Falls back to EWMA if fitting fails.",
  tgarch:    "GJR-GARCH(1,1,1) with Student-t innovations. Top = VaR; bottom = ES. Two simultaneous corrections to vanilla GARCH: (1) GJR threshold term — negative shocks raise conditional variance more than equal-sized positive shocks, capturing the leverage effect; (2) Student-t innovations — heavy-tailed daily innovations matching empirical equity return kurtosis. The 't' in this column's name refers to BOTH: 'threshold' GARCH AND Student-t innovations. Falls back to EWMA if fitting fails.",
  evt:       "Extreme Value Theory. Top = VaR; bottom = ES. Fits a Generalized Pareto Distribution directly to the worst losses; best for fat-tailed assets like crypto.",
  consensus: "Simple average across all five VaR models. A rough consensus proxy — useful as a single reference number but not a coherent risk measure. Treat it as a heuristic.",
  range:     "Range across all five VaR models (min – max). When tight, the models agree — reassuring. When wide — usually EVT pulling high — the asset's tail losses are more extreme than normal-distribution models capture. Model disagreement is the alert, not noise.",
  alpha:     "Hill tail index — estimated from the worst losses. Lower = fatter tails. Broad equity indices typically 3–4; individual stocks 2–4; gold and crypto often below 3; long treasuries can be surprisingly fat-tailed.",
  risk:      "Percentile rank of today's EWMA VaR vs the past 2 years of daily values for this asset. 100% = highest risk seen in 2 years.",
  compVar:   "Component VaR — this holding's contribution to the total portfolio VaR (parametric, EWMA covariance). Sum across all holdings equals the portfolio's EWMA VaR. Negative values indicate hedges (the holding's covariance with the rest of the portfolio reduces total risk).",
};

// Map column key → value extractor for sorting (model columns sort by VaR;
// ES is shown alongside in each cell but isn't independently sortable)
const SORT_FNS = {
  name:      (a) => a.name,
  price:     (a) => a.last_price,
  ret:       (a) => a.last_return_pct,
  varHs:     (a) => a.var_hs,
  varEwma:   (a) => a.var_ewma,
  varGarch:  (a) => a.var_garch,
  varTgarch: (a) => a.var_tgarch,
  varEvt:    (a) => a.var_evt,
  varYr:     (a) => a.var_yr_10pct ?? 0,
  consensus: (a) => a.mean_var,
  range:     (a) => (Math.max(a.var_hs, a.var_ewma, a.var_garch, a.var_tgarch, a.var_evt) - Math.min(a.var_hs, a.var_ewma, a.var_garch, a.var_tgarch, a.var_evt)),
  alpha:     (a) => a.tail_index,
  risk:      (a) => a.risk_level,
  compVar:   (a) => a.component_var ?? -Infinity,
};

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <span className="sort-icon inactive">⇅</span>;
  return <span className="sort-icon active">{sortDir === "asc" ? "↑" : "↓"}</span>;
}

function Th({ col, label, className, sortKey, sortDir, onSort }) {
  return (
    <th
      className={`${className ?? ""} sortable`}
      onClick={() => onSort(col)}
      title="Click to sort"
    >
      <span className="th-inner">
        {label}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </span>
    </th>
  );
}

function ThWithTip({ col, label, tip, className, sortKey, sortDir, onSort }) {
  return (
    <th
      className={`${className ?? ""} sortable`}
      onClick={() => onSort(col)}
      title="Click to sort"
    >
      <span className="th-inner">
        {label}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
        <InfoTip text={tip} />
      </span>
    </th>
  );
}

function RangeCell({ values, className }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const color = spread > 3 ? "var(--red)" : spread > 1.5 ? "var(--yellow)" : "var(--text-dim)";
  return (
    <td className={`num range-cell ${className ?? ""}`} style={{ color }}>
      {min.toFixed(2)}<span className="range-sep"> – </span>{max.toFixed(2)}
    </td>
  );
}

function ReturnCell({ value, className }) {
  const color = value > 0 ? "var(--green)" : value < 0 ? "var(--red)" : "var(--text-dim)";
  return (
    <td className={`num ${className ?? ""}`} style={{ color }}>
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </td>
  );
}

function VarCell({ value, className }) {
  let color = "var(--green)";
  if (value > 5) color = "var(--red)";
  else if (value > 2.5) color = "var(--yellow)";
  return <td className={`num ${className ?? ""}`} style={{ color }}>{value.toFixed(2)}</td>;
}

// Paired cell — shows VaR (top, color-coded) and ES (bottom, smaller and dim).
// Used for the 5 daily-VaR model columns so each forecast carries both
// summary stats.
//
// `neutral` disables the green/yellow/red threshold coloring. The thresholds
// (<2.5 / 2.5–5 / >5) are calibrated for DAILY 1% VaR; they're meaningless
// for the YearVaR column, whose 1-year losses are naturally 12–40% and so
// would render uniformly red. Neutral YearVaR cells render in plain bright
// text, reinforcing the violet col-yr tint's "different horizon, different
// scale" framing rather than fighting it with a misleading color.
function VarEsCell({ varValue, esValue, className, neutral = false }) {
  if (varValue == null) {
    return <td className={`num model-cell ${className ?? ""}`}>—</td>;
  }
  let color = "var(--text-bright)";
  if (!neutral) {
    color = "var(--green)";
    if (varValue > 5) color = "var(--red)";
    else if (varValue > 2.5) color = "var(--yellow)";
  }
  return (
    <td className={`num model-cell ${className ?? ""}`}>
      <div className="model-var" style={{ color }}>{varValue.toFixed(2)}</div>
      {esValue != null && <div className="model-es">{esValue.toFixed(2)}</div>}
    </td>
  );
}

function CompVarCell({ value, className }) {
  if (value == null) {
    return <td className={`num text-dim ${className ?? ""}`}>—</td>;
  }
  // Negative = hedge (reduces portfolio risk). Positive = contributes to risk.
  let color;
  if (value < 0)        color = "var(--green)";
  else if (value > 0.5) color = "var(--red)";
  else if (value > 0.2) color = "var(--yellow)";
  else                  color = "var(--text-dim)";
  return (
    <td className={`num ${className ?? ""}`} style={{ color }}>
      {value > 0 ? "+" : ""}{value.toFixed(2)}
    </td>
  );
}

function WeightsTooltip({ weights }) {
  if (!weights) return null;
  const equity = ["SPY","QQQ","EEM","IWM","XLF"];
  const fi = ["TLT","LQD","HYG"];
  const real = ["GLD","VNQ"];
  const crypto = ["BTC-USD"];
  const groups = [
    { label: "Equity", tickers: equity },
    { label: "Fixed Income", tickers: fi },
    { label: "Real Assets", tickers: real },
    { label: "Crypto", tickers: crypto },
  ];
  const lines = groups.map(g => {
    const total = g.tickers.reduce((s, t) => s + (weights[t] ?? 0), 0);
    const parts = g.tickers.map(t => weights[t] ? `${t} ${(weights[t]*100).toFixed(0)}%` : null).filter(Boolean);
    return `${g.label} ${(total*100).toFixed(0)}%: ${parts.join(" · ")}`;
  }).join("\n");
  return lines;
}

function PortfolioRow({ a, portfolioLabel, showAllModels, topRollup = false, benchmarkBelow = false }) {
  const weightTip = WeightsTooltip({ weights: a.weights });
  return (
    <tr className={`portfolio-row${topRollup ? " portfolio-row-top" : ""}${benchmarkBelow ? " has-benchmark-below" : ""}`}>
      <td className="left asset-cell sticky-col portfolio-sticky">
        <span className="ticker portfolio-ticker">{portfolioLabel ?? "PORTFOLIO"}</span>
        <span className="name">{a.name}</span>
      </td>
      <td className="num price">
        <span className="portfolio-nav" title="Synthetic NAV starting at $100">NAV ${a.nav?.toFixed(2) ?? a.last_price.toFixed(2)}</span>
      </td>
      <ReturnCell value={a.last_return_pct} className="portfolio-cell" />
      {showAllModels && (
        <>
          <VarEsCell varValue={a.var_hs}      esValue={a.es_hs}      className="portfolio-cell col-models group-start" />
          <VarEsCell varValue={a.var_ewma}    esValue={a.es_ewma}    className="portfolio-cell col-models" />
          <VarEsCell varValue={a.var_garch}   esValue={a.es_garch}   className="portfolio-cell col-models" />
        </>
      )}
      <VarEsCell varValue={a.var_tgarch}  esValue={a.es_tgarch}  className={`portfolio-cell col-models ${showAllModels ? "" : "group-start"}`} />
      <VarEsCell varValue={a.var_evt}     esValue={a.es_evt}     className="portfolio-cell col-models group-end" />
      <VarEsCell varValue={a.var_yr_10pct} esValue={a.es_yr_10pct} className="portfolio-cell col-yr group-start group-end" neutral />
      <td className="num alpha-cell portfolio-cell">{a.tail_index?.toFixed(2)}</td>
      <td className="left gauge-cell portfolio-cell">
        <RiskBar
          level={a.risk_level}
          trend={a.var_trend}
          exceptionRate={a.exception_rate}
          exceptionCount={a.exception_count}
        />
      </td>
      {showAllModels && (
        <>
          <td className="num consensus-cell portfolio-cell col-summary group-start">{a.mean_var?.toFixed(2)}</td>
          <RangeCell values={[a.var_hs, a.var_ewma, a.var_garch, a.var_tgarch, a.var_evt]} className="portfolio-cell col-summary" />
        </>
      )}
      <td className={`num portfolio-cell col-summary ${showAllModels ? "group-end" : "group-start group-end"}`} title="Sum of component VaRs across all holdings — equals portfolio EWMA VaR by construction">
        {a.component_var_total != null ? `Σ ${a.component_var_total.toFixed(2)}` : "—"}
      </td>
    </tr>
  );
}

// Policy-benchmark row — sits directly under the portfolio total so the two
// rollups compare column-by-column ("Total Plan vs Policy Benchmark"). Same
// columns as the portfolio row, muted, with no Component VaR (component
// attribution is portfolio-specific and doesn't apply to the benchmark).
function BenchmarkRow({ a, showAllModels }) {
  return (
    <tr className="benchmark-row">
      <td className="left asset-cell sticky-col benchmark-sticky">
        <span className="ticker benchmark-ticker">BENCHMARK</span>
        <span className="name">{a.name}</span>
      </td>
      <td className="num price">
        <span className="portfolio-nav" title="Synthetic NAV starting at $100">NAV ${a.nav?.toFixed(2) ?? a.last_price?.toFixed(2)}</span>
      </td>
      <ReturnCell value={a.last_return_pct} className="benchmark-cell" />
      {showAllModels && (
        <>
          <VarEsCell varValue={a.var_hs}    esValue={a.es_hs}    className="benchmark-cell col-models group-start" />
          <VarEsCell varValue={a.var_ewma}  esValue={a.es_ewma}  className="benchmark-cell col-models" />
          <VarEsCell varValue={a.var_garch} esValue={a.es_garch} className="benchmark-cell col-models" />
        </>
      )}
      <VarEsCell varValue={a.var_tgarch} esValue={a.es_tgarch} className={`benchmark-cell col-models ${showAllModels ? "" : "group-start"}`} />
      <VarEsCell varValue={a.var_evt}    esValue={a.es_evt}    className="benchmark-cell col-models group-end" />
      <VarEsCell varValue={a.var_yr_10pct} esValue={a.es_yr_10pct} className="benchmark-cell col-yr group-start group-end" neutral />
      <td className="num alpha-cell benchmark-cell">{a.tail_index?.toFixed(2)}</td>
      <td className="left gauge-cell benchmark-cell">
        <RiskBar level={a.risk_level} trend={a.var_trend} exceptionRate={a.exception_rate} exceptionCount={a.exception_count} />
      </td>
      {showAllModels && (
        <>
          <td className="num consensus-cell benchmark-cell col-summary group-start">{a.mean_var?.toFixed(2)}</td>
          <RangeCell values={[a.var_hs, a.var_ewma, a.var_garch, a.var_tgarch, a.var_evt]} className="benchmark-cell col-summary" />
        </>
      )}
      <td className={`num benchmark-cell col-summary ${showAllModels ? "group-end" : "group-start group-end"}`} title="Component VaR is a within-portfolio attribution; not applicable to the benchmark">—</td>
    </tr>
  );
}

// A single asset row. Extracted from the body map so it can be reused for
// the pinned look-through fund-reference row in the footer (see below) —
// same columns, same formatting, just rendered in a different slot.
function AssetRow({ a, portfolioWeights, disclosedWeights, fundTicker, showAllModels, isFundReference = false }) {
  const wt = portfolioWeights?.[a.ticker];
  // For look-through baskets we also surface the holding's weight as a
  // fraction of the fund (pre-normalization), so users see at a glance that
  // "5% of basket" maps to e.g. "3.7% of CGGO" — making the basket-vs-fund
  // abstraction legible in the row itself, not just in the panel below.
  const disclosedPct = disclosedWeights?.[a.ticker];
  const refTip = buildReferenceTip(a.ticker, a.references);
  return (
    <tr className={isFundReference ? "fund-reference-row" : undefined}>
      <td className="left asset-cell sticky-col">
        <span className="ticker">
          {a.ticker}
          {refTip ? <InfoTip text={refTip} /> : null}
        </span>
        <span className="name">{a.name}</span>
        {wt != null && disclosedPct != null && fundTicker ? (
          <span className="portfolio-weight">
            {(wt * 100).toFixed(1)}% basket
            <span className="weight-secondary">
              {" · "}{disclosedPct.toFixed(2)}% of {fundTicker}
            </span>
          </span>
        ) : wt != null ? (
          <span className="portfolio-weight">{(wt * 100).toFixed(0)}% of portfolio</span>
        ) : null}
        {/* Look-through reference row: the fund's own ETF, pinned at the
            bottom so its NAV-based risk can be read against the basket
            aggregate. It's NOT a basket holding — hence no weight — so we
            label it explicitly instead of leaving a blank-weight mystery
            row sorted among the actual holdings. */}
        {isFundReference && (
          <span className="portfolio-weight reference-row-tag">
            actual {a.ticker} NAV — reference vs. the basket aggregate
          </span>
        )}
      </td>
      <td className="num price">${a.last_price.toLocaleString()}</td>
      <ReturnCell value={a.last_return_pct} />
      {showAllModels && (
        <>
          <VarEsCell varValue={a.var_hs}      esValue={a.es_hs}      className="col-models group-start" />
          <VarEsCell varValue={a.var_ewma}    esValue={a.es_ewma}    className="col-models" />
          <VarEsCell varValue={a.var_garch}   esValue={a.es_garch}   className="col-models" />
        </>
      )}
      <VarEsCell varValue={a.var_tgarch}  esValue={a.es_tgarch}  className={`col-models ${showAllModels ? "" : "group-start"}`} />
      <VarEsCell varValue={a.var_evt}     esValue={a.es_evt}     className="col-models group-end" />
      <VarEsCell varValue={a.var_yr_10pct} esValue={a.es_yr_10pct} className="col-yr group-start group-end" neutral />
      <td className="num alpha-cell">{a.tail_index?.toFixed(2)}</td>
      <td className="left gauge-cell">
        <RiskBar
          level={a.risk_level}
          trend={a.var_trend}
          exceptionRate={a.exception_rate}
          exceptionCount={a.exception_count}
        />
      </td>
      {showAllModels && (
        <>
          <td className="num consensus-cell col-summary group-start">{a.mean_var?.toFixed(2)}</td>
          <RangeCell values={[a.var_hs, a.var_ewma, a.var_garch, a.var_tgarch, a.var_evt]} className="col-summary" />
        </>
      )}
      <CompVarCell value={a.component_var} className={`col-summary ${showAllModels ? "group-end" : "group-start group-end"}`} />
    </tr>
  );
}

export default function RiskTable({ assets, portfolioWeights, disclosedWeights, fundTicker, portfolioLabel, benchmark }) {
  const [sortKey, setSortKey] = useState("risk");
  const [sortDir, setSortDir] = useState("desc");
  // Default to the compact view (tGARCH + EVT + YearVaR + Comp VaR).
  // Showing all five VaR models in the snapshot is quant-flavored
  // clutter for a non-quant audience. The Model Validation backtests
  // still run on all five; this toggle just controls what's surfaced
  // in the snapshot table.
  const [showAllModels, setShowAllModels] = useState(false);

  const handleSort = useCallback((col) => {
    setSortKey((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return col;
      }
      setSortDir(col === "name" ? "asc" : "desc");
      return col;
    });
  }, []);

  // Separate portfolio from individual assets — portfolio is always pinned to bottom
  const portfolio = assets.find((a) => a.is_portfolio);
  const individuals = assets.filter((a) => !a.is_portfolio);

  // In look-through modes the fund's own ETF is appended as an unweighted
  // reference row (e.g. CGGO sitting among its own 25 holdings). Pull it out
  // of the sortable set so it doesn't float into the middle of the table —
  // it's pinned to the footer next to the basket aggregate, where the
  // NAV-vs-basket comparison it exists for actually reads.
  const fundRefRow = fundTicker
    ? individuals.find((a) => a.ticker === fundTicker && portfolioWeights?.[a.ticker] == null)
    : null;
  const sortable = fundRefRow ? individuals.filter((a) => a !== fundRefRow) : individuals;

  const sorted = [...sortable].sort((a, b) => {
    const fn = SORT_FNS[sortKey] ?? SORT_FNS.risk;
    const av = fn(a);
    const bv = fn(b);
    if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const sp = { sortKey, sortDir, onSort: handleSort };

  return (
    <div className="table-wrapper">
      <table className="risk-table">
        <thead>
          {/* Group super-header — brackets the model columns under an explicit
              "Daily VaR" label AND doubles as the expand/collapse control for
              the hidden models. The individual headers (HS, EWMA, tGARCH, EVT)
              don't say "VaR" themselves, so without this it's ambiguous which
              columns the risk-level legend's colors apply to. Tail α, YearVaR,
              Risk and Comp VaR sit deliberately OUTSIDE the bracket — they are
              not daily-VaR numbers and the legend does not govern them. The
              colspans track the show-all-models toggle (2 visible models
              collapsed, 5 expanded). Clicking the header itself toggles the
              extra models — no separate button floating off to the side. */}
          <tr className="group-superheader-row">
            <th className="left sticky-col" aria-hidden="true" />
            <th colSpan={2} aria-hidden="true" />
            <th
              colSpan={showAllModels ? 5 : 2}
              className="col-models group-start group-end var-superheader"
            >
              {/* Excel-style outline toggle, anchored ON the group's left
                  separator — the boundary where the hidden HS/EWMA/GARCH
                  columns tuck in. [+] reveals them, [−] collapses back to
                  tGARCH + EVT. The label is a secondary (mouse) hit target;
                  the box is the accessible control. */}
              <button
                type="button"
                className="col-group-toggle"
                onClick={() => setShowAllModels((v) => !v)}
                aria-expanded={showAllModels}
                title={showAllModels
                  ? "Collapse — hide HS, EWMA, GARCH"
                  : "Expand — show all 5 VaR models (add HS, EWMA, GARCH)"}
              >
                {showAllModels ? "−" : "+"}
              </button>
              <button
                type="button"
                className="var-superheader-label"
                onClick={() => setShowAllModels((v) => !v)}
                tabIndex={-1}
                aria-hidden="true"
              >
                Daily VaR (worst 1%, per $100)
                {!showAllModels && <span className="var-superheader-hint">+3 models</span>}
              </button>
            </th>
            <th colSpan={showAllModels ? 6 : 4} aria-hidden="true" />
          </tr>
          <tr>
            <Th col="name"  label="Asset"   className="left sticky-col" {...sp} />
            <Th col="price" label="Price"   className="num" {...sp} />
            <ThWithTip col="ret"       label="1d Ret%"    tip={TIPS.ret}       className="num" {...sp} />
            {showAllModels && (
              <>
                <ThWithTip col="varHs"     label="HS"     tip={TIPS.hs}     className="num col-models group-start" {...sp} />
                <ThWithTip col="varEwma"   label="EWMA"   tip={TIPS.ewma}   className="num col-models" {...sp} />
                <ThWithTip col="varGarch"  label="GARCH"  tip={TIPS.garch}  className="num col-models" {...sp} />
              </>
            )}
            <ThWithTip col="varTgarch" label="tGARCH" tip={TIPS.tgarch} className={`num col-models ${showAllModels ? "" : "group-start"}`} {...sp} />
            <ThWithTip col="varEvt"    label="EVT"    tip={TIPS.evt}    className="num col-models group-end" {...sp} />
            <ThWithTip col="varYr"     label="YearVaR (10%)" tip={TIPS.YearVaR} className="num col-yr group-start group-end" {...sp} />
            <ThWithTip col="alpha"     label={<span style={{textTransform:"none"}}>Tail α</span>} tip={TIPS.alpha} className="num" {...sp} />
            <ThWithTip col="risk"      label="Risk"       tip={TIPS.risk}      className="left" {...sp} />
            {showAllModels && (
              <>
                <ThWithTip col="consensus" label="Consensus"  tip={TIPS.consensus} className="num col-summary group-start" {...sp} />
                <ThWithTip col="range"     label="Range"      tip={TIPS.range}     className="num col-summary" {...sp} />
              </>
            )}
            <ThWithTip col="compVar"   label="Comp VaR"   tip={TIPS.compVar}   className={`num col-summary ${showAllModels ? "group-end" : "group-start group-end"}`} {...sp} />
          </tr>
        </thead>
        <tbody>
          {/* Portfolio total + policy benchmark pinned to the TOP — institutional
              "rollup" convention (FactSet / Bloomberg / Aladdin lead with the total
              plan vs its benchmark, so the headline comparison is visible without
              scrolling). */}
          {portfolio && (
            <PortfolioRow a={portfolio} portfolioLabel={portfolioLabel} showAllModels={showAllModels} topRollup benchmarkBelow={!!benchmark} />
          )}
          {benchmark && (
            <BenchmarkRow a={benchmark} showAllModels={showAllModels} />
          )}
          {sorted.map((a) => (
            <AssetRow
              key={a.ticker}
              a={a}
              portfolioWeights={portfolioWeights}
              disclosedWeights={disclosedWeights}
              fundTicker={fundTicker}
              showAllModels={showAllModels}
            />
          ))}
        </tbody>
        {fundRefRow && (
          <tfoot>
            {/* Look-through fund-NAV reference row pinned to the footer, for the
                NAV-vs-basket comparison (the basket total now sits at the top). */}
            <AssetRow
              a={fundRefRow}
              portfolioWeights={portfolioWeights}
              disclosedWeights={disclosedWeights}
              fundTicker={fundTicker}
              showAllModels={showAllModels}
              isFundReference
            />
          </tfoot>
        )}
      </table>
    </div>
  );
}
