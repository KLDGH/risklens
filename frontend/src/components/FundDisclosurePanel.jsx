import "./FundDisclosurePanel.css";

/**
 * Look-through modeling caveat for active-fund spotlight modes (CGGO, DWLD…).
 *
 * Renders at the *top* of the Risk Snapshot section (above the RiskTable),
 * not as its own section. The risk table is built from the top-N disclosed
 * holdings of the spotlighted ETF, re-normalized to 100% — this callout
 * surfaces that approximation honestly: how much of the actual fund weight
 * is covered, and how much (cash, long-tail names, foreign listings without
 * ADRs) is excluded from the basket.
 */
export default function FundDisclosurePanel({ disclosure, coverageMeta }) {
  if (!disclosure || !coverageMeta) return null;

  const { ticker } = disclosure;
  const modeledPct = coverageMeta.modeled_weight_pct ?? 0;
  const excludedPct = 100 - modeledPct;

  return (
    <div className="fund-disclosure-panel">
      <div className="fund-coverage-callout">
        <strong>Modeling caveat:</strong> The risk snapshot below models the
        top {coverageMeta.modeled_n} of{" "}
        {coverageMeta.total_holdings?.toLocaleString()} disclosed holdings —
        covering <strong>{modeledPct.toFixed(1)}%</strong> of {ticker}'s actual
        weight as of {coverageMeta.as_of}. The remaining{" "}
        {excludedPct.toFixed(1)}% (long-tail positions, foreign listings
        without ADRs, cash components) is excluded from the basket. Weights in
        the basket are re-normalized to sum to 100% across the modeled subset,
        so individual portfolio weights in the risk table are scaled up vs.
        their actual disclosed weights.
      </div>
    </div>
  );
}
