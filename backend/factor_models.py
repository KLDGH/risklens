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
    are wider and better calibrated in those regimes.

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


def compute_orthogonal_factor_cascade(
    returns: pd.Series,
    factors: pd.DataFrame,
    order: list | None = None,
    lookback: int = 252,
) -> dict | None:
    """
    Sequential (Gram-Schmidt) orthogonalization of the FF5 + Momentum factors,
    then regress excess returns on the orthogonalized set.

    Why, alongside the standard OLS regression (fit_ff_carhart):
      The factors are correlated — the market overlaps everything; HML, RMW and
      CMA overlap each other. Plain OLS still returns a loading per factor, but
      the shared variance inflates the standard errors (the wide CIs on a name
      like XLE) and makes each factor's marginal contribution ambiguous: the
      betas trade off against one another.

      The cascade fixes an order (default: Mkt-RF, SMB, HML, RMW, CMA, MOM),
      orthogonalizes each factor against the ones before it, and regresses on
      the orthogonal set. Because the regressors are now uncorrelated:
        - each loading is unambiguous (no multicollinearity inflation)
        - R² decomposes additively — factor k contributes exactly its own
          incremental variance, and the pieces sum to the model R² with no
          overlap and no double-counting
        - the result is auditable: you read off how much NEW variance each
          factor explains beyond the factors above it

    Tradeoff (disclosed): the decomposition is ORDER-DEPENDENT. The first
    factor absorbs all the variance it shares with later ones, so the loadings
    read as "marginal beyond the factors above," not standalone betas. For raw
    symmetric exposures the OLS view is the right one; this is the clean
    variance attribution that sits next to it.

    Returns None if the aligned series is too short.
    """
    cols = order or FACTOR_COLS
    df = factors[FACTOR_COLS + ["RF"]].copy()
    aligned = returns.to_frame("R").join(df, how="inner").dropna().tail(lookback)
    n = len(aligned)
    if n < 60:
        return None

    y_raw = aligned["R"].to_numpy() - aligned["RF"].to_numpy()   # excess return
    y = y_raw - y_raw.mean()                                      # centered
    F = np.column_stack([aligned[c].to_numpy() for c in cols])   # n x k
    F = F - F.mean(axis=0, keepdims=True)                        # center factors
    k = F.shape[1]

    # Modified Gram-Schmidt: Q[:, j] = part of F[:, j] orthogonal to F[:, <j].
    Q = np.zeros_like(F)
    for j in range(k):
        v = F[:, j].copy()
        for i in range(j):
            qi = Q[:, i]
            denom = float(qi @ qi)
            if denom > 0:
                v = v - (float(qi @ v) / denom) * qi
        Q[:, j] = v

    var_y = float(y @ y) / (n - 1)
    if var_y <= 0:
        return None

    # Orthogonal regressors → each loading is independent of the others.
    # Incremental variance share of factor j = corr(y, Q_j)^2 (the part of the
    # model R² that factor j alone adds). With orthogonal Q these sum to R².
    sigma2_eps_full = None
    cascade = []
    cum_r2 = 0.0
    resid = y.copy()
    for j in range(k):
        qj = Q[:, j]
        qq = float(qj @ qj)
        if qq <= 1e-18:
            beta_j = 0.0
            incr_r2 = 0.0
        else:
            beta_j = float(qj @ y) / qq            # loading on orthogonalized factor
            incr_r2 = (beta_j ** 2) * qq / float(y @ y)   # share of total variance
            resid = resid - beta_j * qj
        cum_r2 += incr_r2
        cascade.append({
            "factor":          cols[j],
            "label":           FACTOR_LABELS[cols[j]],
            "step":            j + 1,
            "ortho_loading":   round(beta_j, 4),
            "incr_var_pct":    round(100.0 * incr_r2, 2),    # NEW variance explained, beyond prior
            "cumulative_r2_pct": round(100.0 * cum_r2, 2),
        })

    model_r2 = cum_r2
    # Share of EXPLAINED variance (sums to 100 across factors) — the intuitive
    # "of what the factors explain, how it splits" read.
    for c in cascade:
        c["share_of_explained_pct"] = (
            round(100.0 * (c["incr_var_pct"] / 100.0) / model_r2, 1) if model_r2 > 0 else None
        )

    rss = float(resid @ resid)
    df_resid = n - k - 1
    alpha = float(y_raw.mean())   # intercept ~ mean excess (factors centered)

    return {
        "model":               "FF5 + Momentum orthogonal cascade (sequential / Gram-Schmidt)",
        "lookback_days":       int(n),
        "first_date":          aligned.index[0].strftime("%Y-%m-%d"),
        "last_date":           aligned.index[-1].strftime("%Y-%m-%d"),
        "order":               list(cols),
        "model_r2_pct":        round(100.0 * model_r2, 2),
        "alpha_daily_pct":     round(alpha * 100, 4),
        "alpha_annualized_pct": round(alpha * 252 * 100, 2),
        "cascade":             cascade,
        "notes": [
            "Each factor's incr_var_pct is the NEW share of return variance it "
            "explains beyond the factors above it; the steps sum to the model R² "
            "with no overlap.",
            "Order-dependent (default market-first): the first factor absorbs the "
            "variance it shares with later ones. Loadings are marginal-beyond-prior, "
            "not standalone betas — the OLS view holds the symmetric exposures.",
        ],
    }


