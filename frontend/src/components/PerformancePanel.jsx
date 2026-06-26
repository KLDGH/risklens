import InfoTip from "./InfoTip.jsx";
import "./Performance.css";

/**
 * Risk-adjusted performance for a portfolio vs its benchmark.
 * Data shape: backend performance.compute_performance_metrics().
 */

const TIPS = {
  ir: "IR = (portfolio − benchmark) return ÷ tracking error, annualized. Skill per unit of how far you stray from the benchmark. Good >0.5, great >1.",
  sharpe: "Sharpe = (return − cash) ÷ total volatility, annualized. We take cash = 0, so it's just return ÷ vol. Reward per unit of total risk. Good >1, great >2.",
  sortino: "Sortino = (return − cash) ÷ downside volatility. Like Sharpe, but only losing days count as risk — upside swings don't. Good >1.2, great >2.5.",
  calmar: "Calmar = annual return ÷ worst peak-to-trough drawdown. Reward per unit of max pain. Good >1, great >3.",
  active: "Active return = portfolio − benchmark, annualized. Positive = you beat the benchmark.",
  te: "Tracking error = volatility of (portfolio − benchmark). How far you wander from the benchmark; it's the denominator of IR, not good or bad alone.",
  maxdd: "Max drawdown = worst peak-to-trough drop. Closer to 0 is better.",
  es: "ES₅ = average loss on the worst 5% of days (the 1-in-20 tail). Smaller is better.",
  starr: "STARR = return ÷ tail loss (ES), where Sharpe uses ÷ volatility. Reward per unit of tail risk. Higher is better.",
  batting: "Batting = % of months you beat the benchmark. >50 = win more often than not. Read with win/loss.",
  winloss: "Win/loss = average up-month ÷ average down-month (active return). >1 = wins bigger than losses. Read with batting.",
  capture: "Capture = your average month ÷ the benchmark's, in up / down months. Ideal: >100 in up months, <100 in down.",
};

// Rule-of-thumb rating bands for the headline ratios → {word, tier}. tier drives
// color: good (green), mid (neutral), bad (red). Bands are deliberately
// conventional rough-cuts, not hard truths — the hover spells out the scale.
const RATING_BANDS = {
  ir:      [[1.0, "Exceptional", "good"], [0.5, "Strong", "good"], [0.25, "Modest", "mid"], [0, "Marginal", "mid"], [-1e9, "Negative", "bad"]],
  sharpe:  [[2, "Excellent", "good"], [1, "Good", "good"], [0.5, "Fair", "mid"], [0, "Weak", "mid"], [-1e9, "Negative", "bad"]],
  sortino: [[2.5, "Excellent", "good"], [1.2, "Good", "good"], [0.6, "Fair", "mid"], [0, "Weak", "mid"], [-1e9, "Negative", "bad"]],
  calmar:  [[3, "Excellent", "good"], [1, "Good", "good"], [0.5, "Fair", "mid"], [0, "Weak", "mid"], [-1e9, "Negative", "bad"]],
};
function rate(metric, v) {
  if (v == null) return {};
  for (const [thr, word, tier] of RATING_BANDS[metric]) if (v >= thr) return { word, tier };
  return {};
}
// Two-threshold tier for the secondary stats (color only, no word).
function tierOf(v, good, bad) {
  if (v == null) return undefined;
  return v >= good ? "good" : v <= bad ? "bad" : "mid";
}

