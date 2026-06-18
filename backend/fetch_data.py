import yfinance as yf
import pandas as pd
import numpy as np



TICKERS = [
    "SPY", "EFA", "EEM", "QQQ", "IWM",
    "IEF", "TLT", "LQD", "HYG", "TIP",
    "GLD", "DBC", "VNQ", "BTC-USD",
]

NAMES = {
    "SPY":    "S&P 500 ETF",
    "EFA":    "MSCI EAFE (Intl Developed) ETF",
    "EEM":    "Emerging Markets ETF",
    "QQQ":    "Nasdaq 100 ETF",
    "IWM":    "Russell 2000 ETF",
    "IEF":    "7-10yr Treasury ETF",
    "TLT":    "20yr Treasury ETF",
    "LQD":    "Investment Grade Bond ETF",
    "HYG":    "High Yield Bond ETF",
    "TIP":    "TIPS (Inflation-Linked) ETF",
    "GLD":    "Gold ETF",
    "DBC":    "Broad Commodities ETF",
    "VNQ":    "Real Estate ETF",
    "BTC-USD":"Bitcoin / USD",
}

# Underlying holdings of Vanguard Target Retirement 2055 (VFFVX),
# mapped to ETF equivalents for transparent daily NAV access.
TDF_2055_TICKERS = ["VTI", "VXUS", "BND", "BNDX"]

TDF_2055_NAMES = {
    "VTI":  "Vanguard Total Stock Market ETF",
    "VXUS": "Vanguard Total International Stock ETF",
    "BND":  "Vanguard Total Bond Market ETF",
    "BNDX": "Vanguard Total International Bond ETF",
}

# Underlying holdings of American Funds Target Date Retirement 2055 (AAFTX).
# Capital Group TDFs hold actively-managed American Funds mutual funds, not
# ETFs — so the layered structure is materially different from Vanguard.
CG_2055_TICKERS = [
    "AGTHX", "AIVSX", "ANCFX", "AWSHX", "AMRMX",
    "ANWPX", "AEPGX", "CWGIX", "NEWFX", "SMCWX",
    "ABNDX", "AMUSX",
]

CG_2055_NAMES = {
    "AGTHX": "Growth Fund of America",
    "AIVSX": "Investment Company of America",
    "ANCFX": "Fundamental Investors",
    "AWSHX": "Washington Mutual Investors",
    "AMRMX": "American Mutual Fund",
    "ANWPX": "New Perspective Fund",
    "AEPGX": "EuroPacific Growth Fund",
    "CWGIX": "Capital World Growth & Income",
    "NEWFX": "New World Fund",
    "SMCWX": "SMALLCAP World Fund",
    "ABNDX": "Bond Fund of America",
    "AMUSX": "U.S. Government Securities Fund",
}

# Underlying look-through of the iShares Core 60/40 Balanced Allocation ETF
# (AOR) — a real, publicly-traded fund-of-ETFs. Holdings as disclosed
# 2026-06-11, re-normalized over the seven underlying funds (the ~0.1% net
# cash sweep is dropped). This gives the app a real, well-known multi-asset
# fund as its showcase portfolio rather than an invented book.
AOR_TICKERS = ["IVV", "IUSB", "IDEV", "IEMG", "IAGG", "IJH", "IJR"]

AOR_NAMES = {
    "IVV":  "iShares Core S&P 500 ETF",
    "IUSB": "iShares Core Total USD Bond Market ETF",
    "IDEV": "iShares Core MSCI Intl Developed ETF",
    "IEMG": "iShares Core MSCI Emerging Markets ETF",
    "IAGG": "iShares Core International Aggregate Bond ETF",
    "IJH":  "iShares Core S&P Mid-Cap ETF",
    "IJR":  "iShares Core S&P Small-Cap ETF",
}

# Active stock-picker ETFs spotlighted as standalone single-fund modes.
# Each is an active global equity ETF from a distinct sponsor — selected to
# let users compare two competing answers to the same active-management
# mandate, with their disclosed holdings shown alongside the risk metrics.
ACTIVE_FUND_TICKERS = ["CGGO", "DWLD"]

ACTIVE_FUND_NAMES = {
    "CGGO": "Capital Group Global Growth Equity ETF",
    "DWLD": "Davis Select Worldwide ETF",
}

# Tickers surfaced in the Anomaly Detector tab — sector ETFs that are
# liquid, well-followed, and clean for univariate single-asset analysis.
# 11 SPDR sectors + 3 thematic (regional banks, semis, biotech) where
# anomaly events have historically had clear macro narratives.
ANOMALY_TICKERS = [
    # SPDR sector ETFs (S&P 500 sectors)
    "XLF",  # Financials
    "XLE",  # Energy
    "XLK",  # Technology
    "XLV",  # Health Care
    "XLI",  # Industrials
    "XLY",  # Consumer Discretionary
    "XLP",  # Consumer Staples
    "XLU",  # Utilities
    "XLB",  # Materials
    "XLRE", # Real Estate
    "XLC",  # Communication Services
    # Thematic / sub-sector
    "KRE",  # Regional Banks (SVB blowup, etc.)
    "SMH",  # Semiconductors
    "IBB",  # Biotechnology
]

