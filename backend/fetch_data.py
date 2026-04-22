import yfinance as yf
import pandas as pd
import numpy as np

TICKERS = ["SPY", "QQQ", "GLD", "TLT", "EEM", "BTC-USD"]

NAMES = {
    "SPY": "S&P 500 ETF",
    "QQQ": "Nasdaq 100 ETF",
    "GLD": "Gold ETF",
    "TLT": "20yr Treasury ETF",
    "EEM": "Emerging Markets ETF",
    "BTC-USD": "Bitcoin / USD",
}


def fetch_prices(period: str = "10y") -> pd.DataFrame:
    frames = {}
    for ticker in TICKERS:
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
    prices = prices.reindex(columns=TICKERS)

    # Forward-fill gaps (handles BTC weekend data and other missing values)
    prices = prices.ffill()

    return prices


def compute_log_returns(prices: pd.DataFrame) -> pd.DataFrame:
    return np.log(prices / prices.shift(1)).dropna()


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
