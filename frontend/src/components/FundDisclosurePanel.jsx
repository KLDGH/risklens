import "./FundDisclosurePanel.css";

/**
 * Reference panel for an active-fund spotlight mode (CGGO, DWLD, etc.).
 * Surfaces the fund's static metadata + concentration stats + a scrollable
 * top-holdings table.
 *
 * The risk pipeline runs on the fund's NAV, not on these underlyings —
 * holdings are display-only. Disclosure cadence is whatever the sponsor
 * publishes (daily for transparent active ETFs, quarterly for mutual funds).
 */
export default function FundDisclosurePanel({ disclosure }) {
  if (!disclosure) return null;

  const {
    ticker,
    fund_name,
    sponsor,
    mandate,
    category,
    inception,
    as_of,
    source_file,
    n_holdings,
    total_weight_pct,
    top10_concentration_pct,
    top25_concentration_pct,
    holdings = [],
  } = disclosure;

  // Cap displayed rows. The scroll panel handles arbitrarily large lists
  // without pushing other sections down — but rendering all 10k+ rows for
  // a fund like DFAX would still hit DOM-size pain. Show top 50 by weight,
  // which captures everything quants actually scrutinize; the long tail of
  // sub-1bp positions is diversification noise.
  const DISPLAY_CAP = 50;
  const shown = holdings.slice(0, DISPLAY_CAP);
  const truncated = holdings.length > DISPLAY_CAP;

  return (
    <div className="fund-disclosure-panel">
      <div className="fund-meta-grid">
        <div className="fund-meta-cell">
          <span className="fund-meta-label">Fund</span>
          <span className="fund-meta-value">
            <strong>{ticker}</strong> &middot; {fund_name}
          </span>
        </div>
        <div className="fund-meta-cell">
          <span className="fund-meta-label">Sponsor</span>
          <span className="fund-meta-value">{sponsor}</span>
        </div>
        <div className="fund-meta-cell">
          <span className="fund-meta-label">Mandate</span>
          <span className="fund-meta-value">{mandate}</span>
        </div>
        <div className="fund-meta-cell">
          <span className="fund-meta-label">Category</span>
          <span className="fund-meta-value">{category}</span>
        </div>
        {inception && (
          <div className="fund-meta-cell">
            <span className="fund-meta-label">Inception</span>
            <span className="fund-meta-value">{inception}</span>
          </div>
        )}
        <div className="fund-meta-cell">
          <span className="fund-meta-label">Holdings as of</span>
          <span className="fund-meta-value">{as_of ?? "—"}</span>
        </div>
      </div>

      <div className="fund-concentration-row">
        <div className="conc-stat">
          <span className="conc-num">{n_holdings.toLocaleString()}</span>
          <span className="conc-label">total holdings</span>
        </div>
        <div className="conc-stat">
          <span className="conc-num">{top10_concentration_pct?.toFixed(1)}%</span>
          <span className="conc-label">top 10 weight</span>
        </div>
        <div className="conc-stat">
          <span className="conc-num">{top25_concentration_pct?.toFixed(1)}%</span>
          <span className="conc-label">top 25 weight</span>
        </div>
        <div className="conc-stat">
          <span className="conc-num">{total_weight_pct?.toFixed(1)}%</span>
          <span className="conc-label">disclosed</span>
        </div>
      </div>

      <div className="fund-holdings-header">
        <span>
          Full disclosed list — top {shown.length}{truncated ? ` of ${n_holdings.toLocaleString()}` : ""} (panel-only; per-asset risk metrics for the top 25 are above in the risk snapshot)
        </span>
        <span className="fund-holdings-source">Source: {source_file}</span>
      </div>

      {/* Scrollable list — max-height caps vertical footprint so the panel
          never pushes other sections down regardless of holdings count.
          This view shows the *full* disclosed list including the long-tail
          positions and untradeable / unmappable names that don't have risk
          rows above. Country column adds context not present in the risk table. */}
      <div className="fund-holdings-scroll">
        <table className="fund-holdings-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Security</th>
              <th>Ticker</th>
              <th className="country-col">Country</th>
              <th>Risk row?</th>
              <th className="num">Weight</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((h) => (
              <tr key={`${h.rank}-${h.ticker || h.security}`}>
                <td className="num rank-cell">{h.rank}</td>
                <td className="security-cell">{h.security}</td>
                <td className="ticker-cell">{h.ticker || "—"}</td>
                <td className="country-cell">{h.country ?? ""}</td>
                <td className="risk-flag-cell">
                  {h.yf_ticker
                    ? <span className="risk-flag-yes">✓ {h.yf_ticker}</span>
                    : <span className="risk-flag-no">—</span>}
                </td>
                <td className="num weight-cell">{h.weight?.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="fund-disclosure-footnote">
        The portfolio summary in the risk snapshot above is computed on{" "}
        <strong>{ticker}'s</strong> own daily NAV; the per-asset rows show
        each disclosed underlying's standalone risk metrics. Tickers shown
        with a checkmark above are mapped to yfinance and have a risk row;
        unmappable names (foreign listings without ADRs, OTC pinks, cash
        components) appear in the panel only.
      </p>
    </div>
  );
}
