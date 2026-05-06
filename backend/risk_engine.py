import numpy as np
import pandas as pd
from scipy.stats import norm, genpareto, chi2
from arch import arch_model

WINDOW = 1000
P = 0.01
PORTFOLIO_VALUE = 100
CAP = 100.0


def _cap(x: float) -> float:
    return min(float(x), CAP)


def var_es_hs(returns: np.ndarray, p: float = P) -> tuple[float, float]:
    """Historical Simulation VaR and ES."""
    T = len(returns)
    sorted_rets = np.sort(returns)
    idx = int(T * p)
    var = -sorted_rets[idx] * PORTFOLIO_VALUE
    es = -np.mean(sorted_rets[: idx + 1]) * PORTFOLIO_VALUE
    return _cap(var), _cap(es)


def var_es_ewma(returns: np.ndarray, p: float = P, lam: float = 0.94) -> tuple[float, float]:
    """EWMA volatility VaR and ES (normal assumption)."""
    var_t = np.var(returns[:30]) if len(returns) >= 30 else returns[0] ** 2
    for r in returns:
        var_t = (1 - lam) * r**2 + lam * var_t
    sigma = np.sqrt(var_t)

    z = norm.ppf(1 - p)
    var_val = sigma * z * PORTFOLIO_VALUE
    es_val = sigma * norm.pdf(norm.ppf(p)) / p * PORTFOLIO_VALUE
    return _cap(var_val), _cap(es_val)


def var_es_tgarch(returns: np.ndarray, p: float = P) -> tuple[float, float]:
    """GJR-GARCH(1,1,1) — asymmetric GARCH that weights negative shocks more heavily."""
    try:
        scaled = returns * 100
        am = arch_model(scaled, vol="GARCH", p=1, o=1, q=1, dist="normal", rescale=False)
        res = am.fit(disp="off", show_warning=False)
        forecast = res.forecast(horizon=1, reindex=False)
        var_forecast = forecast.variance.iloc[-1, 0]
        sigma = np.sqrt(var_forecast) / 100
        z = norm.ppf(1 - p)
        var_val = sigma * z * PORTFOLIO_VALUE
        es_val = sigma * norm.pdf(norm.ppf(p)) / p * PORTFOLIO_VALUE
        return _cap(var_val), _cap(es_val)
    except Exception:
        return var_es_ewma(returns, p)


def var_es_evt(returns: np.ndarray, p: float = P, threshold_pct: float = 0.10) -> tuple[float, float]:
    """Peaks-over-Threshold EVT using Generalized Pareto Distribution."""
    try:
        losses = -returns
        u = np.quantile(losses, 1 - threshold_pct)
        exceedances = losses[losses > u] - u
        if len(exceedances) < 10:
            return var_es_ewma(returns, p)
        xi, _, sigma = genpareto.fit(exceedances, floc=0)
        n = len(losses)
        Nu = len(exceedances)
        if abs(xi) < 1e-8:
            var = u + sigma * np.log(n / (Nu * p))
        else:
            var = u + (sigma / xi) * ((n / (Nu * p)) ** xi - 1)
        if xi < 1:
            es = (var + sigma - xi * u) / (1 - xi)
        else:
            es = var * 1.5
        return _cap(var * PORTFOLIO_VALUE), _cap(es * PORTFOLIO_VALUE)
    except Exception:
        return var_es_hs(returns, p)


def tail_index_hill(returns: np.ndarray) -> float:
    """Hill estimator for tail index alpha. Lower = fatter tails."""
    losses = np.sort(-returns)[::-1]
    k = max(10, int(len(losses) ** 0.5))
    k = min(k, len(losses) - 1)
    alpha = k / np.sum(np.log(losses[:k] / losses[k]))
    return round(float(alpha), 2)


def var_es_garch(returns: np.ndarray, p: float = P) -> tuple[float, float]:
    """GARCH(1,1) VaR and ES with fallback to EWMA."""
    try:
        scaled = returns * 100
        am = arch_model(scaled, vol="GARCH", p=1, q=1, dist="normal", rescale=False)
        res = am.fit(disp="off", show_warning=False)
        forecast = res.forecast(horizon=1, reindex=False)
        var_forecast = forecast.variance.iloc[-1, 0]
        sigma = np.sqrt(var_forecast) / 100

        z = norm.ppf(1 - p)
        var_val = sigma * z * PORTFOLIO_VALUE
        es_val = sigma * norm.pdf(norm.ppf(p)) / p * PORTFOLIO_VALUE
        return _cap(var_val), _cap(es_val)
    except Exception:
        return var_es_ewma(returns, p)


def compute_risk_level(ticker_returns: pd.Series, window: int = WINDOW) -> float:
    """
    Percentile rank of current EWMA VaR vs trailing 2-year (504 trading day) history.
    Returns a value in [0, 1].
    """
    history_window = 504
    if len(ticker_returns) < window + history_window:
        return 0.5

    ewma_vars = []
    lam = 0.94
    for i in range(history_window):
        end = len(ticker_returns) - history_window + i + 1
        start = max(0, end - window)
        chunk = ticker_returns.values[start:end]
        _, es = var_es_ewma(chunk)
        ewma_vars.append(es)

    current_var, _ = var_es_ewma(ticker_returns.values[-window:])
    rank = np.mean(np.array(ewma_vars) <= current_var)
    return float(np.clip(rank, 0.0, 1.0))


def compute_daily_ewma_var(returns: pd.Series, p: float = P, lam: float = 0.94, warmup: int = 252) -> pd.Series:
    """Daily EWMA VaR series for the full return history."""
    z = norm.ppf(1 - p)
    vals = returns.values
    var_t = np.var(vals[:warmup]) if len(vals) >= warmup else np.var(vals)
    results = np.full(len(vals), np.nan)
    for i, r in enumerate(vals):
        if i >= warmup:
            results[i] = np.sqrt(var_t) * z * PORTFOLIO_VALUE
        var_t = (1 - lam) * r ** 2 + lam * var_t
    return pd.Series(results, index=returns.index)


