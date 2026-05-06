import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from fetch_data import (
    NAMES, TICKERS,
    TDF_2055_TICKERS, TDF_2055_NAMES,
    CG_2055_TICKERS, CG_2055_NAMES,
    ACTIVE_FUND_TICKERS, ACTIVE_FUND_NAMES,
    compute_log_returns, fetch_prices, fetch_sp500_history, fetch_vix_history,
    fetch_yield_curve_spread, fetch_intraday_data,
)
from risk_engine import (
    compute_asset_risk, compute_sp500_history, compute_rolling_correlation,
    compute_scenarios, compute_hypothetical_scenarios,
    compute_portfolio_risk_history, compute_component_var,
    backtest_portfolio_var, backtest_portfolio_garch,
    nyfed_recession_probability, compute_intraday_correlation_daily,
    compute_multi_window_correlation,
    CORR_TICKERS,
)

# Extra tickers fetched beyond the portfolio universe.
# - AGG: broad bond aggregate for the multi-window stock-bond correlation chart
#        (alongside portfolio-resident TLT/IEF/LQD/HYG).
# - UUP: USD index ETF — included in the cross-asset correlation basket as the
#        FX risk-premium leg. Not held in the portfolio, so fetched separately.
EXTRA_BOND_PROXIES = ["AGG", "UUP"]

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "data", "risk_output.json")

# Cached GARCH/tGARCH backtests — too slow for the daily run, refreshed on
# demand via RISKLENS_FULL_BACKTEST=1 python run.py
GARCH_CACHE_PATH = os.path.join(os.path.dirname(__file__), "cache", "garch_backtests.json")

# Preprocessed disclosed-holdings JSON for the active-fund spotlight modes.
# Generated locally by `python backend/preprocess_holdings.py` from xlsx/csv
# disclosures dropped into ext-data/. Committed to the repo so GitHub Actions
# can read it without needing openpyxl in CI.
ACTIVE_FUND_HOLDINGS_PATH = os.path.join(
    os.path.dirname(__file__), "data", "active_fund_holdings.json")


# ---------------------------------------------------------------------------
# Probability outlook — external source links per hypothetical scenario.
# Curated rather than computed; we don't want to make up percentages.
# Where a live computation is defensible (e.g. NY Fed recession probability
# from the yield-curve spread), we attach it dynamically below.
# ---------------------------------------------------------------------------
PROBABILITY_SOURCES = {
    "taiwan_invasion": [
        {
            "name": "Metaculus — Sino-American war over Taiwan by 2030",
            "url":  "https://www.metaculus.com/questions/?search=taiwan",
            "note": "Aggregated forecaster probabilities with track-record scoring.",
        },
        {
            "name": "Polymarket — China invasion / blockade markets",
            "url":  "https://polymarket.com/markets?_q=taiwan",
            "note": "Money-backed prediction markets. Liquidity varies.",
        },
        {
            "name": "CSIS — \"The First Battle of the Next War\" war-game",
            "url":  "https://www.csis.org/analysis/first-battle-next-war-wargaming-chinese-invasion-taiwan",
            "note": "Structured war-game with explicit probability framing (Hass et al, 2023).",
        },
    ],
    "iran_conflict": [
        {
            "name": "Polymarket — Iran-Israel war / Hormuz markets",
            "url":  "https://polymarket.com/markets?_q=iran",
            "note": "Time-bounded conflict probability questions.",
        },
        {
            "name": "Brent crude futures (CME)",
            "url":  "https://www.cmegroup.com/markets/energy/crude-oil/brent-crude-oil.html",
            "note": "Forward-looking oil pricing reflects supply-disruption risk.",
        },
        {
            "name": "Metaculus — Middle East conflict questions",
            "url":  "https://www.metaculus.com/questions/?search=iran",
            "note": "Aggregated forecaster probabilities.",
        },
    ],
    "us_recession": [
        # The NY Fed entry is upserted at runtime with a live value.
        {
            "name": "NY Fed recession-probability methodology",
            "url":  "https://www.newyorkfed.org/research/capital_markets/ycfaq.html",
            "note": "Estrella-Trubin probit model on the 10Y - 3M Treasury yield spread.",
        },
        {
            "name": "Conference Board Leading Economic Index",
            "url":  "https://www.conference-board.org/topics/us-leading-indicators",
            "note": "Composite leading indicator; sustained declines have historically preceded recessions.",
        },
        {
            "name": "Polymarket — US recession in 2026",
            "url":  "https://polymarket.com/markets?_q=us+recession",
            "note": "Money-backed prediction market.",
        },
        {
            "name": "FRED — yield curve and recession indicators",
            "url":  "https://fred.stlouisfed.org/series/T10Y3M",
            "note": "Source data behind the NY Fed model.",
        },
    ],
    "ai_bubble_burst": [
        {
            "name": "CBOE SKEW Index",
            "url":  "https://www.cboe.com/tradable_products/sp_500/skew_index/",
            "note": "Implied probability of large negative S&P 500 returns from option pricing.",
        },
        {
            "name": "Shiller CAPE ratio (Robert Shiller, Yale)",
            "url":  "http://www.econ.yale.edu/~shiller/data.htm",
            "note": "Cyclically-adjusted price-to-earnings ratio. Extreme readings have historically preceded multi-year drawdowns.",
        },
        {
            "name": "Goldman Sachs equity-research bubble dashboards",
            "url":  "https://www.goldmansachs.com/insights/topics/equities",
            "note": "Sell-side valuation extreme indicators (concentration, premium to historical median, etc.).",
        },
    ],
}

