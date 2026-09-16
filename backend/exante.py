"""
Ex-ante positioning — the forward-looking read that opens the dashboard.

Answers three questions a quant PM asks before anything else:

    ex-ante active risk   how far am I from my benchmark, predicted
    ex-ante beta          am I making an unintended market call
    growth <-> value      what style am I actually running

All three come from ONE risk model — the same Sigma = B Sigma_f Bᵀ + D
structure the factor-decomposition panel uses — so the headline numbers and
the attribution below them are the same object, not two estimates that can
disagree.

FACTOR SET (8). FF5 + Momentum spans equity style but says nothing about a
bond sleeve, which left multi-asset books with no model at all. Two
orthogonalized macro factors fix that:

    DUR   long-Treasury excess return, orthogonalized to the equity market
          -> reads as duration exposure beyond equity beta
    CRD   high-yield minus long-Treasury, orthogonalized to market and DUR
          -> reads as credit-spread exposure beyond duration and equity

Orthogonalization keeps each loading interpretable on its own and stops the
bond factors from stealing variance that belongs to equity beta.

EX-ANTE ACTIVE RISK. The active return series (portfolio - benchmark) is
regressed directly on the factors, so

    TE = sqrt( aᵀ Sigma_f a  +  active residual variance ) * sqrt(252)

Regressing the difference rather than differencing two fitted exposures buys
two things: the active residual variance is measured rather than assumed
(no "portfolio and benchmark residuals are independent" step), and every
active loading arrives with a standard error. The t-stats matter here —
the credit factor carries ~4% annualized volatility against the market's
~17%, so its loading is weakly identified and frequently insignificant.

GROWTH <-> VALUE. Not read off the Fama-French HML loading. Since the
mid-2010s mega-cap growth is highly profitable, so RMW and momentum absorb
much of what a PM means by "growth" and HML alone reads growth funds as
neutral. Instead the active return is regressed on a direct style spread,

    GMV = Russell 1000 Growth - Russell 1000 Value (IWF - IWD), ⟂ market

and labeled only when the loading is both statistically real (|t| >= 2)
and economically material (|loading| >= 0.05, i.e. roughly a 5% net
growth-minus-value position). GMV sits outside the 8-factor risk model —
it is collinear with HML and momentum — and is used only for the label.

EQUITY BETA. For a balanced policy benchmark, beta vs the benchmark and
beta to equities are different questions, so multi-asset benchmarks also
get model beta vs ACWI.

LIMITS, all surfaced in the UI rather than buried:
  - 8 factors, not Barra's 40+: no industry, country, or currency factors, so
    concentrated industry/country bets land in D and predicted TE runs LOW.
  - Diagonal D assumes uncorrelated residuals. `model_capture_pct` measures
    exactly how much of realized variance the model reproduces, so the size
    of that assumption is visible (and a book below ~70% should be read as
    directional only).
  - EWMA covariance with a ~6-month half-life on a 252-day window, so the
    forecast leans toward the current regime without swinging on a single
    volatile fortnight. (The VaR engine's lambda 0.94 is deliberately faster
    — it forecasts tomorrow, not the year.) No shrinkage and no GARCH term
    structure: point-in-time estimates, not forecasts with confidence bands.
  - Exposures come from a trailing regression with weights held at current
    disclosure. A commercial model reads exposures from security
    characteristics instead, so it reprices the instant a trade settles
    where this one needs the window to roll.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from factor_models import FACTOR_COLS

TRADING_DAYS = 252

# Full 8-factor set: the six equity style factors plus the two derived macro
# factors. Order is fixed — downstream code indexes by position.
EXANTE_FACTORS = FACTOR_COLS + ["DUR", "CRD"]

FACTOR_LABELS = {
    "Mkt-RF": "Market",
    "SMB":    "Size (small-big)",
    "HML":    "Value (high-low)",
    "RMW":    "Profitability",
    "CMA":    "Investment",
    "MOM":    "Momentum",
    "DUR":    "Duration",
    "CRD":    "Credit spread",
}

# Proxies for the two derived macro factors.
DUR_PROXY, CRD_PROXY = "TLT", "HYG"

# Style spread (growth minus value) and the equity reference for equity beta.
GROWTH_PROXY, VALUE_PROXY = "IWF", "IWD"
EQUITY_REF = "ACWI"

# Growth<->value banding on the active GMV loading. A tilt needs BOTH a real
# t-stat and a material size; calibration on a trailing year: QQQ vs SPY
# +0.30, RPV vs SPY -0.64, index-tracking allocation funds within ±0.03.
STYLE_MIN_T, STYLE_TILT, STYLE_STRONG = 2.0, 0.05, 0.15

def _style_label(gmv: float, t: float) -> str:
    if abs(t) < STYLE_MIN_T or abs(gmv) < STYLE_TILT:
        return "Style neutral"
    side = "growth" if gmv > 0 else "value"
    return f"Strong {side}" if abs(gmv) >= STYLE_STRONG else f"{side.capitalize()} tilt"


# Covariance decay, expressed as a half-life. Horizon matters: the VaR engine
# uses the RiskMetrics daily default (lambda 0.94, ~11-day half-life) because
# it forecasts tomorrow. An annualized tracking-error forecast is a different
# question, and a 11-day memory makes it swing on a single volatile fortnight.
# Commercial risk models use half-lives measured in months; ~6 months (126
# trading days) keeps the estimate regime-responsive without being twitchy.
EWMA_HALFLIFE_DAYS = 126
EWMA_LAMBDA = float(0.5 ** (1.0 / EWMA_HALFLIFE_DAYS))   # ~0.9945


def _ewma_weights(n: int, lam: float = EWMA_LAMBDA) -> np.ndarray:
    """Normalized exponential weights, most recent observation heaviest."""
    w = lam ** np.arange(n - 1, -1, -1)
    return w / w.sum()


def _ewma_cov(Xm: np.ndarray, lam: float = EWMA_LAMBDA) -> np.ndarray:
    """Zero-mean EWMA covariance (RiskMetrics convention)."""
    w = _ewma_weights(len(Xm), lam)
    Xw = Xm * np.sqrt(w)[:, None]
    return Xw.T @ Xw


def _ewma_var(x: np.ndarray, lam: float = EWMA_LAMBDA) -> float:
    return float(_ewma_weights(len(x), lam) @ (x ** 2))


def _expost(port: np.ndarray, bench: np.ndarray) -> dict:
    """Realized (ex-post) stats over the same window — the fact-sheet view."""
    act = port - bench
    vb = float(np.var(bench, ddof=1))
    return {
        "active_risk_pct": round(float(np.std(act, ddof=1) * np.sqrt(TRADING_DAYS) * 100), 2),
        "vol_pct":         round(float(np.std(port, ddof=1) * np.sqrt(TRADING_DAYS) * 100), 2),
        "beta":            round(float(np.cov(port, bench, ddof=1)[0, 1] / vb), 2) if vb > 0 else None,
        "corr":            round(float(np.corrcoef(port, bench)[0, 1]), 3),
    }


def _ols(y: np.ndarray, X: np.ndarray, ewma: bool = True):
    """
    Returns (coefficients incl. intercept, residual variance).

    Residual variance is EWMA-weighted by default so the specific-risk term
    reflects the current regime rather than a flat average over the window —
    matching the EWMA factor covariance it gets added to.
    """
    beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    eps = y - X @ beta
    if ewma:
        return beta, _ewma_var(eps)
    dof = len(y) - X.shape[1]
    return beta, (float(eps @ eps) / dof if dof > 0 else float("nan"))


def build_exante_factors(factors: pd.DataFrame, prices: pd.DataFrame) -> pd.DataFrame | None:
    """
    FF5+Mom plus the two orthogonalized macro factors, as daily decimals.
    Returns None when the bond proxies are unavailable.
    """
    if DUR_PROXY not in prices.columns or CRD_PROXY not in prices.columns:
        return None
    px = prices[[DUR_PROXY, CRD_PROXY]].dropna()
    rets = np.log(px / px.shift(1)).dropna()

    df = factors[FACTOR_COLS + ["RF"]].join(rets, how="inner").dropna()
    if len(df) < 120:
        return None

    mkt = df["Mkt-RF"].to_numpy()
    dur_raw = (df[DUR_PROXY] - df["RF"]).to_numpy()          # duration, excess
    crd_raw = (df[CRD_PROXY] - df[DUR_PROXY]).to_numpy()      # credit spread

    # DUR ⟂ market
    b = float(np.cov(dur_raw, mkt, ddof=1)[0, 1] / np.var(mkt, ddof=1))
    dur = dur_raw - b * mkt

    # CRD ⟂ (market, DUR)
    X = np.column_stack([np.ones(len(df)), mkt, dur])
    coef, _ = _ols(crd_raw, X)
    crd = crd_raw - X @ coef

    out = df[FACTOR_COLS + ["RF"]].copy()
    out["DUR"] = dur
    out["CRD"] = crd

    # Growth-minus-value spread ⟂ market, for the style label only.
    if GROWTH_PROXY in prices.columns and VALUE_PROXY in prices.columns:
        sp = prices[[GROWTH_PROXY, VALUE_PROXY]].dropna()
        sr = np.log(sp / sp.shift(1)).dropna()
        g = (sr[GROWTH_PROXY] - sr[VALUE_PROXY]).reindex(out.index)
        ok = g.notna().to_numpy()
        m = out["Mkt-RF"].to_numpy()[ok]
        gv = g.to_numpy()[ok]
        bg = float(np.cov(gv, m, ddof=1)[0, 1] / np.var(m, ddof=1))
        out["GMV"] = np.nan
        out.loc[ok, "GMV"] = gv - bg * m
    return out


def _style(active: np.ndarray, mkt: np.ndarray, gmv: np.ndarray | None) -> dict:
    """Active growth-minus-value loading, controlling for market."""
    if gmv is None:
        return {"style_gmv": None, "style_gmv_tstat": None, "style_label": None}
    X = np.column_stack([np.ones(len(active)), mkt, gmv])
    coef, s2 = _ols(active, X, ewma=False)
    se = float(np.sqrt(max(0.0, s2 * np.linalg.pinv(X.T @ X)[2, 2])))
    t = float(coef[2] / se) if se > 0 else 0.0
    return {
        "style_gmv":       round(float(coef[2]), 2),
        "style_gmv_tstat": round(t, 1),
        "style_label":     _style_label(float(coef[2]), t),
    }


def _beta_vs(net: np.ndarray, Sigma_f: np.ndarray, b_ref: np.ndarray, ref_idio: float):
    v = float(b_ref @ Sigma_f @ b_ref) + ref_idio
    return round(float(net @ Sigma_f @ b_ref) / v, 2) if v > 0 else None


def compute_exante(
    returns: pd.DataFrame,
    weights: dict,
    benchmark: tuple | None,
    exante_factors: pd.DataFrame,
    names: dict | None = None,
    fund_ticker: str | None = None,
    lookback: int = TRADING_DAYS,
    min_history: int = TRADING_DAYS,
) -> dict | None:
    """
    Ex-ante positioning for one portfolio against its policy benchmark.
    Returns None without a benchmark or with too little common history.
    """
    if not benchmark:
        return None
    bm_weights, bm_label = benchmark

    avail = [
        t for t in weights
        if t in returns.columns and float(weights.get(t, 0)) > 0
        and returns[t].dropna().shape[0] >= min_history
    ]
    bm_avail = [t for t in bm_weights if t in returns.columns]
    if len(avail) < 2 or not bm_avail:
        return None

    w = np.array([float(weights[t]) for t in avail])
    if w.sum() <= 0:
        return None
    w = w / w.sum()

    bw = np.array([float(bm_weights[t]) for t in bm_avail])
    bw = bw / bw.sum()

    has_fund = (
        fund_ticker is not None
        and fund_ticker in returns.columns
        and returns[fund_ticker].dropna().shape[0] >= min_history
    )
    # Equity beta is only a separate question when the benchmark is not
    # itself a single equity index.
    want_eq = (len(bm_avail) > 1 and EQUITY_REF in returns.columns)
    has_gmv = "GMV" in exante_factors.columns
    cols = sorted(set(avail) | set(bm_avail)
                  | ({fund_ticker} if has_fund else set())
                  | ({EQUITY_REF} if want_eq else set()))
    fcols = EXANTE_FACTORS + ["RF"] + (["GMV"] if has_gmv else [])
    panel = returns[cols].join(
        exante_factors[fcols], how="inner"
    ).dropna().tail(lookback)
    if len(panel) < 120:
        return None
    n = len(panel)

    F = panel[EXANTE_FACTORS].to_numpy()
    rf = panel["RF"].to_numpy()
    X = np.column_stack([np.ones(n), F])
    K = len(EXANTE_FACTORS)

    # Per-holding loadings + residual variances.
    B = np.zeros((len(avail), K))
    D = np.zeros(len(avail))
    for i, t in enumerate(avail):
        coef, resid_var = _ols(panel[t].to_numpy() - rf, X)
        B[i] = coef[1:]
        D[i] = resid_var

    # Benchmark as a basket, through the same regression.
    bench_ret = panel[bm_avail].to_numpy() @ bw
    bcoef, bench_idio = _ols(bench_ret - rf, X)
    b_bench = bcoef[1:]

    # EWMA factor covariance — this is what makes the ex-ante number a
    # forecast rather than a restatement of realized risk. Equal weighting
    # would make predicted and realized nearly identical by construction.
    Sigma_f = _ewma_cov(F - F.mean(axis=0))
    idx_mkt = EXANTE_FACTORS.index("Mkt-RF")
    idx_hml = EXANTE_FACTORS.index("HML")
    mkt_s = F[:, idx_mkt]
    gmv_s = panel["GMV"].to_numpy() if has_gmv else None

    eq = None
    if want_eq:
        eq_ret = panel[EQUITY_REF].to_numpy()
        ecoef, eq_idio = _ols(eq_ret - rf, X)
        eq = (ecoef[1:], eq_idio, eq_ret)

    net = B.T @ w                      # portfolio factor exposure
    port_idio = float((w ** 2) @ D)
    sys_var   = float(net @ Sigma_f @ net)
    total_var = sys_var + port_idio

    # ACTIVE exposure from a direct regression of the active return series
    # (portfolio - benchmark) rather than differencing two fitted exposures.
    # Cleaner: the active residual variance comes out of the same fit, so we
    # never assume the portfolio's and benchmark's residuals are independent,
    # and each active loading gets a standard error. That last part matters —
    # the credit factor has ~4% annualized vol against the market's ~17%, so
    # its loading is weakly identified and would otherwise be reported with
    # false confidence. t-stats let a reader discount exactly those.
    port_ret_s = panel[avail].to_numpy() @ w
    active_ret = port_ret_s - bench_ret
    acoef, active_resid_var = _ols(active_ret, X)          # EWMA residual var
    _, a_resid_ols = _ols(active_ret, X, ewma=False)       # for the t-stats
    active = acoef[1:]

    XtX_inv = np.linalg.pinv(X.T @ X)
    a_se = np.sqrt(np.maximum(0.0, a_resid_ols * np.diag(XtX_inv)))[1:]
    a_t = np.divide(active, a_se, out=np.zeros_like(active), where=a_se > 0)

    active_var = float(active @ Sigma_f @ active) + active_resid_var
    if total_var <= 0 or active_var <= 0:
        return None

    # Ex-ante beta VS THE BENCHMARK, from the model covariance:
    #   beta = Cov_model(r_p, r_b) / Var_model(r_b)
    # Residuals are taken independent across the two, so only the systematic
    # term enters the covariance. This is what a risk system means by
    # "predicted beta" — and it is comparable to the trailing beta a fund
    # page publishes. (The raw Mkt-RF loading is a different animal: it is
    # exposure to the Fama-French US market factor, not to this portfolio's
    # actual benchmark, and the two diverge sharply for a global book.)
    bench_var_model = float(b_bench @ Sigma_f @ b_bench) + bench_idio
    beta_bm = (float(net @ Sigma_f @ b_bench) / bench_var_model
               if bench_var_model > 0 else None)

    ann = lambda v: float(np.sqrt(max(0.0, v) * TRADING_DAYS) * 100.0)

    # Realized check — how much of actual variance the model reproduces.
    port_ret = panel[avail].to_numpy() @ w
    realized_var = float(np.var(port_ret, ddof=1))
    capture = 100.0 * total_var / realized_var if realized_var > 0 else None

    # Euler risk contributions -> concentration (effective number of bets).
    marg = (B @ (Sigma_f @ net)) * w + (w ** 2) * D
    shares = marg / total_var if total_var > 0 else np.zeros_like(marg)
    pos = np.clip(shares, 0, None)
    eff_n = float(1.0 / np.sum((pos / pos.sum()) ** 2)) if pos.sum() > 0 else None

    # Ex-post (realized) over the same window, for the modeled series.
    expost = _expost(port_ret_s, bench_ret)
    if eq:
        expost["equity_beta"] = _expost(port_ret_s, eq[2])["beta"]

    # FUND-LEVEL read. A look-through basket is only its top-N holdings
    # re-normalized to 100%, so it is materially more concentrated than the
    # fund itself and its active risk runs far higher. When the fund's own
    # NAV is available, run the identical model on it — that is the number
    # that answers "what is this FUND's active risk", and the basket number
    # becomes what it actually is: the modeled subset's.
    fund_block = None
    if has_fund:
        f_ret = panel[fund_ticker].to_numpy()
        f_active = f_ret - bench_ret
        fa_coef, fa_resid = _ols(f_active, X)
        fa = fa_coef[1:]
        f_te = float(fa @ Sigma_f @ fa) + fa_resid
        ft_coef, ft_resid = _ols(f_ret - rf, X)
        f_net = ft_coef[1:]
        f_real = _expost(f_ret, bench_ret)
        if eq:
            f_real["equity_beta"] = _expost(f_ret, eq[2])["beta"]
        fund_block = {
            "ticker": fund_ticker,
            "exante": {
                "active_risk_pct": round(ann(f_te), 2),
                "beta":            round(float(f_net @ Sigma_f @ b_bench) / bench_var_model, 2)
                                   if bench_var_model > 0 else None,
                "equity_beta":     _beta_vs(f_net, Sigma_f, eq[0], eq[1]) if eq else None,
                "beta_market_factor": round(float(f_net[idx_mkt]), 2),
                "active_beta":     round(float(fa[idx_mkt]), 2),
                "style_active_hml": round(float(fa[idx_hml]), 2),
                **_style(f_active, mkt_s, gmv_s),
                "vol_pct":         round(ann(float(f_net @ Sigma_f @ f_net) + ft_resid), 2),
            },
            "realized": f_real,
        }

    idx = {f: i for i, f in enumerate(EXANTE_FACTORS)}
    mkt_i, hml_i = idx["Mkt-RF"], idx["HML"]

    factor_rows = [
        {
            "factor":     f,
            "label":      FACTOR_LABELS[f],
            "portfolio":  round(float(net[i]), 3),
            "benchmark":  round(float(b_bench[i]), 3),
            "active":     round(float(active[i]), 3),
            "active_tstat": round(float(a_t[i]), 1),
            "significant":  bool(abs(a_t[i]) >= 1.96),
            # Each factor's share of ACTIVE systematic variance (Euler).
            "active_var_share_pct": round(
                100.0 * float(active[i] * (Sigma_f @ active)[i])
                / float(active @ Sigma_f @ active), 1
            ) if float(active @ Sigma_f @ active) > 0 else None,
        }
        for i, f in enumerate(EXANTE_FACTORS)
    ]

    contributors = sorted(
        (
            {
                "ticker": t,
                "name":   (names or {}).get(t, t),
                "weight_pct":   round(100.0 * float(w[i]), 2),
                "risk_share_pct": round(100.0 * float(shares[i]), 1),
            }
            for i, t in enumerate(avail)
        ),
        key=lambda r: -r["risk_share_pct"],
    )

    return {
        "model": "Ex-ante factor risk model (FF5 + Momentum + duration + credit, EWMA covariance)",
        "ewma_lambda": round(EWMA_LAMBDA, 4),
        "ewma_halflife_days": EWMA_HALFLIFE_DAYS,
        "benchmark_label": bm_label,
        "n_obs":      int(n),
        "n_holdings": int(len(avail)),
        "first_date": panel.index[0].strftime("%Y-%m-%d"),
        "last_date":  panel.index[-1].strftime("%Y-%m-%d"),

        # ---- the three headline numbers ----
        "active_risk_pct":   round(ann(active_var), 2),
        "beta":              round(beta_bm, 2) if beta_bm is not None else None,
        "equity_beta":       _beta_vs(net, Sigma_f, eq[0], eq[1]) if eq else None,
        "equity_ref":        EQUITY_REF if eq else None,
        "beta_market_factor": round(float(net[mkt_i]), 2),
        "beta_benchmark":    round(float(b_bench[mkt_i]), 2),
        "active_beta":       round(float(active[mkt_i]), 2),
        "active_beta_tstat": round(float(a_t[mkt_i]), 1),
        "style_active_hml":  round(float(active[hml_i]), 2),
        "style_hml_tstat":   round(float(a_t[hml_i]), 1),
        **_style(active_ret, mkt_s, gmv_s),
        "style_proxy":       f"{GROWTH_PROXY} − {VALUE_PROXY}" if has_gmv else None,

        # ---- supporting ----
        "total_risk_pct":       round(ann(total_var), 2),
        "benchmark_risk_pct":   round(ann(float(b_bench @ Sigma_f @ b_bench) + bench_idio), 2),
        "systematic_share_pct": round(100.0 * sys_var / total_var, 1),
        "specific_share_pct":   round(100.0 * port_idio / total_var, 1),
        "model_capture_pct":    round(capture, 1) if capture is not None else None,
        "effective_n":          round(eff_n, 1) if eff_n else None,
        "realized":             expost,
        "fund":                 fund_block,
        "factors":              factor_rows,
        "contributors":         contributors[:10],
        "notes": [
            "Predicted (ex-ante) from a factor covariance model, not realized.",
            "8 factors — no industry, country, or currency factors, so "
            "concentrated bets of that kind land in residual risk and "
            "predicted active risk runs low.",
            "Model capture reports how much realized variance the model "
            "reproduces; below ~70% read the numbers as directional.",
            "Look-through baskets model the top-N holdings re-normalized to "
            "100%, so the basket is more concentrated than the fund and its "
            "active risk runs materially higher; the fund-level block uses "
            "the fund's own NAV.",
            "Exposures are estimated from a trailing regression with weights "
            "held at current disclosure — unlike a commercial model that "
            "reads exposures from security characteristics and so reprices "
            "the instant a trade settles.",
            "Active loadings carry t-stats: the credit factor has ~4% "
            "annualized volatility against the market's ~17%, so its loading "
            "is weakly identified and often insignificant. Discount "
            "insignificant rows rather than reading them as positions.",
        ],
    }