def compute_sp500_history(returns: pd.Series, prices: pd.Series, vix: pd.Series = None) -> list[dict]:
    """Per-year min/max EWMA VaR and annual return for the S&P 500 historical chart."""
    daily_var = compute_daily_ewma_var(returns)
    daily_var = daily_var.dropna()

    # Annual return: last price of year / first price of year - 1
    annual_ret = prices.resample("YE").last().pct_change() * 100

    # Annual average VIX per year
    vix_annual = {}
    if vix is not None:
        for year, group in vix.groupby(vix.index.year):
            vix_annual[year] = round(float(group.mean()), 2)

    rows = []
    for year, group in daily_var.groupby(daily_var.index.year):
        if len(group) < 20:
            continue
        ret = float(annual_ret[annual_ret.index.year == year].iloc[0]) if year in annual_ret.index.year else None
        rows.append({
            "year": year,
            "min_var": round(float(group.min()), 2),
            "max_var": round(float(group.max()), 2),
            "annual_return_pct": round(ret, 2) if ret is not None else None,
            "vix_avg": vix_annual.get(year),
        })
    return rows


# Tickers with sufficient history for the cross-asset correlation chart.
# Excludes BTC-USD (launched 2014) so the series starts ~2007 and captures the GFC.
CORR_TICKERS = ["SPY", "EFA", "EEM", "TLT", "LQD", "HYG", "GLD", "DBC", "VNQ", "UUP"]


def compute_portfolio_risk_history(
    prices: pd.DataFrame,
    weights: dict,
    sample_every: int = 5,
) -> list[dict]:
    """
    Daily EWMA VaR of the active portfolio over time, sampled weekly.

    Builds the weighted portfolio return series from the available tickers
    in `weights`, runs the same daily EWMA VaR computation we use elsewhere,
    and downsamples to keep the JSON manageable.

    Takes raw `prices` (not pre-computed returns) so we can compute log
    returns over only the portfolio's tickers — otherwise an unrelated
    short-history ticker (e.g. BTC-USD, launched 2014) would truncate the
    series even when the active portfolio doesn't include it.
    """
    avail = [t for t in weights if t in prices.columns]
    if not avail:
        return []

    raw_w  = np.array([weights[t] for t in avail])
    norm_w = raw_w / raw_w.sum()  # re-normalize if some tickers missing

    # Compute log returns over only the portfolio's tickers, then drop rows
    # where any of them are missing (preserves max history for each portfolio)
    sub_prices = prices[avail].dropna()
    if len(sub_prices) < 2:
        return []
    ret_df = np.log(sub_prices / sub_prices.shift(1)).dropna()

    port_rets = pd.Series(ret_df.values @ norm_w, index=ret_df.index)
    daily_var = compute_daily_ewma_var(port_rets).dropna()

    sampled = daily_var.iloc[::sample_every]
    return [
        {"date": idx.strftime("%Y-%m-%d"), "var": round(float(v), 3)}
        for idx, v in sampled.items()
    ]


def compute_rolling_correlation(returns: pd.DataFrame, window: int = 60, sample_every: int = 5) -> list[dict]:
    """
    Rolling average pairwise correlation across core ETFs.
    Returns a list of {date, avg_corr} sampled every `sample_every` trading days.
    """
    cols = [c for c in CORR_TICKERS if c in returns.columns]
    df = returns[cols].dropna()

    n = len(cols)
    results = []
    for i in range(window, len(df), sample_every):
        chunk = df.iloc[i - window:i]
        corr_matrix = chunk.corr().values
        # Mean of upper triangle (excluding diagonal)
        pairs = [corr_matrix[r, c] for r in range(n) for c in range(r + 1, n)]
        avg_corr = float(np.nanmean(pairs))
        results.append({
            "date": df.index[i].strftime("%Y-%m-%d"),
            "avg_corr": round(avg_corr, 4),
        })
    return results


def compute_var_trend(daily_var: pd.Series, days: int = 5) -> str:
    """Direction of EWMA VaR over the last `days` trading days."""
    series = daily_var.dropna()
    if len(series) < days + 1:
        return "flat"
    current = series.iloc[-1]
    past = series.iloc[-(days + 1)]
    if past == 0:
        return "flat"
    change = (current - past) / past
    if change > 0.05:
        return "up"
    elif change < -0.05:
        return "down"
    return "flat"


def compute_var_exceptions(returns: pd.Series, daily_var: pd.Series, lookback: int = 504) -> dict:
    """
    Count days in the last `lookback` trading days where actual loss exceeded EWMA VaR.
    Expected rate at 1% confidence: ~1% (~5 per year, ~10 over 2 years).
    """
    series = daily_var.dropna()
    recent_var = series.iloc[-lookback:]
    recent_ret = returns.reindex(recent_var.index)
    df = pd.DataFrame({"var": recent_var, "ret": recent_ret}).dropna()
    # Actual loss in dollar terms on $100 portfolio
    actual_loss = -df["ret"] * 100
    exceptions = int((actual_loss > df["var"]).sum())
    total = len(df)
    rate = round(exceptions / total * 100, 2) if total > 0 else 0.0
    return {"exception_count": exceptions, "exception_rate": rate}