# ---------------------------------------------------------------------------
# Hypothetical blended portfolio weights (must sum to 1.0)
#   Equity (60%):       SPY 25, EFA 14, EEM 8, QQQ 8, IWM 5
#   Fixed Income (30%): IEF 8, TLT 4, LQD 10, HYG 5, TIP 3
#   Real Assets (8%):   GLD 4, DBC 2, VNQ 2
#   Crypto (2%):        BTC-USD 2
# Reweighted from a US-equity-heavy mix to give explicit DM-international
# exposure (EFA), inflation protection (TIP), broad commodities (DBC), and
# intermediate-duration Treasuries (IEF).
# ---------------------------------------------------------------------------
HYPOTHETICAL_WEIGHTS = {
    "SPY":     0.25,
    "EFA":     0.14,
    "EEM":     0.08,
    "QQQ":     0.08,
    "IWM":     0.05,
    "IEF":     0.08,
    "TLT":     0.04,
    "LQD":     0.10,
    "HYG":     0.05,
    "TIP":     0.03,
    "GLD":     0.04,
    "DBC":     0.02,
    "VNQ":     0.02,
    "BTC-USD": 0.02,
}

# ---------------------------------------------------------------------------
# Vanguard Target Retirement 2055 (VFFVX) underlying allocation
# Source: Vanguard fund holdings (publicly disclosed quarterly).
#   ~54% Total US Equity      → VTI
#   ~36% Total Intl Equity    → VXUS
#   ~7%  Total US Bonds       → BND
#   ~3%  Total Intl Bonds     → BNDX
# ---------------------------------------------------------------------------
TDF_2055_WEIGHTS = {
    "VTI":  0.54,
    "VXUS": 0.36,
    "BND":  0.07,
    "BNDX": 0.03,
}

# ---------------------------------------------------------------------------
# American Funds Target Date Retirement 2055 (AAFTX) underlying allocation
# Source: Capital Group fund fact sheet (top holdings, ~95% coverage)
#   ~89% Equity (mix of US, intl, EM, global) split across 10 active funds
#   ~11% Fixed Income across 2 active bond funds
# ---------------------------------------------------------------------------
CG_2055_WEIGHTS = {
    "AGTHX": 0.13,   # Growth Fund of America — US large growth
    "AIVSX": 0.11,   # Investment Company of America — US large blend
    "ANCFX": 0.11,   # Fundamental Investors — US large blend
    "AWSHX": 0.06,   # Washington Mutual — US value
    "AMRMX": 0.06,   # American Mutual — US dividend
    "ANWPX": 0.12,   # New Perspective — global equity
    "AEPGX": 0.11,   # EuroPacific Growth — intl developed
    "CWGIX": 0.09,   # Capital World Growth & Income — global income
    "NEWFX": 0.06,   # New World — emerging markets
    "SMCWX": 0.04,   # SMALLCAP World — global small cap
    "ABNDX": 0.07,   # Bond Fund of America — US core bonds
    "AMUSX": 0.04,   # US Government Securities — Treasuries
}

