import { useEffect, useState } from "react";

/**
 * Theme-aware color palette for Recharts components.
 *
 * Recharts doesn't read CSS custom properties at runtime — every color
 * it consumes is a hex string in component JSX. This hook reads the
 * current value of `data-theme` on <html>, watches it for changes via
 * MutationObserver, and returns the matching palette so chart tooltips,
 * gridlines, axis ticks, and reference lines flip with the theme.
 *
 * Usage:
 *
 *   const c = useThemeColors();
 *   <Tooltip contentStyle={{ background: c.bg2, border: `1px solid ${c.border}`, color: c.text }} />
 *   <CartesianGrid stroke={c.grid} />
 *   <XAxis tick={{ fill: c.axisTick }} axisLine={{ stroke: c.axisLine }} />
 *
 * Keep values here in sync with the CSS variables in src/index.css.
 */

const DARK = {
  mode:       "dark",
  bg:         "#141821",
  bg2:        "#1c222c",
  bg3:        "#232a37",
  border:     "#2e3744",
  text:       "#c5cbd4",
  textDim:    "#7e8794",
  textBright: "#e8ecf2",
  // Chart chrome — slightly different from raw palette so gridlines
  // read as subtle reference vs as full panel borders.
  grid:       "#232a37",
  axisTick:   "#7e8794",
  axisLine:   "#2e3744",
  refLine:    "#3a4554",
  // Semantic hues — the SAME values as --green/--yellow/--red/--accent*
  // in index.css, exposed here because Recharts can't read CSS vars.
  // One red and one green app-wide; charts must not mint their own.
  green:      "#5fb87b",
  yellow:     "#d18548",
  red:        "#d96464",
  accent:     "#d97706",
  accentSoft: "#f59e0b",
  violet:     "#a78bfa",   // VIX / GARCH-residual / HML family
  // Hover-cursor wash for Recharts <Tooltip cursor={{ fill: c.cursor }}>.
  cursor:     "rgba(255, 255, 255, 0.06)",
  // rgb() bases for alpha heat ramps (calendar cells, intraday bars):
  // use `rgba(${c.heatGreenRgb}, a)` so ramps track the theme greens/reds.
  heatGreenRgb: "95, 184, 123",
  heatRedRgb:   "217, 100, 100",
};

const LIGHT = {
  mode:       "light",
  bg:         "#f5efe0",
  bg2:        "#ede5d0",
  bg3:        "#e0d6bc",
  border:     "#c9bd9f",
  text:       "#3a2f24",
  textDim:    "#7a6b58",
  textBright: "#1a140c",
  grid:       "#d8cdb0",
  axisTick:   "#7a6b58",
  axisLine:   "#c9bd9f",
  refLine:    "#b8a87f",
  green:      "#4b8a5a",
  yellow:     "#b86a30",
  red:        "#b53e3e",
  accent:     "#b85a1f",
  accentSoft: "#d97706",
  violet:     "#7a5cc4",
  cursor:     "rgba(0, 0, 0, 0.05)",
  heatGreenRgb: "75, 138, 90",
  heatRedRgb:   "181, 62, 62",
};


function readTheme() {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") || "dark";
}


export function useThemeColors() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      const next = readTheme();
      setTheme((prev) => (prev === next ? prev : next));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme === "light" ? LIGHT : DARK;
}