def compute_asset_risk(ticker: str, returns: pd.Series, prices: pd.Series) -> dict:
    if len(returns) < WINDOW:
        window_rets = returns.values
    else:
        window_rets = returns.values[-WINDOW:]

    var_hs, es_hs = var_es_hs(window_rets)
    var_ewma, es_ewma = var_es_ewma(window_rets)
    var_garch, es_garch = var_es_garch(window_rets)
    var_tgarch, es_tgarch = var_es_tgarch(window_rets)
    var_evt, es_evt = var_es_evt(window_rets)
    alpha = tail_index_hill(window_rets)

    mean_var = round(float(np.mean([var_hs, var_ewma, var_garch, var_tgarch, var_evt])), 4)

    risk_level = compute_risk_level(returns)

    # Compute daily EWMA VaR series once — reused for trend and exceptions
    daily_var_series = compute_daily_ewma_var(returns)
    trend = compute_var_trend(daily_var_series)
    exc = compute_var_exceptions(returns, daily_var_series)

    last_price = float(prices.iloc[-1])
    # Use second-to-last return when the last row is a forward-fill artifact (yfinance
    # sometimes appends today's incomplete trading day with 0% change for closed markets)
    last_ret = float(returns.iloc[-1])
    if last_ret == 0.0 and len(returns) > 1:
        last_ret = float(returns.iloc[-2])
    last_return_pct = last_ret * 100

    return {
        "ticker": ticker,
        "last_price": round(last_price, 2),
        "last_return_pct": round(last_return_pct, 4),
        "var_hs": round(var_hs, 4),
        "es_hs": round(es_hs, 4),
        "var_ewma": round(var_ewma, 4),
        "es_ewma": round(es_ewma, 4),
        "var_garch": round(var_garch, 4),
        "es_garch": round(es_garch, 4),
        "var_tgarch": round(var_tgarch, 4),
        "es_tgarch": round(es_tgarch, 4),
        "var_evt": round(var_evt, 4),
        "es_evt": round(es_evt, 4),
        "tail_index": alpha,
        "mean_var": mean_var,
        "risk_level": round(risk_level, 4),
        "var_trend": trend,
        "exception_count": exc["exception_count"],
        "exception_rate": exc["exception_rate"],
    }


# ---------------------------------------------------------------------------
# Historical scenario analysis
# ---------------------------------------------------------------------------

SCENARIOS = [
    {
        "id": "gfc",
        "name": "Global Financial Crisis",
        "desc": "Lehman Brothers collapse triggers global credit freeze",
        "start": "2008-09-15",
        "end": "2009-03-09",
    },
    {
        "id": "covid",
        "name": "COVID Crash",
        "desc": "Pandemic panic selling, fastest 30% drop in S&P history",
        "start": "2020-02-20",
        "end": "2020-03-23",
    },
    {
        "id": "rate_shock_2022",
        "name": "Fed Rate Shock 2022",
        "desc": "Most aggressive hiking cycle in 40 years breaks stocks AND bonds",
        "start": "2022-01-03",
        "end": "2022-10-12",
    },
    {
        "id": "russia_ukraine",
        "name": "Russia–Ukraine Invasion",
        "desc": "Full-scale invasion triggers energy shock and risk-off selloff",
        "start": "2022-02-24",
        "end": "2022-03-14",
    },
    {
        "id": "q4_2018",
        "name": "Q4 2018 Sell-off",
        "desc": "Fed tightening fears and trade war escalation hit markets",
        "start": "2018-10-03",
        "end": "2018-12-24",
    },
]


# ---------------------------------------------------------------------------
# Hypothetical / forward-looking scenarios
# Shocks are analyst-estimated % moves per ETF under each scenario.
# These are illustrative assumptions, not forecasts.
# ---------------------------------------------------------------------------

