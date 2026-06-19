"""
Stress-test configuration loader + validator.

The scenario *assumptions* live in config/scenarios.yaml (human-editable by an
analyst / PM). This module loads that file, validates it strictly, and exposes
the three structures the risk engine consumes:

    SCENARIOS              historical crisis windows  (list[dict])
    HYPOTHETICAL_SCENARIOS forward-looking shock sets (list[dict])
    SCENARIO_PROXIES       pre-inception stand-ins    (dict[str, str])

Validation fails LOUDLY (raises ScenarioConfigError) on a malformed edit, so a
typo in the assumptions file aborts the regen instead of silently producing
wrong P&L. report_scenario_coverage() prints a per-portfolio coverage table at
build time so an editor can see whether a scenario under-covers a portfolio.
"""

from __future__ import annotations

import os
from datetime import datetime

import yaml

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "scenarios.yaml")

# A shock outside this band is almost certainly a typo (e.g. -22 written for a
# 22% drop instead of -0.22). Hard error. A soft warning fires past ±60%.
_SHOCK_HARD_LIMIT = 1.0
_SHOCK_WARN_LIMIT = 0.60


class ScenarioConfigError(ValueError):
    """Raised when scenarios.yaml is missing required fields or malformed."""


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise ScenarioConfigError(msg)


def _is_number(x) -> bool:
    # bool is a subclass of int — exclude it so `shock: true` doesn't pass.
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _valid_ticker(t) -> bool:
    if not isinstance(t, str) or not t:
        return False
    # Tickers used here: letters/digits plus '.', '-', '^' (e.g. BTC-USD,
    # 000660.KS, ^VIX). Permissive but rejects whitespace / odd punctuation.
    return all(c.isalnum() or c in ".-^" for c in t)


def _validate_historical(items) -> list[dict]:
    _require(isinstance(items, list) and items,
             "scenarios.yaml: 'historical' must be a non-empty list")
    seen = set()
    for i, s in enumerate(items):
        where = f"historical[{i}]"
        _require(isinstance(s, dict), f"{where} must be a mapping")
        for field in ("id", "name", "desc", "start", "end"):
            _require(field in s and isinstance(s[field], str) and s[field],
                     f"{where} missing/empty required string field '{field}'")
        _require(s["id"] not in seen, f"{where}: duplicate id '{s['id']}'")
        seen.add(s["id"])
        for field in ("start", "end"):
            try:
                datetime.strptime(s[field], "%Y-%m-%d")
            except ValueError:
                raise ScenarioConfigError(
                    f"{where}: '{field}' must be YYYY-MM-DD, got '{s[field]}'"
                )
        _require(s["start"] <= s["end"],
                 f"{where}: start '{s['start']}' is after end '{s['end']}'")
        # Normalize to exactly the engine's expected key set/order.
        items[i] = {k: s[k] for k in ("id", "name", "desc", "start", "end")}
    return items


def _validate_hypothetical(items) -> list[dict]:
    _require(isinstance(items, list) and items,
             "scenarios.yaml: 'hypothetical' must be a non-empty list")
    seen = set()
    for i, s in enumerate(items):
        where = f"hypothetical[{i}]"
        _require(isinstance(s, dict), f"{where} must be a mapping")
        for field in ("id", "name", "desc"):
            _require(field in s and isinstance(s[field], str) and s[field],
                     f"{where} missing/empty required string field '{field}'")
        _require(s["id"] not in seen, f"{where}: duplicate id '{s['id']}'")
        seen.add(s["id"])
        shocks = s.get("shocks")
        _require(isinstance(shocks, dict) and shocks,
                 f"{where} ('{s['id']}') must have a non-empty 'shocks' mapping")
        for t, v in shocks.items():
            _require(_valid_ticker(t),
                     f"{where} ('{s['id']}'): invalid ticker key {t!r}")
            _require(_is_number(v),
                     f"{where} ('{s['id']}'): shock for {t} must be a number, "
                     f"got {v!r}")
            _require(-_SHOCK_HARD_LIMIT <= v <= _SHOCK_HARD_LIMIT,
                     f"{where} ('{s['id']}'): shock for {t} = {v} is outside "
                     f"±{_SHOCK_HARD_LIMIT:.0%}. A shock is a fraction "
                     f"(-0.22 = -22%); did you mean {v/100}?")
            if abs(v) > _SHOCK_WARN_LIMIT:
                print(f"  [scenarios.yaml] WARNING: {s['id']} shock for {t} = "
                      f"{v:+.0%} is unusually large — confirm this is intended.")
        # Coerce ints to float so downstream math is consistent, keep insertion order.
        items[i] = {
            "id":     s["id"],
            "name":   s["name"],
            "desc":   s["desc"],
            "shocks": {t: float(v) for t, v in shocks.items()},
        }
    return items


