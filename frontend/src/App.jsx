import { useEffect, useState } from "react";
import RiskTable from "./components/RiskTable.jsx";
import HistoricalChart from "./components/HistoricalChart.jsx";
import "./App.css";

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/data/risk_output.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (!json.assets || json.assets.length === 0) {
          throw new Error("No asset data — run the backend first.");
        }
        setData(json);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const fmt = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC";
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo">EXTREME<span className="logo-accent">RISK</span></span>
          <span className="subtitle">Market Risk Dashboard · 1% VaR / ES · 1000-day window</span>
        </div>
        {data && (
          <div className="generated-at">
            <span className="label">Generated</span>
            <span className="value">{fmt(data.generated_at)}</span>
          </div>
        )}
      </header>

      <div className="legend">
        <span className="legend-item"><span className="dot green" />Low risk (&lt;2.5)</span>
        <span className="legend-item"><span className="dot yellow" />Elevated (2.5–5)</span>
        <span className="legend-item"><span className="dot red" />High (&gt;5)</span>
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
        {data && <RiskTable assets={data.assets} />}
        {data?.sp500_history && (
          <HistoricalChart data={data.sp500_history} />
        )}
      </main>

      <footer className="footer">
        <span>VaR models: Historical Simulation · EWMA (λ=0.94) · GARCH(1,1)</span>
        <span>Data via yfinance · Not financial advice</span>
      </footer>
    </div>
  );
}