HYPOTHETICAL_SCENARIOS = [
    {
        "id": "taiwan_invasion",
        "name": "Taiwan Invasion",
        "desc": "PLA military action triggers semiconductor supply shock and broad Asia risk-off",
        "shocks": {
            "SPY":     -0.15,
            "EFA":     -0.13,   # intl developed, Japan-heavy → Asia spillover
            "EEM":     -0.22,   # EM Asia exposure
            "QQQ":     -0.22,   # TSMC/NVDA/ASML heavy in Nasdaq
            "IWM":     -0.14,
            "IEF":     +0.05,   # flight to safety, intermediate Treasuries
            "TLT":     +0.09,   # flight to safety, rate cut expectations
            "LQD":     +0.02,
            "HYG":     -0.09,   # credit spread widening
            "TIP":     +0.04,   # real yields fall + commodity inflation
            "GLD":     +0.14,   # flight to safety
            "DBC":     +0.08,   # broad commodities — oil/metals supply shock
            "VNQ":     -0.10,
            "BTC-USD": -0.28,   # crypto risk-off
            "XLF":     -0.11,   # legacy: kept for any portfolio still holding
            # Active-fund spotlight ETFs
            "CGGO":    -0.22,   # heavy semis/AI infra — direct Taiwan/Asia hit
            "DWLD":    -0.18,   # concentrated global, sizeable Asia exposure
            # TDF underlying holdings
            "VTI":     -0.15,   # US total market
            "VXUS":    -0.20,   # intl total — heavier Asia weight
            "BND":     +0.04,   # US bonds — modest flight to safety
            "BNDX":    +0.03,   # intl bonds
            # Capital Group TDF underlying funds
            "AGTHX":   -0.22,   # US growth (heavy semis)
            "AIVSX":   -0.15,   # US large blend
            "ANCFX":   -0.16,   # US large blend
            "AWSHX":   -0.10,   # US value (defensive)
            "AMRMX":   -0.12,   # US dividend (defensive)
            "ANWPX":   -0.19,   # global (Asia weight)
            "AEPGX":   -0.16,   # intl developed
            "CWGIX":   -0.14,   # global income
            "NEWFX":   -0.22,   # EM (heavy Asia)
            "SMCWX":   -0.18,   # global small cap
            "ABNDX":   +0.04,   # US core bonds
            "AMUSX":   +0.05,   # US Treasuries
        },
    },
    {
        "id": "iran_conflict",
        "name": "Iran Conflict / Oil Shock",
        "desc": "Strait of Hormuz disruption drives oil toward $150, stagflation fears spike",
        "shocks": {
            "SPY":     -0.09,
            "EFA":     -0.10,   # Europe/Japan oil-importer hit
            "EEM":     -0.13,
            "QQQ":     -0.08,
            "IWM":     -0.09,
            "IEF":     +0.02,   # modest flight to safety, capped by inflation
            "TLT":     +0.04,
            "LQD":     +0.01,
            "HYG":     -0.07,
            "TIP":     +0.05,   # inflation hedge benefits in oil shock
            "GLD":     +0.13,   # oil/safe haven
            "DBC":     +0.18,   # commodity index, oil-heavy — biggest beneficiary
            "VNQ":     -0.07,
            "BTC-USD": -0.18,
            "XLF":     -0.08,   # legacy
            # Active-fund spotlight ETFs
            "CGGO":    -0.10,   # global growth, modest oil-shock sensitivity
            "DWLD":    -0.05,   # value-leaning, has Coterra (oil benefits) — softer hit
            # TDF underlying holdings
            "VTI":     -0.09,
            "VXUS":    -0.11,   # intl exposure to oil shock
            "BND":     +0.02,
            "BNDX":    +0.01,
            # Capital Group TDF underlying funds
            "AGTHX":   -0.10,
            "AIVSX":   -0.09,
            "ANCFX":   -0.09,
            "AWSHX":   -0.07,
            "AMRMX":   -0.07,
            "ANWPX":   -0.10,
            "AEPGX":   -0.11,
            "CWGIX":   -0.09,
            "NEWFX":   -0.13,
            "SMCWX":   -0.10,
            "ABNDX":   +0.01,
            "AMUSX":   +0.03,
        },
    },
    {
        "id": "us_recession",
        "name": "U.S. Recession",
        "desc": "GDP contraction triggers Fed pivot, credit spreads widen, earnings fall",
        "shocks": {
            "SPY":     -0.28,
            "EFA":     -0.22,   # global recession spillover, less leverage than US
            "EEM":     -0.22,
            "QQQ":     -0.32,
            "IWM":     -0.32,   # small caps hit hardest
            "IEF":     +0.10,   # rate cuts benefit, less duration than TLT
            "TLT":     +0.18,   # aggressive rate cuts
            "LQD":     +0.04,
            "HYG":     -0.16,   # high yield blowout
            "TIP":     +0.06,   # real yields fall, but inflation also falls
            "GLD":     +0.08,
            "DBC":     -0.18,   # demand collapse hits commodities
            "VNQ":     -0.22,
            "BTC-USD": -0.45,
            "XLF":     -0.30,   # legacy: financials crater
            # Active-fund spotlight ETFs
            "CGGO":    -0.26,   # global growth, quality tilt softens vs QQQ
            "DWLD":    -0.30,   # smaller-cap value-leaning, recession-sensitive
            # TDF underlying holdings
            "VTI":     -0.28,
            "VXUS":    -0.24,   # global recession spillover
            "BND":     +0.08,   # rate cut benefit
            "BNDX":    +0.05,
            # Capital Group TDF underlying funds
            "AGTHX":   -0.32,   # growth-tilted, hardest hit
            "AIVSX":   -0.28,
            "ANCFX":   -0.28,
            "AWSHX":   -0.22,   # defensive value
            "AMRMX":   -0.22,   # defensive dividend
            "ANWPX":   -0.25,
            "AEPGX":   -0.20,
            "CWGIX":   -0.22,
            "NEWFX":   -0.25,
            "SMCWX":   -0.32,   # small caps hit hardest
            "ABNDX":   +0.06,
            "AMUSX":   +0.12,   # rate cut benefit
        },
    },
    {
        "id": "ai_bubble_burst",
        "name": "AI Bubble Burst",
        "desc": "Demand disappointment or capex reality check causes mega-cap tech repricing",
        "shocks": {
            "SPY":     -0.18,
            "EFA":     -0.10,   # less mega-cap AI concentration
            "EEM":     -0.10,
            "QQQ":     -0.35,   # highest concentration in AI names
            "IWM":     -0.12,
            "IEF":     +0.05,   # modest flight to quality
            "TLT":     +0.08,
            "LQD":     +0.02,
            "HYG":     -0.08,
            "TIP":     +0.03,
            "GLD":     +0.05,
            "DBC":     -0.05,   # modest growth scare
            "VNQ":     -0.08,
            "BTC-USD": -0.30,   # correlated risk-off
            "XLF":     -0.14,   # legacy
            # Active-fund spotlight ETFs
            "CGGO":    -0.30,   # heaviest AI/semis concentration — biggest hit
            "DWLD":    -0.14,   # value-leaning, much less AI exposure
            # TDF underlying holdings
            "VTI":     -0.18,   # broad market, includes AI exposure
            "VXUS":    -0.10,   # less direct AI concentration
            "BND":     +0.04,
            "BNDX":    +0.02,
            # Capital Group TDF underlying funds
            "AGTHX":   -0.32,   # growth fund — heavy mega-cap AI names
            "AIVSX":   -0.18,
            "ANCFX":   -0.18,
            "AWSHX":   -0.10,   # value, low AI concentration
            "AMRMX":   -0.10,   # dividend, low AI concentration
            "ANWPX":   -0.20,   # global growth
            "AEPGX":   -0.10,
            "CWGIX":   -0.12,
            "NEWFX":   -0.12,
            "SMCWX":   -0.16,
            "ABNDX":   +0.03,
            "AMUSX":   +0.06,
        },
    },
]


def compute_hypothetical_scenarios(weights: dict) -> list[dict]:
    """
    Apply analyst-estimated shock vectors to portfolio weights.
    No historical price data required — pure assumption-based stress test.
    """
    results = []
    for s in HYPOTHETICAL_SCENARIOS:
        shocks  = s["shocks"]
        avail   = [t for t in weights if t in shocks]
        raw_w   = {t: weights[t] for t in avail}
        total_w = sum(raw_w.values())
        norm_w  = {t: w / total_w for t, w in raw_w.items()}

        port_return   = sum(shocks[t] * norm_w[t] for t in avail)
        contributions = {t: round(shocks[t] * norm_w[t] * 100, 2) for t in avail}

        results.append({
            "id":            s["id"],
            "name":          s["name"],
            "desc":          s["desc"],
            "type":          "hypothetical",
            "portfolio_pnl": round(port_return * 100, 2),
            "coverage_pct":  round(total_w * 100, 1),
            "asset_returns": {t: round(shocks[t] * 100, 1) for t in avail},
            "contributions": contributions,
        })
    return results


