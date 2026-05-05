import HoverTip from "./HoverTip.jsx";
import CalendarHeatmap from "./CalendarHeatmap.jsx";
import "./BacktestPanel.css";

const TIPS = {
  exceptions:
    "Number of trading days in the 504-day evaluation window where the actual loss exceeded the model's daily VaR forecast.",
  expected:
    "Expected exceptions at 1% confidence: 504 × 0.01 ≈ 5.04 days.",
  rate:
    "Observed exception rate. At 1% confidence, the unbiased target is 1.00%. Higher means the model under-estimates tail risk; lower means the model is too conservative.",
  kupiec:
    "Kupiec unconditional coverage test. Null: actual exception rate equals expected 1%. p-value > 0.05 → fail to reject null (PASS, model is calibrated). p-value ≤ 0.05 → reject null (FAIL).",
  christoffersen:
    "Christoffersen independence test. Null: VaR violations are independent (no clustering). p-value > 0.05 → no detectable clustering. Tests whether one violation predicts the next, indicating the model misses time-varying volatility.",
  verdict:
    "Directional summary of model calibration. CALIBRATED = both tests pass at 5% significance. UNDER-EST = exception rate is statistically above 1% (model misses tails). OVER-CONSERV = exception rate is statistically below 1% (model too pessimistic). CLUSTERED = rate is fine but exceptions bunch together (model misses time-varying volatility). The verdict names the dominant calibration issue; quants should look at the underlying p-values for nuance.",
};

const VERDICT_CLASS = {
  CALIBRATED:    "verdict-calibrated",
  "UNDER-EST":   "verdict-under",
  "OVER-CONSERV": "verdict-over",
  CLUSTERED:     "verdict-clustered",
};

function formatP(v) {
  if (v == null) return "—";
  if (v < 0.0001) return "<0.0001";
  return v.toFixed(4);
}

function rateColor(rate, expected) {
  const ratio = rate / expected;
  if (ratio > 1.5 || ratio < 0.5) return "var(--red)";
  if (ratio > 1.2 || ratio < 0.7) return "var(--yellow)";
  return "var(--green)";
}

function modelDescription(model) {
  return {
    HS:     "Historical Simulation — empirical 1% percentile of trailing 1000 returns",
    EWMA:   "Exponentially Weighted Moving Average — λ=0.94, normal-distribution VaR",
    EVT:    "Extreme Value Theory — Generalized Pareto fit to tail losses",
    GARCH:  "GARCH(1,1) — mean-reverting conditional volatility, normal innovations",
    tGARCH: "GJR-tGARCH — asymmetric volatility, negative shocks weight more heavily",
  }[model] ?? model;
}

// Color cell by how many models flagged that day as an exception. More
// models flagging the same day → stronger red, signals the day was
// genuinely unusual regardless of model choice.
function exceptionColor(count, totalModels) {
  if (!count) return "rgba(255, 255, 255, 0.04)";
  const intensity = count / Math.max(1, totalModels);
  const opacity = 0.22 + intensity * 0.7;
  return `rgba(229, 62, 62, ${opacity})`;
}