# Active-fund spotlight modes — each is a single-fund "portfolio" (100% in
# the named active ETF) so the existing risk pipeline (VaR/ES/EVT,
# scenarios, backtests, risk history) all run on the fund's NAV without
# any new code paths. Disclosed holdings are surfaced as a reference panel
# in the frontend, decoupled from the risk calc.
CGGO_WEIGHTS = {"CGGO": 1.0}
DWLD_WEIGHTS = {"DWLD": 1.0}

PORTFOLIO_MODES = {
    "hypothetical": {
        "label":       "Hypothetical Portfolio",
        "description": "An illustrative diversified mix: 60% equity (US + intl developed + EM), 30% fixed income (Treasuries + IG + HY + TIPS), 8% real assets (gold + broad commodities + REITs), 2% crypto. Built from 14 asset-class ETFs.",
        "tickers":     TICKERS,
        "names":       NAMES,
        "weights":     HYPOTHETICAL_WEIGHTS,
        "name":        "60/40 Blended Portfolio",
    },
    "tdf_2055": {
        "label":       "Vanguard Target 2055 (VFFVX)",
        "description": "Underlying holdings of the Vanguard 2055 target-date fund: ~90% equity (54% US, 36% intl) and ~10% bonds (7% US, 3% intl). Built from 4 broad passive index ETFs.",
        "tickers":     TDF_2055_TICKERS,
        "names":       TDF_2055_NAMES,
        "weights":     TDF_2055_WEIGHTS,
        "name":        "Vanguard Target Retirement 2055",
    },
    "cg_2055": {
        "label":       "AF Target 2055 (AAFTX)",
        "description": "~89% equity, ~11% bonds, split across 12 actively-managed American Funds mutual funds.",
        "tickers":     CG_2055_TICKERS,
        "names":       CG_2055_NAMES,
        "weights":     CG_2055_WEIGHTS,
        "name":        "American Funds Target 2055",
    },
    "cggo_active": {
        "label":       "CGGO (Capital Group active)",
        "description": "Capital Group Global Growth Equity ETF (CGGO) — actively managed, ~100 holdings, semis/AI-infra-tilted growth. Risk metrics computed on the fund's NAV; disclosed holdings surfaced as a reference panel.",
        "tickers":     ["CGGO"],
        "names":       {"CGGO": ACTIVE_FUND_NAMES["CGGO"]},
        "weights":     CGGO_WEIGHTS,
        "name":        "CGGO — Capital Group Global Growth",
        "is_active_fund_spotlight": True,
    },
    "dwld_active": {
        "label":       "DWLD (Davis active)",
        "description": "Davis Select Worldwide ETF (DWLD) — actively managed, ~40 holdings, value-leaning concentrated global equity. Risk metrics computed on the fund's NAV; disclosed holdings surfaced as a reference panel.",
        "tickers":     ["DWLD"],
        "names":       {"DWLD": ACTIVE_FUND_NAMES["DWLD"]},
        "weights":     DWLD_WEIGHTS,
        "name":        "DWLD — Davis Select Worldwide",
        "is_active_fund_spotlight": True,
    },
}


