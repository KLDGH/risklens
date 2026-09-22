import InfoTip from "./InfoTip.jsx";
import "./SummaryPanel.css";

/**
 * Executive risk summary — one row per portfolio, exception-first.
 *
 * Built for a reader who doesn't need the factor tables: which books are
 * outside their bounds, why, and what happens next. Everything here is
 * derived from data the other tabs already show; nothing new is modeled.
 *
 * Status is rule-based and deliberately simple: each portfolio collects
 * flags (below), 0 flags = green, 1 = amber, 2+ = red. Rows sort worst-first.
 */

// PLACEHOLDER tolerance bands for ex-ante active risk, by mandate type.
// Real bands are set by the independent investment-risk function with each
// PM; these are rough industry ranges so the view has something to test.
const BANDS = {
  allocation:    { lo: 0.5, hi: 3.0, label: "Index-based allocation" },
  active_us:     { lo: 2.0, hi: 6.0, label: "Active US large-cap" },
  active_global: { lo: 3.0, hi: 8.0, label: "Active global equity" },
};
const BAND_OF = {
  hypothetical: "allocation",
  aor:          "allocation",
  tdf_2055:     "allocation",
  cg_2035:      "allocation",
  ica_active:   "active_us",
  cggo_active:  "active_global",
  npf_active:   "active_global",
  dwld_active:  "active_global",
};

const BETA_DRIFT = 0.25;      // |beta − 1| beyond this reads as a market call
const MIN_CAPTURE = 70;       // model capture below this = numbers directional
const BAR_MAX = 12;           // % active risk at the right edge of the band bar

const TIPS = {
  te: "Predicted tracking error: how far the fund can be expected to drift from its benchmark in a typical year (about two years in three fall inside ± this number). Shaded band is the tolerance range for this kind of mandate. Bands here are placeholders, not agreed limits.",
  beta: "Sensitivity to the benchmark. 1.0 moves with it; 1.3 amplifies benchmark moves by about 30%. Flagged when more than 0.25 away from 1.",
  stress: "Largest shortfall against the benchmark across every stress scenario, historical and forward-looking. An absolute crisis loss mostly restates market exposure; the gap to the benchmark shows where a fund behaves worse than its mandate implies. Historical crises use the fund's own price where it existed for the whole window; otherwise (and for the forward-looking scenarios) the modeled holdings. Full list on the Stress tab.",
  model: "Do the risk models hold up? Each daily loss forecast is checked against what actually happened. Pass = at least one model forecast losses at the right frequency without clustering. Watch = frequency right but misses came in clusters. Fail = every model under-predicted.",
  theme: "How much of the portfolio's risk comes from AI and semiconductor exposure beyond the general market.",
};

// ---------------------------------------------------------------------------

function modelCheck(backtests) {
  if (!backtests?.length) return { status: "none", label: "No test yet" };
  const v = backtests.map((b) => b.verdict);
  if (v.includes("CALIBRATED")) {
    const passing = backtests.filter((b) => b.verdict === "CALIBRATED").map((b) => b.model);
    const all = passing.length === backtests.length;
    return { status: "pass", label: "Pass", detail: all ? null : passing.join(", ") };
  }
  if (v.includes("CLUSTERED")) return { status: "watch", label: "Watch" };
  return { status: "fail", label: "Fail" };
}

