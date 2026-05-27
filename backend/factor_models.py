"""
Fama-French 5-factor + Momentum (Carhart-extended) regression for sector ETFs.

Why this exists:
  We can't (and don't want to) license Barra GEMLT / Northfield / Axioma. But
  factor risk attribution doesn't require a commercial model — Fama-French
  factors are publicly published by Ken French (Dartmouth) and the
  regression methodology is standard OLS. The output (factor loadings,
  factor-attributable variance, idiosyncratic vol, alpha) is conceptually
  the same as a Barra-style attribution: smaller universe, fewer factors,
  no industry-within-country granularity, but legitimate and auditable.

References:
  Fama, French (1993)  "Common Risk Factors in the Returns on Stocks and Bonds"
  Carhart    (1997)    "On Persistence in Mutual Fund Performance"
  Fama, French (2015)  "A Five-Factor Asset Pricing Model"

Data source:
  Ken French Data Library, daily factors, free + public:
    https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html
"""

from __future__ import annotations
import io
import os
import zipfile
import urllib.request

import numpy as np
import pandas as pd
from scipy.stats import t as student_t


FF5_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"
MOM_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_daily_CSV.zip"

CACHE_DIR  = os.path.join(os.path.dirname(__file__), "cache")
CACHE_PATH = os.path.join(CACHE_DIR, "ff_carhart_daily.csv")

# Factor columns in the order we report them in
FACTOR_COLS = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "MOM"]

# Display labels — Mkt-RF is the canonical name in Ken French's data
# but reads better as "Market" in the UI.
FACTOR_LABELS = {
    "Mkt-RF": "Market (Mkt-Rf)",
    "SMB":    "Small minus Big (SMB)",
    "HML":    "High minus Low (HML)",
    "RMW":    "Robust minus Weak (RMW)",
    "CMA":    "Conservative minus Aggressive (CMA)",
    "MOM":    "Momentum (MOM)",
}