def compute_portfolio_row(returns: pd.DataFrame, weights: dict, name: str) -> dict:
    """
    Build a weighted portfolio return series and run all risk models on it.
    Uses the common date range across all tickers in `weights`.
    """
    avail = [t for t in weights if t in returns.columns]
    raw_weights = np.array([weights[t] for t in avail])
    norm_weights = raw_weights / raw_weights.sum()  # re-normalize if any ticker missing

    ret_df = returns[avail].dropna()
    port_rets = pd.Series(ret_df.values @ norm_weights, index=ret_df.index)

    # Synthetic NAV starting at $100 (for last_price display)
    port_prices = np.exp(port_rets.cumsum()) * 100

    print(f"  Portfolio: {len(port_rets)} trading days, {len(avail)} tickers, "
          f"weights sum={norm_weights.sum():.4f}")

    data = compute_asset_risk("PORTFOLIO", port_rets, port_prices)
    data["name"] = name
    data["is_portfolio"] = True
    data["weights"] = {t: round(float(weights[t]), 4) for t in weights}
    data["nav"] = round(float(port_prices.iloc[-1]), 2)
    return data


def compute_mode(prices_10y: pd.DataFrame, returns_10y: pd.DataFrame,
                 prices_long: pd.DataFrame, mode_cfg: dict) -> dict:
    """Compute everything needed for one portfolio mode."""
    tickers  = mode_cfg["tickers"]
    names    = mode_cfg["names"]
    weights  = mode_cfg["weights"]

    # Per-asset risk rows
    assets = []
    for ticker in tickers:
        if ticker not in returns_10y.columns:
            print(f"  WARNING: {ticker} not in 10y data, skipping")
            continue
        ret = returns_10y[ticker].dropna()
        px  = prices_10y[ticker].dropna()
        if len(ret) < 30:
            print(f"  WARNING: insufficient data for {ticker}, skipping")
            continue
        print(f"  Computing risk for {ticker}...")
        row = compute_asset_risk(ticker, ret, px)
        row["name"] = names.get(ticker, ticker)
        assets.append(row)

    # Portfolio summary row
    print("  Computing portfolio row...")
    port_row = compute_portfolio_row(returns_10y, weights, mode_cfg["name"])
    assets.append(port_row)

    # Component VaR — each holding's contribution to portfolio VaR (sums to total)
    print("  Computing component VaR...")
    comp_var = compute_component_var(prices_long, weights)
    portfolio_total_comp = sum(comp_var.values()) if comp_var else 0.0
    for asset in assets:
        if asset["ticker"] in comp_var:
            asset["component_var"] = comp_var[asset["ticker"]]
    # Annotate the portfolio row with the total (= portfolio EWMA VaR by construction)
    if comp_var and assets and assets[-1].get("is_portfolio"):
        assets[-1]["component_var_total"] = round(float(portfolio_total_comp), 4)

    # Scenarios — historical (data-driven) + hypothetical (shock-driven)
    print("  Computing scenarios...")
    hist = compute_scenarios(prices_long, weights)
    for s in hist:
        s["type"] = "historical"
    hypo = compute_hypothetical_scenarios(weights)
    scenarios = hist + hypo

    # Portfolio risk trajectory — daily EWMA VaR over full available history.
    # Pass raw prices so the function can compute returns over only this
    # portfolio's tickers (avoids truncation by unrelated short-history names).
    print("  Computing portfolio risk history...")
    risk_history = compute_portfolio_risk_history(prices_long, weights)

    # Backtesting — Kupiec UC + Christoffersen IC tests over last 504 days
    print("  Backtesting VaR models on portfolio (504-day eval, 1000-day lookback)...")
    backtests = backtest_portfolio_var(prices_long, weights)

    return {
        "label":        mode_cfg["label"],
        "description":  mode_cfg["description"],
        "weights":      weights,
        "assets":       assets,
        "scenarios":    scenarios,
        "risk_history": risk_history,
        "backtests":    backtests,
    }