function assess(id, p) {
  const xa = p.exante;
  if (!xa) return null;
  const F = xa.fund;
  const head = F ? F.exante : xa;
  const te = head.active_risk_pct;
  const beta = head.beta;
  const band = BANDS[BAND_OF[id]] ?? BANDS.allocation;

  // Worst ACTIVE stress outcome: portfolio − benchmark, across historical and
  // hypothetical scenarios. Fund NAV replay where available (look-through
  // baskets overstate the gap), otherwise the modeled holdings.
  const worst = (p.scenarios ?? [])
    .map((s) => {
      const fund = s.fund_active_pnl != null;
      const active = fund ? s.fund_active_pnl : s.active_pnl;
      if (active == null) return null;
      return {
        name: s.name, type: s.type, active, basis: fund ? "fund" : "model",
        pnl: fund ? s.fund_pnl : s.portfolio_pnl, bench: s.benchmark_pnl,
      };
    })
    .filter(Boolean)
    .reduce((a, s) => (a == null || s.active < a.active ? s : a), null);
  const model = modelCheck(p.backtests);
  const theme = p.theme_now;

  const flags = [];
  if (te != null && (te > band.hi || te < band.lo)) {
    const drivers = [...(xa.factors ?? [])]
      .filter((f) => f.significant && (f.active_var_share_pct ?? 0) > 0)
      .sort((a, b) => b.active_var_share_pct - a.active_var_share_pct)
      .slice(0, 2)
      .map((f) => f.label.replace(/\s*\(.*\)/, "").toLowerCase());
    flags.push({
      kind: "te",
      text: `Active risk ${te.toFixed(1)}%, ${te > band.hi ? "above" : "below"} its ${band.lo}–${band.hi}% band` +
        (drivers.length ? `. Largest drivers${F ? " in the modeled holdings" : ""}: ${drivers.join(" and ")}.` : "."),
      owner: "Investment risk", action: "Review with PM",
    });
  }
  if (beta != null && Math.abs(beta - 1) > BETA_DRIFT) {
    flags.push({
      kind: "beta",
      text: `Beta ${beta.toFixed(2)} vs benchmark: ${beta > 1 ? "amplifies" : "damps"} market moves by about ${Math.round(Math.abs(beta - 1) * 100)}%.`,
      owner: "Investment risk", action: "Confirm intended",
    });
  }
  if (theme && theme.tier === "high") {
    flags.push({
      kind: "theme",
      text: `AI and semis concentration: ${theme.risk_share_pct?.toFixed(0)}% of risk beyond the market; a sector sell-off costs about ${Math.abs(theme.shock_impact_pct ?? 0).toFixed(0)}%.`,
      owner: "Investment risk", action: "Monitor theme",
    });
  }
  if (model.status === "fail" || model.status === "watch") {
    flags.push({
      kind: "model",
      text: model.status === "fail"
        ? "Every VaR model under-predicted losses over the test window."
        : "VaR misses arrived in clusters: models are slow to react when volatility jumps.",
      owner: "Model validation", action: "Review model choice",
    });
  }
  const thin = (xa.n_obs ?? 0) < 252;
  const lowCap = xa.model_capture_pct != null && xa.model_capture_pct < MIN_CAPTURE;
  if (thin || lowCap || model.status === "none") {
    const bits = [];
    if (thin) bits.push(`${xa.n_obs} days of shared history, short of a full year`);
    if (lowCap) bits.push(`the factor model explains only ${xa.model_capture_pct.toFixed(0)}% of realized variance`);
    if (model.status === "none") bits.push("no VaR backtest yet");
    flags.push({
      kind: "data",
      text: bits.join("; ").replace(/^./, (c) => c.toUpperCase()) + ".",
      owner: "Data and models", action: "Extend history",
    });
  }

  const level = flags.length === 0 ? "green" : flags.length === 1 ? "amber" : "red";
  return {
    id, label: p.label, short: shortName(p.label), lookThrough: !!F,
    te, beta, band, worst, model, theme, flags, level,
    summary: flags.length ? flags.map((f) => FLAG_WORD[f.kind]).join(", ") : "Within tolerance",
  };
}

const FLAG_WORD = {
  te: "active risk outside band", beta: "beta drift", theme: "AI/semis heavy",
  model: "model check", data: "thin data",
};
const RANK = { red: 0, amber: 1, green: 2 };

