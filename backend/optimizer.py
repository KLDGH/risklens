"""
optimizer.py — systematic portfolio construction for the Optimizer tab.

Takes a base strategy (the hypothetical portfolio's weights) and produces a small
set of mean-variance / risk-based variants, plus the metric deltas a PM cares
about (return, vol, Sharpe, beta, alpha, tracking error, concentration, turnover,
risk budget). It is a transparent prototype, not a replacement for a production
optimizer.

Design decisions (see the deck's Optimizer caveats):
  * Optimization uses a Ledoit-Wolf-SHRUNK sample covariance. The engine's EWMA
    covariance (used for component-VaR attribution) is well-suited to a
    terminal-day risk readout but too ill-conditioned to invert for optimization.
  * Risk-based objectives (GMV, ERC, max-diversification, the two PM tilts) need
    NO expected-return forecast — that's the defensible core.
  * Max-Sharpe IS included but is a fragility demonstration only: historical-mean
    expected returns are an "error maximizer" (Michaud 1989; DeMiguel-Garlappi-
    Uppal 2009), so it corners into whatever looked good in-sample.
  * All return/Sharpe/alpha numbers are REALIZED IN-SAMPLE on the trailing window,
    descriptive only — never a forecast.
"""

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.covariance import LedoitWolf

from factor_models import compute_beta

LAMBDA_EWMA = 0.94          # only documented in output; optimization uses LW cov
WINDOW = 1000              # trailing trading days used for the moment estimates
ANNUALIZE = 252
MIN_POSITION = 0.005       # zero-out positions below 0.5% then renormalize
DEFAULT_MAX_W = 0.35
RF_ANNUAL = 0.045          # cash / risk-free assumption (today's regime); Sharpe & tangency are excess-of-cash


# ---------------------------------------------------------------- covariance
def _lw_cov_ann(R: np.ndarray) -> np.ndarray:
    """Ledoit-Wolf shrunk daily covariance, annualized (×252)."""
    return LedoitWolf().fit(R).covariance_ * ANNUALIZE


def _cond(M: np.ndarray) -> float:
    try:
        return float(np.linalg.cond(M))
    except Exception:
        return float("nan")


# ---------------------------------------------------------------- solver
def _solve(obj, n, max_w, x0, extra_cons=(), lo=0.0):
    """SLSQP with a budget constraint, long-only box, and a 2-start determinism
    guard (warm-start from base + equal-weight, keep the lower objective)."""
    cons = [{"type": "eq", "fun": lambda w: w.sum() - 1.0}, *extra_cons]
    bounds = [(lo, max_w)] * n
    best = None
    for s in (x0, np.full(n, 1.0 / n)):
        r = minimize(obj, s, method="SLSQP", bounds=bounds, constraints=cons,
                     options={"maxiter": 1000, "ftol": 1e-12})
        if r.success and (best is None or r.fun < best.fun):
            best = r
    return (best if best is not None else r).x


def _erc_obj(Sig):
    """Equal-risk-contribution: minimize the dispersion of the per-asset risk
    contributions RC_i = w_i (Σw)_i / sqrt(wΣw)."""
    def f(w):
        port_vol = np.sqrt(w @ Sig @ w)
        if port_vol <= 0:
            return 1e6
        rc = w * (Sig @ w) / port_vol
        return float(np.sum((rc - rc.mean()) ** 2))
    return f


# ---------------------------------------------------------------- clean weights
def _clean(w, tickers):
    """Zero out sub-threshold positions, renormalize to 1.0, return a dict."""
    w = np.where(w < MIN_POSITION, 0.0, w)
    tot = w.sum()
    w = w / tot if tot > 0 else w
    return {t: float(round(wi, 4)) for t, wi in zip(tickers, w)}


