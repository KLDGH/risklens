import HoverTip from "./HoverTip.jsx";
import CalendarHeatmap from "./CalendarHeatmap.jsx";
import "./BacktestPanel.css";

const TIPS = {
  exceptions:
    "Number of trading days in the out-of-sample evaluation window where the actual loss exceeded the model's daily VaR forecast.",
  expected:
    "Expected exceptions at 1% confidence = number of evaluation days × 0.01.",
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
    GARCH:  "GARCH(1,1) — mean-reverting conditional volatility, Student-t innovations",
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
        Insufficient history to backtest this portfolio's models.
      </div>
    );
  }

  const evalDates = data[0]?.eval_dates ?? [];
  const nDays = evalDates.length;
  const winStart = evalDates[0]?.slice(0, 7);
  const winEnd = evalDates[evalDates.length - 1]?.slice(0, 7);
  const windowLabel = winStart && winEnd ? `${winStart} to ${winEnd}` : "";
  const expectedExc = data[0]?.expected ?? +(nDays * 0.01).toFixed(1);

  return (
    <div className="backtest-panel">
      <div className="backtest-summary">
        Backtested over <strong>{nDays.toLocaleString()}</strong> out-of-sample
        trading days{windowLabel ? <> (<strong>{windowLabel}</strong>)</> : ""} of{" "}
        <strong>{portfolioLabel}</strong>'s daily portfolio returns — the full
        history its holdings support. Each forecast uses a strict 1000-day rolling
        lookback before the day being tested (out-of-sample). Expected exceptions
        at 1% confidence: <strong>{expectedExc}</strong>.
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
        significantly below 1% — the model overstates risk; conservative, but a
        calibration drift to note.{" "}
        <span className="verdict-clustered">CLUSTERED</span> means exceptions
        bunch together rather than appearing independently — a sign of
        time-varying volatility the model isn't capturing. The panel shows
        each model's behavior in the recent regime, not whether the model is
        good or bad in general.
      </div>

      <div className="backtest-interpretation">
        <strong>Why EWMA tends to show UNDER-EST.</strong> EWMA assumes
        normal-distribution tails, but real returns have fat tails (excess
        kurtosis), so it systematically misses the far tail at 1% confidence.
        That is canonical; every quant textbook covers it. The evaluation window
        spans several stress regimes — the 2022 dual-asset selloff, the 2025
        tariff shock, and (for holdings with long-enough history) the 2020 COVID
        crash — an above-average-stress sample that widens the gap. EVT makes the
        opposite trade: it fits the tail directly, so it tends to run
        OVER-CONSERV. That split — the Gaussian model under-estimating and the
        tail model over-conservative — is the expected result, not a bug, and is
        why the snapshot shows multiple models instead of one. Use EVT for tail
        sizing in fat-tail regimes, and the conditional-vol models for everyday
        forecasting.
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

        // The calendar is a single-row week grid (~52 weeks fits the panel);
        // cap it to the most recent year so every cell is visible without
        // clipping. The stats table above uses the full window.
        const CAL_DAYS = 252;
        const calWindow = evalDates.slice(-CAL_DAYS);
        const calClipped = evalDates.length > calWindow.length;
        const calData = calWindow.map((date) => ({
          date,
          count: flaggedBy[date]?.length ?? 0,
          models: flaggedBy[date] ?? [],
        }));

        return (
          <div className="exception-calendar-section">
            <div className="exception-calendar-label">
              VaR exception calendar{calClipped ? <> — <strong>most recent year</strong> ({CAL_DAYS} trading days; the table above covers the full {evalDates.length.toLocaleString()}-day window)</> : ""}; each cell is one trading
              day, intensity = how many of the {data.length} models flagged it as a
              VaR breach. Clusters of red show the breach-clustering the
              Christoffersen test measures.
            </div>
            <CalendarHeatmap
              data={calData}
              valueKey="count"
              colorFn={(count) => exceptionColor(count, data.length)}
              cellSize={11}
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

      {!data.some((r) => /garch/i.test(r.model)) && (
        <div className="backtest-footnote">
          GARCH(1,1) and GJR-tGARCH are not backtested for this portfolio yet —
          they require re-fitting via maximum likelihood at each rolling step, which
          is too expensive on a routine run. EVT GPD parameters are re-fit at each step.
        </div>
      )}
    </div>
  );
}