// Percentage-point gap to the benchmark, e.g. "−7.9 pts".
const fmtPts = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pts`;

// "iShares Core 60/40 (AOR)" -> "AOR"; "CGGO Look-Through" -> "CGGO".
function shortName(label) {
  const paren = label.match(/\(([^)]+)\)\s*$/);
  return paren ? paren[1] : label.replace(/\s*(Look-Through|Portfolio)$/, "");
}

// ---------------------------------------------------------------------------

export default function SummaryPanel({ portfolios, order, onOpen }) {
  const rows = (order ?? Object.keys(portfolios))
    .map((k) => assess(k, portfolios[k]))
    .filter(Boolean)
    .sort((a, b) => RANK[a.level] - RANK[b.level]);
  if (!rows.length) return null;

  const attention = rows.filter((r) => r.level !== "green");
  const withTheme = rows.filter((r) => r.theme?.risk_share_pct != null);
  const topTheme = withTheme.reduce((a, r) => (!a || r.theme.risk_share_pct > a.theme.risk_share_pct ? r : a), null);
  const tested = rows.filter((r) => r.model.status !== "none");
  const passing = tested.filter((r) => r.model.status === "pass");
  const worstAll = rows.reduce((a, r) => (r.worst && (!a || r.worst.active < a.worst.active) ? r : a), null);
  const exceptions = rows.flatMap((r) => r.flags.map((f) => ({ ...f, row: r })));

  return (
    <div className="sum-panel">
      {/* ---- headline tiles ---- */}
      <div className="sum-tiles">
        <div className="sum-tile">
          <span className="sum-label">Needs attention</span>
          <span className={`sum-value ${attention.length ? "sum-warn" : "sum-ok"}`}>
            {attention.length} of {rows.length}
          </span>
          <span className="sum-sub">
            {attention.length ? attention.map((r) => r.short).join(", ") : "all within tolerance"}
          </span>
        </div>
        {topTheme && (
          <div className="sum-tile">
            <span className="sum-label">Largest AI/semis exposure <InfoTip text={TIPS.theme} /></span>
            <span className="sum-value">{topTheme.theme.risk_share_pct.toFixed(0)}%</span>
            <span className="sum-sub">of {topTheme.short}'s risk</span>
          </div>
        )}
        <div className="sum-tile">
          <span className="sum-label">Risk models passing <InfoTip text={TIPS.model} /></span>
          <span className="sum-value">{passing.length} of {tested.length}</span>
          <span className="sum-sub">
            {rows.length - tested.length > 0 ? `${rows.length - tested.length} not yet tested` : "all portfolios tested"}
          </span>
        </div>
        {worstAll?.worst && (
          <div className="sum-tile">
            <span className="sum-label">Largest stress shortfall <InfoTip text={TIPS.stress} /></span>
            <span className={`sum-value ${worstAll.worst.active < 0 ? "sum-neg" : ""}`}>
              {fmtPts(worstAll.worst.active)}
            </span>
            <span className="sum-sub">{worstAll.short} vs benchmark · {worstAll.worst.name}</span>
          </div>
        )}
      </div>

      {/* ---- one row per portfolio ---- */}
      <div className="sum-table-wrap">
        <table className="sum-table">
          <thead>
            <tr>
              <th className="left">Portfolio</th>
              <th className="left sum-band-col">Active risk vs tolerance band <InfoTip text={TIPS.te} /></th>
              <th>Beta <InfoTip text={TIPS.beta} /></th>
              <th>Stress vs benchmark <InfoTip text={TIPS.stress} /></th>
              <th>Model check <InfoTip text={TIPS.model} /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pos = (v) => `${Math.min(100, (v / BAR_MAX) * 100)}%`;
              const out = r.te > r.band.hi || r.te < r.band.lo;
              return (
                <tr key={r.id} onClick={() => onOpen?.(r.id)} title="Open this portfolio's positioning">
                  <td className="left">
                    <div className="sum-name">
                      <span className={`sum-dot sum-dot-${r.level}`} />
                      {r.label}
                    </div>
                    <div className="sum-why">{r.summary}</div>
                  </td>
                  <td className="left sum-band-col">
                    <div className="sum-bar">
                      <span className="sum-bar-band" style={{ left: pos(r.band.lo), width: `calc(${pos(r.band.hi)} - ${pos(r.band.lo)})` }} />
                      <span className={`sum-bar-mark ${out ? "sum-bar-mark-out" : ""}`} style={{ left: pos(r.te) }} />
                    </div>
                    <div className="sum-why">
                      <strong className={out ? "sum-warn" : ""}>{r.te.toFixed(1)}%</strong> vs {r.band.lo}–{r.band.hi}% · {r.band.label}
                    </div>
                  </td>
                  <td className={`num ${Math.abs(r.beta - 1) > BETA_DRIFT ? "sum-warn" : ""}`}>{r.beta?.toFixed(2)}</td>
                  <td className="num">
                    {r.worst ? (
                      <>
                        <span className={r.worst.active < 0 ? "sum-neg" : ""}>{fmtPts(r.worst.active)}</span>
                        <div className="sum-why">{r.worst.name}</div>
                        <div className="sum-why">
                          {r.worst.pnl.toFixed(1)}% vs {r.worst.bench.toFixed(1)}%
                          {r.lookThrough && r.worst.basis === "model" ? " · holdings" : ""}
                        </div>
                      </>
                    ) : "—"}
                  </td>
                  <td className="num">
                    <span className={`sum-pill sum-pill-${r.model.status}`}>{r.model.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- exceptions ---- */}
      <div className="sum-block-label">
        Exceptions
        <span className="sum-block-sub">each needs an owner and a next step</span>
      </div>
      {exceptions.length === 0 ? (
        <div className="sum-empty">No exceptions: every portfolio is inside its tolerance band.</div>
      ) : (
        <ul className="sum-exc">
          {exceptions.map((e, i) => (
            <li key={i} className="sum-exc-item" onClick={() => onOpen?.(e.row.id)}>
              <span className={`sum-dot sum-dot-${e.row.level}`} />
              <span className="sum-exc-who">{e.row.short}</span>
              <span className="sum-exc-text">{e.text}</span>
              <span className="sum-exc-owner">{e.owner} · {e.action}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="sum-foot">
        Status: green = no flags, amber = one, red = two or more. Flags: active risk outside its band;
        beta more than {BETA_DRIFT} from 1; high AI/semis concentration; VaR models failing their
        backtest; or thin data (under a year of history, factor model explaining under {MIN_CAPTURE}% of
        variance, or no backtest). Look-through funds are read on the fund's own NAV. Stress vs benchmark is
        the largest gap to the benchmark across all nine scenarios, in percentage points; it is shown for
        context and does not set the status. Historical crises use the fund's own price where it existed
        for the whole window; "holdings" marks results from the modeled top holdings instead. <strong>Tolerance
        bands are placeholders</strong> for illustration; real limits would be agreed between the
        investment risk function and each PM. Owners and actions are suggested defaults. Click any row
        to open that portfolio.
      </div>
    </div>
  );
}
