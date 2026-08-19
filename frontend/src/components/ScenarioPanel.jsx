import { useState } from "react";
import HoverTip from "./HoverTip.jsx";
import InfoTip from "./InfoTip.jsx";
import "./ScenarioPanel.css";

// Plain-spoken mechanics disclosure for the assumption sliders. A reader who
// sees sliders may assume a factor model with cross-asset propagation is
// underneath — it deliberately is NOT, and saying so up front is the point.
const ADJUST_MECHANICS_TIP =
  "Not a factor model. Each slider multiplies this scenario's hand-set " +
  "category shocks for one group (0×–2×); a holding's P&L is weight × shock, " +
  "summed. Groups are independent — moving equities does not move rates or " +
  "gold; nothing propagates unless you move it. Deliberately naive: what you " +
  "set is exactly what is applied. Baselines are analyst assumptions " +
  "versioned in the repo (scenarios.yaml), not model output.";

const fmt = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });

const fmtSigned = (n, digits = 1) =>
  `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;


function ContribTooltip({ ticker, ret, weightPct, contrib }) {
  return (
    <div>
      <div style={{ fontWeight: 600, color: "var(--text-bright)", marginBottom: 4 }}>
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
          borderTop: "1px solid var(--border)",
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
          color: "var(--text-bright)",
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
                  color: worse ? "var(--red)" : "var(--green)",
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


// Fixed display order for the assumption-group sliders. Equities split by
// region — the level at which the curated scenarios differentiate shocks.
const GROUP_ORDER = [
  "tech_semis", "us_equity", "intl_equity", "em_equity",
  "rates_credit", "real_assets", "crypto",
];

function ScenarioCard({ s, weights, comparisons, currentMode }) {
  const isHypo = s.type === "hypothetical";
  const [refsOpen, setRefsOpen] = useState(false);

  // ---- assumption adjustment (hypothetical cards only) ----
  // Each group slider scales every member holding's curated shock together,
  // so relative structure inside the group is preserved. Adjusted
  // contribution = baseline contribution × the group's multiplier.
  const [adjOpen, setAdjOpen] = useState(false);
  const [adj, setAdj] = useState({});
  const groups = isHypo && s.asset_groups
    ? GROUP_ORDER.filter((g) => Object.values(s.asset_groups).includes(g))
    : [];
  const multOf = (g) => adj[g] ?? 1;
  const multFor = (ticker) => multOf(s.asset_groups?.[ticker]);
  const modified = groups.some((g) => multOf(g) !== 1);

  const adjContrib = (ticker, contrib) =>
    contrib * (isHypo ? multFor(ticker) : 1);
  const displayPnl = modified
    ? Object.entries(s.contributions).reduce(
        (acc, [t, c]) => acc + adjContrib(t, c), 0)
    : s.portfolio_pnl;
  const isLoss = displayPnl < 0;

  // Anchor per group: the member with the largest baseline |shock| — its
  // scaled value is the slider's readout ("what −28% becomes").
  const anchorRet = (g) => {
    let best = 0;
    for (const [t, grp] of Object.entries(s.asset_groups ?? {})) {
      const r = s.asset_returns[t] ?? 0;
      if (grp === g && Math.abs(r) > Math.abs(best)) best = r;
    }
    return best;
  };

  const sorted = Object.entries(s.contributions)
    .map(([t, c]) => [t, adjContrib(t, c)])
    .sort((a, b) => a[1] - b[1]);
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
          {displayPnl > 0 ? "+" : ""}{displayPnl.toFixed(1)}%
          <span className="scenario-pnl-label">
            {modified ? (
              <>
                adjusted · baseline {s.portfolio_pnl > 0 ? "+" : ""}
                {s.portfolio_pnl.toFixed(1)}%
              </>
            ) : (
              "portfolio return"
            )}
          </span>
        </div>
      </HoverTip>

      {isHypo && groups.length > 0 && (
        <div className="scenario-adjust">
          <button
            className={`adj-toggle${adjOpen ? " open" : ""}${modified ? " modified" : ""}`}
            onClick={() => setAdjOpen((o) => !o)}
            aria-expanded={adjOpen}
          >
            {adjOpen ? "▾" : "▸"} Adjust assumptions
            {modified && <span className="adj-dot" title="assumptions modified" />}
          </button>
          {adjOpen && <InfoTip text={ADJUST_MECHANICS_TIP} />}
          {adjOpen && (
            <div className="adj-body">
              {groups.map((g) => {
                const m = multOf(g);
                const base = anchorRet(g);
                // Provenance hover: the distinct curated shock values inside
                // this group (each holding uses its own category's value).
                const distinct = [...new Set(
                  Object.entries(s.asset_groups ?? {})
                    .filter(([, grp]) => grp === g)
                    .map(([t]) => s.asset_returns[t] ?? 0)
                )].sort((a, b) => a - b);
                const provenance = (
                  <div style={{ lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 600, color: "var(--text-bright)", marginBottom: 3 }}>
                      Curated shocks in this group
                    </div>
                    {distinct.map((v) => (
                      <div key={v} style={{ fontVariantNumeric: "tabular-nums" }}>
                        {v > 0 ? "+" : ""}{v.toFixed(0)}% → {(v * m) > 0 ? "+" : ""}{(v * m).toFixed(0)}%
                      </div>
                    ))}
                    <div style={{ color: "var(--text-dim)", marginTop: 3 }}>
                      hand-set per category (scenarios.yaml); the slider scales
                      them together
                    </div>
                  </div>
                );
                return (
                  <div key={g} className="adj-row">
                    <HoverTip content={provenance} width={230}>
                      <span className="adj-label">{s.group_labels?.[g] ?? g}</span>
                    </HoverTip>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      step="5"
                      value={Math.round(m * 100)}
                      onChange={(e) =>
                        setAdj({ ...adj, [g]: Number(e.target.value) / 100 })
                      }
                    />
                    <span className={`adj-val${m !== 1 ? " modified" : ""}`}>
                      {(base * m) > 0 ? "+" : ""}{(base * m).toFixed(0)}%
                      <span className="adj-base">
                        {m === 1 ? "curated" : `base ${base > 0 ? "+" : ""}${base.toFixed(0)}%`}
                      </span>
                    </span>
                  </div>
                );
              })}
              <div className="adj-footrow">
                <button className="adj-reset" onClick={() => setAdj({})} disabled={!modified}>
                  reset to analyst baseline
                </button>
                <span className="adj-note">
                  simple re-scaling of the analyst's hand-set shocks — no
                  factor model, no cross-group propagation (hover a group
                  name for its curated values)
                </span>
              </div>
            </div>
          )}
        </div>
      )}

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
            ret={(s.asset_returns[ticker] ?? 0) * (isHypo ? multFor(ticker) : 1)}
            weightPct={effectiveWeight(ticker, s.contributions[ticker])}
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
