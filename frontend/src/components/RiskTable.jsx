import { useState, useCallback } from "react";
import RiskBar from "./RiskBar.jsx";
import InfoTip from "./InfoTip.jsx";
import "./RiskTable.css";

const TIPS = {
  ret:       "Yesterday's log return for this asset.",
  yrVar:     "1-year VaR at 10% confidence. The 10th-percentile worst loss expected over a 1-year horizon, on a $100 position. Computed via Student-t parametric scaling: fit Student-t degrees of freedom (ν) to daily returns, scale daily volatility by √252, then take the standardized t-quantile at q=0.10. Interpretation: '10% chance of losing more than $X over the next year.' The consumer / long-horizon-PM complement to the 1-day 1% VaR columns (which are pro / trading-floor framing). Bottom number is the expected shortfall — average loss conditional on the loss exceeding VaR.",
  hs:        "Historical Simulation. Top number = VaR (1% worst daily loss). Bottom number = ES (average loss across the worst 1%). Both drawn directly from the last 1000 trading days; no distribution assumption.",
  ewma:      "EWMA model. Top = VaR; bottom = ES. Computed with exponentially weighted volatility (λ=0.94) under a normal-distribution assumption. Recent days weigh more than older ones.",
  garch:     "GARCH(1,1) with Student-t innovations. Top = VaR; bottom = ES. The conditional volatility process is GARCH(1,1); the innovation distribution is Student-t (degrees of freedom estimated per fit) rather than Normal. This matches the empirical kurtosis of daily equity returns and produces tail-VaR estimates ~30–60% larger than Normal-innovation GARCH at 99% confidence. The EWMA column to the left assumes Normal innovations, so the EWMA-vs-GARCH gap *is* the heavy-tail premium. Falls back to EWMA if fitting fails.",
  tgarch:    "GJR-GARCH(1,1,1) with Student-t innovations. Top = VaR; bottom = ES. Two simultaneous corrections to vanilla GARCH: (1) GJR threshold term — negative shocks raise conditional variance more than equal-sized positive shocks, capturing the leverage effect; (2) Student-t innovations — heavy-tailed daily innovations matching empirical equity return kurtosis. The 't' in this column's name refers to BOTH: 'threshold' GARCH AND Student-t innovations. Falls back to EWMA if fitting fails.",
  evt:       "Extreme Value Theory. Top = VaR; bottom = ES. Fits a Generalized Pareto Distribution directly to the worst losses; best for fat-tailed assets like crypto.",
  consensus: "Simple average across all five VaR models. A rough consensus proxy — useful as a single reference number but not a coherent risk measure. Treat it as a heuristic.",
  range:     "Range across all five VaR models (min – max). When tight, the models agree and standard assumptions hold. When wide — usually EVT pulling high — the asset's tail losses are more extreme than normal-distribution models capture. That gap is a warning, not noise.",
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
// Used for the 5 model columns so each forecast carries both summary stats.
function VarEsCell({ varValue, esValue, className }) {
  if (varValue == null) {
    return <td className={`num model-cell ${className ?? ""}`}>—</td>;
  }
  let color = "var(--green)";
  if (varValue > 5) color = "var(--red)";
  else if (varValue > 2.5) color = "var(--yellow)";
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

function PortfolioRow({ a, portfolioLabel, showAllModels }) {
  const weightTip = WeightsTooltip({ weights: a.weights });
  return (
    <tr className="portfolio-row">
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
      <VarEsCell varValue={a.var_yr_10pct} esValue={a.es_yr_10pct} className="portfolio-cell col-yr group-start group-end" />
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

export default function RiskTable({ assets, portfolioWeights, disclosedWeights, fundTicker, portfolioLabel }) {
  const [sortKey, setSortKey] = useState("risk");
  const [sortDir, setSortDir] = useState("desc");
  // Default to the compact view (tGARCH + EVT + yrVaR + Comp VaR).
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

  const sorted = [...individuals].sort((a, b) => {
    const fn = SORT_FNS[sortKey] ?? SORT_FNS.risk;
    const av = fn(a);
    const bv = fn(b);
    if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const sp = { sortKey, sortDir, onSort: handleSort };

  return (
    <div className="table-wrapper">
      <div className="table-controls">
        <button
          className="model-toggle-btn"
          onClick={() => setShowAllModels((v) => !v)}
          aria-pressed={showAllModels}
        >
          {showAllModels
            ? "▾ Hide HS / EWMA / GARCH (show only tGARCH + EVT)"
            : "▸ Show all 5 VaR models (add HS, EWMA, GARCH)"}
        </button>
      </div>
      <table className="risk-table">
        <thead>
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
            <ThWithTip col="varYr"     label="yrVaR (10%)" tip={TIPS.yrVar} className="num col-yr group-start group-end" {...sp} />
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
          {sorted.map((a) => {
            const wt           = portfolioWeights?.[a.ticker];
            // For look-through baskets we also surface the holding's
            // weight as a fraction of the fund (pre-normalization),
            // so users see at a glance that "5% of basket" maps to e.g.
            // "3.7% of CGGO" — making the basket-vs-fund abstraction
            // legible in the row itself, not just in the panel below.
            const disclosedPct = disclosedWeights?.[a.ticker];
            return (
            <tr key={a.ticker}>
              <td className="left asset-cell sticky-col">
                <span className="ticker">{a.ticker}</span>
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
                {/* Reference row in active-fund modes: the fund itself,
                    not in the basket. Make that explicit so users don't
                    wonder why it has no weight. */}
                {wt == null && fundTicker && a.ticker === fundTicker && (
                  <span className="portfolio-weight reference-row-tag">
                    fund reference (not in basket)
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
              <VarEsCell varValue={a.var_yr_10pct} esValue={a.es_yr_10pct} className="col-yr group-start group-end" />
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
          })}
        </tbody>
        {portfolio && (
          <tfoot>
            <PortfolioRow a={portfolio} portfolioLabel={portfolioLabel} showAllModels={showAllModels} />
          </tfoot>
        )}
      </table>
    </div>
  );
}
