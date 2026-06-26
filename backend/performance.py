"""
Performance & skill analytics for a portfolio measured against its benchmark.

Pure return-series analytics — everything here is computable from two aligned
daily return streams (portfolio and benchmark), so it runs entirely on the
public price data the rest of the pipeline already pulls. No time-stamped
holdings or analyst forecasts are required.

Three layers:

  compute_performance_metrics      risk-adjusted ratios + batting/slugging/capture
  compute_regime_conditional_alpha alpha & IR split by volatility regime  (the hero)
  compute_skill_vs_luck            bootstrap "luck" IR distribution + PSR    (the rigor)

`compute_performance_skill` orchestrates all three from raw weights.

Conventions: inputs are DAILY LOG returns (matching the rest of the engine),
risk-free is taken as 0 (Sharpe/Sortino are gross-of-cash; the Information
Ratio is risk-free-independent by construction). 252 trading days / year.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

TRADING_DAYS = 252
_BOOT_SEED = 20260626  # deterministic bootstrap so reruns are reproducible


# ----------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------
def _norm_cdf(x: float) -> float:
    """Standard-normal CDF via erf — avoids a scipy dependency."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _basket_returns(returns: pd.DataFrame, weights: dict, min_history: int = 252):
    """
    Weighted daily return series for a basket, mirroring compute_portfolio_row:
    drop tickers with < min_history days, re-normalize over survivors, then take
    the common date range. Returns a pd.Series, or None if nothing qualifies.
    """
    avail = [
        t for t in weights
        if t in returns.columns and int(returns[t].dropna().shape[0]) >= min_history
    ]
    if not avail:
        return None
    raw = np.array([weights[t] for t in avail], dtype=float)
    if raw.sum() <= 0:
        return None
    norm = raw / raw.sum()
    rdf = returns[avail].dropna()
    if rdf.empty:
        return None
    return pd.Series(rdf.values @ norm, index=rdf.index)


def _ann_return_pct(r: pd.Series) -> float:
    return float(r.mean() * TRADING_DAYS * 100.0)


def _ann_vol_pct(r: pd.Series) -> float:
    return float(r.std(ddof=1) * math.sqrt(TRADING_DAYS) * 100.0)


def _sharpe(r: pd.Series):
    sd = float(r.std(ddof=1))
    return float(r.mean() / sd * math.sqrt(TRADING_DAYS)) if sd > 0 else None


def _sortino(r: pd.Series, target: float = 0.0):
    downside = np.minimum(r.to_numpy() - target, 0.0)
    dd = math.sqrt(float(np.mean(downside ** 2)))
    return float((r.mean() - target) / dd * math.sqrt(TRADING_DAYS)) if dd > 0 else None


def _info_ratio(active: pd.Series):
    sd = float(active.std(ddof=1))
    return float(active.mean() / sd * math.sqrt(TRADING_DAYS)) if sd > 0 else None


def _max_drawdown_pct(r: pd.Series) -> float:
    nav = np.exp(r.cumsum())
    peak = nav.cummax()
    return float((nav / peak - 1.0).min() * 100.0)


def _monthly(r: pd.Series) -> pd.Series:
    """Compound daily LOG returns into monthly LOG returns (version-robust)."""
    return r.groupby(r.index.to_period("M")).sum()


# ----------------------------------------------------------------------------
# 1. risk-adjusted return + the batting-average family
# ----------------------------------------------------------------------------
def compute_performance_metrics(port: pd.Series, bench: pd.Series) -> dict | None:
    df = pd.concat([port, bench], axis=1, keys=["p", "b"]).dropna()
    if len(df) < 60:
        return None
    p, b = df["p"], df["b"]
    active = p - b

    # Tail / ES (daily 5% Expected Shortfall, as a positive loss in %).
    cutoff = float(p.quantile(0.05))
    tail = p[p <= cutoff]
    es5_daily = float(-tail.mean()) if len(tail) else 0.0
    # STARR: annualized excess return / annualized ES (ES scaled like vol, √252).
    ann_es = es5_daily * math.sqrt(TRADING_DAYS)
    starr = float(p.mean() * TRADING_DAYS / ann_es) if ann_es > 0 else None

    # Batting average & slugging, monthly active return.
    pm, bm = _monthly(p), _monthly(b)
    am = (pm - bm).dropna()
    wins = am[am > 0]
    losses = am[am < 0]
    batting = float((am > 0).mean() * 100.0) if len(am) else None
    avg_win = float(wins.mean()) if len(wins) else 0.0
    avg_loss = float(losses.mean()) if len(losses) else 0.0
    win_loss = float(avg_win / abs(avg_loss)) if avg_loss < 0 else None

    # Up / down capture (average monthly capture vs the benchmark).
    up, down = bm > 0, bm < 0
    up_cap = (float(pm[up].mean() / bm[up].mean()) * 100.0
              if up.any() and bm[up].mean() != 0 else None)
    down_cap = (float(pm[down].mean() / bm[down].mean()) * 100.0
                if down.any() and bm[down].mean() != 0 else None)

    def rnd(v, d=2):
        return round(v, d) if v is not None else None

    return {
        "ann_return_pct":   round(_ann_return_pct(p), 2),
        "ann_vol_pct":      round(_ann_vol_pct(p), 2),
        "bench_return_pct": round(_ann_return_pct(b), 2),
        "bench_vol_pct":    round(_ann_vol_pct(b), 2),
        "active_return_pct": round(_ann_return_pct(active), 2),
        "tracking_error_pct": round(_ann_vol_pct(active), 2),
        "max_drawdown_pct": round(_max_drawdown_pct(p), 2),
        "sharpe":           rnd(_sharpe(p)),
        "sortino":          rnd(_sortino(p)),
        "information_ratio": rnd(_info_ratio(active)),
        "calmar":           rnd(
            (_ann_return_pct(p) / abs(_max_drawdown_pct(p)))
            if _max_drawdown_pct(p) < 0 else None
        ),
        "es5_daily_pct":    round(es5_daily * 100.0, 2),
        "starr":            rnd(starr),
        "batting_avg_pct":  rnd(batting, 1),
        "win_loss_ratio":   rnd(win_loss),
        "up_capture_pct":   rnd(up_cap, 1),
        "down_capture_pct": rnd(down_cap, 1),
        "n_months":         int(len(am)),
    }


