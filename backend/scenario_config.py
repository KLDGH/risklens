"""
Stress-test configuration loader + validator.

The scenario *assumptions* live in config/scenarios.yaml and the security
taxonomy in config/categories.yaml (both human-editable by an analyst / PM).
This module loads and strictly validates them, and exposes:

    SCENARIOS              historical crisis windows  (list[dict])
    HYPOTHETICAL_SCENARIOS forward-looking shock sets (list[dict])
    SCENARIO_PROXIES       pre-inception stand-ins    (dict[str, str])
    effective_shocks(weights, scenario)               resolved per-holding shocks

Hypothetical scenarios shock by CATEGORY (asset-class/region `class` + optional
equity `sector`), not by ticker. A holding's effective shock resolves:
    per-name override -> sector -> class -> class-parent -> uncovered.

Validation fails LOUDLY (ScenarioConfigError) on a malformed edit, so a typo
aborts the regen instead of producing wrong P&L. assert_all_mapped() refuses a
regen where a portfolio holding has no taxonomy entry (which would silently get
0 coverage), and report_scenario_coverage() prints a per-portfolio table.
"""

from __future__ import annotations

import os
from datetime import datetime

import yaml

_HERE = os.path.dirname(__file__)
SCENARIO_PATH = os.path.join(_HERE, "config", "scenarios.yaml")
CATEGORY_PATH = os.path.join(_HERE, "config", "categories.yaml")

# A shock outside this band is almost certainly a typo (e.g. -22 written for a
# 22% drop instead of -0.22). Hard error. A soft warning fires past ±60%.
_SHOCK_HARD_LIMIT = 1.0
_SHOCK_WARN_LIMIT = 0.60


class ScenarioConfigError(ValueError):
    """Raised when scenarios.yaml / categories.yaml is malformed."""


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise ScenarioConfigError(msg)


def _is_number(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _valid_ticker(t) -> bool:
    if not isinstance(t, str) or not t:
        return False
    return all(c.isalnum() or c in ".-^" for c in t)


def _check_shock(value, where: str) -> None:
    _require(_is_number(value), f"{where}: shock must be a number, got {value!r}")
    _require(-_SHOCK_HARD_LIMIT <= value <= _SHOCK_HARD_LIMIT,
             f"{where}: shock {value} is outside ±{_SHOCK_HARD_LIMIT:.0%}. A shock "
             f"is a fraction (-0.22 = -22%); did you mean {value/100}?")
    if abs(value) > _SHOCK_WARN_LIMIT:
        print(f"  [scenarios.yaml] WARNING: {where} shock {value:+.0%} is unusually "
              f"large — confirm this is intended.")


# ───────────────────────────── categories.yaml ─────────────────────────────

def _validate_categories(raw) -> dict:
    _require(isinstance(raw, dict), "categories.yaml: top level must be a mapping")
    for section in ("class_parents", "sectors", "securities"):
        _require(section in raw, f"categories.yaml: missing section '{section}'")

    parents = raw["class_parents"]
    _require(isinstance(parents, dict) and parents,
             "categories.yaml: 'class_parents' must be a non-empty mapping")
    for c, p in parents.items():
        _require(isinstance(c, str) and isinstance(p, str),
                 f"categories.yaml: class_parents entry {c!r}->{p!r} must be strings")
        _require(p in parents,
                 f"categories.yaml: parent {p!r} of class {c!r} is not itself a "
                 f"declared class (every parent chain must terminate at a root)")
    # Every class must reach a root (a self-mapping key) without cycling.
    def _terminates(cls):
        seen = set()
        while cls not in seen:
            seen.add(cls)
            nxt = parents[cls]
            if nxt == cls:
                return True
            cls = nxt
        return False
    for c in parents:
        _require(_terminates(c),
                 f"categories.yaml: class {c!r} parent chain does not terminate "
                 f"at a root (cycle?)")

    sectors = raw["sectors"]
    _require(isinstance(sectors, list) and sectors
             and all(isinstance(s, str) for s in sectors),
             "categories.yaml: 'sectors' must be a non-empty list of strings")
    sectors = set(sectors)

    securities = raw["securities"]
    _require(isinstance(securities, dict) and securities,
             "categories.yaml: 'securities' must be a non-empty mapping")
    norm_sec = {}
    for t, spec in securities.items():
        where = f"categories.yaml securities[{t}]"
        _require(_valid_ticker(t), f"{where}: invalid ticker key")
        _require(isinstance(spec, dict), f"{where}: must be a mapping")
        if "weights" in spec:
            w = spec["weights"]
            _require(isinstance(w, dict) and w, f"{where}: 'weights' must be a mapping")
            for cls, wt in w.items():
                _require(cls in parents, f"{where}: weight class {cls!r} unknown")
                _require(_is_number(wt) and wt > 0, f"{where}: weight for {cls} must be > 0")
            tot = sum(w.values())
            _require(abs(tot - 1.0) <= 0.02,
                     f"{where}: weights sum to {tot:.3f}, must be ~1.0")
            norm_sec[t] = {"weights": {c: float(x) for c, x in w.items()}}
        else:
            cls = spec.get("class")
            _require(cls in parents, f"{where}: 'class' {cls!r} unknown")
            entry = {"class": cls}
            sec = spec.get("sector")
            if sec is not None:
                _require(sec in sectors, f"{where}: 'sector' {sec!r} not in sectors list")
                entry["sector"] = sec
            norm_sec[t] = entry

    return {"class_parents": parents, "sectors": sectors, "securities": norm_sec}


# ───────────────────────────── scenarios.yaml ──────────────────────────────

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
                    f"{where}: '{field}' must be YYYY-MM-DD, got '{s[field]}'")
        _require(s["start"] <= s["end"],
                 f"{where}: start '{s['start']}' is after end '{s['end']}'")
        items[i] = {k: s[k] for k in ("id", "name", "desc", "start", "end")}
    return items


