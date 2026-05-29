"""
Curated reference values for the dashboard's risk metrics.

Why this module exists
----------------------
Elkan's critique of the dashboard: "I have no way of seeing if these numbers
are approximately correct." When a reader sees "tGARCH VaR = 4.2% for XLF",
nothing on screen tells them whether 4.2% is normal, suspicious, or obviously
broken. They'd need to remember off the top of their head that financial-
sector VaR is usually 2-3.5% in calm regimes and 5-10% in stress.

This module ships a small curated reference table that the frontend appends
to the relevant InfoTip text. The reader hovers a metric and immediately
sees both the model's answer AND the expected range for that asset class.

Sources
-------
Reference values are aggregated from:
  - McNeil, Frey & Embrechts, "Quantitative Risk Management" (Princeton,
    2015) — ch. 2 (loss distributions), ch. 7 (heavy tails)
  - Fama & French data library historical-distribution notes
  - Pflueger & Sunderam (NBER WP 27906, 2020) on stock-bond correlation
    regimes
  - Author's own backtest history of this dashboard's outputs (2014-2025)

The numbers are deliberately given as bands ("Typical: X-Y%"), not point
estimates — the goal is gut-check calibration, not pseudo-precision. If you
want a single authoritative reference per ticker, this is the wrong tool;
use Bloomberg/MSCI/Barra.
"""

# ----------------------------------------------------------------------------
# Asset-class taxonomy. Maps each dashboard ticker to a category that shares
# typical risk-profile bands. Multiple tickers can map to the same class
# (SPY/IVV/VOO are all "broad_us_equity") — keeps the reference table small.
# ----------------------------------------------------------------------------
ASSET_CLASS: dict[str, str] = {
    # Broad US equity
    "SPY":  "broad_us_equity",
    "IVV":  "broad_us_equity",
    "VOO":  "broad_us_equity",
    "VTI":  "broad_us_equity",
    # Tech-heavy
    "QQQ":  "large_cap_tech",
    "XLK":  "large_cap_tech",
    "VGT":  "large_cap_tech",
    "SMH":  "semis",
    # Financials
    "XLF":  "financials",
    "KRE":  "regional_banks",
    # Health / biotech
    "XLV":  "healthcare",
    "IBB":  "biotech",
    "XBI":  "biotech",
    # Cyclical sectors
    "XLE":  "energy",
    "XLI":  "industrials",
    "XLY":  "consumer_disc",
    "XLB":  "materials",
    # Defensive sectors
    "XLP":  "defensive_staples",
    "XLU":  "defensive_utilities",
    # Other
    "XLRE": "real_estate",
    "VNQ":  "real_estate",
    "XLC":  "communications",
    "IWM":  "small_cap_equity",
    # Fixed income
    "TLT":  "long_treasuries",
    "IEF":  "intermediate_treasuries",
    "AGG":  "broad_bond",
    "LQD":  "ig_credit",
    "HYG":  "hy_credit",
    "TIP":  "tips",
    # International
    "EFA":  "developed_intl",
    "EEM":  "emerging_intl",
    # Alternatives
    "GLD":  "gold",
    "DBC":  "commodities",
    "BTC-USD": "crypto",
    "UUP":  "fx_dollar",
}


