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
    ANOMALY_TICKERS, ANOMALY_NAMES,
    compute_log_returns, fetch_prices, fetch_sp500_history, fetch_vix_history,
    fetch_yield_curve_spread, fetch_intraday_data,
)
from risk_engine import (
    compute_asset_risk, compute_sp500_history, compute_rolling_correlation,
    compute_scenarios, compute_hypothetical_scenarios,
    compute_portfolio_risk_history, compute_component_var,
    backtest_portfolio_var, backtest_portfolio_garch,
    nyfed_recession_probability, compute_intraday_correlation_daily,
    compute_multi_window_correlation, compute_anomaly_view,
    CORR_TICKERS,
)
from factor_models import (
    fetch_ff_carhart_daily, fit_ff_carhart, compute_beta,
    compute_rolling_ff_loadings, compute_thematic_exposures,
    THEMATIC_BASKETS,
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

# Active-fund spotlight modes — the portfolio is the fund's *look-through
# basket*: each disclosed top-N underlying is a per-asset row with its own
# risk metrics, weighted by its disclosed weight (re-normalized over the
# top-N). The fund's own ticker stays in the tickers list as a final
# reference row (no weight) so users can compare the look-through basket
# vs. the fund's own NAV — the difference is the manager's discretionary
# trading effect since the disclosure date plus expense-ratio drag.
#
# Both dicts are placeholders that get fully overwritten by
# _augment_active_fund_modes_with_holdings() before the pipeline runs.
CGGO_WEIGHTS = {}
DWLD_WEIGHTS = {}

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
        "label":       "CGGO Look-Through",
        "description": "Capital Group Global Growth Equity ETF (CGGO) modeled as a look-through basket of its top 25 disclosed holdings. Each underlying is a per-asset risk row weighted by its disclosed weight (re-normalized over the top 25). The CGGO ETF row at the bottom shows the fund's own NAV-based risk for comparison vs. the basket.",
        "tickers":     ["CGGO"],   # overwritten by _augment_active_fund_modes_with_holdings
        "names":       {"CGGO": ACTIVE_FUND_NAMES["CGGO"]},
        "weights":     CGGO_WEIGHTS,
        "name":        "CGGO Top-25 Basket (Look-Through)",
        "is_active_fund_spotlight": True,
        "fund_ticker": "CGGO",
    },
    "dwld_active": {
        "label":       "DWLD Look-Through",
        "description": "Davis Select Worldwide ETF (DWLD) modeled as a look-through basket of its top 25 disclosed holdings. Each underlying is a per-asset risk row weighted by its disclosed weight (re-normalized over the top 25). The DWLD ETF row at the bottom shows the fund's own NAV-based risk for comparison vs. the basket.",
        "tickers":     ["DWLD"],   # overwritten by _augment_active_fund_modes_with_holdings
        "names":       {"DWLD": ACTIVE_FUND_NAMES["DWLD"]},
        "weights":     DWLD_WEIGHTS,
        "name":        "DWLD Top-25 Basket (Look-Through)",
        "is_active_fund_spotlight": True,
        "fund_ticker": "DWLD",
    },
}