# ---------------------------------------------------------------- per-portfolio metrics
def _metrics(wdict, w0_dict, tickers, Sig, mu_ann, sig_diag, ret_df, spy_rets, prices_long):
    """Compute the comparison metric block for one weight vector."""
    w  = np.array([wdict.get(t, 0.0) for t in tickers])
    w0 = np.array([w0_dict.get(t, 0.0) for t in tickers])
    port_vol = float(np.sqrt(w @ Sig @ w))
    ret_ann  = float(w @ mu_ann)                       # realized in-sample mean
    sharpe   = (ret_ann - RF_ANNUAL) / port_vol if port_vol > 0 else 0.0

    # Equity-market sensitivity diagnostic ONLY (beta vs SPY) — NOT the benchmark.
    # The benchmark for the active frame below is the reference book w0 itself.
    port_daily = pd.Series(ret_df.values @ w, index=ret_df.index)
    beta = compute_beta(port_daily, spy_rets, lookback=252)

    # Active frame, all measured vs the reference book w0 (the declared benchmark):
    # ex-ante active risk, in-sample active return, and the information ratio they form.
    te = float(np.sqrt((w - w0) @ Sig @ (w - w0)))
    active_ret = float((w - w0) @ mu_ann)
    info_ratio = (active_ret / te) if te > 1e-9 else None
    hhi = float(np.sum(w ** 2))
    div_ratio = float((w @ sig_diag) / port_vol) if port_vol > 0 else 0.0

    # Risk budget — per-asset risk contribution under the SAME (LW) covariance
    # the optimizer used: RC_i = w_i (Σw)_i / sqrt(wΣw), shares sum to 100%.
    # (Using the optimization covariance here is what makes the ERC variant
    # actually read as equal-risk-contribution; the engine's EWMA Σ is a
    # different matrix and would make ERC look uneven.)
    if port_vol > 0:
        rc = w * (Sig @ w) / port_vol
        rc_tot = float(rc.sum())
        rc_pct = {t: round(100.0 * ri / rc_tot, 1) for t, ri in zip(tickers, rc)} if rc_tot else {}
    else:
        rc_pct = {}

    return {
        "weights":        wdict,
        "weight_deltas":  {t: round(wdict.get(t, 0.0) - w0_dict.get(t, 0.0), 4) for t in tickers},
        "return_ann":     round(ret_ann * 100, 2),
        "vol_ann":        round(port_vol * 100, 2),
        "sharpe":         round(sharpe, 2),
        "beta":           round(beta, 2) if beta is not None else None,
        "tracking_error": round(te * 100, 2),
        "active_return":  round(active_ret * 100, 2),
        "info_ratio":     round(info_ratio, 2) if info_ratio is not None else None,
        "max_weight":     round(float(w.max()) * 100, 1),
        "hhi":            round(hhi, 4),
        "eff_n":          round(1.0 / hhi, 1) if hhi > 0 else None,
        "turnover":       round(float(np.sum(np.abs(w - w0))) * 100, 1),
        "div_ratio":      round(div_ratio, 2),
        "n_holdings":     int(np.sum(w > MIN_POSITION)),
        "rc_pct":         rc_pct,
    }