function num(v, d = 2, suffix = "") {
  if (v == null) return "—";
  return `${v.toFixed(d)}${suffix}`;
}
function signed(v, d = 2, suffix = "") {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}${suffix}`;
}
function cls(v) {
  if (v == null) return "";
  return v > 0 ? "pf-pos" : v < 0 ? "pf-neg" : "";
}

function Card({ label, value, sub, tip, strong, tier, rating }) {
  const vCls = tier === "good" ? " pf-good" : tier === "bad" ? " pf-bad" : "";
  return (
    <div className={"pf-card" + (strong ? " pf-card-strong" : "")}>
      <div className="pf-card-label">
        {label}
        {tip && <InfoTip text={tip} />}
      </div>
      <div className={"pf-card-value" + vCls}>{value}</div>
      {rating && <div className={"pf-rating pf-rating-" + tier}>{rating}</div>}
      {sub && <div className="pf-card-sub">{sub}</div>}
    </div>
  );
}

export default function PerformancePanel({ data, meta }) {
  if (!data) return null;
  const m = data;

  return (
    <div className="pf-panel">
      {/* Headline risk-adjusted ratios */}
      <div className="pf-cards">
        <Card
          label="Information Ratio"
          value={num(m.information_ratio)}
          tier={rate("ir", m.information_ratio).tier}
          rating={rate("ir", m.information_ratio).word}
          sub={`active ${signed(m.active_return_pct, 1, "%")} · TE ${num(m.tracking_error_pct, 1, "%")}`}
          tip={TIPS.ir}
          strong
        />
        <Card label="Sharpe" value={num(m.sharpe)} tier={rate("sharpe", m.sharpe).tier} rating={rate("sharpe", m.sharpe).word} tip={TIPS.sharpe} />
        <Card label="Sortino" value={num(m.sortino)} tier={rate("sortino", m.sortino).tier} rating={rate("sortino", m.sortino).word} tip={TIPS.sortino} />
        <Card label="Calmar" value={num(m.calmar)} tier={rate("calmar", m.calmar).tier} rating={rate("calmar", m.calmar).word} tip={TIPS.calmar} />
      </div>

      {/* Portfolio vs benchmark */}
      <table className="pf-table">
        <thead>
          <tr>
            <th className="left">Metric</th>
            <th className="num">Portfolio</th>
            <th className="num">Benchmark</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="left">Annualized return</td>
            <td className={"num " + cls(m.ann_return_pct)}>{signed(m.ann_return_pct, 1, "%")}</td>
            <td className={"num " + cls(m.bench_return_pct)}>{signed(m.bench_return_pct, 1, "%")}</td>
          </tr>
          <tr>
            <td className="left">Annualized volatility</td>
            <td className="num">{num(m.ann_vol_pct, 1, "%")}</td>
            <td className="num">{num(m.bench_vol_pct, 1, "%")}</td>
          </tr>
          <tr>
            <td className="left">
              Max drawdown
              <InfoTip text={TIPS.maxdd} />
            </td>
            <td className={"num " + cls(m.max_drawdown_pct)}>{num(m.max_drawdown_pct, 1, "%")}</td>
            <td className="num pf-dim">—</td>
          </tr>
          <tr className="pf-row-active">
            <td className="left">
              Active return
              <InfoTip text={TIPS.active} />
            </td>
            <td className={"num " + cls(m.active_return_pct)}>{signed(m.active_return_pct, 2, "%")}</td>
            <td className="num pf-dim">vs bench</td>
          </tr>
          <tr>
            <td className="left">
              Tracking error
              <InfoTip text={TIPS.te} />
            </td>
            <td className="num">{num(m.tracking_error_pct, 2, "%")}</td>
            <td className="num pf-dim">—</td>
          </tr>
        </tbody>
      </table>

      {/* Skill shape — the batting-average family + tail */}
      <div className="pf-shape">
        <Card label="Batting average" value={num(m.batting_avg_pct, 0, "%")} tier={tierOf(m.batting_avg_pct, 55, 45)} sub={`${m.n_months} months`} tip={TIPS.batting} />
        <Card label="Win / loss" value={num(m.win_loss_ratio)} tier={tierOf(m.win_loss_ratio, 1.1, 0.8)} sub="avg win ÷ avg loss" tip={TIPS.winloss} />
        <Card
          label="Up / down capture"
          value={`${num(m.up_capture_pct, 0)} / ${num(m.down_capture_pct, 0)}`}
          sub="% of benchmark"
          tip={TIPS.capture}
        />
        <Card label="STARR" value={num(m.starr)} sub={`ES₅ ${num(m.es5_daily_pct, 1, "%")}/day`} tip={TIPS.starr} />
      </div>

      <div className="pf-foot">
        {meta && (
          <>
            {meta.benchmark_label} · {meta.years} years ({meta.first_date} → {meta.last_date}).{" "}
          </>
        )}
        Risk-free taken as 0; Sharpe/Sortino are gross-of-cash. Batting average,
        win/loss, and capture are monthly; ratios are annualized from daily log
        returns. The Information Ratio is benchmark-relative and risk-free-independent.
      </div>
    </div>
  );
}
