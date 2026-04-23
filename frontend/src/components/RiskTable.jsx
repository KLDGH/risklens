import { useState, useCallback } from "react";
import RiskBar from "./RiskBar.jsx";
import InfoTip from "./InfoTip.jsx";
import "./RiskTable.css";

const TIPS = {
  ret:       "Yesterday's log return for this asset.",
  varHs:     "Historical Simulation VaR — the 1% worst daily loss drawn directly from the last 1000 trading days. No distribution assumption.",
  varEwma:   "EWMA VaR — normal distribution VaR using exponentially weighted volatility (λ=0.94). Recent days get more weight than older ones.",
  varGarch:  "GARCH(1,1) VaR — like EWMA but uses a GARCH model to forecast tomorrow's volatility. Falls back to EWMA if fitting fails.",
  varTgarch: "GJR-GARCH VaR — asymmetric GARCH that gives extra weight to negative return shocks. Better captures the 'volatility is higher after crashes' effect.",
  varEvt:    "Extreme Value Theory VaR — fits a Generalized Pareto Distribution to the worst losses. Best for fat-tailed assets like crypto.",
  esEwma:    "Expected Shortfall (CVaR) — the average loss on the worst 1% of days. Always larger than VaR; a better measure of tail risk.",
  consensus: "Simple average across all five VaR models. A rough consensus proxy — useful as a single reference number but not a coherent risk measure. Treat it as a heuristic, not a precise estimate.",
  range:     "Range across all five VaR models (min – max). When tight, the models agree and standard assumptions hold. When wide — usually EVT pulling high — the asset's tail losses are more extreme than normal-distribution models capture. That gap is a warning, not noise.",
  alpha:     "Hill tail index — estimated from the worst losses. Lower = fatter tails. Equities typically 3–5; crypto often below 3.",
  risk:      "Percentile rank of today's EWMA VaR vs the past 2 years of daily values for this asset. 100% = highest risk seen in 2 years.",
};

// Map column key → value extractor for sorting
const SORT_FNS = {
  name:      (a) => a.name,
  price:     (a) => a.last_price,
  ret:       (a) => a.last_return_pct,
  varHs:     (a) => a.var_hs,
  varEwma:   (a) => a.var_ewma,
  varGarch:  (a) => a.var_garch,
  varTgarch: (a) => a.var_tgarch,
  varEvt:    (a) => a.var_evt,
  esEwma:    (a) => a.es_ewma,
  consensus: (a) => a.mean_var,
  range:     (a) => (Math.max(a.var_hs, a.var_ewma, a.var_garch, a.var_tgarch, a.var_evt) - Math.min(a.var_hs, a.var_ewma, a.var_garch, a.var_tgarch, a.var_evt)),
  alpha:     (a) => a.tail_index,
  risk:      (a) => a.risk_level,
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

// Expand/collapse toggle header for the model detail columns
function ThToggle({ expanded, onToggle, colSpan }) {
  return (
    <th
      className="num model-toggle-th"
      colSpan={colSpan}
      onClick={onToggle}
      title={expanded ? "Hide individual model VaRs" : "Show individual model VaRs"}
    >
      <span className="th-inner">
        {expanded ? "▾ Models" : "▸ Models"}
      </span>
    </th>
  );
}

function RangeCell({ values }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const color = spread > 3 ? "var(--red)" : spread > 1.5 ? "var(--yellow)" : "var(--text-dim)";
  return (
    <td className="num range-cell" style={{ color }}>
      {min.toFixed(2)}<span className="range-sep"> – </span>{max.toFixed(2)}
    </td>
  );
}

function ReturnCell({ value }) {
  const color = value > 0 ? "var(--green)" : value < 0 ? "var(--red)" : "var(--text-dim)";
  return (
    <td className="num" style={{ color }}>
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </td>
  );
}

function VarCell({ value }) {
  let color = "var(--green)";
  if (value > 5) color = "var(--red)";
  else if (value > 2.5) color = "var(--yellow)";
  return <td className="num" style={{ color }}>{value.toFixed(2)}</td>;
}

export default function RiskTable({ assets }) {
  const [sortKey, setSortKey] = useState("risk");
  const [sortDir, setSortDir] = useState("desc");

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

  const sorted = [...assets].sort((a, b) => {
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
          <tr>
            <Th col="name"  label="Asset"   className="left sticky-col" {...sp} />
            <Th col="price" label="Price"   className="num" {...sp} />
            <ThWithTip col="ret"       label="1d Ret%"    tip={TIPS.ret}       className="num" {...sp} />
            <ThWithTip col="varHs"     label="VaR HS"     tip={TIPS.varHs}     className="num" {...sp} />
            <ThWithTip col="varEwma"   label="VaR EWMA"   tip={TIPS.varEwma}   className="num" {...sp} />
            <ThWithTip col="varGarch"  label="VaR GARCH"  tip={TIPS.varGarch}  className="num" {...sp} />
            <ThWithTip col="varTgarch" label="VaR tGARCH" tip={TIPS.varTgarch} className="num" {...sp} />
            <ThWithTip col="varEvt"    label="VaR EVT"    tip={TIPS.varEvt}    className="num" {...sp} />
            <ThWithTip col="esEwma"    label="ES EWMA"    tip={TIPS.esEwma}    className="num" {...sp} />
            <ThWithTip col="alpha"     label={<span style={{textTransform:"none"}}>α tail</span>} tip={TIPS.alpha} className="num" {...sp} />
            <ThWithTip col="risk"      label="Risk"       tip={TIPS.risk}      className="left" {...sp} />
            <ThWithTip col="consensus" label="Consensus"  tip={TIPS.consensus} className="num" {...sp} />
            <ThWithTip col="range"     label="Range"      tip={TIPS.range}     className="num" {...sp} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <tr key={a.ticker}>
              <td className="left asset-cell sticky-col">
                <span className="ticker">{a.ticker}</span>
                <span className="name">{a.name}</span>
              </td>
              <td className="num price">${a.last_price.toLocaleString()}</td>
              <ReturnCell value={a.last_return_pct} />
              <VarCell value={a.var_hs} />
              <VarCell value={a.var_ewma} />
              <VarCell value={a.var_garch} />
              <VarCell value={a.var_tgarch} />
              <VarCell value={a.var_evt} />
              <VarCell value={a.es_ewma} />
              <td className="num alpha-cell">{a.tail_index?.toFixed(2)}</td>
              <td className="left gauge-cell">
                <RiskBar
                  level={a.risk_level}
                  trend={a.var_trend}
                  exceptionRate={a.exception_rate}
                  exceptionCount={a.exception_count}
                />
              </td>
              <td className="num consensus-cell">{a.mean_var?.toFixed(2)}</td>
              <RangeCell values={[a.var_hs, a.var_ewma, a.var_garch, a.var_tgarch, a.var_evt]} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