def _validate_proxies(items) -> dict:
    _require(isinstance(items, dict) and items,
             "scenarios.yaml: 'proxies' must be a non-empty mapping")
    out = {}
    for src, dst in items.items():
        _require(_valid_ticker(src), f"proxies: invalid source ticker {src!r}")
        _require(_valid_ticker(dst),
                 f"proxies: invalid stand-in ticker {dst!r} for {src}")
        _require(src != dst, f"proxies: {src} maps to itself")
        out[src] = dst
    return out


def load_scenario_config(path: str = CONFIG_PATH) -> dict:
    """Load + validate scenarios.yaml. Returns dict with the three structures."""
    if not os.path.exists(path):
        raise ScenarioConfigError(f"scenarios.yaml not found at {path}")
    with open(path) as fh:
        raw = yaml.safe_load(fh)
    _require(isinstance(raw, dict), "scenarios.yaml: top level must be a mapping")
    for section in ("historical", "hypothetical", "proxies"):
        _require(section in raw, f"scenarios.yaml: missing section '{section}'")
    return {
        "historical":   _validate_historical(raw["historical"]),
        "hypothetical": _validate_hypothetical(raw["hypothetical"]),
        "proxies":      _validate_proxies(raw["proxies"]),
    }


# Load once at import. Names match the old in-engine literals so the rest of
# risk_engine.py is unchanged.
_cfg = load_scenario_config()
SCENARIOS              = _cfg["historical"]
HYPOTHETICAL_SCENARIOS = _cfg["hypothetical"]
SCENARIO_PROXIES       = _cfg["proxies"]


def report_scenario_coverage(modes: dict, min_ok: float = 0.99) -> None:
    """
    Print a portfolio × hypothetical-scenario coverage table.

    Coverage = fraction of a portfolio's weight whose tickers have a shock
    defined in that scenario. The engine re-normalizes over covered tickers, so
    low coverage means the stress P&L reflects only part of the portfolio.
    `modes` is the PORTFOLIO_MODES dict (each value has 'weights' + 'label').

    Look-through modes (those with a 'fund_ticker') fall back to a fund-level
    shock when their individual holdings aren't covered, so a low per-ticker
    coverage there is shown as 'fund-lvl', not flagged as a gap.
    """
    print("\n  Scenario coverage (hypothetical shocks vs portfolio weights):")
    header = "    " + f"{'portfolio':<26}" + "".join(
        f"{s['id'][:14]:>16}" for s in HYPOTHETICAL_SCENARIOS
    )
    print(header)
    worst = 1.0
    for key, cfg in modes.items():
        weights     = cfg.get("weights") or {}
        fund_ticker = cfg.get("fund_ticker")
        total_w     = sum(weights.values())
        if total_w <= 0:
            continue
        cells = []
        for s in HYPOTHETICAL_SCENARIOS:
            shocks = s["shocks"]
            cov = sum(w for t, w in weights.items() if t in shocks) / total_w
            if cov >= min_ok:
                cells.append(f"{cov*100:>13.1f}% ")
            elif fund_ticker and fund_ticker in shocks:
                # Covered as a whole via the fund-level fallback, not a gap.
                cells.append(f"{'fund-lvl':>15}")
            else:
                worst = min(worst, cov)
                cells.append(f"{cov*100:>13.1f}% <")
        label = (cfg.get("label") or key)[:25]
        print(f"    {label:<26}" + "".join(f"{c:>16}" for c in cells))
    if worst < min_ok:
        print(f"  NOTE: some portfolios fall below {min_ok:.0%} coverage "
              f"(marked '<') — a shock is undefined for part of that portfolio.")
    else:
        print(f"  All portfolios covered on every scenario "
              f"(per-ticker ≥ {min_ok:.0%} or fund-level fallback).")


if __name__ == "__main__":
    # Standalone validation: `python scenario_config.py`
    print(f"Loaded + validated {CONFIG_PATH}")
    print(f"  historical:   {len(SCENARIOS)} crisis windows")
    print(f"  hypothetical: {len(HYPOTHETICAL_SCENARIOS)} shock sets "
          f"({[len(s['shocks']) for s in HYPOTHETICAL_SCENARIOS]} shocks each)")
    print(f"  proxies:      {len(SCENARIO_PROXIES)} substitutions")