def compute_scenarios(prices: pd.DataFrame, weights: dict) -> list[dict]:
    """
    For each historical scenario, compute portfolio and per-asset total returns
    over the scenario date range. Missing tickers (e.g. BTC pre-2014) are
    excluded and weights re-normalized so the portfolio return is still meaningful.
    """
    results = []

    for s in SCENARIOS:
        start = pd.Timestamp(s["start"])
        end   = pd.Timestamp(s["end"])

        mask   = (prices.index >= start) & (prices.index <= end)
        window = prices[mask].copy()

        if len(window) < 2:
            continue

        # Only include tickers that have full non-NaN data across the window
        avail = [
            t for t in weights
            if t in window.columns and window[t].notna().sum() >= 2
        ]
        if not avail:
            continue

        # Total return per ticker: (last / first) - 1
        asset_returns = {}
        for t in avail:
            series = window[t].dropna()
            if len(series) >= 2:
                asset_returns[t] = float(series.iloc[-1] / series.iloc[0] - 1)

        if not asset_returns:
            continue

        # Re-normalize weights to available tickers
        raw_w   = {t: weights[t] for t in asset_returns}
        total_w = sum(raw_w.values())
        norm_w  = {t: w / total_w for t, w in raw_w.items()}

        # Portfolio return (normalized weights)
        port_return = sum(asset_returns[t] * norm_w[t] for t in asset_returns)

        # Per-asset contribution = return × normalized weight
        contributions = {
            t: round(asset_returns[t] * norm_w[t] * 100, 2)
            for t in asset_returns
        }

        results.append({
            "id":               s["id"],
            "name":             s["name"],
            "desc":             s["desc"],
            "start":            s["start"],
            "end":              s["end"],
            "portfolio_pnl":    round(port_return * 100, 2),
            "coverage_pct":     round(total_w * 100, 1),
            "asset_returns":    {t: round(v * 100, 2) for t, v in asset_returns.items()},
            "contributions":    contributions,
        })

    return results


# ---------------------------------------------------------------------------
# Component VaR (risk attribution)
# ---------------------------------------------------------------------------

def compute_component_var(
    prices: pd.DataFrame,
    weights: dict,
    p: float = P,
    lam: float = 0.94,
    window: int = WINDOW,
) -> dict:
    """
    Component VaR per asset using an EWMA covariance matrix.

    Sum of component VaRs across all holdings equals the portfolio's
    parametric (EWMA) VaR — so each component value answers
    "how much of today's portfolio VaR comes from this asset?"

    Negative component VaR indicates a hedge (an asset whose covariance
    with the rest of the portfolio reduces total risk).

    Standard formula:
        Component VaR_i = w_i × (Σ w)_i / σ_p × z × portfolio_value
        where Σ is the EWMA covariance matrix of returns.
    """
    avail = [t for t in weights if t in prices.columns]
    if len(avail) < 2:
        return {}

    raw_w  = np.array([weights[t] for t in avail])
    norm_w = raw_w / raw_w.sum()

    # Log returns over only the portfolio's tickers (preserves max history)
    sub = prices[avail].dropna()
    if len(sub) < 30:
        return {}
    ret_df = np.log(sub / sub.shift(1)).dropna()
    if len(ret_df) < 30:
        return {}

    R = ret_df.iloc[-window:].values  # T x N

    # EWMA covariance: cov_t = (1-λ) r r' + λ cov_{t-1}
    cov = np.cov(R.T)  # initial estimate from sample covariance
    for r in R:
        r_col = r.reshape(-1, 1)
        cov = (1 - lam) * (r_col @ r_col.T) + lam * cov

    portfolio_var = float(norm_w @ cov @ norm_w)
    if portfolio_var <= 0:
        return {}
    portfolio_sigma = np.sqrt(portfolio_var)
    z = norm.ppf(1 - p)

    cov_w    = cov @ norm_w
    comp_var = norm_w * cov_w / portfolio_sigma * z * PORTFOLIO_VALUE

    return {avail[i]: round(float(comp_var[i]), 4) for i in range(len(avail))}


# ---------------------------------------------------------------------------
# Backtesting (Kupiec UC + Christoffersen independence)
# ---------------------------------------------------------------------------

def kupiec_uc_test(violations: int, total: int, p: float = P) -> dict:
    """
    Kupiec unconditional coverage test.
    Null: actual exception rate equals expected rate p.
    LR statistic ~ χ²(1) under the null. p-value > 0.05 → fail to reject (model PASSES).
    """
    if total == 0:
        return {"stat": None, "p_value": None}

    p_hat = violations / total

    if violations == 0:
        lr = -2 * total * np.log(1 - p)
    elif violations == total:
        lr = -2 * total * np.log(p)
    else:
        lr = -2 * (
            (total - violations) * np.log((1 - p) / (1 - p_hat)) +
            violations * np.log(p / p_hat)
        )

    p_value = 1 - chi2.cdf(lr, df=1)
    return {"stat": round(float(lr), 3), "p_value": round(float(p_value), 4)}


def christoffersen_ind_test(violations: np.ndarray) -> dict:
    """
    Christoffersen independence test.
    Null: VaR violations are independent (no clustering).
    Two-state Markov chain on violation indicator. LR ~ χ²(1) under the null.
    """
    if len(violations) < 2:
        return {"stat": None, "p_value": None}

    v = np.asarray(violations, dtype=int)

    n00 = int(np.sum((v[:-1] == 0) & (v[1:] == 0)))
    n01 = int(np.sum((v[:-1] == 0) & (v[1:] == 1)))
    n10 = int(np.sum((v[:-1] == 1) & (v[1:] == 0)))
    n11 = int(np.sum((v[:-1] == 1) & (v[1:] == 1)))

    if (n00 + n01) == 0 or (n10 + n11) == 0:
        # Not enough transitions to test (e.g. zero violations)
        return {"stat": None, "p_value": None}

    p01  = n01 / (n00 + n01)
    p11  = n11 / (n10 + n11)
    p_uc = (n01 + n11) / max(1, n00 + n01 + n10 + n11)

    eps = 1e-12  # avoid log(0)

    log_l_null = (
        (n00 + n10) * np.log(max(eps, 1 - p_uc)) +
        (n01 + n11) * np.log(max(eps, p_uc))
    )
    log_l_alt = (
        n00 * np.log(max(eps, 1 - p01)) +
        n01 * np.log(max(eps, p01)) +
        n10 * np.log(max(eps, 1 - p11)) +
        n11 * np.log(max(eps, p11))
    )

    lr = -2 * (log_l_null - log_l_alt)
    p_value = 1 - chi2.cdf(lr, df=1)
    return {"stat": round(float(lr), 3), "p_value": round(float(p_value), 4)}