def compute_factor_risk_decomposition(
    returns: pd.DataFrame,
    weights: dict,
    factors: pd.DataFrame,
    names: dict | None = None,
    lookback: int = 252,
) -> dict | None:
    """
    Split a stock-basket portfolio's risk into systematic factor risk vs.
    stock-specific (idiosyncratic) risk via the FF5 + Momentum factor risk
    model:

        Sigma  =  B Sigma_f Bᵀ  +  D

      B        holdings x factors loading matrix (per-name OLS, excess returns)
      Sigma_f  factor return covariance (daily, sample)
      D        diagonal of per-name residual variances (idiosyncratic)

    Portfolio variance under the model:
        var_model = (Bᵀw)ᵀ Sigma_f (Bᵀw)  +  sum_i w_i^2 D_ii
                  = systematic_var          +  specific_var

    Every contribution returned sums to its total exactly (Euler allocation):
      - per holding: factor-risk and stock-specific contributions to model var
      - per factor:  each factor's share of systematic var (net loading Bᵀw)

    The stock-specific share per holding answers "is this name's risk in the
    book shared factor exposure or its own residual" — the second is where a
    manager's name-specific positioning shows up.

    Diagonal D assumes uncorrelated residuals; `model_capture_pct` reports
    how much of the realized portfolio variance the diagonal model reproduces,
    so the size of that assumption is visible rather than hidden. Equity
    factors only — intended for individual-stock baskets.

    Returns None if fewer than 2 holdings overlap the factor history for the
    requested window, or the model variance is degenerate.
    """
    avail = [t for t in weights if t in returns.columns and weights.get(t, 0) > 0]
    if len(avail) < 2:
        return None

    raw_w = np.array([weights[t] for t in avail], dtype=float)
    if raw_w.sum() <= 0:
        return None
    w = raw_w / raw_w.sum()
    N = len(avail)

    F = factors[FACTOR_COLS + ["RF"]].copy()
    panel = returns[avail].join(F, how="inner").dropna().tail(lookback)
    if len(panel) < 60:
        return None
    n = len(panel)

    Fm = panel[FACTOR_COLS].to_numpy()           # n x 6
    rf = panel["RF"].to_numpy()                  # n
    Sigma_f = np.cov(Fm, rowvar=False, ddof=1)   # 6 x 6 (PSD)

    X = np.column_stack([np.ones(n), Fm])        # n x 7 (intercept + factors)
    k = X.shape[1]
    if n - k < 5:
        return None

    n_factors = len(FACTOR_COLS)
    B        = np.zeros((N, n_factors))
    idio_var = np.zeros(N)
    r2       = np.zeros(N)
    excess   = np.zeros((n, N))

    for i, t in enumerate(avail):
        y = panel[t].to_numpy() - rf             # excess return
        excess[:, i] = y
        beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
        e = y - X @ beta
        B[i]        = beta[1:]
        idio_var[i] = float(e @ e) / (n - k)     # unbiased residual variance
        tss = float(((y - y.mean()) ** 2).sum())
        r2[i] = (1.0 - float(e @ e) / tss) if tss > 0 else 0.0

    # Portfolio net factor exposure and systematic variance.
    net_beta = B.T @ w                            # Bᵀw  (6-vector)
    Sf_nb    = Sigma_f @ net_beta                 # Sigma_f (Bᵀw)
    systematic_var = float(net_beta @ Sf_nb)      # (Bᵀw)ᵀ Sigma_f (Bᵀw)

    # Idiosyncratic (diagonal-D) variance.
    idio_contrib   = (w ** 2) * idio_var          # per-holding w_i^2 D_ii
    specific_var   = float(idio_contrib.sum())

    model_var = systematic_var + specific_var
    if model_var <= 0:
        return None

    # Realized portfolio excess variance — diagnostic for the diagonal-D gap.
    port_excess  = excess @ w
    realized_var = float(np.var(port_excess, ddof=1))

    # Per-holding systematic contribution (Euler on systematic_var):
    #   c_i = w_i (B Sigma_f Bᵀ w)_i ,  sum_i c_i = systematic_var
    syst_marg    = B @ Sf_nb                       # (B Sigma_f Bᵀ w)_i
    syst_contrib = w * syst_marg

    # Per-factor systematic contribution (Euler on factors):
    #   f_k = netbeta_k (Sigma_f netbeta)_k ,  sum_k f_k = systematic_var
    factor_contrib = net_beta * Sf_nb

    def ann(v: float) -> float:
        return round(float(np.sqrt(max(0.0, v) * 252.0) * 100.0), 2)

    def share(num: float, den: float) -> float | None:
        return round(float(100.0 * num / den), 1) if den not in (0, 0.0) else None

    holdings_out = []
    for i, t in enumerate(avail):
        own = float(syst_contrib[i] + idio_contrib[i])    # contrib to model_var
        holdings_out.append({
            "ticker":               t,
            "name":                 (names or {}).get(t, t),
            "weight_pct":           round(float(w[i]) * 100.0, 2),
            "r_squared":            round(float(r2[i]), 4),
            "factor_contrib_pct":   share(float(syst_contrib[i]), model_var),
            "specific_contrib_pct": share(float(idio_contrib[i]), model_var),
            "total_contrib_pct":    share(own, model_var),
            "specific_share_pct":   share(float(idio_contrib[i]), own) if own > 0 else None,
        })
    holdings_out.sort(key=lambda h: (h["total_contrib_pct"] or 0.0), reverse=True)

    factors_out = []
    for j, fc in enumerate(FACTOR_COLS):
        factors_out.append({
            "factor":          fc,
            "label":           FACTOR_LABELS[fc],
            "net_beta":        round(float(net_beta[j]), 4),
            "var_contrib_pct": share(float(factor_contrib[j]), systematic_var),
            "of_total_pct":    share(float(factor_contrib[j]), model_var),
        })
    factors_out.sort(key=lambda f: abs(f["var_contrib_pct"] or 0.0), reverse=True)

    return {
        "model":                          "FF5 + Momentum factor risk model (Sigma = B Sigma_f Bᵀ + D)",
        "lookback_days":                  int(n),
        "first_date":                     panel.index[0].strftime("%Y-%m-%d"),
        "last_date":                      panel.index[-1].strftime("%Y-%m-%d"),
        "n_holdings":                     int(N),
        "systematic_vol_annualized_pct":  ann(systematic_var),
        "specific_vol_annualized_pct":    ann(specific_var),
        "model_total_vol_annualized_pct": ann(model_var),
        "realized_total_vol_annualized_pct": ann(realized_var),
        "systematic_share_pct":           share(systematic_var, model_var),
        "specific_share_pct":             share(specific_var, model_var),
        "model_capture_pct":              share(model_var, realized_var),
        "holdings":                       holdings_out,
        "factors":                        factors_out,
        "notes": [
            "Variance split into shared factor exposure (B Sigma_f Bᵀ) and "
            "stock-specific residual (diagonal D). Excess returns vs. the daily "
            "risk-free rate; vols annualized.",
            "Diagonal D assumes uncorrelated residuals. model_capture_pct is the "
            "share of realized portfolio variance the diagonal model reproduces; "
            "under 100% means residuals co-move, over 100% means they offset.",
            "This is a variance decomposition, not the headline VaR — the VaR "
            "columns use the full empirical/EWMA covariance, not a factor model.",
        ],
    }