def compute_portfolio_row(returns: pd.DataFrame, weights: dict, name: str,
                          min_history_days: int = 252) -> dict:
    """
    Build a weighted portfolio return series and run all risk models on it.
    Uses the common date range across all tickers in `weights`.

    Tickers with less than `min_history_days` of return history are dropped
    from the basket aggregation and the remaining weights re-normalized.
    This protects the look-through basket portfolios from being truncated
    to the shortest-history holding (e.g. a recently-listed holding cutting
    a 5-year basket window down to 100 days). Per-asset risk rows for the
    dropped tickers are still computed independently.
    """
    avail   = []
    dropped = []
    for t in weights:
        if t not in returns.columns:
            dropped.append((t, "no data fetched"))
            continue
        history_len = int(returns[t].dropna().shape[0])
        if history_len < min_history_days:
            dropped.append((t, f"only {history_len}d history"))
            continue
        avail.append(t)

    if not avail:
        # Should never hit on real portfolios, but fail safe rather than
        # divide-by-zero downstream.
        raise ValueError(
            f"No tickers in weights have at least {min_history_days} days of history"
        )

    if dropped:
        print(f"    Basket excludes {len(dropped)} ticker(s) for insufficient history: "
              + ", ".join(f"{t} ({why})" for t, why in dropped))

    raw_weights = np.array([weights[t] for t in avail])
    norm_weights = raw_weights / raw_weights.sum()  # re-normalize over survivors

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
    Convert each active-fund spotlight mode into a *look-through basket*:

      tickers = top-N underlyings (mapped to yfinance) + fund ticker (last)
      weights = each underlying's disclosed weight, re-normalized to sum to 1.0
                (the fund itself is in tickers but NOT in weights — it's a
                reference row for comparing basket vs. actual fund NAV)
      names   = security names for each underlying

    This mirrors the synthetic Hypothetical mode pattern: each holding is
    its own per-asset risk row, the portfolio summary is the weighted
    basket aggregate. Compute_component_var, scenarios, backtests, and
    risk history all auto-derive from the new weights dict.

    Also stamps the mode with `coverage_meta` describing what fraction of
    the actual fund's weight is captured by the modeled basket — this is
    the caveat the frontend surfaces in the section header.

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
        fund_ticker = cfg.get("fund_ticker") or cfg["tickers"][0]
        fund = holdings_index.get(fund_ticker)
        if not fund:
            print(f"  WARNING: no disclosure data for {fund_ticker}, mode {mode_key} unchanged")
            continue

        # Take top-N holdings that have a yf_ticker. Some sponsors include
        # cash components or unmappable foreign listings; we drop those and
        # re-normalize the surviving weights.
        topn_disclosed = fund.get("holdings", [])[:TOP_N]
        candidates = [
            h for h in topn_disclosed
            if h.get("yf_ticker") and h["yf_ticker"] != fund_ticker
        ]
        if not candidates:
            print(f"  WARNING: no mappable underlyings for {fund_ticker}, mode {mode_key} unchanged")
            continue

        raw_weight_sum = sum(h["weight"] for h in candidates)
        new_weights        = {}
        new_disclosed_pct  = {}   # raw weight as % of *fund* (pre-normalization)
        new_names          = {fund_ticker: cfg["names"].get(fund_ticker, fund_ticker)}
        new_tickers        = []
        for h in candidates:
            yf = h["yf_ticker"]
            new_tickers.append(yf)
            new_weights[yf] = h["weight"] / raw_weight_sum  # re-normalize over modeled subset
            new_disclosed_pct[yf] = h["weight"]              # untouched fund-level weight (%)
            new_names[yf] = h.get("security", yf)

        # Append fund itself at the END as a reference row (not weighted,
        # so it doesn't affect portfolio aggregation, but its risk metrics
        # still get computed and displayed for comparison).
        new_tickers.append(fund_ticker)

        cfg["tickers"]           = new_tickers
        cfg["weights"]            = new_weights
        cfg["disclosed_weights"]  = new_disclosed_pct
        cfg["names"]              = new_names

        # Coverage metadata for the frontend caveat
        actual_top_n_weight = sum(h["weight"] for h in topn_disclosed)
        total_disclosed     = fund.get("total_weight_pct", 100.0)
        cfg["coverage_meta"] = {
            "modeled_n":             len(candidates),
            "modeled_weight_pct":    round(actual_top_n_weight, 2),  # of the fund as disclosed
            "total_holdings":        fund.get("n_holdings"),
            "total_disclosed_pct":   round(total_disclosed, 2),
            "as_of":                 fund.get("as_of"),
        }
        print(f"  Restructured {mode_key}: {len(candidates)} basket underlyings + 1 fund reference; "
              f"basket covers {actual_top_n_weight:.1f}% of fund's disclosed weight")