# ----------------------------------------------------------------------------
# 2. regime-conditional alpha  (the hero — does the edge survive stress?)
# ----------------------------------------------------------------------------
def compute_regime_conditional_alpha(
    port: pd.Series, bench: pd.Series, vol_window: int = 21
) -> dict | None:
    """
    Split the history into Calm / Normal / Stressed regimes by the benchmark's
    trailing realized volatility (terciles), and report the basket's active
    return + Information Ratio in each. Answers a question a static IR can't:
    is the alpha earned when risk is cheap, or when it's expensive?
    """
    df = pd.concat([port, bench], axis=1, keys=["p", "b"]).dropna()
    if len(df) < TRADING_DAYS:
        return None
    p, b = df["p"], df["b"]
    active = p - b

    roll_vol = b.rolling(vol_window).std() * math.sqrt(TRADING_DAYS)
    valid = roll_vol.dropna()
    if len(valid) < TRADING_DAYS:
        return None
    q1, q2 = float(valid.quantile(1 / 3)), float(valid.quantile(2 / 3))
    base_n = int(len(valid))

    defs = [
        ("calm", "Calm", roll_vol < q1),
        ("normal", "Normal", (roll_vol >= q1) & (roll_vol < q2)),
        ("stressed", "Stressed", roll_vol >= q2),
    ]
    regimes = []
    for key, label, cond in defs:
        mask = cond & roll_vol.notna()
        a = active[mask]
        if len(a) < 10:
            continue
        regimes.append({
            "key": key,
            "label": label,
            "n_days": int(len(a)),
            "share_pct": round(100.0 * len(a) / base_n, 1),
            "ann_active_pct": round(_ann_return_pct(a), 2),
            "info_ratio": (round(_info_ratio(a), 2)
                           if _info_ratio(a) is not None else None),
            "ann_port_pct": round(_ann_return_pct(p[mask]), 2),
            "ann_bench_pct": round(_ann_return_pct(b[mask]), 2),
            "avg_bench_vol_pct": round(float(roll_vol[mask].mean()) * 100.0, 1),
            "hit_rate_pct": round(float((a > 0).mean() * 100.0), 1),
        })
    if len(regimes) < 2:
        return None

    by_key = {r["key"]: r for r in regimes}
    calm_minus_stressed = None
    if "calm" in by_key and "stressed" in by_key:
        calm_minus_stressed = round(
            by_key["calm"]["ann_active_pct"] - by_key["stressed"]["ann_active_pct"], 2
        )

    return {
        "vol_window": vol_window,
        "vol_thresholds_pct": [round(q1 * 100.0, 1), round(q2 * 100.0, 1)],
        "regimes": regimes,
        "calm_minus_stressed_alpha": calm_minus_stressed,
        "n_classified_days": base_n,
    }