def _validate_hypothetical(items, taxonomy) -> list[dict]:
    _require(isinstance(items, list) and items,
             "scenarios.yaml: 'hypothetical' must be a non-empty list")
    valid_cats = set(taxonomy["class_parents"]) | set(taxonomy["sectors"])
    seen = set()
    out = []
    for i, s in enumerate(items):
        where = f"hypothetical[{i}]"
        _require(isinstance(s, dict), f"{where} must be a mapping")
        for field in ("id", "name", "desc"):
            _require(field in s and isinstance(s[field], str) and s[field],
                     f"{where} missing/empty required string field '{field}'")
        _require(s["id"] not in seen, f"{where}: duplicate id '{s['id']}'")
        seen.add(s["id"])

        cats = s.get("categories") or {}
        overrides = s.get("shocks") or {}
        _require(cats or overrides,
                 f"{where} ('{s['id']}') needs a 'categories' (or 'shocks') block")
        _require(isinstance(cats, dict), f"{where} ('{s['id']}'): 'categories' must be a mapping")
        for cat, v in cats.items():
            _require(cat in valid_cats,
                     f"{where} ('{s['id']}'): category {cat!r} is not a known class "
                     f"or sector (see categories.yaml)")
            _check_shock(v, f"{where} ('{s['id']}') category {cat}")
        _require(isinstance(overrides, dict), f"{where} ('{s['id']}'): 'shocks' must be a mapping")
        for t, v in overrides.items():
            _require(_valid_ticker(t), f"{where} ('{s['id']}'): override ticker {t!r} invalid")
            _check_shock(v, f"{where} ('{s['id']}') override {t}")

        out.append({
            "id":         s["id"],
            "name":       s["name"],
            "desc":       s["desc"],
            "categories": {c: float(v) for c, v in cats.items()},
            "shocks":     {t: float(v) for t, v in overrides.items()},
        })
    return out


def _validate_proxies(items) -> dict:
    _require(isinstance(items, dict) and items,
             "scenarios.yaml: 'proxies' must be a non-empty mapping")
    out = {}
    for src, dst in items.items():
        _require(_valid_ticker(src), f"proxies: invalid source ticker {src!r}")
        _require(_valid_ticker(dst), f"proxies: invalid stand-in ticker {dst!r} for {src}")
        _require(src != dst, f"proxies: {src} maps to itself")
        out[src] = dst
    return out


def load_category_config(path: str = CATEGORY_PATH) -> dict:
    if not os.path.exists(path):
        raise ScenarioConfigError(f"categories.yaml not found at {path}")
    with open(path) as fh:
        return _validate_categories(yaml.safe_load(fh))


def load_scenario_config(path: str = SCENARIO_PATH, taxonomy: dict = None) -> dict:
    if not os.path.exists(path):
        raise ScenarioConfigError(f"scenarios.yaml not found at {path}")
    if taxonomy is None:
        taxonomy = load_category_config()
    with open(path) as fh:
        raw = yaml.safe_load(fh)
    _require(isinstance(raw, dict), "scenarios.yaml: top level must be a mapping")
    for section in ("historical", "hypothetical", "proxies"):
        _require(section in raw, f"scenarios.yaml: missing section '{section}'")
    return {
        "historical":   _validate_historical(raw["historical"]),
        "hypothetical": _validate_hypothetical(raw["hypothetical"], taxonomy),
        "proxies":      _validate_proxies(raw["proxies"]),
    }