def compute_factor_risk_bridge(
    returns: pd.DataFrame,
    weights: dict,
    factors: pd.DataFrame,
    max_window: int = 252,
    min_window: int = 90,
) -> dict | None:
    """
    Attribute the CHANGE in a stock basket's modeled risk between two adjacent
    windows ("then" vs "now") to its drivers — a risk bridge.

    Holding the basket's weights fixed at the current disclosure (historical
    weights aren't observable), the FF5 + Momentum factor risk model gives the
    modeled variance in each window:

        var = (Bᵀw)ᵀ Sigma_f (Bᵀw) + sum_i w_i^2 D_ii   (systematic + specific)

    The change var_now - var_then splits cleanly into three additive pieces
    (sequential / Type-I attribution):

      exposure     ΔB     the basket's net factor loadings drifted (style drift)
      factor_vol   ΔSigma_f  the factors themselves grew or calmed (regime)
      specific     ΔD     stock-specific (idiosyncratic) variance changed

      exposure + factor_vol = Δ systematic ;  + specific = Δ total   (exact)

    This is pure ex-post explanation of a past move — not a forecast.

    Windows: two adjacent, equal, non-overlapping blocks of length
    min(n_total/2, max_window). Returns None if that length is below
    min_window (too little history to compare — e.g. very young baskets).
    """
    avail = [t for t in weights if t in returns.columns and weights.get(t, 0) > 0]
    if len(avail) < 2:
        return None
    raw_w = np.array([weights[t] for t in avail], dtype=float)
    if raw_w.sum() <= 0:
        return None
    w = raw_w / raw_w.sum()
    N = len(avail)

    panel = returns[avail].join(factors[FACTOR_COLS + ["RF"]], how="inner").dropna()
    n_total = len(panel)
    win = min(n_total // 2, max_window)
    if win < min_window:
        return None

    now  = panel.tail(win)
    then = panel.iloc[-2 * win:-win]

    def block(sub: pd.DataFrame):
        """Per-window factor block: net beta, factor cov, idiosyncratic variances."""
        Fm = sub[FACTOR_COLS].to_numpy()
        rf = sub["RF"].to_numpy()
        Sigma_f = np.cov(Fm, rowvar=False, ddof=1)
        X = np.column_stack([np.ones(len(sub)), Fm])
        k = X.shape[1]
        B = np.zeros((N, len(FACTOR_COLS)))
        idio = np.zeros(N)
        for i, t in enumerate(avail):
            y = sub[t].to_numpy() - rf
            beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
            e = y - X @ beta
            B[i] = beta[1:]
            idio[i] = float(e @ e) / (len(sub) - k)
        return B, Sigma_f, idio

    B0, Sf0, D0 = block(then)
    B1, Sf1, D1 = block(now)

    nb0, nb1 = B0.T @ w, B1.T @ w
    sys_then = float(nb0 @ Sf0 @ nb0)
    sys_now  = float(nb1 @ Sf1 @ nb1)
    idio_then = float((w ** 2) @ D0)
    idio_now  = float((w ** 2) @ D1)
    var_then = sys_then + idio_then
    var_now  = sys_now + idio_now
    if var_then <= 0 or var_now <= 0:
        return None

    # Sequential attribution: exposure shift at the OLD factor cov, then the
    # factor-vol shift at the NEW exposure. exposure + factor_vol = Δsystematic.
    d_exposure  = float(nb1 @ Sf0 @ nb1) - sys_then
    d_factorvol = sys_now - float(nb1 @ Sf0 @ nb1)
    d_specific  = idio_now - idio_then
    d_total     = var_now - var_then

    def ann(v: float) -> float:
        return round(float(np.sqrt(max(0.0, v) * 252.0) * 100.0), 2)

    vol_then = ann(var_then)
    vol_now  = ann(var_now)
    d_vol    = round(vol_now - vol_then, 2)

    # Allocate the net vol change across the three drivers in proportion to
    # their share of the variance change (vol isn't additive; this is an
    # approximate, sign-consistent split that sums to d_vol exactly).
    def vol_points(dv: float) -> float | None:
        if abs(d_total) < 1e-18:
            return None
        return round(d_vol * (dv / d_total), 2)

    comp_defs = [
        ("exposure",   "Factor-exposure drift",     d_exposure),
        ("factor_vol", "Factor-volatility regime",  d_factorvol),
        ("specific",   "Stock-specific risk",       d_specific),
    ]
    components = [
        {
            "key":        key,
            "label":      label,
            "delta_var":  dv,
            "vol_points": vol_points(dv),
            "share_pct":  (round(100.0 * dv / d_total, 1) if abs(d_total) >= 1e-18 else None),
            "direction":  "raised" if dv > 0 else ("lowered" if dv < 0 else "flat"),
        }
        for key, label, dv in comp_defs
    ]
    dominant = max(components, key=lambda c: abs(c["delta_var"]))["key"]

    return {
        "model":          "Factor risk change attribution (now vs prior window)",
        "n_holdings":     int(N),
        "window_days":    int(win),
        "then_first_date": then.index[0].strftime("%Y-%m-%d"),
        "then_last_date":  then.index[-1].strftime("%Y-%m-%d"),
        "now_first_date":  now.index[0].strftime("%Y-%m-%d"),
        "now_last_date":   now.index[-1].strftime("%Y-%m-%d"),
        "vol_then_pct":   vol_then,
        "vol_now_pct":    vol_now,
        "delta_vol_pct":  d_vol,
        "systematic_then_vol_pct": ann(sys_then),
        "systematic_now_vol_pct":  ann(sys_now),
        "specific_then_vol_pct":   ann(idio_then),
        "specific_now_vol_pct":    ann(idio_now),
        "components":     components,
        "dominant":       dominant,
        "notes": [
            "Weights held at the current disclosure — this isolates the change "
            "in factor exposures and volatilities, not rebalancing (historical "
            "basket weights aren't observable).",
            "exposure + factor_vol + stock-specific sum to the total variance "
            "change exactly. Vol points are an approximate split of the net vol "
            "move (vol isn't additive across drivers); they sum to the net.",
            "Two adjacent " + str(win) + "-day windows. Short windows are "
            "noisier — read the direction, not the third decimal.",
        ],
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

    What this adds over a single regression:
      A single FF regression gives the *current* factor exposure
      profile. Whether exposures have shifted over months-to-years
      shows sector rotation, style-regime, and drift effects a
      snapshot misses.

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
#   rigorous but interpretively abstract. A "+0.4 HML loading" is harder
#   to map to a narrative than a "+0.6 oil-shock exposure." Banks
#   (Goldman, Morgan Stanley, JPM) publish
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