# ----------------------------------------------------------------------------
# Reference bands per asset class. Keys are the metric names the frontend
# looks up (var_1d_99, year_var_10, hill_alpha, ff_market_beta, ff_smb, etc.).
# Each value is a short prose string appended to the tooltip text in the UI.
# ----------------------------------------------------------------------------
REFERENCES: dict[str, dict[str, str]] = {
    # ---------- Broad US equity ----------
    "broad_us_equity": {
        "var_1d_99":      "Typical range for broad US equity: 2.0-3.5% (calm regimes like 2017-2019), 5-9% (crisis regimes — Oct 2008, Mar 2020). Below 2% suggests the model may be missing volatility clustering; above 10% is regime-shift territory.",
        "year_var_10":    "Typical range for broad US equity: 12-18% (calm baselines), 22-32% (post-crisis). Anchored by the historical S&P 500 drawdown distribution.",
        "hill_alpha":     "Broad equity indices: 3.0-4.0. Below 2.5 means fatter-than-normal tail; above 4.5 the tail looks too thin and EVT estimates may be unreliable.",
        "ff_market_beta": "Expected: 0.95-1.05 (SPY-like funds are the market by construction).",
        "ff_smb":         "Expected: -0.10 to +0.10 (large-cap by construction).",
        "ff_hml":         "Expected: -0.20 to +0.20.",
    },
    # ---------- Tech-heavy ----------
    "large_cap_tech": {
        "var_1d_99":      "Typical range for large-cap tech: 2.5-4.5% (calm), 6-12% (tech-sector stress — dotcom unwind, 2022 rates shock).",
        "year_var_10":    "Typical range: 16-24% (calm), 28-40% (post-shock).",
        "hill_alpha":     "Large-cap tech: 2.5-3.5. Tail typically fatter than broad equity.",
        "ff_market_beta": "Expected: 1.05-1.25 (amplified market beta).",
        "ff_smb":         "Expected: -0.10 to +0.10 (mostly large-cap).",
        "ff_hml":         "Expected: -0.40 to -0.10 (growth tilt — negative HML by construction).",
        "ff_rmw":         "Expected: 0.00 to +0.30 (mega-cap tech is typically profitable).",
        "ff_mom":         "Expected: -0.10 to +0.30 (often momentum-loading during tech-led rallies).",
    },
    "semis": {
        "var_1d_99":      "Semis are among the most volatile equity sub-sectors: 3.5-6% (calm), 8-15% (cycle peaks/troughs — 2018, late 2022).",
        "year_var_10":    "Typical: 22-32% (calm), 35-55% (cycle stress).",
        "hill_alpha":     "Semis: 2.3-3.2. Fatter tail than broad tech.",
        "ff_market_beta": "Expected: 1.20-1.60 (highest among sector ETFs).",
        "ff_hml":         "Expected: -0.50 to -0.10 (deep growth tilt).",
    },
    # ---------- Financials ----------
    "financials": {
        "var_1d_99":      "Typical range for diversified financials: 2.0-3.5% (calm), 5-10% (financial-sector stress — March 2020, March 2023 regional-bank panic).",
        "year_var_10":    "Typical: 14-22% (calm), 30-50% (post-2008 baselines).",
        "hill_alpha":     "Financials: 2.5-3.5. Fat-tailed due to leverage and contagion sensitivity.",
        "ff_market_beta": "Expected: 1.00-1.25.",
        "ff_hml":         "Expected: +0.10 to +0.40 (value tilt — typical book-value-anchored).",
        "ff_smb":         "Expected: -0.10 to +0.15.",
    },
    "regional_banks": {
        "var_1d_99":      "Regional banks are higher-vol than diversified financials: 2.5-5% (calm), 8-20% (sector blowups — Mar 2023 KRE hit -25% in one week).",
        "year_var_10":    "Typical: 20-30% (calm), 40-60% (post-blowup).",
        "hill_alpha":     "Regional banks: 2.0-2.8. Notably fat-tailed.",
        "ff_market_beta": "Expected: 0.90-1.30.",
        "ff_hml":         "Expected: +0.30 to +0.70 (deep value tilt).",
        "ff_smb":         "Expected: +0.20 to +0.60 (smaller-cap exposure).",
    },
    # ---------- Health / biotech ----------
    "healthcare": {
        "var_1d_99":      "Diversified healthcare is one of the lowest-VaR sectors: 1.5-2.5% (calm), 4-7% (pandemic-era spikes, 2020).",
        "year_var_10":    "Typical: 10-16%.",
        "hill_alpha":     "Healthcare: 3.0-4.0.",
        "ff_market_beta": "Expected: 0.75-1.00 (defensive tilt).",
        "ff_hml":         "Expected: -0.15 to +0.20.",
    },
    "biotech": {
        "var_1d_99":      "Biotech is volatile and idiosyncratic: 3-5% (calm), 7-14% (FDA / earnings cycles, 2022 small-biotech bear).",
        "year_var_10":    "Typical: 25-40%.",
        "hill_alpha":     "Biotech: 2.5-3.3.",
        "ff_market_beta": "Expected: 0.90-1.20.",
        "ff_smb":         "Expected: +0.20 to +0.60 (XBI especially small-biotech tilted).",
    },
    # ---------- Cyclical sectors ----------
    "energy": {
        "var_1d_99":      "Energy is the most regime-dependent sector: 1.5-3% in stable commodity regimes, 6-15% during oil shocks (2014-16 collapse, COVID March 2020 oil futures crash, 2022 invasion spike).",
        "year_var_10":    "Typical: 20-35% (calm), 40-60% (shock).",
        "hill_alpha":     "Energy: 2.0-3.0. Fat tails from oil-price discontinuities.",
        "ff_market_beta": "Expected: 0.80-1.40 (varies with oil regime).",
        "ff_hml":         "Expected: +0.30 to +0.80 (strong value tilt).",
    },
    "industrials": {
        "var_1d_99":      "Typical: 2-3.5% (calm), 5-9% (recession scares).",
        "year_var_10":    "Typical: 14-22%.",
        "ff_market_beta": "Expected: 1.05-1.25.",
    },
    "consumer_disc": {
        "var_1d_99":      "Typical: 2-4% (calm), 5-10% (recession scares, 2022 rates shock).",
        "year_var_10":    "Typical: 16-26%.",
        "ff_market_beta": "Expected: 1.05-1.30 (pro-cyclical).",
    },
    "materials": {
        "var_1d_99":      "Materials track global growth: 2-3.5% (calm), 5-10% (China-cycle / global-demand shocks).",
        "ff_market_beta": "Expected: 1.05-1.30.",
    },
    # ---------- Defensive sectors ----------
    "defensive_staples": {
        "var_1d_99":      "Staples are the lowest-VaR equity sector: 1.0-2.0% (calm), 3-5% (broad market stress — but typically less than half SPY's stress reading).",
        "year_var_10":    "Typical: 8-14%.",
        "hill_alpha":     "Staples: 3.5-4.5. Thinnest equity tails in the sector universe.",
        "ff_market_beta": "Expected: 0.50-0.75 (low-beta defensive).",
        "ff_hml":         "Expected: -0.05 to +0.25.",
    },
    "defensive_utilities": {
        "var_1d_99":      "Utilities: 1.5-2.5% (calm), 4-7% (rate shocks — utilities are duration-sensitive).",
        "year_var_10":    "Typical: 10-16%.",
        "hill_alpha":     "Utilities: 3.0-4.0.",
        "ff_market_beta": "Expected: 0.40-0.70.",
        "ff_hml":         "Expected: 0.00 to +0.30.",
    },
    # ---------- Other equity ----------
    "real_estate": {
        "var_1d_99":      "REITs: 2-3.5% (calm), 6-12% (rate shocks, 2022 — REITs are very duration-sensitive).",
        "year_var_10":    "Typical: 16-26%.",
        "ff_market_beta": "Expected: 0.85-1.15.",
        "ff_hml":         "Expected: +0.10 to +0.50.",
    },
    "communications": {
        "var_1d_99":      "Comm services (post-2018 reclassification — includes Meta, Google, Netflix): 2-3.5% (calm), 5-10% (mega-cap tech blowups).",
        "ff_market_beta": "Expected: 1.00-1.20.",
        "ff_hml":         "Expected: -0.30 to 0.00.",
    },
    "small_cap_equity": {
        "var_1d_99":      "Small caps: 2.5-4% (calm), 6-12% (recession scares — small caps lead going down).",
        "year_var_10":    "Typical: 18-28%.",
        "hill_alpha":     "Small caps: 2.8-3.5.",
        "ff_market_beta": "Expected: 1.00-1.20.",
        "ff_smb":         "Expected: +0.60 to +1.00 (by construction).",
    },
    # ---------- Fixed income ----------
    "long_treasuries": {
        "var_1d_99":      "Long Treasuries (TLT): 1.0-2.0% (calm), 3-6% (rate-shock episodes — 2013 taper tantrum, 2022 inflation shock).",
        "year_var_10":    "Typical: 8-16%.",
        "ff_market_beta": "Expected: -0.20 to +0.10 (low equity correlation; sometimes negative).",
    },
    "intermediate_treasuries": {
        "var_1d_99":      "Intermediate Treasuries (IEF): 0.5-1.2% (calm), 1.5-3% (rate shocks).",
        "year_var_10":    "Typical: 4-9%.",
    },
    "broad_bond": {
        "var_1d_99":      "Broad bond aggregate (AGG): 0.4-1.0% (calm), 1.5-3% (rate shocks like 2022).",
        "year_var_10":    "Typical: 4-10%.",
    },
    "ig_credit": {
        "var_1d_99":      "IG corporates (LQD): 0.8-1.5% (calm), 3-7% (credit-spread blowouts — Mar 2020).",
    },
    "hy_credit": {
        "var_1d_99":      "HY corporates (HYG): 1.5-2.5% (calm), 5-10% (credit cycles — 2015-16 energy default scare, Mar 2020).",
    },
    "tips": {
        "var_1d_99":      "TIPS: 0.6-1.2% (calm), 2-4% (real-yield shocks).",
    },
    # ---------- International ----------
    "developed_intl": {
        "var_1d_99":      "Developed-ex-US equity (EFA): 2-3.5% (calm), 5-10% (Euro/UK crises, Yen blowups).",
        "ff_market_beta": "Expected: 0.85-1.05 against US market.",
    },
    "emerging_intl": {
        "var_1d_99":      "EM equity (EEM): 2.5-4.5% (calm), 6-15% (EM crises — 2015 China devaluation, 2018 Turkey/Argentina).",
        "hill_alpha":     "EM: 2.3-3.2.",
    },
    # ---------- Alternatives ----------
    "gold": {
        "var_1d_99":      "Gold: 1.5-2.5% (calm), 3-6% (crisis hedging spikes or sell-the-news downdrafts).",
        "ff_market_beta": "Expected: -0.10 to +0.20 (low equity correlation; sometimes negative in stress).",
    },
    "commodities": {
        "var_1d_99":      "Broad commodities (DBC): 2-3.5% (calm), 5-12% (commodity-cycle peaks/troughs).",
    },
    "crypto": {
        "var_1d_99":      "BTC: 4-8% (calm regimes), 10-25% (FTX, Luna, 2018 winter, 2022 bear — outsized vs. all other asset classes).",
        "year_var_10":    "Typical: 50-90% (drawdowns of -60 to -80% have recurred every 3-4 years).",
        "hill_alpha":     "BTC: 1.8-2.5. Among the fattest tails of any traded asset.",
        "ff_market_beta": "Variable: -0.5 to +1.5 depending on regime. Highly unstable.",
    },
    "fx_dollar": {
        "var_1d_99":      "USD index (UUP): 0.4-0.8% (calm), 1-2% (dollar regime shifts).",
    },
}


# ----------------------------------------------------------------------------
# Public lookup. Always returns a dict (empty if the ticker is unknown), so
# callers don't need to None-check at every call site.
# ----------------------------------------------------------------------------
def get_references_for_ticker(ticker: str) -> dict[str, str]:
    """Reference bands for `ticker`, keyed by metric name. Empty dict if unknown."""
    klass = ASSET_CLASS.get(ticker)
    if klass is None:
        return {}
    return REFERENCES.get(klass, {})


def get_factor_reference(ticker: str, factor: str) -> str | None:
    """Reference band for a specific Fama-French / Carhart factor loading.

    `factor` is one of the FF column names: Mkt-RF, SMB, HML, RMW, CMA, MOM.
    Returns the expected-range string or None if no curated band exists.
    """
    refs = get_references_for_ticker(ticker)
    # Map FF column names → reference keys
    factor_key = {
        "Mkt-RF": "ff_market_beta",
        "SMB":    "ff_smb",
        "HML":    "ff_hml",
        "RMW":    "ff_rmw",
        "CMA":    "ff_cma",
        "MOM":    "ff_mom",
    }.get(factor)
    if factor_key is None:
        return None
    return refs.get(factor_key)
