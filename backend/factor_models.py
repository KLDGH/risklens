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


def _paired_bootstrap_betas(
    X: np.ndarray,
    y: np.ndarray,
    n_boot: int = 500,
    seed: int = 17,
) -> np.ndarray | None:
    """
    Paired (case-resampling) bootstrap for OLS coefficients.

    Resample (X_i, y_i) rows with replacement, refit OLS via least-squares,
    and collect the coefficient vector across replicates. Returns an
    (n_boot, k) array of bootstrap β draws, or None if any replicate is
    singular.

    The "paired" flavor (as opposed to residual bootstrap) is robust to
    heteroskedasticity — daily equity returns are obviously not
    homoskedastic, so the analytical OLS SEs systematically understate
    estimator variance during volatile sub-windows. The bootstrap CIs
    are wider and more honest in those regimes.

    B=500 is enough for stable 95% percentile bounds at our problem
    size (~250 obs, ~6 factors); doubling to 1000 changes the displayed
    CI by less than the rounding precision (3 decimals).
    """
    n, k = X.shape
    rng = np.random.default_rng(seed)
    betas = np.empty((n_boot, k))
    for b in range(n_boot):
        idx = rng.integers(0, n, n)
        Xb = X[idx]
        yb = y[idx]
        try:
            beta_b, _, _, _ = np.linalg.lstsq(Xb, yb, rcond=None)
        except np.linalg.LinAlgError:
            return None
        betas[b] = beta_b
    return betas


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

    # Paired bootstrap CIs — heteroskedasticity-robust complement to the
    # analytical OLS SEs above. The 2.5th/97.5th percentile bounds are
    # surfaced in the frontend as β ± uncertainty. We report both the
    # bootstrap SE (for ± formatting) and the explicit percentile
    # bounds (so wide-but-skewed CIs read correctly).
    boot_betas = _paired_bootstrap_betas(X, y, n_boot=500)
    if boot_betas is not None:
        boot_se   = np.std(boot_betas, axis=0, ddof=1)
        ci_low    = np.percentile(boot_betas, 2.5, axis=0)
        ci_high   = np.percentile(boot_betas, 97.5, axis=0)
    else:
        # Fall back to analytical normal-approximation CIs if any
        # bootstrap replicate hit a singular design matrix.
        boot_se = se
        ci_low  = beta_hat - 1.96 * se
        ci_high = beta_hat + 1.96 * se

    # Vol decomposition (annualized percent). Derive the factor/idiosyncratic
    # split directly from R² so the decomposition is internally consistent:
    # factor² + idio² = total², and the factor variance share is exactly R².
    # (Previously sigma_idio used the (n-k)-adjusted residual variance while
    # sigma_total used the ddof=1 sample variance, so the share didn't equal R².)
    sigma_total_daily = float(np.std(y, ddof=1))
    sigma_total_ann   = sigma_total_daily * np.sqrt(252) * 100
    sigma_factor_ann  = sigma_total_ann * np.sqrt(max(0.0, r_squared))
    sigma_idio_ann    = sigma_total_ann * np.sqrt(max(0.0, 1.0 - r_squared))
    factor_pct_share  = 100.0 * max(0.0, r_squared)

    loadings = [
        {
            "factor":      FACTOR_COLS[i],
            "label":       FACTOR_LABELS[FACTOR_COLS[i]],
            "beta":        round(float(beta_hat[i + 1]), 4),
            "tstat":       round(float(tstats[i + 1]), 2),
            "p_value":     round(float(pvals[i + 1]), 4),
            "significant": bool(pvals[i + 1] < 0.05),
            "boot_se":     round(float(boot_se[i + 1]), 4),
            "ci_low":      round(float(ci_low[i + 1]),  4),
            "ci_high":     round(float(ci_high[i + 1]), 4),
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


# ---------------------------------------------------------------------------
# Thematic-basket exposure regression.
#
# Why this exists alongside the Fama-French regression:
#   FF/Carhart factors (Mkt-Rf, SMB, HML, RMW, CMA, MOM) are academically
#   rigorous but interpretively abstract. Telling a PM "your stock has
#   +0.4 HML loading" is less actionable than "your stock has +0.6
#   oil-shock exposure." Banks (Goldman, Morgan Stanley, JPM) publish
#   thematic "factor baskets" (oil exposure, China exposure, regional-
#   banking-stress) that map directly to narrative risk drivers. Those
#   baskets are mostly proprietary but their character can be approximated
#   from public sector-ETF returns:
#
#     XLE  → oil-price shock
#     XLF  → financials beta / bank-sector stress
#     KRE  → regional-banking-specific (SVB-style) stress
#     SMH  → semiconductor cycle / Taiwan-supply exposure
#     XLK  → broad tech / mega-cap-growth
#     XLU  → duration / rates-sensitive defensive
#     XLP  → consumer-staples defensive
#     XLRE → real-estate / rates-sensitive long-duration
#     TLT  → long-duration Treasuries / safe-haven
#     EFA  → international developed equity
#     EEM  → emerging-markets / China-sensitive
#     HYG  → high-yield credit spread
#
# Methodology:
#   The sector ETFs are highly correlated with the market (β ~ 0.85-1.2).
#   A naive multi-regression has multicollinearity problems. So we
#   orthogonalize each themed basket against the broad market first
#   (regress XLE on SPY, take residual = "the XLE-specific component
#   not explained by general US equity moves"). Then regress the target
#   asset's returns on SPY + the orthogonalized residuals. Loadings on
#   the orthogonalized baskets read as "exposure beyond what broad
#   market alone explains" — the marginal risk that's actually about
#   the theme.
#
# Output mirrors FF regression shape: per-theme loading, t-stat, p-value,
# R², and a vol-share decomposition.
# ---------------------------------------------------------------------------

THEMATIC_BASKETS = [
    ("SPY",  "US broad equity (market)"),
    ("XLE",  "Energy / oil shock"),
    ("XLF",  "Financials / bank-sector"),
    ("KRE",  "Regional banking stress"),
    ("SMH",  "Semiconductors / Taiwan supply"),
    ("XLK",  "Tech / mega-cap growth"),
    ("XLU",  "Utilities / rates-sensitive defensive"),
    ("XLP",  "Staples / defensive"),
    ("XLRE", "Real estate / duration-sensitive"),
    ("TLT",  "Long Treasuries / safe-haven"),
    ("EFA",  "International developed equity"),
    ("EEM",  "Emerging markets / China-sensitive"),
    ("HYG",  "High-yield credit"),
]


def compute_thematic_exposures(
    returns: pd.Series,
    basket_returns: dict[str, pd.Series],
    lookback: int = 252,
    exclude_self: str | None = None,
) -> dict | None:
    """
    Regress an asset's returns on a panel of orthogonalized thematic
    basket returns. Returns the loadings, R², and vol decomposition.

    `basket_returns` is a dict of {ticker: pd.Series} containing the
    daily log returns for each basket ETF. Caller is responsible for
    providing only baskets that exist in their data; missing baskets
    are silently skipped.

    `exclude_self` is the target asset's ticker. If it appears in the
    basket list (common when regressing a sector ETF that's also a
    basket), it's removed to avoid trivial self-explanation (regressing
    an asset on itself produces R²=1 and one β=1, the rest =0 — useless).

    The first basket (typically SPY) is treated as the "market" baseline
    and is NOT orthogonalized; every other basket is regressed against
    the market first and only the residual variance is used. So the
    market loading is just the market β; the other loadings read as
    "exposure beyond market beta."
    """
    if exclude_self:
        basket_returns = {k: v for k, v in basket_returns.items() if k != exclude_self}
    available_baskets = [(t, lbl) for t, lbl in THEMATIC_BASKETS
                         if t in basket_returns]
    if len(available_baskets) < 3:
        return None

    # Build aligned DataFrame of asset + all baskets
    cols = {"R": returns}
    for t, _ in available_baskets:
        cols[t] = basket_returns[t]
    aligned = pd.DataFrame(cols).dropna().tail(lookback)
    if len(aligned) < 60:
        return None
    n = len(aligned)

    market_ticker = available_baskets[0][0]   # typically SPY
    market = aligned[market_ticker].to_numpy()

    # Orthogonalize each non-market basket against the market: residual
    # = basket - β·market. Each residual stream is then the
    # "market-neutral" component of that theme.
    ortho = {market_ticker: market}
    for t, _ in available_baskets[1:]:
        b = aligned[t].to_numpy()
        cov = np.cov(b, market, ddof=1)
        if cov[1, 1] <= 0:
            continue
        beta_b_mkt = cov[0, 1] / cov[1, 1]
        ortho[t] = b - beta_b_mkt * market

    # Regress asset's excess returns on [intercept, market, orthogonalized
    # basket residuals...]. Excess returns assumed = asset return (we
    # don't strip risk-free — the intercept absorbs any constant).
    y = aligned["R"].to_numpy()
    X = np.column_stack([np.ones(n)] + list(ortho.values()))
    if X.shape[1] < 2:
        return None

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

    sigma_total_daily = float(np.std(y, ddof=1))
    sigma_total_ann   = sigma_total_daily * np.sqrt(252) * 100
    sigma_idio_ann    = np.sqrt(sigma2_eps) * np.sqrt(252) * 100
    sigma_factor_ann  = float(np.sqrt(max(0.0, sigma_total_ann ** 2 - sigma_idio_ann ** 2)))

    basket_keys = list(ortho.keys())
    label_map   = {t: lbl for t, lbl in THEMATIC_BASKETS}
    loadings = [
        {
            "basket":       basket_keys[i],
            "label":        label_map.get(basket_keys[i], basket_keys[i]),
            "is_market":    (i == 0),
            "beta":         round(float(beta_hat[i + 1]), 4),
            "tstat":        round(float(tstats[i + 1]), 2),
            "p_value":      round(float(pvals[i + 1]), 4),
            "significant":  bool(pvals[i + 1] < 0.05),
        }
        for i in range(len(basket_keys))
    ]

    return {
        "model":                       "Thematic basket regression (market-orthogonalized)",
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
        "loadings":                    loadings,
        "notes": [
            "Market loading is the raw β vs SPY (broad equity exposure).",
            "Non-market loadings are computed against market-orthogonalized "
            "basket residuals — they read as 'exposure beyond market beta.'",
            "Each basket is an ETF that approximates a thematic risk driver; "
            "see the label column for the narrative each represents.",
        ],
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