def main():
    # Active-fund spotlight modes get expanded with their disclosed top-25
    # underlying holdings (mapped to yfinance tickers via the preprocessor).
    # Each underlying becomes its own per-asset risk row in the table.
    # Weights remain {fund_ticker: 1.0} — the portfolio is still the fund;
    # underlyings are read-only context with individual risk metrics.
    _augment_active_fund_modes_with_holdings()

    # Master ticker list — union of everything we need across all modes,
    # plus extra bond proxies for the multi-window correlation chart and
    # the sector ETF universe for the Anomaly Detector tab.
    all_tickers = []
    for cfg in PORTFOLIO_MODES.values():
        all_tickers.extend(cfg["tickers"])
    all_tickers = list(dict.fromkeys(
        all_tickers + EXTRA_BOND_PROXIES + ANOMALY_TICKERS
    ))

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
            portfolios[key]["fund_ticker"] = cfg.get("fund_ticker")
            if cfg.get("coverage_meta"):
                portfolios[key]["coverage_meta"] = cfg["coverage_meta"]
            if cfg.get("disclosed_weights"):
                portfolios[key]["disclosed_weights"] = cfg["disclosed_weights"]

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
                fund_ticker = PORTFOLIO_MODES[mode_key].get("fund_ticker")
                if fund_ticker and fund_ticker in holdings_data:
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

    # Anomaly Detector views — for each sector ETF in ANOMALY_TICKERS,
    # compute the univariate detectors (z-score, CUSUM, GARCH-residual),
    # a compact "risk profile" with the same VaR/ES/EVT models from the
    # Portfolio Risk tab, and a Fama-French + Momentum factor regression
    # (the open-data substitute for a Barra-style attribution).
    print("\nComputing univariate anomaly views for sector ETFs...")

    # SPY excess-return series for the beta-vs-market calc — reused across
    # all anomaly tickers.
    spy_rets = compute_log_returns(prices_long[["SPY"]])["SPY"].dropna()

    # Fetch the Fama-French + Momentum factors once. If the live download
    # fails we fall back to the cached copy (see factor_models.py).
    print("  Fetching Fama-French + Momentum daily factors...")
    try:
        ff_factors = fetch_ff_carhart_daily()
        print(f"    {len(ff_factors)} rows, latest {ff_factors.index[-1].date()}")
    except Exception as e:
        print(f"  WARNING: factor data unavailable ({e}); factor models will be omitted")
        ff_factors = None

    anomaly_views = {"tickers": [], "names": {}, "data": {}}
    for tkr in ANOMALY_TICKERS:
        if tkr not in prices_long.columns:
            print(f"  [skip] {tkr} not in price data")
            continue
        px = prices_long[tkr].dropna()
        if len(px) < 252:
            print(f"  [skip] {tkr} only {len(px)}d history (need 252+)")
            continue
        rets = np.log(px / px.shift(1)).dropna()
        try:
            view = compute_anomaly_view(tkr, px, rets, lookback_days=504)
        except Exception as e:
            print(f"  WARNING: {tkr} anomaly view failed ({e})")
            continue
        if not view:
            continue

        # --- Risk profile card — same VaR/ES/EVT/tail-α used on the
        #     Portfolio Risk tab, plus annualized 60-day vol and beta vs SPY.
        try:
            risk_row = compute_asset_risk(tkr, rets, px)
            vol_60d  = float(rets.tail(60).std() * np.sqrt(252) * 100)
            beta_spy = compute_beta(rets, spy_rets, lookback=252)
            view["risk_profile"] = {
                "vol_60d_annualized_pct": round(vol_60d, 2),
                "var_hs":         risk_row["var_hs"],
                "var_ewma":       risk_row["var_ewma"],
                "var_garch":      risk_row["var_garch"],
                "var_tgarch":     risk_row["var_tgarch"],
                "var_evt":        risk_row["var_evt"],
                "var_yr_10pct":   risk_row.get("var_yr_10pct"),
                "es_yr_10pct":    risk_row.get("es_yr_10pct"),
                "yr_nu":          risk_row.get("yr_nu"),
                "es_hs":          risk_row["es_hs"],
                "es_ewma":        risk_row["es_ewma"],
                "es_garch":       risk_row["es_garch"],
                "es_tgarch":      risk_row["es_tgarch"],
                "es_evt":         risk_row["es_evt"],
                "tail_index":     risk_row["tail_index"],
                "risk_level":     risk_row["risk_level"],
                "beta_spy_252d":  beta_spy,
                "last_price":     risk_row["last_price"],
                "last_return_pct": risk_row["last_return_pct"],
            }
        except Exception as e:
            print(f"  WARNING: {tkr} risk profile failed ({e})")

        # --- Fama-French + Momentum factor regression (open-data
        #     substitute for a Barra-style attribution).
        if ff_factors is not None:
            try:
                fmodel = fit_ff_carhart(rets, ff_factors, lookback=252)
                if fmodel:
                    view["factor_model"] = fmodel
            except Exception as e:
                print(f"  WARNING: {tkr} factor model failed ({e})")

            # --- Rolling factor loadings over time — the medium-horizon
            #     analog of the single-snapshot regression. Catches style
            #     drift on the 1-2 year cycle that long-horizon PMs
            #     actually care about (vs the daily detectors above).
            try:
                rolling = compute_rolling_ff_loadings(
                    rets, ff_factors,
                    window=252, step=21, lookback_years=5,
                )
                if rolling:
                    view["factor_model_rolling"] = rolling
            except Exception as e:
                print(f"  WARNING: {tkr} rolling factor loadings failed ({e})")

        # --- Thematic basket exposure regression.
        #     Regress this ticker against orthogonalized sector-ETF
        #     "themed baskets" (oil, semis, regional banks, duration,
        #     etc.) for interpretable risk-driver exposures that map to
        #     narrative scenarios rather than to abstract academic factors.
        try:
            basket_tickers = [b[0] for b in THEMATIC_BASKETS]
            basket_returns = {
                t: np.log(prices_long[t] / prices_long[t].shift(1)).dropna()
                for t in basket_tickers if t in prices_long.columns
            }
            thematic = compute_thematic_exposures(
                rets, basket_returns, lookback=252, exclude_self=tkr,
            )
            if thematic:
                view["thematic_exposures"] = thematic
        except Exception as e:
            print(f"  WARNING: {tkr} thematic exposures failed ({e})")

        anomaly_views["data"][tkr]  = view
        anomaly_views["names"][tkr] = ANOMALY_NAMES.get(tkr, tkr)
        anomaly_views["tickers"].append(tkr)
        n_anom = len(view["anomalies"])
        fm     = view.get("factor_model")
        rsq    = f", R²={fm['r_squared']*100:.0f}%" if fm else ""
        print(f"  {tkr}: {len(view['series'])} days, {n_anom} anomaly day(s){rsq}")

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
        "anomaly_views":          anomaly_views,
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