# ---------------------------------------------------------------- main entry
def compute_optimizer(returns_10y, base_weights, prices_long, spy_rets,
                      window=WINDOW, max_w=DEFAULT_MAX_W,
                      te_caps=None, include_max_sharpe=True):
    if te_caps is None:
        te_caps = {"pm_concentrated": 0.015, "pm_lowvol_te": 0.03}

    avail = [t for t in base_weights
             if t in returns_10y.columns and returns_10y[t].dropna().shape[0] >= 252]
    ret_df = returns_10y[avail].dropna()
    if len(ret_df) < 252 or len(avail) < 3:
        return None
    ret_df = ret_df.iloc[-window:]
    R = ret_df.values
    n = len(avail)

    Sig = _lw_cov_ann(R)
    mu_ann = R.mean(axis=0) * ANNUALIZE
    sig_diag = np.sqrt(np.diag(Sig))
    w0 = np.array([base_weights[t] for t in avail], dtype=float)
    w0 /= w0.sum()
    w0_dict = {t: float(round(wi, 4)) for t, wi in zip(avail, w0)}

    TE = lambda w: np.sqrt((w - w0) @ Sig @ (w - w0))
    te_con = lambda cap: {"type": "ineq", "fun": (lambda w, c=cap: c - TE(w))}

    # ---- solve each objective ----
    raw = {
        "gmv":             _solve(lambda w: w @ Sig @ w, n, 0.35, w0),
        "erc":             _solve(_erc_obj(Sig), n, 1.0, w0, lo=1e-4),
        "max_div":         _solve(lambda w: -(w @ sig_diag) / np.sqrt(w @ Sig @ w), n, 0.35, w0),
        "pm_concentrated": _solve(lambda w: -np.sum(w ** 2), n, 0.40, w0, (te_con(te_caps["pm_concentrated"]),)),
        "pm_lowvol_te":    _solve(lambda w: w @ Sig @ w, n, 0.30, w0, (te_con(te_caps["pm_lowvol_te"]),)),
    }
    if include_max_sharpe:
        raw["max_sharpe"] = _solve(lambda w: -((w @ mu_ann) - RF_ANNUAL) / np.sqrt(w @ Sig @ w), n, 0.35, w0)

    META = {
        "gmv":             ("Global Min Variance", "Lowest-risk long-only mix; needs no return forecast. Tends to pile into low-vol bonds.", False, False),
        "erc":             ("Equal Risk Contribution", "Risk parity: every holding contributes the same share of risk. No return forecast.", False, False),
        "max_div":         ("Max Diversification", "Maximizes the diversification ratio (weighted avg vol / portfolio vol). No return forecast.", False, False),
        "pm_concentrated": ("PM · Concentrated (tight TE)", "The 'more concentrated' ask: maximize concentration subject to a 1.5% tracking-error budget vs the base.", False, False),
        "pm_lowvol_te":    ("PM · Lower-risk, close to base", "Minimize variance subject to a 3% tracking-error budget vs the base — stays near the strategy.", False, False),
        "max_sharpe":      ("Max Sharpe (fragility demo)", "Forecast-dependent. Shown to demonstrate estimation fragility, not as a recommendation — it corners into whatever looked best in-sample.", True, True),
    }

    base = {"id": "base", "label": "Reference book", "needs_mu": False, "fragile": False,
            "description": "The current hypothetical portfolio, as-is — the benchmark every variant's active risk, active return, and information ratio is measured against.",
            **_metrics(w0_dict, w0_dict, avail, Sig, mu_ann, sig_diag, ret_df, spy_rets, prices_long)}

    variants = []
    for vid, w in raw.items():
        wd = _clean(w, avail)
        label, desc, needs_mu, fragile = META[vid]
        variants.append({"id": vid, "label": label, "description": desc,
                         "needs_mu": needs_mu, "fragile": fragile,
                         **_metrics(wd, w0_dict, avail, Sig, mu_ann, sig_diag, ret_df, spy_rets, prices_long)})

    # ---- efficient frontier (min-var for a grid of return targets) ----
    frontier = []
    r_lo = float(np.array([base_weights[t] for t in avail]) @ mu_ann)  # any feasible start
    gmv_ret = next((v["return_ann"] for v in variants if v["id"] == "gmv"), None)
    lo = (gmv_ret / 100.0) if gmv_ret is not None else mu_ann.min()
    hi = float(mu_ann.max())
    for target in np.linspace(lo, hi, 25):
        cons = ({"type": "eq", "fun": lambda w: w.sum() - 1.0},
                {"type": "eq", "fun": (lambda w, t=target: w @ mu_ann - t)})
        r = minimize(lambda w: w @ Sig @ w, w0, method="SLSQP",
                     bounds=[(0, 0.35)] * n, constraints=cons,
                     options={"maxiter": 1000, "ftol": 1e-12})
        if r.success:
            frontier.append({"vol": round(float(np.sqrt(r.x @ Sig @ r.x)) * 100, 2),
                             "ret": round(float(r.x @ mu_ann) * 100, 2)})

    caveats = [
        "The benchmark is the reference book itself (the base weights) — there is no prospectus benchmark because there is no mandate. Active return, active risk (tracking error), and information ratio are all measured against that book and nothing else.",
        "Risk-based objectives (GMV, ERC, Max-Diversification, both PM tilts) use no return forecasts — that is the defensible core. Any return / Sharpe / active return / information ratio shown is realized in-sample, descriptive only, never a forecast.",
        "Max-Sharpe is a fragility demonstration only: historical-mean expected returns are an error-maximizer (Michaud 1989; DeMiguel-Garlappi-Uppal 2009), so it corners into whatever looked best in-sample. Not a recommendation.",
        "Optimization and the risk-budget readout both use a Ledoit-Wolf-shrunk sample covariance; the engine's terminal-day EWMA covariance is well-suited to attribution but too ill-conditioned to invert for optimization.",
        "'More concentrated' and 'lower risk' pull opposite ways: minimizing variance under a TE budget de-concentrates, so concentration only happens because the PM-Concentrated objective explicitly maximizes it.",
        "GMV piles into low-vol bonds (textbook pathology, not a bug); the box cap and the PM tracking-error variants tame it.",
        "All estimates are in-sample on the trailing window; Sharpe / return / active return / information ratio are optimistically biased (no walk-forward in v1). Tracking error and information ratio are ex-ante (parametric from the covariance), not realized active-return figures.",
        "Information ratio = in-sample active return ÷ ex-ante active risk, both versus the reference book — descriptive of the trailing window, not a realized-skill or walk-forward estimate.",
        "Sharpe and the Max-Sharpe tangency objective are excess-of-cash, using a 4.5% annual risk-free rate.",
        "Turnover is one-way and pre-cost — no transaction costs, taxes, liquidity, or rebalancing modeled.",
        "SLSQP is a local solver and the concentration objective is non-convex; a 2-start guard is used, but the concentrated weights are a good local solution, not provably global.",
        "Beta is vs SPY as an equity-market sensitivity diagnostic only — NOT the benchmark; this is a ~40%-non-equity book. The optimizers also assume covariance stationarity, which erodes in crises.",
    ]

    return {
        "constraints": {
            "lookback_days": int(len(ret_df)), "lambda_ewma": LAMBDA_EWMA,
            "cov_method": "ledoit_wolf",
            "cov_condition": {"ledoit_wolf": round(_cond(Sig), 1),
                              "ewma": None},
            "rf": RF_ANNUAL, "annualization": ANNUALIZE,
            "default_max_weight": max_w, "te_caps": te_caps,
            "min_position_threshold": MIN_POSITION,
        },
        "base": base,
        "variants": variants,
        "frontier": frontier,
        "caveats": caveats,
    }
