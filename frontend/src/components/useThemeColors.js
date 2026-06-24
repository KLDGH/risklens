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
