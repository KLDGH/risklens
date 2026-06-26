import InfoTip from "./InfoTip.jsx";
import "./FactorRiskBridgePanel.css";

/**
 * Risk change attribution ("what changed and why") for a look-through stock
 * basket. Compares the basket's factor-risk decomposition between two adjacent
 * windows and splits the change in modeled vol into exposure drift,
 * factor-volatility regime, and stock-specific change.
 *
 * Data shape: backend compute_factor_risk_bridge() (factor_models.py).
 */

const TIPS = {
  exposure:
    "Change in the basket's net factor loadings (Bᵀw) between the two windows — style / exposure drift. Measured at the earlier window's factor volatilities, so it isolates the exposure move.",
  factor_vol:
    "Change in the factors' own volatilities and correlations (Σf) between the two windows — the market regime — measured at the current exposures.",
  specific:
    "Change in stock-specific (idiosyncratic) variance between the two windows — the part of each name's risk not explained by the common factors.",
  net:
    "Net change in the basket's modeled annualized vol. The three drivers sum to it: the underlying variance split is exact, the vol-point split is an approximate, sign-consistent allocation.",
};

function vp(v) {
  if (v == null) return "—";
  return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}

export default function FactorRiskBridgePanel({ data }) {
  if (!data || !data.components?.length) return null;

  const max = Math.max(...data.components.map((c) => Math.abs(c.vol_points ?? 0)), 0.01);
  const dom = data.components.find((c) => c.key === data.dominant);
  const dir =
    data.delta_vol_pct < 0 ? "fell" : data.delta_vol_pct > 0 ? "rose" : "held flat";
  const down = data.delta_vol_pct < 0;

  return (
    <div className="frb-panel">
      <div className="frb-headline">
        <div className="frb-vols">
          <span className="frb-vol">{data.vol_then_pct}%</span>
          <span className="frb-arrow">→</span>
          <span className="frb-vol frb-vol-now">{data.vol_now_pct}%</span>
          <span className={"frb-delta " + (down ? "frb-neg" : "frb-pos")}>
            {vp(data.delta_vol_pct)} vol pts
          </span>
        </div>
        <div className="frb-windows">
          modeled annualized vol · {data.window_days}-day windows · then{" "}
          {data.then_first_date} → {data.then_last_date} vs now{" "}
          {data.now_first_date} → {data.now_last_date}
        </div>
      </div>

      <table className="frb-table">
        <thead>
          <tr>
            <th className="left">Driver</th>
            <th className="num">Effect (vol pts)</th>
            <th className="frb-bar-col">lowered ◀ &middot; ▶ raised</th>
          </tr>
        </thead>
        <tbody>
          {data.components.map((c) => {
            const pos = (c.vol_points ?? 0) >= 0;
            const w = Math.min(50, (Math.abs(c.vol_points ?? 0) / max) * 50);
            return (
              <tr key={c.key}>
                <td className="left">
                  {c.label}
                  <InfoTip text={TIPS[c.key] ?? ""} />
                </td>
                <td className={"num " + (pos ? "frb-pos" : "frb-neg")}>
                  {vp(c.vol_points)}
                </td>
                <td className="frb-bar-col">
                  <span className="frb-track">
                    <span className="frb-center" />
                    <span
                      className={"frb-fill " + (pos ? "frb-fill-pos" : "frb-fill-neg")}
                      style={pos ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
          <tr className="frb-net">
            <td className="left">
              Net change
              <InfoTip text={TIPS.net} />
            </td>
            <td className={"num " + (down ? "frb-neg" : "frb-pos")}>
              {vp(data.delta_vol_pct)}
            </td>
            <td className="frb-bar-col"></td>
          </tr>
        </tbody>
      </table>

      <div className="frb-narrative">
        Modeled vol {dir} {Math.abs(data.delta_vol_pct).toFixed(1)} vol points,
        driven mainly by {dom?.label?.toLowerCase()} ({vp(dom?.vol_points)} pts).
      </div>
      <div className="frb-foot">
        Weights held at the current disclosure, so this isolates the change in
        factor exposures and volatilities, not rebalancing (historical basket
        weights aren't observable). Exposure + factor-vol + stock-specific sum to
        the variance change exactly; the vol-point split is an approximate,
        sign-consistent allocation summing to the net. Two adjacent{" "}
        {data.window_days}-day windows — read the direction, not the third
        decimal.
      </div>
    </div>
  );
}