def _augment_active_fund_modes_with_holdings():
    """
    Expand each active-fund spotlight mode's `tickers` list to include the
    top 25 disclosed underlying holdings (mapped to yfinance-friendly
    tickers by preprocess_holdings.py). Each underlying becomes a per-asset
    risk row in the table; weights stay {fund_ticker: 1.0} so the portfolio
    summary remains the fund's own NAV.

    Mutates PORTFOLIO_MODES in place. No-op when the holdings JSON is missing.
    """
    if not os.path.exists(ACTIVE_FUND_HOLDINGS_PATH):
        print(f"  Skipping holdings expansion — {ACTIVE_FUND_HOLDINGS_PATH} missing.")
        return
    try:
        with open(ACTIVE_FUND_HOLDINGS_PATH) as f:
            holdings_index = json.load(f).get("funds", {})
    except Exception as e:
        print(f"  WARNING: failed to load holdings JSON ({e})")
        return

    TOP_N = 25
    for mode_key, cfg in PORTFOLIO_MODES.items():
        if not cfg.get("is_active_fund_spotlight"):
            continue
        fund_ticker = cfg["tickers"][0]
        fund = holdings_index.get(fund_ticker)
        if not fund:
            continue
        underlyings = []
        for h in fund.get("holdings", [])[:TOP_N]:
            yf = h.get("yf_ticker")
            if not yf or yf == fund_ticker:
                continue
            underlyings.append(yf)
            cfg["names"][yf] = h.get("security", yf)
        cfg["tickers"] = [fund_ticker] + underlyings
        print(f"  Expanded {mode_key}: fund + {len(underlyings)} mapped top-25 underlyings")


