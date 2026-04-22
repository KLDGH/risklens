import "./RiskBar.css";

export default function RiskBar({ level }) {
  const pct = Math.round(level * 100);

  // Color: green (low) → yellow (mid) → red (high)
  const hue = Math.round(120 - level * 120);
  const color = `hsl(${hue}, 85%, 52%)`;

  return (
    <div className="risk-bar-wrapper" title={`Risk percentile: ${pct}% vs trailing 2-year history`}>
      <div className="risk-bar-track">
        <div
          className="risk-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="risk-bar-label" style={{ color }}>{pct}%</span>
    </div>
  );
}