def _verdict_from_tests(rate: float, p: float, kp, cp, alpha: float = 0.05) -> str:
    """
    Directional verdict from Kupiec + Christoffersen p-values:
    UNDER-EST   = rate too high (model misses tails)
    OVER-CONSERV = rate too low (model too pessimistic)
    CLUSTERED   = rate fine but exceptions cluster (time-varying vol missed)
    CALIBRATED  = both tests pass at α significance
    """
    kupiec_reject = kp is not None and kp < alpha
    christ_reject = cp is not None and cp < alpha
    if kupiec_reject and rate > p:
        return "UNDER-EST"
    if kupiec_reject and rate < p:
        return "OVER-CONSERV"
    if christ_reject:
        return "CLUSTERED"
    return "CALIBRATED"


def backtest_portfolio_var(
    prices: pd.DataFrame,
    weights: dict,
    eval_window: int = 504,
    lookback: int = WINDOW,
    p: float = P,
) -> list[dict]:
    """
    Backtest HS, EWMA, and EVT VaR models against the active portfolio's
    daily return series over the most recent `eval_window` trading days.

    For each day in the eval window, the VaR forecast is computed using the
    prior `lookback` returns (so it's strictly out-of-sample). Then the
    actual loss is compared to the forecast.

    GARCH/tGARCH are not included because they require iterative MLE refits
    on each window — too expensive to recompute daily on a routine run.
    """
    avail = [t for t in weights if t in prices.columns]
    if len(avail) < 2:
        return []

    raw_w  = np.array([weights[t] for t in avail])
    norm_w = raw_w / raw_w.sum()

    sub = prices[avail].dropna()
    if len(sub) < eval_window + lookback + 10:
        return []

    ret_df = np.log(sub / sub.shift(1)).dropna()
    port_rets_series = pd.Series(ret_df.values @ norm_w, index=ret_df.index)
    if len(port_rets_series) < eval_window + lookback:
        return []

    # Restrict to last (lookback + eval_window) so the rolling backtest is fast
    eval_series = port_rets_series.iloc[-(lookback + eval_window):]
    rets_arr   = eval_series.values
    eval_dates = eval_series.index[-eval_window:]
    eval_dates_str = [d.strftime("%Y-%m-%d") for d in eval_dates]

    hs_var   = np.zeros(eval_window)
    ewma_var = np.zeros(eval_window)
    evt_var  = np.zeros(eval_window)

    for i in range(eval_window):
        window_rets = rets_arr[i:i + lookback]
        hs_v,   _ = var_es_hs(window_rets, p)
        ewma_v, _ = var_es_ewma(window_rets, p)
        evt_v,  _ = var_es_evt(window_rets, p)
        hs_var[i]   = hs_v
        ewma_var[i] = ewma_v
        evt_var[i]  = evt_v

    actual_loss = -rets_arr[-eval_window:] * PORTFOLIO_VALUE
    expected = eval_window * p

    results = []
    for name, var_arr in [("HS", hs_var), ("EWMA", ewma_var), ("EVT", evt_var)]:
        violations = (actual_loss > var_arr).astype(int)
        n_v  = int(violations.sum())
        rate = n_v / eval_window
        violation_dates = [eval_dates_str[i] for i in range(eval_window) if violations[i]]

        kupiec = kupiec_uc_test(n_v, eval_window, p)
        christ = christoffersen_ind_test(violations)

        kp = kupiec.get("p_value")
        cp = christ.get("p_value")
        verdict = _verdict_from_tests(rate, p, kp, cp)

        results.append({
            "model":            name,
            "exceptions":       n_v,
            "expected":         round(expected, 1),
            "rate_pct":         round(rate * 100, 2),
            "expected_pct":     round(p * 100, 2),
            "kupiec_p":         kp,
            "christoffersen_p": cp,
            "verdict":          verdict,
            "eval_dates":       eval_dates_str,
            "violation_dates":  violation_dates,
        })

    return results



