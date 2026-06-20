"""
Portfolio registry loader + validator.

Reads config/portfolios.yaml (analyst-editable) and builds the structures the
pipeline consumes:

    PORTFOLIO_MODES    ordered dict of visible portfolios (the shape run.py and
                       _augment_active_fund_modes_with_holdings expect)
    BENCHMARKS         {mode_id: ({ticker: weight}, label)}
    BENCHMARK_TICKERS  tickers to fetch for benchmark rows
    NAV_TICKERS        real-fund price tickers (shown on the total row)

Two holdings source types per portfolio:
    holdings: {weights: {...}}                  explicit basket
    holdings: {look_through: {fund_ticker, top_n}}  disclosed top-N (the mode is
        a placeholder here; _augment_active_fund_modes_with_holdings fills the
        basket from the committed disclosure file at pipeline start)

Validation fails LOUDLY (PortfolioConfigError) on a malformed edit.
"""

from __future__ import annotations

import os
import yaml

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "portfolios.yaml")


class PortfolioConfigError(ValueError):
    """Raised when portfolios.yaml is missing fields or malformed."""


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise PortfolioConfigError(msg)


def _is_number(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _valid_ticker(t) -> bool:
    return isinstance(t, str) and bool(t) and all(c.isalnum() or c in ".-^" for c in t)


def _validate_weights(w, where, names) -> dict:
    _require(isinstance(w, dict) and w, f"{where}: weights must be a non-empty mapping")
    for t, wt in w.items():
        _require(_valid_ticker(t), f"{where}: invalid ticker {t!r}")
        _require(_is_number(wt) and wt > 0, f"{where}: weight for {t} must be > 0")
        _require(t in names, f"{where}: {t} has no entry in the names: map")
    tot = sum(w.values())
    _require(abs(tot - 1.0) <= 0.02, f"{where}: weights sum to {tot:.4f}, must be ~1.0")
    return {t: float(wt) for t, wt in w.items()}


def load_portfolio_config(path: str = CONFIG_PATH) -> dict:
    if not os.path.exists(path):
        raise PortfolioConfigError(f"portfolios.yaml not found at {path}")
    with open(path) as fh:
        raw = yaml.safe_load(fh)
    _require(isinstance(raw, dict), "portfolios.yaml: top level must be a mapping")
    for section in ("names", "benchmarks", "portfolios"):
        _require(section in raw, f"portfolios.yaml: missing section '{section}'")

    names = raw["names"]
    _require(isinstance(names, dict) and names, "portfolios.yaml: 'names' must be a non-empty mapping")
    for t, n in names.items():
        _require(_valid_ticker(t), f"names: invalid ticker {t!r}")
        _require(isinstance(n, str) and n, f"names[{t}]: must be a non-empty string")

    raw_benchmarks = raw["benchmarks"]
    _require(isinstance(raw_benchmarks, dict) and raw_benchmarks,
             "portfolios.yaml: 'benchmarks' must be a non-empty mapping")
    benchmark_defs = {}
    for bid, spec in raw_benchmarks.items():
        where = f"benchmarks[{bid}]"
        _require(isinstance(spec, dict), f"{where}: must be a mapping")
        _require(isinstance(spec.get("label"), str) and spec["label"], f"{where}: missing 'label'")
        bw = spec.get("weights")
        _require(isinstance(bw, dict) and bw, f"{where}: missing 'weights'")
        for t, wt in bw.items():
            _require(_valid_ticker(t) and _is_number(wt) and wt > 0,
                     f"{where}: bad weight {t!r}={wt!r}")
        benchmark_defs[bid] = ({t: float(wt) for t, wt in bw.items()}, spec["label"])

    plist = raw["portfolios"]
    _require(isinstance(plist, list) and plist, "portfolios.yaml: 'portfolios' must be a non-empty list")

    modes = {}
    benchmarks = {}
    nav_tickers = []
    seen = set()
    for i, p in enumerate(plist):
        where = f"portfolios[{i}]"
        _require(isinstance(p, dict), f"{where}: must be a mapping")
        pid = p.get("id")
        _require(isinstance(pid, str) and pid, f"{where}: missing 'id'")
        _require(pid not in seen, f"{where}: duplicate id '{pid}'")
        seen.add(pid)
        for field in ("label", "name", "description"):
            _require(isinstance(p.get(field), str) and p[field],
                     f"{where} ('{pid}'): missing/empty '{field}'")
        if not p.get("visible", True):
            continue                                   # hidden — don't build a mode

        holdings = p.get("holdings")
        _require(isinstance(holdings, dict) and holdings, f"{where} ('{pid}'): missing 'holdings'")

        mode = {
            "label":       p["label"],
            "name":        p["name"],
            "description": p["description"],
        }
        if "weights" in holdings:
            weights = _validate_weights(holdings["weights"], f"{where} ('{pid}') holdings.weights", names)
            mode["weights"] = weights
            mode["tickers"] = list(weights)                       # order = row order
            mode["names"]   = {t: names[t] for t in weights}
        elif "look_through" in holdings:
            lt = holdings["look_through"]
            _require(isinstance(lt, dict), f"{where} ('{pid}'): 'look_through' must be a mapping")
            ft = lt.get("fund_ticker")
            _require(_valid_ticker(ft), f"{where} ('{pid}'): look_through needs a valid fund_ticker")
            _require(ft in names, f"{where} ('{pid}'): fund_ticker {ft} has no entry in names:")
            top_n = lt.get("top_n", 25)
            _require(isinstance(top_n, int) and top_n > 0, f"{where} ('{pid}'): top_n must be a positive int")
            # Placeholder — _augment_active_fund_modes_with_holdings fills the basket.
            mode["weights"]                   = {}
            mode["tickers"]                   = [ft]
            mode["names"]                     = {ft: names[ft]}
            mode["is_active_fund_spotlight"]  = True
            mode["fund_ticker"]               = ft
            mode["look_through_top_n"]        = top_n
        else:
            raise PortfolioConfigError(
                f"{where} ('{pid}'): holdings needs 'weights' or 'look_through'")

        if p.get("nav_ticker"):
            _require(_valid_ticker(p["nav_ticker"]), f"{where} ('{pid}'): bad nav_ticker")
            mode["nav_ticker"] = p["nav_ticker"]
            nav_tickers.append(p["nav_ticker"])
        if p.get("optimizable"):
            mode["optimizable"] = True

        bref = p.get("benchmark")
        if bref is not None:
            _require(bref in benchmark_defs,
                     f"{where} ('{pid}'): benchmark '{bref}' is not defined in benchmarks:")
            benchmarks[pid] = benchmark_defs[bref]

        modes[pid] = mode

    benchmark_tickers = sorted({t for bw, _ in benchmarks.values() for t in bw})
    return {
        "modes":             modes,
        "benchmarks":        benchmarks,
        "benchmark_tickers": benchmark_tickers,
        "nav_tickers":       nav_tickers,
    }


_cfg = load_portfolio_config()
PORTFOLIO_MODES   = _cfg["modes"]
BENCHMARKS        = _cfg["benchmarks"]
BENCHMARK_TICKERS = _cfg["benchmark_tickers"]
NAV_TICKERS       = _cfg["nav_tickers"]


if __name__ == "__main__":
    print(f"Loaded + validated config/portfolios.yaml")
    for k, m in PORTFOLIO_MODES.items():
        kind = "look-through" if m.get("is_active_fund_spotlight") else f"{len(m['weights'])} holdings"
        bench = BENCHMARKS.get(k, (None, "—"))[1]
        print(f"  {k:14s} {kind:16s} nav={m.get('nav_ticker','-'):7s} bench='{bench}'")
    print(f"  BENCHMARK_TICKERS={BENCHMARK_TICKERS}  NAV_TICKERS={NAV_TICKERS}")
