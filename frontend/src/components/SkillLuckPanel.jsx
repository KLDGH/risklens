import InfoTip from "./InfoTip.jsx";
import "./Performance.css";

/**
 * Skill vs luck: how much of the basket's active record a zero-edge manager
 * could have produced by chance. Shows the bootstrapped "luck" distribution of
 * Information Ratios (true edge set to zero) with the observed IR marked, plus
 * the Probabilistic Sharpe Ratio and the significance arithmetic.
 *
 * Data shape: backend performance.compute_skill_vs_luck().
 */

const TIPS = {
  prob: "P(skill) = 1 − (share of zero-skill bootstraps that beat your IR). How often luck fails to reach your result. Higher is better.",
  psr: "Probabilistic Sharpe = confidence your true Sharpe > 0, given track length and fat tails (Bailey–López de Prado). >95% is convincing.",
  tstat: "t-stat = IR × √years. ≥2 ≈ 95% confident the skill is real. Short records rarely clear it.",
  pluck: "p = share of zero-skill bootstraps that matched or beat your IR. <0.05 = luck is an unlikely explanation.",
  yearsForSig: "Years = (2 ÷ IR)². How long this IR must run to reach t = 2 (95% confidence).",
  hist: "Each bar = the IR from one resample of your active returns with the edge removed. The cloud is luck; the line is you.",
};

function fmt(v, d = 2) {
  return v == null ? "—" : v.toFixed(d);
}

function verdictClass(v) {
  if (!v) return "";
  if (v.startsWith("Skill")) return "pf-verdict-good";
  if (v.startsWith("Suggestive")) return "pf-verdict-mid";
  return "pf-verdict-weak";
}

// value-coloring class from a tier
function vc(tier) {
  return "pf-card-value" + (tier === "good" ? " pf-good" : tier === "bad" ? " pf-bad" : "");
}

function Histogram({ data }) {
  const W = 720, H = 220;
  const padL = 14, padR = 14, padT = 16, padB = 30;
  const xs = data.hist_centers || [];
  const ys = data.hist_counts || [];
  const n = xs.length;
  if (n < 2) return null;

  const obs = data.information_ratio;
  const xmin = Math.min(xs[0], obs) - 0.05;
  const xmax = Math.max(xs[n - 1], obs) + 0.05;
  const maxC = Math.max(...ys, 1);
  const X = (v) => padL + ((v - xmin) / (xmax - xmin)) * (W - padL - padR);
  const Y = (c) => H - padB - (c / maxC) * (H - padT - padB);
  const barW = Math.max(1, X(xs[1]) - X(xs[0]) - 1);
  const baseY = H - padB;

  // Bottom ticks: the luck cloud's 5–95 range plus zero, greedily dropped if
  // two would render within 40px (keeps "0.00 0.09" from colliding). The
  // observed IR is labeled at its marker, so it isn't repeated on the axis.
  const ticks = [];
  [data.null_p5, 0, data.null_p95]
    .filter((v) => v != null)
    .sort((a, b) => a - b)
    .forEach((v) => {
      if (!ticks.length || Math.abs(X(v) - X(ticks[ticks.length - 1])) > 40) ticks.push(v);
    });

  // Observed-IR marker label flips to the side with room; the luck-cloud label
  // is parked on the left third so the two never collide when IR ≈ 0.
  const obsX = X(obs);
  const obsRight = obsX > (padL + (W - padR)) / 2;
  const luckX = padL + (W - padL - padR) * 0.3;

  return (
    <svg className="pf-hist" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {/* baseline */}
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--border)" strokeWidth="1" />

      {/* null-distribution bars; the tail at/above the observed IR is the luck region */}
      {xs.map((x, i) => {
        const inTail = x >= obs;
        return (
          <rect
            key={i}
            x={X(x) - barW / 2}
            y={Y(ys[i])}
            width={barW}
            height={Math.max(0, baseY - Y(ys[i]))}
            fill={inTail ? "var(--accent)" : "var(--frp-specific)"}
            opacity={inTail ? 0.72 : 0.5}
          />
        );
      })}

      {/* observed IR marker */}
      <line x1={obsX} y1={padT - 4} x2={obsX} y2={baseY} stroke="var(--accent)" strokeWidth="2" />
      <text
        x={obsRight ? obsX - 7 : obsX + 7}
        y={padT - 7}
        textAnchor={obsRight ? "end" : "start"}
        className="pf-hist-obs-label"
      >
        observed IR {fmt(obs)}
      </text>

      {/* luck-cloud label, parked on the left so it never overlaps the marker */}
      <text x={luckX} y={padT + 8} textAnchor="middle" className="pf-hist-luck-label">
        zero-skill (luck)
      </text>

      {/* x ticks */}
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={X(v)} y1={baseY} x2={X(v)} y2={baseY + 4} stroke="var(--text-dim)" strokeWidth="1" />
          <text x={X(v)} y={baseY + 16} textAnchor="middle" className="pf-hist-tick">
            {fmt(v)}
          </text>
        </g>
      ))}
      <text x={(padL + W - padR) / 2} y={H - 4} textAnchor="middle" className="pf-hist-axis">
        Information Ratio
      </text>
    </svg>
  );
}

