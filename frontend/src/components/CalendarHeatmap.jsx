import { useState } from "react";
import "./CalendarHeatmap.css";

/** Get the Monday of the week containing `date` (UTC). */
function getMonday(date) {
  const d = new Date(date);
  const dow = d.getUTCDay() || 7;  // Sun=7, Mon=1, ..., Sat=6
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * GitHub-contribution-style calendar heatmap.
 *
 * Renders one cell per data point in a 5-row (Mon-Fri) × N-column (weeks) grid.
 * Each cell's background is computed by `colorFn(value)`. Hovering surfaces a
 * tooltip line at the bottom with the date + custom rendered details.
 *
 * Props:
 *   - data:       array of { date: "YYYY-MM-DD", ...other fields }
 *   - colorFn:    (value, row) => CSS color string (gets the row, not just the value)
 *   - valueKey:   field name in each row that's the colored value (default "value")
 *   - formatHover: (row) => string for the hover line
 *   - legendStops: array of [value, label] for the color legend
 *   - cellSize:   px size of each cell (default 30)
 */
export default function CalendarHeatmap({
  data,
  colorFn,
  valueKey = "value",
  formatHover,
  legendStops = [],
  cellSize = 30,
}) {
  const [hovered, setHovered] = useState(null);

  if (!data?.length) return null;

  const dayMs = 24 * 3600 * 1000;
  const cells = data.map((d) => {
    const date = new Date(d.date + "T00:00:00Z");
    return { ...d, jsDate: date, dow: date.getUTCDay() || 7 };
  });

  const firstMonday = getMonday(cells[0].jsDate);
  cells.forEach((c) => {
    const cMonday = getMonday(c.jsDate);
    c.week = Math.round((cMonday - firstMonday) / (7 * dayMs));
  });

  const nWeeks = Math.max(...cells.map((c) => c.week)) + 1;

  // Month labels: emit one when the month changes between consecutive weeks
  const monthLabels = [];
  let lastMonth = null;
  for (let w = 0; w < nWeeks; w++) {
    const weekCells = cells.filter((c) => c.week === w);
    if (!weekCells.length) continue;
    const m = weekCells[0].jsDate.toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    if (m !== lastMonth) {
      monthLabels.push({ week: w, label: m });
      lastMonth = m;
    }
  }

  return (
    <div className="cal-container" style={{ "--cell-size": `${cellSize}px` }}>
      <div className="cal-frame">
        {/* Month strip */}
        <div
          className="cal-month-row"
          style={{ gridTemplateColumns: `repeat(${nWeeks}, var(--cell-size))` }}
        >
          {monthLabels.map((m) => (
            <span
              key={m.week}
              className="cal-month-label"
              style={{ gridColumnStart: m.week + 1 }}
            >
              {m.label}
            </span>
          ))}
        </div>

        <div className="cal-body">
          {/* Day-of-week labels */}
          <div className="cal-day-labels">
            {DOW_LABELS.map((d, i) => (
              <span
                key={d}
                className="cal-day-label"
                style={{ gridRowStart: i + 1 }}
              >
                {d}
              </span>
            ))}
          </div>

          {/* Heatmap cells */}
          <div
            className="cal-grid"
            style={{ gridTemplateColumns: `repeat(${nWeeks}, var(--cell-size))` }}
          >
            {cells.map((c) => (
              <div
                key={c.date}
                className={`cal-cell${hovered?.date === c.date ? " hovered" : ""}`}
                style={{
                  gridRowStart: c.dow,
                  gridColumnStart: c.week + 1,
                  background: colorFn(c[valueKey], c),
                }}
                onMouseEnter={() => setHovered(c)}
                onMouseLeave={() => setHovered(null)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Hover line + legend, side-by-side */}
      <div className="cal-footer">
        <div className="cal-hover-line">
          {hovered ? (
            formatHover ? formatHover(hovered) : `${hovered.date}: ${hovered[valueKey]}`
          ) : (
            <span className="cal-hover-empty">Hover any day for details</span>
          )}
        </div>
        {legendStops.length > 0 && (
          <div className="cal-legend">
            {legendStops.map(([value, label], i) => (
              <span key={i} className="cal-legend-stop">
                <span
                  className="cal-legend-swatch"
                  style={{ background: colorFn(value) }}
                />
                <span className="cal-legend-label">{label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
