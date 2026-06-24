import { useState, Fragment } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import InfoTip from "./InfoTip.jsx";
import { useThemeColors } from "./useThemeColors.js";
import "./OptimizerPanel.css";

// Short headers for the dense comparison table (full labels stay in legend/selector).
const SHORT = {
  base: "Reference", gmv: "Min Var", erc: "Risk Parity", max_div: "Max Div",
  pm_concentrated: "PM Concentr.", pm_lowvol_te: "PM Low-risk", max_sharpe: "Max Sharpe",
};

// Color per portfolio id (DOM + chart share these hexes).
const COLORS = {
  base:            "#3a2f24",   // neutral (the strategy)
  gmv:             "#1898b7",   // teal
  erc:             "#2e6b34",   // green
  max_div:         "#7a5cc4",   // violet
  pm_concentrated: "#d97706",   // amber (the PM headline)
  pm_lowvol_te:    "#c98a2e",   // soft amber
  max_sharpe:      "#a33a3a",   // red (fragility)
};

// Metric rows for the comparison table, grouped into three explicit reference
// frames so the table never silently mixes yardsticks:
//   1. Standalone   — pure properties of the weights; no benchmark.
//   2. Active vs the reference book (the declared benchmark) — TE, active return, IR, turnover.
//   3. Equity-market diagnostic — SPY beta only; a sensitivity read, NOT the benchmark.
const ROW_GROUPS = [
  {
    group: "Standalone profile",
    note: "no benchmark — pure properties of the weights",
    rows: [
      { key: "return_ann",  label: "Return (ann, in-sample)", unit: "%", tip: "Realized in-sample mean return over the trailing window, annualized. Descriptive — NOT a forecast." },
      { key: "vol_ann",     label: "Volatility (ann)",        unit: "%", tip: "Annualized portfolio volatility from the Ledoit-Wolf-shrunk covariance, √(wΣw)·√252." },
      { key: "sharpe",      label: "Sharpe (rf=4.5%)",        unit: "",  tip: "Excess-of-cash return ÷ volatility, using a 4.5% annual risk-free rate. Inherits the in-sample caveat on return." },
      { key: "eff_n",       label: "Effective N",             unit: "",  tip: "1 / Σwᵢ² — the effective number of positions. Lower = more concentrated." },
      { key: "max_weight",  label: "Max weight",              unit: "%", tip: "Largest single position (the concentration cap binds here)." },
      { key: "n_holdings",  label: "# holdings",              unit: "",  tip: "Positions above the 0.5% threshold." },
    ],
  },
  {
    group: "Active vs reference book",
    note: "the benchmark is the current book itself",
    rows: [
      { key: "tracking_error", label: "Active risk vs ref (ex-ante)", unit: "%", tip: "Ex-ante active risk vs the reference book: √((w−w₀)Σ(w−w₀))·√252. The reference book is 0 by construction." },
      { key: "active_return",  label: "Active return (ann)",          unit: "%", tip: "In-sample active return vs the reference book: (w−w₀)·μ, annualized. Descriptive, not a forecast." },
      { key: "info_ratio",     label: "Information ratio",            unit: "",  tip: "Active return ÷ ex-ante active risk, both vs the reference book — so numerator and denominator share one benchmark. In-sample/ex-ante: descriptive of the window, not a realized-skill estimate." },
      { key: "turnover",       label: "Turnover vs ref",              unit: "%", tip: "One-way Σ|wᵢ−w₀ᵢ| to move from the reference book to this mix. Pre-cost — no transaction costs modeled." },
    ],
  },
  {
    group: "Equity-market diagnostic",
    note: "a sensitivity read, NOT the benchmark",
    rows: [
      { key: "beta", label: "Equity beta (SPY)", unit: "", tip: "OLS beta of the book's daily returns on SPY (252-day). A diagnostic of equity-market sensitivity — NOT the benchmark; this is a ~40%-non-equity book." },
    ],
  },
];

function fmt(v, unit) {
  if (v === null || v === undefined) return "—";
  return unit === "%" ? `${v}%` : `${v}`;
}