export default function BacktestPanel({ data, portfolioLabel }) {
  if (!data || data.length === 0) {
    return (
      <div className="backtest-empty">
        Insufficient history to run a 504-day backtest on this portfolio's models.
      </div>
    );
  }

  return (
    <div className="backtest-panel">
      <div className="backtest-summary">
        Backtested over the most recent <strong>504</strong> trading days of{" "}
        <strong>{portfolioLabel}</strong>'s daily portfolio returns. Each
        forecast uses a strict 1000-day rolling lookback before the day being
        tested (out-of-sample). Expected exceptions at 1% confidence:{" "}
        <strong>5.04</strong>.
      </div>

      <div className="backtest-table-wrap">
        <table className="backtest-table">
          <thead>
            <tr>
              <th className="left">Model</th>
              <th className="num">
                <HoverTip width={240} content={TIPS.exceptions}>
                  <span style={{ borderBottom: "1px dotted var(--text-dim)" }}>Exceptions</span>
                </HoverTip>
              </th>
              <th className="num">
                <HoverTip width={240} content={TIPS.expected}>
                  <span style={{ borderBottom: "1px dotted var(--text-dim)" }}>Expected</span>
                </HoverTip>
              </th>
              <th className="num">
                <HoverTip width={240} content={TIPS.rate}>
                  <span style={{ borderBottom: "1px dotted var(--text-dim)" }}>Rate</span>
                </HoverTip>
              </th>
              <th className="num">
                <HoverTip width={260} content={TIPS.kupiec}>
                  <span style={{ borderBottom: "1px dotted var(--text-dim)" }}>Kupiec p-value</span>
                </HoverTip>
              </th>
              <th className="num">
                <HoverTip width={280} content={TIPS.christoffersen}>
                  <span style={{ borderBottom: "1px dotted var(--text-dim)" }}>Christoffersen p-value</span>
                </HoverTip>
              </th>
              <th className="center">
                <HoverTip width={240} content={TIPS.verdict}>
                  <span style={{ borderBottom: "1px dotted var(--text-dim)" }}>Verdict</span>
                </HoverTip>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const expected = row.expected_pct ?? 1.0;
              return (
                <tr key={row.model}>
                  <td className="left">
                    <div className="model-label">{row.model}</div>
                    <div className="model-desc">{modelDescription(row.model)}</div>
                  </td>
                  <td className="num">{row.exceptions}</td>
                  <td className="num text-dim">{row.expected}</td>
                  <td className="num" style={{ color: rateColor(row.rate_pct, expected) }}>
                    {row.rate_pct?.toFixed(2)}%
                  </td>
                  <td className="num">{formatP(row.kupiec_p)}</td>
                  <td className="num">{formatP(row.christoffersen_p)}</td>
                  <td className={`center ${VERDICT_CLASS[row.verdict] ?? ""}`}>
                    {row.verdict}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="backtest-interpretation">
        <strong>Reading the verdicts.</strong>{" "}
        <span className="verdict-calibrated">CALIBRATED</span> means the
        exception rate over the eval window is statistically consistent with
        1% and exceptions don't cluster.{" "}
        <span className="verdict-under">UNDER-EST</span> means the rate is
        significantly above 1% — the model is missing tails and you should
        weight EVT-style estimates more heavily in this regime.{" "}
        <span className="verdict-over">OVER-CONSERV</span> means the rate is
        significantly below 1% — the model is too pessimistic, which is
        "safe" from a risk-management standpoint but indicates calibration
        drift worth knowing about.{" "}
        <span className="verdict-clustered">CLUSTERED</span> means exceptions
        bunch together rather than appearing independently — a sign of
        time-varying volatility the model isn't capturing. The panel reveals
        each model's behavior in the recent regime, not whether the model is
        "good" or "bad" in general.
      </div>

      <div className="backtest-interpretation">
        <strong>Why most models often show UNDER-EST.</strong> Parametric
        volatility models (EWMA, GARCH, tGARCH) assume normal-distribution
        tails — but real returns have fat tails (excess kurtosis), so they
        systematically miss the far tail at 1% confidence. This is canonical:
        every quant textbook covers it. The current 504-day window also
        includes 2022's dual-asset selloff and the 2025 tariff shock — an
        above-average-stress regime that any model evaluated against would
        look like it's missing tails. EVT doesn't share the normality
        assumption and compensates by being too conservative. The asymmetric
        failure pattern (parametric models UNDER-EST, EVT OVER-CONSERV) is
        the literature's predicted result, not a methodology bug — and is
        precisely why this dashboard shows all five models rather than
        picking one. Trust EVT for tail sizing in fat-tail regimes; trust
        the parametric models for everyday vol forecasting.
      </div>

      {(() => {
        // Build the exception calendar from per-model violation date lists.
        // Each cell: count of models that flagged that day as a VaR breach.
        // Days flagged by many models indicate genuinely tail events; clusters
        // visualize the Christoffersen independence test directly.
        const evalDates = data[0]?.eval_dates;
        if (!evalDates?.length) return null;

        const flaggedBy = {};
        for (const row of data) {
          for (const d of row.violation_dates ?? []) {
            if (!flaggedBy[d]) flaggedBy[d] = [];
            flaggedBy[d].push(row.model);
          }
        }

        const calData = evalDates.map((date) => ({
          date,
          count: flaggedBy[date]?.length ?? 0,
          models: flaggedBy[date] ?? [],
        }));

        return (
          <div className="exception-calendar-section">
            <div className="exception-calendar-label">
              VaR exception calendar — each cell is one trading day in the eval
              window; intensity = how many of the 5 models flagged that day as a
              VaR breach. Solid clusters of red are the Christoffersen test made
              visual.
            </div>
            <CalendarHeatmap
              data={calData}
              valueKey="count"
              colorFn={(count) => exceptionColor(count, data.length)}
              cellSize={14}
              formatHover={(c) =>
                c.count === 0 ? (
                  <><strong>{c.date}</strong> · no exceptions</>
                ) : (
                  <>
                    <strong>{c.date}</strong> · flagged by{" "}
                    <strong style={{ color: "#fca5a5" }}>{c.count}</strong> of{" "}
                    {data.length} models — {c.models.join(", ")}
                  </>
                )
              }
              legendStops={[
                [0, "0"],
                [1, "1"],
                [Math.max(2, Math.floor(data.length / 2)), `${Math.max(2, Math.floor(data.length / 2))}`],
                [data.length, `${data.length}`],
              ]}
            />
          </div>
        );
      })()}

      <div className="backtest-footnote">
        GARCH(1,1) and GJR-tGARCH are not backtested here because they require
        re-fitting via maximum likelihood at each rolling step, which is too
        expensive on a routine run. EVT GPD parameters are re-fit at each step.
      </div>
    </div>
  );
}