def main():
    # Active-fund spotlight modes get expanded with their disclosed top-25
    # underlying holdings (mapped to yfinance tickers via the preprocessor).
    # Each underlying becomes its own per-asset risk row in the table.
    # Weights remain {fund_ticker: 1.0} — the portfolio is still the fund;
    # underlyings are read-only context with individual risk metrics.
    _augment_active_fund_modes_with_holdings()

    # Master ticker list — union of everything we need across all modes,
    # plus extra bond proxies for the multi-window correlation chart.
    all_tickers = []
    for cfg in PORTFOLIO_MODES.values():
        all_tickers.extend(cfg["tickers"])
    all_tickers = list(dict.fromkeys(all_tickers + EXTRA_BOND_PROXIES))

    print("Fetching 10y price data...")
    prices_10y = fetch_prices(period="10y", tickers=all_tickers)
    print("Computing log returns...")
    returns_10y = compute_log_returns(prices_10y)

    print("Fetching 20y price data (for scenarios + correlation)...")
    prices_long = fetch_prices(period="20y", tickers=all_tickers)

    # Compute each portfolio mode
    portfolios = {}
    for key, cfg in PORTFOLIO_MODES.items():
        print(f"\n=== Mode: {cfg['label']} ===")
        portfolios[key] = compute_mode(prices_10y, returns_10y, prices_long, cfg)
        # Echo flags so the frontend knows which modes need the holdings panel
        if cfg.get("is_active_fund_spotlight"):
            portfolios[key]["is_active_fund_spotlight"] = True

    # Attach disclosed-holdings reference data to active-fund spotlight modes.
    # Loaded from the preprocessed JSON (committed to repo so CI doesn't need
    # openpyxl). Missing files degrade gracefully.
    if os.path.exists(ACTIVE_FUND_HOLDINGS_PATH):
        try:
            with open(ACTIVE_FUND_HOLDINGS_PATH) as f:
                holdings_data = json.load(f).get("funds", {})
            for mode_key, mode in portfolios.items():
                if not mode.get("is_active_fund_spotlight"):
                    continue
                fund_ticker = PORTFOLIO_MODES[mode_key]["tickers"][0]
                if fund_ticker in holdings_data:
                    mode["fund_disclosure"] = holdings_data[fund_ticker]
                    print(f"  Attached {fund_ticker} holdings: "
                          f"n={mode['fund_disclosure']['n_holdings']}, "
                          f"as_of={mode['fund_disclosure']['as_of']}")
        except Exception as e:
            print(f"  WARNING: failed to load active-fund holdings ({e})")
    else:
        print(f"\nNo active-fund holdings JSON at {ACTIVE_FUND_HOLDINGS_PATH}; "
              f"run preprocess_holdings.py first.")

    # Live external probability signals — attached to relevant hypothetical scenarios.
    # NY Fed yield-curve recession probability (Estrella-Trubin 2006).
    print("\nFetching yield-curve data for NY Fed recession probability...")
    try:
        y10, y3m, spread = fetch_yield_curve_spread()
        recession_prob = nyfed_recession_probability(spread)
        ny_fed_live = {
            "name":         "NY Fed yield-curve model — live",
            "value":        round(float(recession_prob) * 100, 1),
            "value_label":  f"{round(float(recession_prob) * 100, 1)}%",
            "context":      f"From current 10Y - 3M spread of {spread:+.2f}% ({y10:.2f}% – {y3m:.2f}%)",
            "url":          "https://www.newyorkfed.org/research/capital_markets/ycfaq.html",
            "live":         True,
        }
        print(f"  10Y={y10:.2f}%  3M={y3m:.2f}%  spread={spread:+.2f}%  →  P(recession 12mo) = {recession_prob*100:.1f}%")
    except Exception as e:
        print(f"  WARNING: failed to compute live recession probability ({e}); using static sources only.")
        ny_fed_live = None

    # Augment hypothetical scenarios in each portfolio with probability sources
    for portfolio in portfolios.values():
        for sc in portfolio.get("scenarios", []):
            if sc.get("type") != "hypothetical":
                continue
            sources = list(PROBABILITY_SOURCES.get(sc["id"], []))
            sc["probability_sources"] = sources
            if sc["id"] == "us_recession" and ny_fed_live is not None:
                sc["probability_live"] = ny_fed_live

    # GARCH / tGARCH backtests — heavy compute, separately cached.
    # Trigger a refresh by setting RISKLENS_FULL_BACKTEST=1 before invoking.
    refresh_garch = os.environ.get("RISKLENS_FULL_BACKTEST", "0") == "1"
    if refresh_garch:
        print("\n[FULL BACKTEST MODE] Re-computing GARCH/tGARCH backtests (slow)...")
        garch_cache = {}
        for key, cfg in PORTFOLIO_MODES.items():
            print(f"  GARCH(1,1) backtest for {cfg['label']}...")
            g = backtest_portfolio_garch(prices_long, cfg["weights"], asymmetric=False)
            print(f"  GJR-tGARCH backtest for {cfg['label']}...")
            tg = backtest_portfolio_garch(prices_long, cfg["weights"], asymmetric=True)
            garch_cache[key] = [r for r in [g, tg] if r is not None]

        os.makedirs(os.path.dirname(GARCH_CACHE_PATH), exist_ok=True)
        with open(GARCH_CACHE_PATH, "w") as f:
            json.dump({
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "portfolios":   garch_cache,
            }, f, indent=2)
        print(f"  Wrote GARCH cache → {GARCH_CACHE_PATH}")
    else:
        garch_cache = {}
        if os.path.exists(GARCH_CACHE_PATH):
            try:
                with open(GARCH_CACHE_PATH) as f:
                    cache_data = json.load(f)
                garch_cache = cache_data.get("portfolios", {})
                print(f"\nLoaded GARCH backtest cache (generated {cache_data.get('generated_at', 'unknown')})")
            except Exception as e:
                print(f"\nWARNING: failed to load GARCH cache ({e}); GARCH/tGARCH backtests will be omitted.")
        else:
            print(f"\nNo GARCH cache at {GARCH_CACHE_PATH}; run RISKLENS_FULL_BACKTEST=1 python run.py to populate.")

    # Merge cached GARCH/tGARCH into each portfolio's backtests array
    for key, p in portfolios.items():
        cached = garch_cache.get(key, [])
        p["backtests"] = p["backtests"] + cached

    # S&P 500 historical chart
    print("\nFetching S&P 500 full history (^GSPC)...")
    sp500_returns, sp500_prices = fetch_sp500_history()
    print("Fetching VIX history...")
    vix = fetch_vix_history()
    print("  Computing yearly risk history...")
    sp500_history = compute_sp500_history(sp500_returns, sp500_prices, vix=vix)

    # Cross-asset correlation, with rolling-60-day VIX overlay
    print("Computing rolling cross-asset correlation...")
    corr_cols = [c for c in CORR_TICKERS if c in prices_long.columns]
    corr_returns = compute_log_returns(prices_long[corr_cols])
    corr_history = compute_rolling_correlation(corr_returns)

    # Smooth VIX with the same 60-day window as the correlation series so the
    # two metrics are visually comparable on the chart's twin axes.
    vix_smooth = vix.rolling(60, min_periods=20).mean()
    for entry in corr_history:
        d = pd.Timestamp(entry["date"])
        if d in vix_smooth.index:
            v = vix_smooth.loc[d]
        else:
            idx = vix_smooth.index.get_indexer([d], method="pad")[0]
            v = vix_smooth.iloc[idx] if idx >= 0 else None
        entry["vix"] = round(float(v), 2) if v is not None and pd.notna(v) else None

    # Multi-window stock-bond correlation: SPY × {AGG, TLT, IEF, LQD} at
    # 20d, 60d, 252d windows. Different windows reveal different time scales
    # of regime change — recent shifts surface in the 20d series first.
    print("Computing multi-window SPY × bond correlations (AGG, TLT, IEF, LQD)...")
    multi_window_corr = compute_multi_window_correlation(
        prices_long,
        primary="SPY",
        bond_proxies=["AGG", "TLT", "IEF", "LQD"],
        windows=[20, 60, 252],
    )
    for bond, by_window in multi_window_corr.items():
        windows_present = [w for w in by_window if by_window[w]]
        print(f"  {bond}: windows {windows_present}")

    # Intraday SPY-TLT correlation at multiple sampling intervals.
    # 5-min:  more observations per day (78), but more microstructure noise / Epps attenuation
    # 15-min: cleaner magnitudes (academic-literature default for cross-asset corr), but fewer obs (26)
    # We compute both so the chart can offer a toggle and the user can verify
    # the regime signal is robust across sampling choices.
    intraday_corr = {}
    for interval in ("5m", "15m"):
        print(f"Fetching {interval} intraday SPY and TLT...")
        try:
            spy_intra = fetch_intraday_data("SPY", interval=interval)
            tlt_intra = fetch_intraday_data("TLT", interval=interval)
            # Threshold for valid days scales with sampling interval —
            # need at least ~25% of a full session's observations
            min_obs = 20 if interval == "5m" else 8
            series = compute_intraday_correlation_daily(spy_intra, tlt_intra, min_obs=min_obs)
            intraday_corr[f"interval_{interval}"] = series
            if series:
                n_pos = sum(1 for r in series if r["corr"] > 0)
                print(f"  {interval}: {len(series)} trading days · "
                      f"{n_pos} positive ({n_pos / len(series) * 100:.0f}%)")
        except Exception as e:
            print(f"  WARNING: {interval} intraday correlation fetch failed ({e})")
            intraday_corr[f"interval_{interval}"] = []

    # Latest US-equity trading date represented in the data. We walk back from
    # the end of SPY's series until its price actually changes — this strips off
    # any trailing rows that are forward-fill artifacts from 24/7-traded tickers
    # like BTC reaching past the most recent US market close.
    spy_series = prices_10y["SPY"]
    i = len(spy_series) - 1
    while i > 0 and spy_series.iloc[i] == spy_series.iloc[i - 1]:
        i -= 1
    data_as_of = prices_10y.index[i].strftime("%Y-%m-%d")

    output = {
        "generated_at":           datetime.now(timezone.utc).isoformat(),
        "data_as_of":             data_as_of,
        "default_mode":           "hypothetical",
        "portfolios":             portfolios,
        "sp500_history":          sp500_history,
        "correlation_history":    corr_history,
        "multi_window_corr":      multi_window_corr,
        "intraday_corr_history":  intraday_corr,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    counts = {k: len(p["assets"]) for k, p in portfolios.items()}
    print(f"\nWrote portfolios → {OUTPUT_PATH}")
    for k, n in counts.items():
        print(f"  {k}: {n} asset rows")


if __name__ == "__main__":
    main()
