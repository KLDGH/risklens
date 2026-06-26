import { useState, useCallback } from "react";
import HoverTip from "./HoverTip.jsx";
import "./FactorRiskPanel.css";

/**
 * Factor risk decomposition for a look-through stock basket (CGGO, DWLD).
 *
 * Splits the basket's modeled variance into systematic factor risk
 * (B Σf Bᵀ, the FF5 + Momentum exposure the whole book shares) vs.
 * stock-specific residual (diagonal D). Per holding, shows how its risk
 * contribution divides between the two — the stock-specific part is where
 * name-level positioning sits, not shared factor beta.
 *
 * Data shape: backend compute_factor_risk_decomposition() (factor_models.py).
 */

const TIPS = {
  systematic:
    "Share of the basket's modeled variance from shared FF5 + Momentum factor exposure (B Σf Bᵀ) — risk the whole book carries together.",
  specific:
    "Share from stock-specific residual (diagonal D): each name's return left unexplained by the common factors. Where name-level positioning shows up rather than shared factor beta.",
  capture:
    "How much of the basket's realized variance the diagonal factor model reproduces. Under 100% means residuals co-move and the model understates; over 100% means they offset.",
  netBeta:
    "Portfolio net loading on this factor — the weighted sum of holding betas (Bᵀw). Positive means the basket is net long the factor.",
  factorShare:
    "This factor's share of systematic variance (Euler allocation). Sums to 100% across the six factors.",
  weight: "Re-normalized basket weight.",
  rsq: "R² of this holding's own FF5 + Momentum regression — how factor-driven the name is on its own.",
  totalContrib:
    "This holding's share of total modeled variance (factor + stock-specific). Sums to 100% across holdings.",
  split:
    "How this holding's risk contribution divides between shared factor exposure (left) and its own stock-specific residual (right).",
  specShare:
    "Stock-specific share of this holding's own contribution. High means the name's risk in this book is mostly its own, not shared factor exposure. Shown as — for names whose factor exposure offsets the book (no clean 0-100% split) or that contribute negligible variance.",
};

function pct(v, d = 1) {
  return v == null ? "—" : `${v.toFixed(d)}%`;
}
function signed(v, d = 3) {
  if (v == null) return "—";
  return v >= 0 ? `+${v.toFixed(d)}` : v.toFixed(d);
}

// Sort accessors for the per-holding table. Nulls sort to the bottom in
// descending order (the default), which keeps low-R² foreign listings from
// floating to the top on a missing value.
const HOLDING_SORT = {
  ticker: (h) => h.ticker ?? "",
  weight: (h) => h.weight_pct ?? -Infinity,
  rsq: (h) => h.r_squared ?? -Infinity,
  total: (h) => h.total_contrib_pct ?? -Infinity,
  specShare: (h) => h.specific_share_pct ?? -Infinity,
};

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <span className="sort-icon inactive">⇅</span>;
  return (
    <span className="sort-icon active">{sortDir === "asc" ? "↑" : "↓"}</span>
  );
}

function SortTh({ col, label, tip, className, sortKey, sortDir, onSort }) {
  return (
    <th
      className={`${className ?? ""} sortable`}
      onClick={() => onSort(col)}
      title="Click to sort"
    >
      <span className="th-inner">
        {label}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
        {tip && <HoverTip text={tip} />}
      </span>
    </th>
  );
}