export default function OptimizerPanel({ opt }) {
  const c = useThemeColors();
  const portfolios = [opt.base, ...opt.variants];
  const [selId, setSelId] = useState("pm_concentrated");
  const sel = opt.variants.find((v) => v.id === selId) || opt.variants[0];

  // chart data
  const frontierData = opt.frontier.map((p) => ({ vol: p.vol, ret: p.ret }));
  const portfolioPts = portfolios.map((p) => ({
    vol: p.vol_ann, ret: p.return_ann, id: p.id, label: p.label, fragile: p.fragile,
  }));

  const ChartTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    if (d.id === undefined) return null; // frontier point
    const p = portfolios.find((x) => x.id === d.id);
    return (
      <div className="opt-charttip" style={{ background: c.bg2, border: `1px solid ${c.border}`, color: c.text }}>
        <strong style={{ color: COLORS[d.id] }}>{p.label}</strong>
        <div>vol {p.vol_ann}% · ret {p.return_ann}%</div>
        <div>Sharpe {p.sharpe} · TE {p.tracking_error}% · effN {p.eff_n}</div>
      </div>
    );
  };

  // weight-delta + risk-budget rows for the selected variant
  const deltaRows = Object.entries(sel.weight_deltas || {})
    .map(([t, d]) => ({ t, d: d * 100 }))
    .filter((r) => Math.abs(r.d) >= 0.1)
    .sort((a, b) => b.d - a.d);
  const maxDelta = Math.max(1, ...deltaRows.map((r) => Math.abs(r.d)));

  const rcTickers = Object.keys(opt.base.rc_pct || {});
  const rcRows = rcTickers
    .map((t) => ({ t, base: opt.base.rc_pct[t] ?? 0, sel: sel.rc_pct?.[t] ?? 0 }))
    .sort((a, b) => b.base - a.base)
    .slice(0, 8);

  // Custom scatter markers: tiny dots for the frontier line, bigger distinct
  // markers for each portfolio (base = hollow ring so it reads as "the anchor",
  // fragile max-Sharpe = diamond).
  const frontierDot = (p) => (p.cx == null ? null
    : <circle cx={p.cx} cy={p.cy} r={2} fill={c.refLine} />);
  const portMarker = (color, fragile, isBase) => (p) => {
    if (p.cx == null) return null;
    if (fragile) {
      const r = 7;
      return <path d={`M${p.cx},${p.cy - r} L${p.cx + r},${p.cy} L${p.cx},${p.cy + r} L${p.cx - r},${p.cy} Z`}
        fill={color} stroke={c.bg} strokeWidth={1.5} />;
    }
    return <circle cx={p.cx} cy={p.cy} r={isBase ? 7 : 6}
      fill={isBase ? "none" : color} stroke={isBase ? color : c.bg} strokeWidth={isBase ? 2.5 : 1.5} />;
  };

  return (
    <div className="opt-panel">
      {/* honesty banner */}
      <div className="opt-banner">
        <strong>The benchmark is the current book itself (the "reference book")</strong> — active risk, active return, and
        information ratio are measured against it, and nothing else. SPY beta is an equity-sensitivity diagnostic, not the
        benchmark. Risk-based objectives (GMV, ERC, Max-Diversification, both PM tilts) use no return forecasts; any return,
        Sharpe, active return, or IR shown is realized in-sample, descriptive only, never a forecast. Max-Sharpe is a
        fragility demo, not a recommendation.
      </div>

      {/* ---- efficient frontier ---- */}
      <div className="opt-block">
        <div className="opt-h">Efficient frontier <InfoTip text="The lowest volatility achievable at each return target (Ledoit-Wolf covariance, long-only, 35% cap). The reference book sits inside the frontier — the optimized portfolios sit on or near it. Returns are in-sample." /></div>
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
              <CartesianGrid stroke={c.grid} />
              <XAxis type="number" dataKey="vol" name="Volatility" unit="%" domain={["dataMin - 0.5", "dataMax + 0.5"]}
                tick={{ fill: c.axisTick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} axisLine={{ stroke: c.axisLine }} tickLine={{ stroke: c.axisLine }}
                label={{ value: "Annualized volatility (%)", position: "bottom", fill: c.axisTick, fontSize: 11 }} />
              <YAxis type="number" dataKey="ret" name="Return" unit="%"
                tick={{ fill: c.axisTick, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} axisLine={{ stroke: c.axisLine }} tickLine={{ stroke: c.axisLine }}
                label={{ value: "Return (%, in-sample)", angle: -90, position: "left", fill: c.axisTick, fontSize: 11 }} />
              <Tooltip content={<ChartTip />} cursor={{ strokeDasharray: "3 3", stroke: c.refLine }} />
              <Scatter name="frontier" data={frontierData} line={{ stroke: c.refLine, strokeWidth: 1.5 }} shape={frontierDot} legendType="none" />
              {portfolioPts.map((p) => (
                <Scatter key={p.id} name={p.label} data={[p]} fill={COLORS[p.id]} shape={portMarker(COLORS[p.id], p.fragile, p.id === "base")} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="opt-legend">
          {portfolioPts.map((p) => (
            <span key={p.id} className="opt-legend-item">
              <span className="opt-dot" style={{ background: COLORS[p.id] }} />{p.label}{p.fragile ? " ⚠" : ""}
            </span>
          ))}
        </div>
      </div>

      {/* ---- metrics comparison table ---- */}
      <div className="opt-block">
        <div className="opt-h">Reference vs optimized <InfoTip text="Every portfolio measured on the same window, grouped by reference frame: a standalone profile (no benchmark), the active picture vs the reference book (the benchmark), and one equity-beta diagnostic. Max-Sharpe is muted as a fragility demo." /></div>
        <div className="opt-table-wrap">
          <table className="opt-table">
            <thead>
              <tr>
                <th className="opt-metric-col">Metric</th>
                {portfolios.map((p) => (
                  <th key={p.id} className={`opt-col ${p.fragile ? "opt-fragile" : ""} ${p.id === "base" ? "opt-base-col" : ""}`} style={{ color: COLORS[p.id] }}>
                    {SHORT[p.id] || p.label}{p.fragile ? " ⚠" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROW_GROUPS.map((g) => (
                <Fragment key={g.group}>
                  <tr className="opt-group-row">
                    <td className="opt-group-label" colSpan={portfolios.length + 1}>
                      {g.group} <span className="opt-group-note">· {g.note}</span>
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.key}>
                      <td className="opt-metric-col">{r.label} <InfoTip text={r.tip} /></td>
                      {portfolios.map((p) => (
                        <td key={p.id} className={`opt-num ${p.fragile ? "opt-fragile" : ""} ${p.id === "base" ? "opt-base-col" : ""}`}>
                          {fmt(p[r.key], r.unit)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="opt-cap">Return, Sharpe, and active return / IR are realized in-sample on the trailing {opt.constraints.lookback_days}-day window — descriptive, not forecasts. Active risk, information ratio, and volatility are ex-ante from the shrunk covariance.</div>
      </div>

      {/* ---- weight + risk-budget for a selected variant ---- */}
      <div className="opt-block">
        <div className="opt-h">How it differs from the reference book</div>
        <div className="opt-selector">
          {opt.variants.map((v) => (
            <button key={v.id} className={`opt-pill ${v.id === selId ? "active" : ""} ${v.fragile ? "fragile" : ""}`} onClick={() => setSelId(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="opt-desc">{sel.description}</div>
        <div className="opt-two">
          <div className="opt-half">
            <div className="opt-subh">Weight change vs reference (pp)</div>
            {deltaRows.map((r) => (
              <div key={r.t} className="opt-bar-row">
                <span className="opt-bar-label">{r.t}</span>
                <div className="opt-bar-track">
                  <div className="opt-bar-mid" />
                  <div className="opt-bar-fill" style={{
                    left: r.d >= 0 ? "50%" : `${50 - (Math.abs(r.d) / maxDelta) * 50}%`,
                    width: `${(Math.abs(r.d) / maxDelta) * 50}%`,
                    background: r.d >= 0 ? "var(--green)" : "var(--red)",
                  }} />
                </div>
                <span className="opt-bar-val" style={{ color: r.d >= 0 ? "var(--green)" : "var(--red)" }}>
                  {r.d >= 0 ? "+" : ""}{r.d.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
          <div className="opt-half">
            <div className="opt-subh">Risk budget — share of portfolio risk (%)</div>
            <table className="opt-rc">
              <thead><tr><th>Asset</th><th className="num">Ref</th><th className="num">{sel.label.split(" ")[0]}</th></tr></thead>
              <tbody>
                {rcRows.map((r) => (
                  <tr key={r.t}>
                    <td>{r.t}</td>
                    <td className="num">{r.base}%</td>
                    <td className="num" style={{ color: r.sel > r.base ? "var(--red)" : r.sel < r.base ? "var(--green)" : "var(--text-dim)" }}>{r.sel}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="opt-cap">Risk contributions (Euler, on the optimizer's Ledoit-Wolf covariance) sum to 100%. Equal-Risk-Contribution equalizes them by construction; the PM-Concentrated tilt visibly pushes risk into fewer names.</div>
          </div>
        </div>
      </div>

      {/* ---- caveats ---- */}
      <details className="opt-caveats">
        <summary>Method &amp; limitations ({opt.caveats.length})</summary>
        <ul>{opt.caveats.map((cav, i) => <li key={i}>{cav}</li>)}</ul>
      </details>
    </div>
  );
}
