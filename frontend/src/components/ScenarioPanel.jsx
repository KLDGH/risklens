import { useState } from "react";
import HoverTip from "./HoverTip.jsx";
import "./ScenarioPanel.css";

const fmt = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });

const fmtSigned = (n, digits = 1) =>
  `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;


function ContribTooltip({ ticker, ret, weightPct, contrib }) {
  return (
    <div>
      <div style={{ fontWeight: 600, color: "#e8ecf2", marginBottom: 4 }}>
        {ticker}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ opacity: 0.7 }}>Asset return</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtSigned(ret, 2)}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ opacity: 0.7 }}>× Weight</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {weightPct.toFixed(2)}%
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 5,
          paddingTop: 5,
          borderTop: "1px solid #3a4554",
          fontWeight: 600,
        }}
      >
        <span>= Contribution</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtSigned(contrib, 2)}
        </span>
      </div>
    </div>
  );
}


function ContribBar({ ticker, contrib, ret, weightPct, maxAbs }) {
  const isGain = contrib >= 0;
  const width = Math.min(100, (Math.abs(contrib) / maxAbs) * 100);

  return (
    <HoverTip
      block
      width={220}
      content={
        <ContribTooltip
          ticker={ticker}
          ret={ret}
          weightPct={weightPct}
          contrib={contrib}
        />
      }
    >
      <div className="contrib-row">
        <span className="contrib-ticker">{ticker}</span>
        <div className="contrib-track">
          <div
            className={`contrib-fill ${isGain ? "gain" : "loss"}`}
            style={{ width: `${width}%` }}
          />
        </div>
        <span className={`contrib-ret ${isGain ? "gain" : "loss"}`}>
          {contrib > 0 ? "+" : ""}{contrib.toFixed(2)}
        </span>
      </div>
    </HoverTip>
  );
}


function ComparisonTooltip({ comparisons, currentMode, currentPnl }) {
  if (!comparisons) return null;
  const entries = Object.entries(comparisons).filter(([k]) => k !== currentMode);
  if (entries.length === 0) return null;

  return (
    <div>
      <div
        style={{
          fontWeight: 600,
          color: "#e8ecf2",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontSize: 9,
        }}
      >
        Same scenario, other portfolios
      </div>
      {entries.map(([k, v]) => {
        const delta = v.pnl - currentPnl;
        const worse = delta < 0;            // more negative = worse
        const sign = delta > 0 ? "+" : "";
        return (
          <div
            key={k}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 2,
            }}
          >
            <span style={{ opacity: 0.85 }}>{v.label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtSigned(v.pnl, 1)}
              <span
                style={{
                  marginLeft: 6,
                  opacity: 0.55,
                  fontSize: 9,
                  color: worse ? "#fca5a5" : "#86efac",
                }}
              >
                ({sign}{Math.abs(delta).toFixed(1)}pp {worse ? "worse" : "better"})
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}


function ScenarioCard({ s, weights, comparisons, currentMode }) {
  const isHypo = s.type === "hypothetical";
  const isLoss = s.portfolio_pnl < 0;
  const [refsOpen, setRefsOpen] = useState(false);

  const sorted = Object.entries(s.contributions).sort((a, b) => a[1] - b[1]);
  const maxAbs = Math.max(...sorted.map(([, v]) => Math.abs(v)));

  // Each ticker's effective weight inside this scenario (re-normalized when
  // some assets were missing). We back-derive it: weight = contrib / return.
  const effectiveWeight = (ticker, contrib) => {
    const ret = s.asset_returns[ticker];
    if (ret === undefined || ret === 0) return 0;
    return (contrib / ret) * 100; // both as percent → weight in percent
  };

  const cardComparisons = comparisons?.[s.id];

  return (
    <div className={`scenario-card ${isHypo ? "hypo" : "historical"}`}>
      <div className="scenario-card-top">
        <div className="scenario-name-row">
          <span className="scenario-name">{s.name}</span>
          <span className={`scenario-badge ${isHypo ? "badge-hypo" : "badge-hist"}`}>
            {isHypo ? "HYPOTHETICAL" : "HISTORICAL"}
          </span>
        </div>
        <div className="scenario-dates">
          {isHypo
            ? "Analyst-estimated shock scenario"
            : `${fmt(s.start)} — ${fmt(s.end)}`}
        </div>
        <div className="scenario-desc">{s.desc}</div>
      </div>

      <HoverTip
        block
        width={280}
        content={
          <ComparisonTooltip
            comparisons={cardComparisons}
            currentMode={currentMode}
            currentPnl={s.portfolio_pnl}
          />
        }
      >
        <div className={`scenario-pnl ${isLoss ? "loss" : "gain"}`}>
          {s.portfolio_pnl > 0 ? "+" : ""}{s.portfolio_pnl.toFixed(1)}%
          <span className="scenario-pnl-label">
            portfolio return
          </span>
        </div>
      </HoverTip>

      {s.references?.length > 0 && (
        <div className="scenario-refs">
          <div className="scenario-refs-caption">
            {isHypo ? "For context · same shocks" : "For context · same window"}
          </div>
          {s.references.map((r) => (
            <div className="scenario-ref-row" key={r.label}>
              <span className="scenario-ref-label">{r.label}</span>
              <span className={`scenario-ref-val ${r.ret_pct < 0 ? "loss" : "gain"}`}>
                {r.ret_pct > 0 ? "+" : ""}{r.ret_pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="contrib-list">
        {sorted.map(([ticker, contrib]) => (
          <ContribBar
            key={ticker}
            ticker={ticker}
            contrib={contrib}
            ret={s.asset_returns[ticker] ?? 0}
            weightPct={effectiveWeight(ticker, contrib)}
            maxAbs={maxAbs}
          />
        ))}
      </div>

      {!isHypo && s.proxied && Object.keys(s.proxied).length > 0 && (
        <div className="scenario-proxy-note">
          Pre-inception proxy: {Object.entries(s.proxied).map(([t, px]) => `${t}→${px}`).join(", ")}
          {" "}— these funds launched after this window, so a long-history equivalent stands in.
        </div>
      )}

      {isHypo && (s.probability_live || s.probability_sources?.length > 0) && (
        <div className="prob-outlook">
          <div className="prob-outlook-label">Probability outlook</div>

          {s.probability_live && (
            <div className="prob-live">
              <a
                href={s.probability_live.url}
                target="_blank"
                rel="noopener noreferrer"
                className="prob-live-link"
              >
                {s.probability_live.name} ↗
              </a>
              <span className="prob-live-value">{s.probability_live.value_label}</span>
              {s.probability_live.context && (
                <div className="prob-live-context">{s.probability_live.context}</div>
              )}
            </div>
          )}

          {s.probability_sources?.length > 0 && (
            <div className="prob-sources">
              <button
                className={`prob-refs-toggle${refsOpen ? " open" : ""}`}
                onClick={() => setRefsOpen((o) => !o)}
                aria-expanded={refsOpen}
              >
                {refsOpen
                  ? `▾ Hide external references (${s.probability_sources.length})`
                  : `▸ External references (${s.probability_sources.length})`}
              </button>
              {refsOpen && (
                <ul className="prob-sources-list">
                  {s.probability_sources.map((src) => (
                    <li key={src.name}>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="prob-source-link"
                      >
                        {src.name} ↗
                      </a>
                      {src.note && <span className="prob-source-note"> · {src.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {s.coverage_pct < 100 && (
        <div className="scenario-coverage">
          {s.coverage_pct}% of portfolio weight covered — some assets didn't exist yet
        </div>
      )}

      {isHypo && (
        <div className="scenario-coverage">
          Assumptions are illustrative estimates, not forecasts. Shocks reflect analyst consensus on directional exposure.
        </div>
      )}
    </div>
  );
}


export default function ScenarioPanel({ scenarios, weights, comparisons, currentMode }) {
  if (!scenarios || scenarios.length === 0) return null;

  // Hypothetical (forward-looking) cards first, historical cards second
  const ordered = [
    ...scenarios.filter((s) => s.type === "hypothetical"),
    ...scenarios.filter((s) => s.type !== "hypothetical"),
  ];

  return (
    <div className="scenario-section">
      <div className="scenario-grid">
        {ordered.map((s) => (
          <ScenarioCard
            key={s.id}
            s={s}
            weights={weights}
            comparisons={comparisons}
            currentMode={currentMode}
          />
        ))}
      </div>
    </div>
  );
}