export default function FactorRiskPanel({ data }) {
  // Hooks must run before any early return. Default to total-risk descending,
  // which preserves the backend's ranked order until the user sorts.
  const [sortKey, setSortKey] = useState("total");
  const [sortDir, setSortDir] = useState("desc");
  const handleSort = useCallback(
    (col) => {
      if (col === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(col);
        setSortDir(col === "ticker" ? "asc" : "desc");
      }
    },
    [sortKey],
  );

  if (!data || !data.holdings?.length) return null;

  const sysShare = data.systematic_share_pct ?? 0;
  const specShare = data.specific_share_pct ?? 0;
  const capture = data.model_capture_pct;

  const sortedHoldings = [...data.holdings].sort((a, b) => {
    const fn = HOLDING_SORT[sortKey] ?? HOLDING_SORT.total;
    const av = fn(a);
    const bv = fn(b);
    if (typeof av === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortDir === "asc" ? av - bv : bv - av;
  });
  const hsp = { sortKey, sortDir, onSort: handleSort };

  return (
    <div className="factor-risk-panel">
      {/* Systematic vs stock-specific split bar */}
      <div className="frp-splitbar-wrap">
        <div className="frp-splitbar">
          <div
            className="frp-seg frp-seg-systematic"
            style={{ width: `${sysShare}%` }}
            title={`Systematic ${pct(sysShare)}`}
          />
          <div
            className="frp-seg frp-seg-specific"
            style={{ width: `${specShare}%` }}
            title={`Stock-specific ${pct(specShare)}`}
          />
        </div>
      </div>

      {/* Headline stat table — the variance split in structured form */}
      <table className="frp-table frp-stat-table">
        <thead>
          <tr>
            <th className="left">Component</th>
            <th className="num">Share of variance</th>
            <th className="num">Annualized vol</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="left">
              <span className="frp-key frp-key-systematic" />
              Systematic (shared factor)
              <HoverTip text={TIPS.systematic} />
            </td>
            <td className="num frp-stat-strong">{pct(sysShare)}</td>
            <td className="num">{data.systematic_vol_annualized_pct}%</td>
          </tr>
          <tr>
            <td className="left">
              <span className="frp-key frp-key-specific" />
              Stock-specific (residual)
              <HoverTip text={TIPS.specific} />
            </td>
            <td className="num frp-stat-strong">{pct(specShare)}</td>
            <td className="num">{data.specific_vol_annualized_pct}%</td>
          </tr>
          <tr className="frp-stat-total">
            <td className="left">Model total</td>
            <td className="num">100%</td>
            <td className="num">{data.model_total_vol_annualized_pct}%</td>
          </tr>
          <tr>
            <td className="left">
              Realized
              <HoverTip text={TIPS.capture} />
            </td>
            <td className="num text-dim">—</td>
            <td className="num">{data.realized_total_vol_annualized_pct}%</td>
          </tr>
        </tbody>
      </table>
      <div className="frp-stat-caption">
        {data.n_holdings} names, last {data.lookback_days} trading days (
        {data.first_date} → {data.last_date}).
        {capture != null &&
          ` The diagonal factor model reproduces ${pct(capture)} of realized variance.`}
      </div>

      {/* Per-factor systematic-risk attribution */}
      <div className="frp-block-label">
        Systematic risk by factor
        <span className="frp-block-sub">
          which shared exposures drive the factor part
        </span>
      </div>
      <div className="frp-table-wrap">
        <table className="frp-table">
          <thead>
            <tr>
              <th className="left">Factor</th>
              <th className="num">
                Net loading
                <HoverTip text={TIPS.netBeta} />
              </th>
              <th className="num">
                Share of systematic
                <HoverTip text={TIPS.factorShare} />
              </th>
              <th className="bar-col"></th>
            </tr>
          </thead>
          <tbody>
            {data.factors.map((f) => {
              const w = Math.min(100, Math.abs(f.var_contrib_pct ?? 0));
              return (
                <tr key={f.factor}>
                  <td className="left frp-factor-label">{f.label}</td>
                  <td className="num">{signed(f.net_beta)}</td>
                  <td className="num">{pct(f.var_contrib_pct)}</td>
                  <td className="bar-col">
                    <span className="frp-minibar-track">
                      <span
                        className="frp-minibar-fill frp-fill-systematic"
                        style={{ width: `${w}%` }}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Per-holding contribution split */}
      <div className="frp-block-label">
        Risk contribution by holding
        <span className="frp-block-sub">
          ranked; the stock-specific share is where name-level positioning sits
        </span>
      </div>
      <div className="frp-table-wrap">
        <table className="frp-table">
          <thead>
            <tr>
              <SortTh col="ticker" label="Holding" className="left" {...hsp} />
              <SortTh
                col="weight"
                label="Weight"
                tip={TIPS.weight}
                className="num"
                {...hsp}
              />
              <SortTh
                col="rsq"
                label="R²"
                tip={TIPS.rsq}
                className="num"
                {...hsp}
              />
              <SortTh
                col="total"
                label="Total risk"
                tip={TIPS.totalContrib}
                className="num"
                {...hsp}
              />
              <th className="bar-col">
                Factor / specific
                <HoverTip text={TIPS.split} />
              </th>
              <SortTh
                col="specShare"
                label="Specific share"
                tip={TIPS.specShare}
                className="num"
                {...hsp}
              />
            </tr>
          </thead>
          <tbody>
            {sortedHoldings.map((h) => {
              // Only draw the split when it's a clean non-negative partition
              // (the backend nulls specific_share_pct otherwise). Clamp to
              // [0,100] so a stray negative piece can't render a broken bar.
              const clean = h.specific_share_pct != null;
              const factorPart = Math.max(0, h.factor_contrib_pct ?? 0);
              const specPart = Math.max(0, h.specific_contrib_pct ?? 0);
              const denom = factorPart + specPart || 1;
              const fw = clean ? (100 * factorPart) / denom : 0;
              const sw = clean ? (100 * specPart) / denom : 0;
              const hot = (h.specific_share_pct ?? 0) >= 50;
              return (
                <tr key={h.ticker}>
                  <td className="left">
                    <span className="frp-tkr">{h.ticker}</span>
                    {h.name && h.name !== h.ticker && (
                      <span className="frp-name">{h.name}</span>
                    )}
                  </td>
                  <td className="num">{pct(h.weight_pct, 1)}</td>
                  <td className="num text-dim">
                    {h.r_squared != null ? h.r_squared.toFixed(2) : "—"}
                  </td>
                  <td className="num">{pct(h.total_contrib_pct)}</td>
                  <td className="bar-col">
                    <span className="frp-splitmini">
                      <span
                        className="frp-splitmini-seg frp-fill-systematic"
                        style={{ width: `${fw}%` }}
                      />
                      <span
                        className="frp-splitmini-seg frp-fill-specific"
                        style={{ width: `${sw}%` }}
                      />
                    </span>
                  </td>
                  <td className={"num" + (hot ? " frp-spec-hot" : "")}>
                    {pct(h.specific_share_pct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="frp-footnote">
        Variance split via the FF5 + Momentum factor risk model (Σ = B Σf Bᵀ +
        D) on excess returns; vols annualized. The diagonal D assumes
        uncorrelated residuals — the realized-variance capture above shows how
        far that holds. This is a variance attribution, not the headline VaR:
        the VaR columns use the full empirical/EWMA covariance, not a factor
        model. Equity factors only, on the modeled top-N basket. Names with low
        R² — often non-US listings that trade outside US factor hours — carry a
        stock-specific share that overstates true idiosyncratic risk, since the
        US daily factors can't span their session; read those against the R²
        column. Per-factor shares can run negative or above 100% when a factor
        offsets or amplifies the dominant market exposure (covariance
        allocation), and still sum to 100%.
      </div>
    </div>
  );
}