export default function SkillLuckPanel({ data }) {
  if (!data) return null;

  return (
    <div className="pf-panel">
      <div className="pf-cards">
        <div className="pf-card pf-card-strong">
          <div className="pf-card-label">
            P(real skill)
            <InfoTip text={TIPS.prob} />
          </div>
          <div className={vc(data.prob_skill_pct >= 80 ? "good" : data.prob_skill_pct < 55 ? "bad" : "mid")}>
            {fmt(data.prob_skill_pct, 1)}%
          </div>
          <div className={"pf-card-sub pf-verdict " + verdictClass(data.verdict)}>
            {data.verdict}
          </div>
        </div>
        <div className="pf-card">
          <div className="pf-card-label">
            Prob. Sharpe
            <InfoTip text={TIPS.psr} />
          </div>
          <div className={vc(data.psr_pct == null ? "mid" : data.psr_pct >= 95 ? "good" : data.psr_pct < 50 ? "bad" : "mid")}>
            {data.psr_pct == null ? "—" : `${fmt(data.psr_pct, 1)}%`}
          </div>
          <div className="pf-card-sub">confidence Sharpe &gt; 0</div>
        </div>
        <div className="pf-card">
          <div className="pf-card-label">
            t-stat
            <InfoTip text={TIPS.tstat} />
          </div>
          <div className={vc(data.t_stat >= 2 ? "good" : data.t_stat < 0 ? "bad" : "mid")}>{fmt(data.t_stat)}</div>
          <div className="pf-card-sub">IR {fmt(data.information_ratio)} · {data.years}y</div>
        </div>
        <div className="pf-card">
          <div className="pf-card-label">
            Luck p-value
            <InfoTip text={TIPS.pluck} />
          </div>
          <div className={vc(data.p_luck < 0.05 ? "good" : data.p_luck > 0.2 ? "bad" : "mid")}>{fmt(data.p_luck, 3)}</div>
          <div className="pf-card-sub">{data.n_boot.toLocaleString()} resamples</div>
        </div>
      </div>

      <div className="pf-hist-head">
        Could luck have done this?
        <InfoTip text={TIPS.hist} />
      </div>
      <Histogram data={data} />
      <div className="pf-hist-caption">
        The observed IR of <strong>{fmt(data.information_ratio)}</strong> sits at the{" "}
        <strong>{fmt(data.observed_percentile, 1)}th percentile</strong> of the zero-skill
        distribution (luck spans {fmt(data.null_p5)} to {fmt(data.null_p95)} at the 5–95%
        range). Luck matches or beats it {fmt(data.p_luck * 100, 1)}% of the time.
      </div>

      <div className="pf-foot">
        Block bootstrap ({data.n_boot.toLocaleString()} resamples, 10-day blocks) of the
        demeaned daily active returns — the true edge is set to zero, so the spread is
        pure sampling luck.
        {data.years_for_significance != null && (
          <>
            {" "}At this IR a track record would need ~
            <strong>{data.years_for_significance} years</strong> to clear a t-stat of 2;
            this one has {data.years}.
            <InfoTip text={TIPS.yearsForSig} />
          </>
        )}{" "}
        Active-return skew {fmt(data.active_skew)}, excess kurtosis {fmt(data.active_excess_kurt)}.
      </div>
    </div>
  );
}
