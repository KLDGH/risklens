import RiskBar from "./RiskBar.jsx";
import InfoTip from "./InfoTip.jsx";
import "./RiskTable.css";

const TIPS = {
  ret:     "Yesterday's log return for this asset.",
  varHs:   "Historical Simulation VaR — the 1% worst daily loss drawn directly from the last 1000 trading days. No distribution assumption.",
  varEwma: "EWMA VaR — normal distribution VaR using exponentially weighted volatility (λ=0.94). Recent days get more weight than older ones.",
  varGarch: "GARCH(1,1) VaR — like EWMA but uses a GARCH model to forecast tomorrow's volatility. Falls back to EWMA if fitting fails.",
  varTgarch: "GJR-GARCH VaR — asymmetric GARCH that gives extra weight to negative return shocks. Better captures the 'volatility is higher after crashes' effect.",
  varEvt:  "Extreme Value Theory VaR — fits a Generalized Pareto Distribution to the worst losses. Best for fat-tailed assets like crypto.",
  esEwma:  "Expected Shortfall (CVaR) — the average loss on the worst 1% of days. Always larger than VaR; a better measure of tail risk.",
  mean:    "Simple average of all five VaR models (HS, EWMA, GARCH, tGARCH, EVT). A quick ensemble estimate.",
  alpha:   "Hill tail index — estimated from the worst losses. Lower = fatter tails. Equities typically 3–5; crypto often below 3.",
  risk:    "Percentile rank of today's EWMA VaR vs the past 2 years of daily values for this asset. 100% = highest risk seen in 2 years.",
};

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
  return (
    <div className="table-wrapper">
      <table className="risk-table">
        <thead>
          <tr>
            <th className="left">Asset</th>
            <th className="num">Price</th>
            <th className="num">1d Ret% <InfoTip text={TIPS.ret} /></th>
            <th className="num">VaR HS <InfoTip text={TIPS.varHs} /></th>
            <th className="num">VaR EWMA <InfoTip text={TIPS.varEwma} /></th>
            <th className="num">VaR GARCH <InfoTip text={TIPS.varGarch} /></th>
            <th className="num">VaR tGARCH <InfoTip text={TIPS.varTgarch} /></th>
            <th className="num">VaR EVT <InfoTip text={TIPS.varEvt} /></th>
            <th className="num">ES EWMA <InfoTip text={TIPS.esEwma} /></th>
            <th className="num">Mean <InfoTip text={TIPS.mean} /></th>
            <th className="num">α <InfoTip text={TIPS.alpha} /></th>
            <th className="left">Risk <InfoTip text={TIPS.risk} /></th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.ticker}>
              <td className="left asset-cell">
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
              <td className="num mean-cell">{a.mean_var?.toFixed(2)}</td>
              <td className="num alpha-cell">{a.tail_index?.toFixed(2)}</td>
              <td className="left gauge-cell">
                <RiskBar level={a.risk_level} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
