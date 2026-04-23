import HoverTip from "./HoverTip.jsx";
import "./RiskBar.css";

function TipContent({ pct, color, trend, exceptionRate, exceptionCount }) {
  const trendLabel = trend === "up"
    ? "↑ Rising — VaR has been climbing over the last 5 trading days"
    : trend === "down"
    ? "↓ Falling — VaR has been easing over the last 5 trading days"
    : "→ Flat — VaR roughly unchanged over the last 5 days";

  const excInterpret = exceptionRate != null
    ? exceptionRate > 3
      ? "EWMA is likely underestimating tail risk. Weight EVT estimates more heavily."
      : exceptionRate > 1.5
      ? "Slight underestimation. Model is reasonable but EVT may be more accurate."
      : "Model well-calibrated. EWMA estimates are reliable for this asset."
    : null;

  return (
    <div style={{ lineHeight: 1.7 }}>
      <div style={{ color: color, fontWeight: 600, marginBottom: 5 }}>
        Risk gauge: {pct}%
      </div>
      <div style={{ marginBottom: 4 }}>
        Percentile rank vs trailing 2-year history. 100% = highest risk seen in 2 years.
      </div>
      <div style={{ borderTop: "1px solid #1e3048", paddingTop: 5, marginTop: 4 }}>
        {trendLabel}
      </div>
      {exceptionRate != null && (
        <div style={{ borderTop: "1px solid #1e3048", paddingTop: 5, marginTop: 4 }}>
          <div>VaR exceptions (2y): <span style={{ color: exceptionRate > 3 ? "#e53e3e" : exceptionRate > 1.5 ? "#f59e0b" : "#4ade80", fontWeight: 600 }}>{exceptionCount} days ({exceptionRate}%)</span></div>
          <div style={{ color: "#8896aa", marginTop: 2 }}>Expected ~1%. {excInterpret}</div>
        </div>
      )}
    </div>
  );
}

export default function RiskBar({ level, trend, exceptionRate, exceptionCount }) {
  const pct = Math.round(level * 100);
  const hue = Math.round(120 - level * 120);
  const color = `hsl(${hue}, 85%, 52%)`;

  const trendIcon  = trend === "up" ? "↑" : trend === "down" ? "↓" : null;
  const trendColor = trend === "up" ? "var(--red)" : "var(--green)";

  return (
    <HoverTip content={
      <TipContent
        pct={pct}
        color={color}
        trend={trend}
        exceptionRate={exceptionRate}
        exceptionCount={exceptionCount}
      />
    }>
      <div className="risk-bar-wrapper">
        <div className="risk-bar-track">
          <div
            className="risk-bar-fill"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <span className="risk-bar-label" style={{ color }}>{pct}%</span>
        {trendIcon && (
          <span className="risk-bar-trend" style={{ color: trendColor }}>{trendIcon}</span>
        )}
      </div>
    </HoverTip>
  );
}