# Load once at import.
TAXONOMY               = load_category_config()
CLASS_PARENTS          = TAXONOMY["class_parents"]
SECTORS                = TAXONOMY["sectors"]
SECURITIES             = TAXONOMY["securities"]

_cfg = load_scenario_config(taxonomy=TAXONOMY)
SCENARIOS              = _cfg["historical"]
HYPOTHETICAL_SCENARIOS = _cfg["hypothetical"]
SCENARIO_PROXIES       = _cfg["proxies"]


# ───────────────────────────── resolution ──────────────────────────────────

def _resolve_class(cls: str, cats: dict):
    """Walk a class up its parent chain to the nearest category the scenario
    shocks. Returns the shock or None if no ancestor is shocked."""
    seen = set()
    while cls is not None and cls not in seen:
        if cls in cats:
            return cats[cls]
        seen.add(cls)
        parent = CLASS_PARENTS.get(cls)
        if parent == cls:
            break          # reached a root that isn't shocked
        cls = parent
    return None


def resolve_shock(ticker: str, scenario: dict):
    """Effective shock for one holding under one scenario, or None if uncovered.
    Order: per-name override -> equity sector -> class -> class-parent."""
    overrides = scenario.get("shocks") or {}
    if ticker in overrides:
        return overrides[ticker]
    cats = scenario.get("categories") or {}
    sec = SECURITIES.get(ticker)
    if sec is None:
        return None
    if "weights" in sec:
        # Blended fund: weighted average over the class shocks that resolve,
        # re-normalized across the covered sleeves.
        acc, wsum = 0.0, 0.0
        for cls, w in sec["weights"].items():
            s = _resolve_class(cls, cats)
            if s is not None:
                acc += w * s
                wsum += w
        return acc / wsum if wsum > 0 else None
    sector = sec.get("sector")
    if sector and sector in cats:
        return cats[sector]
    return _resolve_class(sec["class"], cats)


def effective_shocks(weights: dict, scenario: dict) -> dict:
    """{ticker: shock} for every holding in `weights` that resolves to a shock."""
    out = {}
    for t in weights:
        s = resolve_shock(t, scenario)
        if s is not None:
            out[t] = s
    return out


# ───────────────────────────── build-time guards ───────────────────────────

def assert_all_mapped(modes: dict) -> None:
    """Refuse a regen if any portfolio holding lacks a taxonomy entry — an
    unmapped holding would silently get 0 shock in every scenario."""
    missing = {}
    for key, cfg in modes.items():
        for t in (cfg.get("weights") or {}):
            if t not in SECURITIES:
                missing.setdefault(t, []).append(key)
    if missing:
        lines = "\n".join(f"    {t}  (in: {', '.join(ms)})" for t, ms in sorted(missing.items()))
        raise ScenarioConfigError(
            "categories.yaml is missing a taxonomy entry for these portfolio "
            f"holdings:\n{lines}\n  Add each to securities: with a class (+ optional "
            "sector) so scenarios can shock it.")
    print(f"  [categories.yaml] all portfolio holdings mapped to the taxonomy.")


def report_scenario_coverage(modes: dict, min_ok: float = 0.99) -> None:
    """Per-portfolio × scenario coverage, using full category resolution."""
    print("\n  Scenario coverage (category-resolved shocks vs portfolio weights):")
    header = "    " + f"{'portfolio':<26}" + "".join(
        f"{s['id'][:14]:>16}" for s in HYPOTHETICAL_SCENARIOS)
    print(header)
    worst = 1.0
    for key, cfg in modes.items():
        weights = cfg.get("weights") or {}
        total_w = sum(weights.values())
        if total_w <= 0:
            continue
        cells = []
        for s in HYPOTHETICAL_SCENARIOS:
            eff = effective_shocks(weights, s)
            cov = sum(weights[t] for t in eff) / total_w
            worst = min(worst, cov)
            cells.append(f"{cov*100:>13.1f}%{'' if cov >= min_ok else ' <'}")
        label = (cfg.get("label") or key)[:25]
        print(f"    {label:<26}" + "".join(f"{c:>16}" for c in cells))
    if worst < min_ok:
        print(f"  NOTE: some portfolios fall below {min_ok:.0%} coverage (marked '<').")
    else:
        print(f"  All portfolios ≥ {min_ok:.0%} coverage on every scenario.")


if __name__ == "__main__":
    print(f"Loaded + validated:")
    print(f"  categories.yaml: {len(SECURITIES)} securities, "
          f"{len(CLASS_PARENTS)} classes, {len(SECTORS)} sectors")
    print(f"  scenarios.yaml:  {len(SCENARIOS)} historical, "
          f"{len(HYPOTHETICAL_SCENARIOS)} hypothetical, {len(SCENARIO_PROXIES)} proxies")
