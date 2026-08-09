import InfoTip from "./InfoTip.jsx";
import "./ThemeNowBanner.css";

/**
 * "NOW" theme banner — the portfolio's AI & semiconductors exposure, at the
 * top of the Portfolio Risk tab. Two distinct reads shown side by side:
 * what you HOLD (direct weight in curated AI/semis names) and how you MOVE
 * (beyond-market SMH beta), plus the theme's share of risk, a shock
 * translation, and a rolling-beta trend spark.
 *
 * Data shape: backend factor_models.compute_theme_now().
 */

const TIPS = {
  beta: "Two-factor fit: portfolio = β·market + β·(SMH stripped of market). This is the semis sensitivity BEYOND broad-equity beta. Low <0.15 · elevated 0.15–0.35 · high >0.35.",
  share: "Share of portfolio variance the semis factor explains in that fit. Higher = more of your day-to-day risk is the AI trade.",
  direct: "Summed weight in curated AI/semis names (chips, supply chain, AI-capex mega-caps). ETF books read n/a — no pretend index look-through.",
  shock: "Raw SMH beta × −20%. Raw (not market-stripped) because a semis drawdown arrives with its usual market co-movement. A beta estimate, not a scenario replay.",
  trend: "Beyond-market semis beta on rolling 90-day windows. Read the direction, not the decimals.",
};

const TIER = {
  low:      { word: "Low",      cls: "tnb-tier-low" },
  elevated: { word: "Elevated", cls: "tnb-tier-elevated" },
  high:     { word: "High",     cls: "tnb-tier-high" },
};

function signed(v, d = 2) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
}

function Spark({ rolling }) {
  if (!rolling || rolling.length < 4) return null;
  const W = 150, H = 40, P = 3;
  const vals = rolling.map((r) => r.beta);
  const lo = Math.min(...vals, 0);
  const hi = Math.max(...vals, 0.01);
  const X = (i) => P + (i / (vals.length - 1)) * (W - 2 * P);
  const Y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const zeroInRange = lo < 0 && hi > 0;
  return (
    <svg className="tnb-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {zeroInRange && (
        <line x1={P} x2={W - P} y1={Y(0)} y2={Y(0)}
              stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" />
      )}
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={X(vals.length - 1)} cy={Y(vals[vals.length - 1])} r="2.5" fill="var(--accent)" />
    </svg>
  );
}

export default function ThemeNowBanner({ data }) {
  if (!data) return null;
  const tier = TIER[data.tier] ?? TIER.low;
  const dr = data.direct;

  const directTip = dr
    ? `${TIPS.direct}\n\n${dr.names.slice(0, 8).map((n) => `${n.ticker} ${n.weight_pct}%`).join(" · ")}${dr.names.length > 8 ? ` · +${dr.names.length - 8} more` : ""}`
    : TIPS.direct;

  return (
    <div className="tnb-panel">
      <div className="tnb-head">
        <span className="tnb-eyebrow">
          Now · AI &amp; Semis exposure
        </span>
        <span className="tnb-sub">
          proxy {data.proxy} · last {data.n_obs} trading days
        </span>
      </div>

      <div className="tnb-row">
        <div className="tnb-stat tnb-stat-hero">
          <span className="tnb-label">β beyond market <InfoTip text={TIPS.beta} /></span>
          <span className={`tnb-value ${tier.cls}`}>{signed(data.beta_theme)}</span>
          <span className={`tnb-tierword ${tier.cls}`}>
            {tier.word}{!data.theme_significant && " · n.s."}
          </span>
        </div>

        <div className="tnb-stat">
          <span className="tnb-label">share of risk <InfoTip text={TIPS.share} /></span>
          <span className="tnb-value">{data.risk_share_pct}%</span>
        </div>

        <div className="tnb-stat">
          <span className="tnb-label">direct weight <InfoTip text={directTip} /></span>
          {dr ? (
            <>
              <span className="tnb-value">{dr.weight_pct}%</span>
              <span className="tnb-note">{dr.n_names} names</span>
            </>
          ) : (
            <>
              <span className="tnb-value tnb-na">n/a</span>
              <span className="tnb-note">ETF book</span>
            </>
          )}
        </div>

        <div className="tnb-stat">
          <span className="tnb-label">if {data.proxy} {data.shock_pct}% <InfoTip text={TIPS.shock} /></span>
          <span className={`tnb-value ${data.shock_impact_pct < 0 ? "tnb-neg" : ""}`}>
            {data.shock_impact_pct}%
          </span>
          <span className="tnb-note">est., β {signed(data.beta_raw)}</span>
        </div>

        <div className="tnb-stat tnb-stat-spark">
          <span className="tnb-label">rolling 90d β <InfoTip text={TIPS.trend} /></span>
          <Spark rolling={data.rolling} />
          {data.beta_prior_6m != null && (
            <span className="tnb-note">6m ago {signed(data.beta_prior_6m)}</span>
          )}
        </div>
      </div>

      <div className="tnb-foot">
        Two-factor read (market + market-orthogonalized {data.proxy}) on daily
        returns, {data.first_date} → {data.last_date}. The curated name list is
        versioned in the backend; 90-day betas are noisy — read the direction,
        not the decimals.
      </div>
    </div>
  );
}
