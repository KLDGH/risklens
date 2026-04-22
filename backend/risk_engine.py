import numpy as np
import pandas as pd
from scipy.stats import norm
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


def compute_sp500_history(returns: pd.Series, prices: pd.Series) -> list[dict]:
    """Per-year min/max EWMA VaR and annual return for the S&P 500 historical chart."""
    daily_var = compute_daily_ewma_var(returns)
    daily_var = daily_var.dropna()

    # Annual return: last price of year / first price of year - 1
    annual_ret = prices.resample("YE").last().pct_change() * 100

    rows = []
    for year, group in daily_var.groupby(daily_var.index.year):
        if len(group) < 20:
            continue
        yr_str = str(year)
        ret = float(annual_ret[annual_ret.index.year == year].iloc[0]) if year in annual_ret.index.year else None
        rows.append({
            "year": year,
            "min_var": round(float(group.min()), 2),
            "max_var": round(float(group.max()), 2),
            "annual_return_pct": round(ret, 2) if ret is not None else None,
        })
    return rows


def compute_asset_risk(ticker: str, returns: pd.Series, prices: pd.Series) -> dict:
    if len(returns) < WINDOW:
        window_rets = returns.values
    else:
        window_rets = returns.values[-WINDOW:]

    var_hs, es_hs = var_es_hs(window_rets)
    var_ewma, es_ewma = var_es_ewma(window_rets)
    var_garch, es_garch = var_es_garch(window_rets)

    risk_level = compute_risk_level(returns)

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
        "risk_level": round(risk_level, 4),
    }