ANOMALY_NAMES = {
    "XLF":  "Financials",
    "XLE":  "Energy",
    "XLK":  "Technology",
    "XLV":  "Health Care",
    "XLI":  "Industrials",
    "XLY":  "Consumer Discretionary",
    "XLP":  "Consumer Staples",
    "XLU":  "Utilities",
    "XLB":  "Materials",
    "XLRE": "Real Estate",
    "XLC":  "Communication Services",
    "KRE":  "Regional Banks",
    "SMH":  "Semiconductors",
    "IBB":  "Biotechnology",
}


def fetch_prices(period: str = "10y", tickers: list = None) -> pd.DataFrame:
    if tickers is None:
        tickers = TICKERS

    frames = {}
    for ticker in tickers:
        try:
            raw = yf.download(ticker, period=period, auto_adjust=True,
                              progress=False, threads=False)
            if isinstance(raw.columns, pd.MultiIndex):
                col = raw["Close"].iloc[:, 0]
            else:
                col = raw["Close"]
            frames[ticker] = col
        except Exception as e:
            print(f"  WARNING: failed to download {ticker}: {e}")

    prices = pd.DataFrame(frames)
    prices = prices.reindex(columns=tickers)

    # Forward-fill gaps (handles BTC weekend data and other missing values)
    prices = prices.ffill()

    return prices


def compute_log_returns(prices: pd.DataFrame) -> pd.DataFrame:
    # Use dropna(how="all") rather than how="any" so a single ticker with a
    # short history (e.g. a recently-listed ETF or international holding)
    # doesn't truncate the entire DataFrame to its intersection date. Each
    # downstream consumer (compute_asset_risk, compute_portfolio_row, etc.)
    # is responsible for its own per-asset .dropna() on the columns it uses.
    return np.log(prices / prices.shift(1)).dropna(how="all")

# TODO: Explore not going back as far given what we want to visualize (70s-80s)

def fetch_vix_history() -> pd.Series:
    """Fetch VIX index history for overlay on the S&P 500 chart."""
    raw = yf.download("^VIX", period="max", auto_adjust=True,
                      progress=False, threads=False)
    if isinstance(raw.columns, pd.MultiIndex):
        prices = raw["Close"].iloc[:, 0]
    else:
        prices = raw["Close"]
    return prices.ffill().dropna()


def fetch_sp500_history() -> tuple[pd.Series, pd.Series]:
    """Fetch maximum available S&P 500 history (^GSPC, back to 1927)."""
    raw = yf.download("^GSPC", period="max", auto_adjust=True,
                      progress=False, threads=False)
    if isinstance(raw.columns, pd.MultiIndex):
        prices = raw["Close"].iloc[:, 0]
    else:
        prices = raw["Close"]
    prices = prices.ffill().dropna()
    returns = np.log(prices / prices.shift(1)).dropna()
    return returns, prices


def fetch_yield_curve_spread() -> tuple[float, float, float]:
    """
    Fetch the current 10Y - 3M Treasury yield spread.
    Returns (latest_10y_pct, latest_3m_pct, spread_pct) as floats in percent.
    Used to compute the NY Fed yield-curve recession probability.
    """
    def _last(symbol: str) -> float:
        raw = yf.download(symbol, period="3mo", auto_adjust=False,
                          progress=False, threads=False)
        if isinstance(raw.columns, pd.MultiIndex):
            s = raw["Close"].iloc[:, 0]
        else:
            s = raw["Close"]
        s = s.ffill().dropna()
        return float(s.iloc[-1])

    # ^TNX = CBOE 10-Year Treasury Yield Index (quoted in tenths of a percent — 45 = 4.5%)
    # ^IRX = CBOE 13-Week Treasury Bill Index (already in percent, e.g. 5.2)
    tnx_raw = _last("^TNX")
    irx_raw = _last("^IRX")
    # ^TNX is reported as percent × 10 historically, but yfinance returns it
    # already in percent for recent quotes. Handle both: if value > 30, divide by 10.
    y10 = tnx_raw / 10 if tnx_raw > 30 else tnx_raw
    y3m = irx_raw  # already in percent
    return y10, y3m, y10 - y3m


def fetch_intraday_data(
    ticker: str,
    interval: str = "15m",
    period: str = "60d",
) -> pd.Series:
    """
    Fetch intraday bars for `ticker` over the last 60 days (yfinance limit).
    Supported intervals: "1m" (7-day window only), "2m"/"5m"/"15m"/"30m"/"60m"
    (60-day window). Returns a price series indexed by timezone-aware timestamps
    (US Eastern when available).
    """
    raw = yf.download(
        ticker, interval=interval, period=period, auto_adjust=True,
        progress=False, threads=False,
    )
    if isinstance(raw.columns, pd.MultiIndex):
        s = raw["Close"].iloc[:, 0]
    else:
        s = raw["Close"]
    return s.dropna()