def backtest_portfolio_garch(
    prices: pd.DataFrame,
    weights: dict,
    asymmetric: bool = False,
    eval_window: int = 504,
    lookback: int = WINDOW,
    p: float = P,
) -> dict:
    """
    Backtest GARCH(1,1) or GJR-tGARCH (when asymmetric=True) on the active
    portfolio's daily return series using warm-started MLE refits.

    Each refit uses the previous day's fitted parameters as starting values,
    which typically drops convergence iterations from ~20–50 to ~3–10.
    Falls back to EWMA on convergence failure (rare). Computationally heavier
    than HS/EWMA/EVT — typically 30–90 seconds per portfolio with warm-start
    vs 5+ minutes for cold-start. Cached separately by run.py so it doesn't
    run on every routine refresh.

    Returns a single backtest dict (same shape as backtest_portfolio_var
    entries), or None if there's insufficient history.
    """
    avail = [t for t in weights if t in prices.columns]
    if len(avail) < 2:
        return None

    raw_w  = np.array([weights[t] for t in avail])
    norm_w = raw_w / raw_w.sum()

    sub = prices[avail].dropna()
    if len(sub) < eval_window + lookback + 10:
        return None

    ret_df = np.log(sub / sub.shift(1)).dropna()
    port_rets_series = pd.Series(ret_df.values @ norm_w, index=ret_df.index)
    if len(port_rets_series) < eval_window + lookback:
        return None

    eval_series = port_rets_series.iloc[-(lookback + eval_window):]
    rets_arr    = eval_series.values
    eval_dates  = eval_series.index[-eval_window:]
    eval_dates_str = [d.strftime("%Y-%m-%d") for d in eval_dates]
    var_arr  = np.zeros(eval_window)
    last_params = None  # warm-start

    for i in range(eval_window):
        window = rets_arr[i:i + lookback]
        scaled = window * 100  # arch lib prefers percent-scaled returns

        am = arch_model(
            scaled,
            vol="GARCH",
            p=1,
            o=1 if asymmetric else 0,
            q=1,
            dist="normal",
            rescale=False,
        )

        try:
            res = am.fit(
                disp="off",
                show_warning=False,
                starting_values=last_params,
            )
            last_params = res.params.values
            forecast = res.forecast(horizon=1, reindex=False)
            sigma = float(np.sqrt(forecast.variance.values[-1, 0])) / 100
            z = norm.ppf(1 - p)
            var_arr[i] = _cap(sigma * z * PORTFOLIO_VALUE)
        except Exception:
            # Convergence failure — fall back to EWMA and reset warm-start
            ewma_v, _ = var_es_ewma(window, p)
            var_arr[i] = ewma_v
            last_params = None

    actual_loss = -rets_arr[-eval_window:] * PORTFOLIO_VALUE
    expected = eval_window * p

    violations = (actual_loss > var_arr).astype(int)
    n_v  = int(violations.sum())
    rate = n_v / eval_window
    violation_dates = [eval_dates_str[i] for i in range(eval_window) if violations[i]]

    kupiec = kupiec_uc_test(n_v, eval_window, p)
    christ = christoffersen_ind_test(violations)

    kp = kupiec.get("p_value")
    cp = christ.get("p_value")
    verdict = _verdict_from_tests(rate, p, kp, cp)

    return {
        "model":            "tGARCH" if asymmetric else "GARCH",
        "exceptions":       n_v,
        "expected":         round(expected, 1),
        "rate_pct":         round(rate * 100, 2),
        "expected_pct":     round(p * 100, 2),
        "kupiec_p":         kp,
        "christoffersen_p": cp,
        "verdict":          verdict,
        "eval_dates":       eval_dates_str,
        "violation_dates":  violation_dates,
    }


def nyfed_recession_probability(spread_pct: float) -> float:
    """
    NY Fed yield-curve recession probability. Estrella & Trubin (2006)
    Federal Reserve Bank of New York Staff Report — uses a probit model
    of NBER recessions on the 10Y - 3M Treasury yield spread.

    Formula:  P(recession in 12 months) = Φ(-0.5333 - 0.6330 × spread)
    where spread is in percentage points.

    Source: https://www.newyorkfed.org/research/capital_markets/ycfaq.html
    Returns a probability in [0, 1].
    """
    z = -0.5333 - 0.6330 * spread_pct
    return float(norm.cdf(z))


# ---------------------------------------------------------------------------
# QMLE integrated-variance estimator (Xiu 2010) and polarization-based
# integrated-correlation estimator (Aït-Sahalia, Fan & Xiu 2010).
#
# Why this exists:
#   Naive realized variance from intraday log returns is biased upward by
#   microstructure noise (bid-ask bounce, tick discreteness): observed log
#   prices behave as latent log price + iid noise, so observed returns are
#   ε_i + (u_i - u_{i-1}). That's exactly an MA(1) around the true return
#   process. Xiu (2010) showed that the QMLE of an MA(1) representation
#   recovers integrated variance consistently in the presence of noise:
#       Var(r_i)         = σ²Δ + 2a²       = ψ²(1 + θ²)
#       Cov(r_i, r_{i-1}) = -a²            = ψ² θ
#   Solving:  a² = -ψ²θ   (requires θ < 0)
#             IV = n · σ²Δ = n · ψ²(1 + θ)²
#
#   For covariance, AFX (2010) use the polarization identity:
#       Cov(X, Y) = [IV(X+Y) - IV(X-Y)] / 4
#   applied to the QMLE-cleaned IV of each of X, Y, X+Y, X-Y.
#
# For SPY × TLT at 5m / 15m bars the SNR is high (~5–15× for SPY, ~2–4×
# for TLT) so the noise correction is small (typically |Δρ| ≤ 0.05). We
# expose this as a "show your work" benchmark so the audience can verify
# the regime signal is robust to estimator choice. QMLE earns its keep
# at finer sampling (1m/tick) or on illiquid pairs.
# ---------------------------------------------------------------------------
def _qmle_iv(returns: np.ndarray) -> tuple[float, str]:
    """
    Estimate integrated variance from a sequence of intraday log returns
    via Xiu-2010 QMLE on the MA(1) representation of noisy log returns.

    Returns (IV, method) where method is:
      "qmle"  — MA(1) fit succeeded with θ < 0 (microstructure noise present
                and removed)
      "rv"    — MA(1) θ ≥ 0 (no noise detected); fell back to realized variance
                (sum of squared returns)
      "fail"  — ARIMA fit raised; fell back to realized variance
    """
    rv = float(np.sum(returns ** 2))
    n = len(returns)
    if n < 5:
        return rv, "rv"
    try:
        from statsmodels.tsa.arima.model import ARIMA
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = ARIMA(returns, order=(0, 0, 1), trend="n")
            fit   = model.fit(method_kwargs={"warn_convergence": False})
        # statsmodels: maparams gives the MA(1) coefficient θ; sigma2 is the
        # innovation variance ψ². fit.params is a numpy array whose last entry
        # is sigma2 when trend="n" with order=(0,0,1).
        theta = float(fit.maparams[0]) if len(fit.maparams) else 0.0
        params_arr = np.asarray(fit.params)
        psi2 = float(params_arr[-1])
        if not np.isfinite(theta) or not np.isfinite(psi2) or psi2 <= 0:
            return rv, "fail"
        if theta >= 0:
            # No microstructure noise picked up — the QMLE reduces to RV
            return rv, "rv"
        IV = n * psi2 * (1 + theta) ** 2
        if not np.isfinite(IV) or IV <= 0:
            return rv, "fail"
        return float(IV), "qmle"
    except Exception:
        return rv, "fail"