# ----------------------------------------------------------------------------
# 3. skill vs luck  (bootstrap a zero-edge null + Probabilistic Sharpe)
# ----------------------------------------------------------------------------
def compute_skill_vs_luck(
    port: pd.Series, bench: pd.Series, n_boot: int = 4000, block: int = 10
) -> dict | None:
    """
    How much of the basket's active record could a zero-skill manager have
    produced by luck? Block-bootstrap the *demeaned* active returns (true edge
    set to zero) and build the distribution of Information Ratios luck alone
    yields, then locate the observed IR in it. Also report the Probabilistic
    Sharpe Ratio (Bailey & Lopez de Prado), which credits/penalizes the
    higher moments of the active stream.
    """
    df = pd.concat([port, bench], axis=1, keys=["p", "b"]).dropna()
    if len(df) < TRADING_DAYS:
        return None
    active = (df["p"] - df["b"]).to_numpy()
    T = len(active)
    years = T / TRADING_DAYS

    sd = float(active.std(ddof=1))
    if sd <= 0:
        return None
    ir_obs = float(active.mean() / sd * math.sqrt(TRADING_DAYS))
    t_stat = float(ir_obs * math.sqrt(years))

    # Block bootstrap of the zero-edge null distribution of IR.
    centered = active - active.mean()
    rng = np.random.default_rng(_BOOT_SEED)
    n_blocks = int(math.ceil(T / block))
    null_irs = np.empty(n_boot)
    for i in range(n_boot):
        starts = rng.integers(0, T - block + 1, size=n_blocks)
        idx = (starts[:, None] + np.arange(block)).ravel()[:T]
        s = centered[idx]
        ssd = s.std(ddof=1)
        null_irs[i] = (s.mean() / ssd * math.sqrt(TRADING_DAYS)) if ssd > 0 else 0.0

    p_luck = float(np.mean(null_irs >= ir_obs))
    prob_skill = round((1.0 - p_luck) * 100.0, 1)
    pct_in_null = round(float(np.mean(null_irs <= ir_obs) * 100.0), 1)

    # Probabilistic Sharpe Ratio of the active stream vs SR*=0, per-observation
    # Sharpe with skew (g3) and non-excess kurtosis (g4).
    sr = float(active.mean() / sd)  # daily (non-annualized) Sharpe of active
    s_ser = pd.Series(active)
    g3 = float(s_ser.skew())
    g4 = float(s_ser.kurtosis()) + 3.0  # pandas gives excess kurtosis
    psr_denom = 1.0 - g3 * sr + (g4 - 1.0) / 4.0 * sr ** 2
    psr = (round(_norm_cdf(sr * math.sqrt(T - 1) / math.sqrt(psr_denom)) * 100.0, 1)
           if psr_denom > 0 else None)

    # Years of track record needed to clear t = 2 at the observed IR.
    years_for_sig = round((2.0 / ir_obs) ** 2, 1) if ir_obs > 0 else None

    # Histogram of the null distribution for the frontend.
    lo = float(min(null_irs.min(), ir_obs)) - 0.05
    hi = float(max(null_irs.max(), ir_obs)) + 0.05
    counts, edges = np.histogram(null_irs, bins=41, range=(lo, hi))
    centers = ((edges[:-1] + edges[1:]) / 2.0)

    verdict = ("Skill likely" if p_luck < 0.05
               else "Suggestive, not conclusive" if p_luck < 0.20
               else "Cannot reject luck")

    return {
        "n_obs": int(T),
        "years": round(years, 1),
        "information_ratio": round(ir_obs, 2),
        "t_stat": round(t_stat, 2),
        "p_luck": round(p_luck, 3),
        "prob_skill_pct": prob_skill,
        "observed_percentile": pct_in_null,
        "psr_pct": psr,
        "sharpe_annual": round(_sharpe(df["p"] - df["b"]) or 0.0, 2),
        "active_skew": round(g3, 2),
        "active_excess_kurt": round(g4 - 3.0, 2),
        "years_for_significance": years_for_sig,
        "null_p5": round(float(np.percentile(null_irs, 5)), 2),
        "null_p50": round(float(np.percentile(null_irs, 50)), 2),
        "null_p95": round(float(np.percentile(null_irs, 95)), 2),
        "hist_centers": [round(float(c), 3) for c in centers],
        "hist_counts": [int(c) for c in counts],
        "n_boot": int(n_boot),
        "verdict": verdict,
    }


# ----------------------------------------------------------------------------
# orchestrator
# ----------------------------------------------------------------------------
def compute_performance_skill(
    returns: pd.DataFrame,
    weights: dict,
    benchmark: tuple | None,
    min_history: int = TRADING_DAYS,
) -> dict | None:
    """
    Build aligned portfolio + benchmark return series and run all three layers.
    Returns None when there's no benchmark or too little common history.
    """
    if not benchmark:
        return None
    bm_weights, bm_label = benchmark

    port = _basket_returns(returns, weights, min_history)
    bench = _basket_returns(returns, bm_weights, min_history)
    if port is None or bench is None:
        return None

    df = pd.concat([port, bench], axis=1, keys=["p", "b"]).dropna()
    if len(df) < min_history:
        return None
    p, b = df["p"], df["b"]

    return {
        "model": "Performance & skill vs benchmark (returns-based, public data)",
        "benchmark_label": bm_label,
        "n_obs": int(len(df)),
        "years": round(len(df) / TRADING_DAYS, 1),
        "first_date": df.index[0].strftime("%Y-%m-%d"),
        "last_date": df.index[-1].strftime("%Y-%m-%d"),
        "metrics": compute_performance_metrics(p, b),
        "regime_alpha": compute_regime_conditional_alpha(p, b),
        "skill_vs_luck": compute_skill_vs_luck(p, b),
    }