def _fetch_french_zip(url: str, timeout: int = 30) -> str:
    """Download a Ken French zipped CSV and return its decoded text content."""
    req = urllib.request.Request(url, headers={"User-Agent": "RiskLens/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        name = zf.namelist()[0]
        with zf.open(name) as f:
            return f.read().decode("latin-1")


def _parse_french_csv(text: str, header_hint: str) -> pd.DataFrame:
    """
    Pull the daily-data block out of a Ken French CSV.

    The files include preamble + the daily block + sometimes monthly/annual
    blocks below. We walk to a row that looks like the header (starts with
    a comma — the index column has no name), then collect rows that begin
    with an 8-digit YYYYMMDD date, stopping at the first non-date row.
    """
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip().startswith(",") and header_hint in line:
            start = i
            break
    if start is None:
        raise ValueError(f"Couldn't find header containing {header_hint!r}")

    data_block = [lines[start]]
    for line in lines[start + 1:]:
        s = line.strip()
        if not s:
            break
        first = s.split(",")[0].strip()
        if not (first.isdigit() and len(first) == 8):
            break
        data_block.append(line)

    df = pd.read_csv(io.StringIO("\n".join(data_block)), index_col=0)
    df.index = pd.to_datetime(df.index.astype(str), format="%Y%m%d")
    df.columns = [c.strip() for c in df.columns]
    return df


def fetch_ff_carhart_daily(use_cache_on_fail: bool = True) -> pd.DataFrame:
    """
    Fetch Fama-French 5-factor + Momentum daily data, merged, in DECIMAL units.

    Ken French's files report values as percent (e.g. 1.5 = 1.5%). We divide
    by 100 here so the regression and downstream calcs operate on decimals
    — matches the convention of log returns used elsewhere in the pipeline.

    Cached to backend/cache/ff_carhart_daily.csv after the first successful
    fetch. If the live download fails (Ken French site down, CI network
    issue, etc.) and a cache exists, falls back to the cache. Otherwise
    re-raises.
    """
    try:
        ff5_text = _fetch_french_zip(FF5_URL)
        mom_text = _fetch_french_zip(MOM_URL)
        ff5 = _parse_french_csv(ff5_text, "Mkt-RF")
        mom = _parse_french_csv(mom_text, "Mom")

        # Sometimes the momentum column comes back as "Mom" — normalize to MOM
        mom = mom.rename(columns={c: "MOM" for c in mom.columns if c.upper().startswith("MOM")})

        df = ff5.join(mom, how="inner")
        df = df[FACTOR_COLS + ["RF"]] / 100.0  # percent -> decimal

        # Cache successful fetch
        os.makedirs(CACHE_DIR, exist_ok=True)
        df.to_csv(CACHE_PATH)
        return df

    except Exception as e:
        if use_cache_on_fail and os.path.exists(CACHE_PATH):
            print(f"  WARNING: live fetch failed ({e}); falling back to cached factors")
            df = pd.read_csv(CACHE_PATH, index_col=0, parse_dates=True)
            return df
        raise


def fit_ff_carhart(
    returns: pd.Series,
    factors: pd.DataFrame,
    lookback: int = 252,
) -> dict | None:
    """
    Run an OLS regression of excess returns on the FF5 + Momentum factors.

    Methodology:
      excess_t = R_t - RF_t                                         (excess return)
      excess_t = α + β_mkt*MktRf_t + ... + β_mom*MOM_t + ε_t        (model)

    Output mirrors what a Barra-style attribution gives you:
      - per-factor loadings with t-stats and p-values
      - R² and alpha (with t-stat / p-value)
      - factor-attributable vol vs idiosyncratic vol vs total vol
        (decomposed via σ_idio² = σ_total² × (1 − R²))

    All vols reported annualized in percent (multiply daily by √252 × 100).
    Returns None if the aligned series is too short or contains no variance.
    """
    df = factors[FACTOR_COLS + ["RF"]].copy()
    aligned = returns.to_frame("R").join(df, how="inner").dropna()
    aligned = aligned.tail(lookback)
    n = len(aligned)
    if n < 60:
        return None

    y = aligned["R"].to_numpy() - aligned["RF"].to_numpy()     # excess return
    X_factors = aligned[FACTOR_COLS].to_numpy()
    X = np.column_stack([np.ones(n), X_factors])                # add intercept

    # OLS via normal equations (small problem, numerically stable enough)
    beta_hat, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    y_pred = X @ beta_hat
    eps    = y - y_pred
    k      = X.shape[1]
    df_resid = n - k

    rss = float((eps ** 2).sum())
    tss = float(((y - y.mean()) ** 2).sum())
    if tss <= 0:
        return None
    r_squared = 1.0 - rss / tss

    sigma2_eps = rss / df_resid
    try:
        cov_beta = sigma2_eps * np.linalg.inv(X.T @ X)
    except np.linalg.LinAlgError:
        return None
    se     = np.sqrt(np.diag(cov_beta))
    tstats = beta_hat / se
    pvals  = 2.0 * (1.0 - student_t.cdf(np.abs(tstats), df=df_resid))

    # Vol decomposition (annualized percent)
    sigma_total_daily = float(np.std(y, ddof=1))
    sigma_total_ann   = sigma_total_daily * np.sqrt(252) * 100
    sigma_idio_ann    = np.sqrt(sigma2_eps) * np.sqrt(252) * 100
    sigma_factor_ann  = float(np.sqrt(max(0.0, sigma_total_ann ** 2 - sigma_idio_ann ** 2)))
    factor_pct_share  = 100.0 * (sigma_factor_ann ** 2) / max(1e-9, sigma_total_ann ** 2)

    loadings = [
        {
            "factor":      FACTOR_COLS[i],
            "label":       FACTOR_LABELS[FACTOR_COLS[i]],
            "beta":        round(float(beta_hat[i + 1]), 4),
            "tstat":       round(float(tstats[i + 1]), 2),
            "p_value":     round(float(pvals[i + 1]), 4),
            "significant": bool(pvals[i + 1] < 0.05),
        }
        for i in range(len(FACTOR_COLS))
    ]

    return {
        "model":                       "Fama-French 5 + Momentum (Carhart-extended)",
        "lookback_days":               int(n),
        "first_date":                  aligned.index[0].strftime("%Y-%m-%d"),
        "last_date":                   aligned.index[-1].strftime("%Y-%m-%d"),
        "r_squared":                   round(float(r_squared), 4),
        "alpha_daily_pct":             round(float(beta_hat[0]) * 100, 4),
        "alpha_annualized_pct":        round(float(beta_hat[0]) * 252 * 100, 2),
        "alpha_tstat":                 round(float(tstats[0]), 2),
        "alpha_pvalue":                round(float(pvals[0]), 4),
        "alpha_significant":           bool(pvals[0] < 0.05),
        "total_vol_annualized_pct":    round(sigma_total_ann, 2),
        "factor_vol_annualized_pct":   round(sigma_factor_ann, 2),
        "idio_vol_annualized_pct":     round(sigma_idio_ann, 2),
        "factor_variance_share_pct":   round(factor_pct_share, 1),
        "loadings":                    loadings,
    }


def compute_rolling_ff_loadings(
    returns: pd.Series,
    factors: pd.DataFrame,
    window: int = 252,
    step: int = 21,
    lookback_years: int = 5,
) -> dict | None:
    """
    Roll the FF/Carhart regression across time to capture factor-loading
    drift — the medium-horizon analog of `fit_ff_carhart`.

    For each step (default monthly, ~21 trading days), fit the six-factor
    regression on the trailing `window` days of returns. Return the time
    series of loadings + R² over the last `lookback_years`.

    Why this matters for a PM/PIO at a long-horizon shop:
      A single FF regression tells you the *current* factor exposure
      profile of an asset. Whether the asset is still doing what it was
      bought to do depends on whether those exposures have shifted over
      months-to-years — the cycle horizon at which sector rotations,
      style regimes, and thesis drift actually play out.

    A "style drift" alert is computed per factor: if the most recent
    loading is more than 1 standard deviation from its mean across the
    rolling history, the factor is flagged as having shifted.

    Returns None if there isn't enough overlap between the asset returns
    and the factor data for the requested lookback.
    """
    df = factors[FACTOR_COLS + ["RF"]].copy()
    aligned = returns.to_frame("R").join(df, how="inner").dropna()
    needed = window + step * 4  # bare minimum to get a few rolling fits
    if len(aligned) < needed:
        return None

    lookback_days = lookback_years * 252
    aligned = aligned.tail(lookback_days + window)
    n = len(aligned)
    if n < window + step:
        return None

    # Rolling fits: anchor at the END of each window, step backward by
    # `step` days, walk forward in time so the output is chronological.
    anchor_positions = list(range(window, n, step))
    if not anchor_positions:
        return None

    snapshots = []
    for end_idx in anchor_positions:
        start_idx = end_idx - window
        slab = aligned.iloc[start_idx:end_idx]
        y = slab["R"].to_numpy() - slab["RF"].to_numpy()
        X = np.column_stack([np.ones(len(slab)), slab[FACTOR_COLS].to_numpy()])
        try:
            beta_hat, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
        except np.linalg.LinAlgError:
            continue
        eps = y - X @ beta_hat
        tss = float(((y - y.mean()) ** 2).sum())
        rss = float((eps ** 2).sum())
        r_squared = 1.0 - rss / tss if tss > 0 else None

        snapshot = {
            "date":            slab.index[-1].strftime("%Y-%m-%d"),
            "alpha_daily_pct": round(float(beta_hat[0]) * 100, 4),
            "r_squared":       round(float(r_squared), 4) if r_squared is not None else None,
        }
        for i, f in enumerate(FACTOR_COLS):
            snapshot[f] = round(float(beta_hat[i + 1]), 4)
        snapshots.append(snapshot)

    if len(snapshots) < 4:
        return None

    # Long-run summary stats per factor: mean + std across the rolling
    # series. The frontend uses these to draw reference lines and to
    # surface "style drift" alerts when the latest loading is unusually
    # far from its own long-run mean.
    factor_arrays = {f: np.array([s[f] for s in snapshots]) for f in FACTOR_COLS}
    long_run_means = {f: float(np.mean(arr)) for f, arr in factor_arrays.items()}
    long_run_stds  = {f: float(np.std(arr, ddof=1)) for f, arr in factor_arrays.items()}

    latest = snapshots[-1]
    drift_alerts = []
    for f in FACTOR_COLS:
        mu  = long_run_means[f]
        sd  = long_run_stds[f]
        cur = latest[f]
        if sd <= 1e-6:
            continue
        n_sd = (cur - mu) / sd
        if abs(n_sd) >= 1.0:
            drift_alerts.append({
                "factor":         f,
                "label":          FACTOR_LABELS[f],
                "current":        round(cur, 4),
                "long_run_mean":  round(mu, 4),
                "std_devs_off":   round(float(n_sd), 2),
                "direction":      "increased" if n_sd > 0 else "decreased",
            })

    return {
        "model":           "Fama-French 5 + Momentum (rolling)",
        "window_days":     int(window),
        "step_days":       int(step),
        "lookback_years":  int(lookback_years),
        "first_date":      snapshots[0]["date"],
        "last_date":       snapshots[-1]["date"],
        "n_snapshots":     len(snapshots),
        "snapshots":       snapshots,
        "long_run_means":  {f: round(v, 4) for f, v in long_run_means.items()},
        "long_run_stds":   {f: round(v, 4) for f, v in long_run_stds.items()},
        "factor_labels":   FACTOR_LABELS,
        "drift_alerts":    drift_alerts,
    }


def compute_beta(returns: pd.Series, mkt_returns: pd.Series, lookback: int = 252) -> float | None:
    """Simple OLS beta of `returns` on `mkt_returns`, trailing `lookback` days."""
    aligned = pd.concat([returns, mkt_returns], axis=1, join="inner").dropna().tail(lookback)
    if len(aligned) < 60:
        return None
    r  = aligned.iloc[:, 0].to_numpy()
    m  = aligned.iloc[:, 1].to_numpy()
    cov = np.cov(r, m, ddof=1)
    if cov[1, 1] <= 0:
        return None
    return round(float(cov[0, 1] / cov[1, 1]), 4)