def compute_intraday_correlation_daily(
    series_a: pd.Series,
    series_b: pd.Series,
    min_obs: int = 20,
) -> list[dict]:
    """
    Daily intraday correlation between two intraday price series.

    For each trading day, compute log returns on the within-day intraday bars
    of both series, then take the Pearson correlation. Each daily value is its
    own meaningful estimate (n ≈ 78 for 5-min bars over a 6.5-hour US session)
    rather than a single point in a rolling daily-data window.

    Returns one dict per trading day: {date, corr, n_obs}.

    The methodological point: a single day's intraday correlation has
    substantially more statistical power than a single day of daily-data
    correlation. A run of consecutive same-sign days is therefore a much
    sharper regime-shift signal than the rolling 60-day daily correlation.
    """
    # Align indexes and compute log returns on each
    df = pd.concat([series_a.rename("a"), series_b.rename("b")], axis=1).dropna()
    if len(df) < min_obs:
        return []

    log_ret = np.log(df / df.shift(1)).dropna()
    if log_ret.empty:
        return []

    # Group by trading day. Use the underlying date to handle tz-aware indexes.
    if hasattr(log_ret.index, "tz") and log_ret.index.tz is not None:
        dates = log_ret.index.tz_convert("America/New_York").date
    else:
        dates = log_ret.index.date

    results = []
    for d, group in log_ret.groupby(dates):
        if len(group) < min_obs:
            continue

        c = group["a"].corr(group["b"])
        if pd.isna(c):
            continue

        # QMLE polarization (AFX 2010): clean each of X, Y, X+Y, X-Y with
        # Xiu-2010 QMLE, then Cov(X,Y) = [IV(X+Y) - IV(X-Y)] / 4.
        rx = group["a"].to_numpy()
        ry = group["b"].to_numpy()
        IV_x,    m_x  = _qmle_iv(rx)
        IV_y,    m_y  = _qmle_iv(ry)
        IV_sum,  m_s  = _qmle_iv(rx + ry)
        IV_diff, m_d  = _qmle_iv(rx - ry)

        methods = (m_x, m_y, m_s, m_d)
        if "fail" in methods or IV_x <= 0 or IV_y <= 0:
            corr_qmle   = float(c)        # fall back to naive
            qmle_method = "fallback"
        else:
            cov_qmle = (IV_sum - IV_diff) / 4.0
            denom    = np.sqrt(IV_x * IV_y)
            raw      = cov_qmle / denom if denom > 0 else float(c)
            # Polarization can occasionally pop outside [-1, 1] on noisy days
            corr_qmle = float(max(-1.0, min(1.0, raw)))
            if all(m == "qmle" for m in methods):
                qmle_method = "qmle"
            else:
                # Some legs reduced to RV (no noise detected); still a valid
                # noise-aware estimate, just labeled distinctly.
                qmle_method = "qmle_partial"

        results.append({
            "date":         d.isoformat() if hasattr(d, "isoformat") else str(d),
            "corr":         round(float(c), 4),         # naive RV correlation (legacy field)
            "corr_naive":   round(float(c), 4),
            "corr_qmle":    round(corr_qmle, 4),
            "n_obs":        int(len(group)),
            "qmle_method":  qmle_method,
        })
    return results


def compute_multi_window_correlation(
    prices: pd.DataFrame,
    primary: str = "SPY",
    bond_proxies: list = None,
    windows: list = None,
    sample_every: int = 5,
) -> dict:
    """
    Rolling correlation of `primary` vs each bond proxy at multiple window
    lengths. Used for the multi-window/multi-bond chart that pairs the
    intraday signal with longer-horizon daily-data context.

    Output structure:
        {
            "AGG": {"20d": [{date, corr}, ...], "60d": [...], "252d": [...]},
            "TLT": {...},
            ...
        }

    Different window lengths reveal different time scales of regime change.
    Recent regime intensification shows up in the 20d series before it
    becomes visible in the 252d series — the latter is dominated by the
    longer history and smooths over recent shifts.
    """
    if bond_proxies is None:
        bond_proxies = ["AGG", "TLT", "IEF", "LQD"]
    if windows is None:
        windows = [20, 60, 252]

    if primary not in prices.columns:
        return {}

    a_log_ret = np.log(prices[primary] / prices[primary].shift(1))

    out = {}
    for bond in bond_proxies:
        if bond not in prices.columns:
            continue

        b_log_ret = np.log(prices[bond] / prices[bond].shift(1))
        df = pd.concat([a_log_ret.rename("a"), b_log_ret.rename("b")], axis=1).dropna()
        if df.empty:
            continue

        # Compute all rolling correlations on the SAME DataFrame, then sample
        # once at unified positions. This ensures all three series share the
        # same date grid after sampling — a per-window dropna+sample approach
        # would produce misaligned grids and a frontend merge-by-date would
        # leave most rows with data for only one window.
        rolling_combined = pd.DataFrame(index=df.index)
        for w in windows:
            rolling_combined[f"{w}d"] = df["a"].rolling(w).corr(df["b"])

        # Drop initial rows where ALL windows are NaN, then sample on the
        # unified index. NaN entries inside a window get dropped per-series
        # below — keeps the longer windows from contributing junk while
        # still aligning short-window data with long-window data.
        rolling_combined = rolling_combined.dropna(how="all")
        sampled = rolling_combined.iloc[::sample_every]

        bond_data = {}
        for w in windows:
            col = f"{w}d"
            non_null = sampled[col].dropna()
            if non_null.empty:
                continue
            bond_data[col] = [
                {"date": idx.strftime("%Y-%m-%d"), "corr": round(float(v), 4)}
                for idx, v in non_null.items()
            ]

        if bond_data:
            out[bond] = bond_data

    return out
