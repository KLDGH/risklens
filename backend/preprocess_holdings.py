"""
Preprocess fund-holdings xlsx files into a clean JSON for the pipeline.

Run locally whenever you drop a new xlsx into ext-data/ — commits the
resulting JSON, and the GitHub Actions runner reads JSON only (no
openpyxl needed in CI).

Currently handles two fund-disclosure formats:
  - Capital Group ETF daily-holdings xlsx (sheet "Daily Fund Holdings",
    headers on row 3, "Percent of Net Assets" as decimal weight)
  - Dimensional (DFA) ETF daily-holdings xlsx (similar structure, row
    offsets autodetected)

Usage:
    python backend/preprocess_holdings.py
"""

import json
import os
import re
import sys
from datetime import datetime

import pandas as pd


REPO_ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT_DATA_DIR  = os.path.join(REPO_ROOT, "ext-data")
OUTPUT_PATH   = os.path.join(REPO_ROOT, "backend", "data", "active_fund_holdings.json")

# Per-fund metadata. Sponsor / mandate descriptors are static so users see
# context next to the risk numbers without having to look elsewhere.
# Each registry entry declares the file pattern and reader-specific overrides
# (xlsx sheet name, CSV header row, etc.). The reader auto-routes by extension.
FUND_REGISTRY = {
    "CGGO": {
        "fund_name":   "Capital Group Global Growth Equity ETF",
        "sponsor":     "Capital Group",
        "mandate":     "Active global growth equity",
        "inception":   "2022-02-22",
        "category":    "Active ETF",
        "file_glob":   "CGGO_*.xlsx",
        "sheet_name":  "Daily Fund Holdings",
    },
    "DWLD": {
        "fund_name":   "Davis Select Worldwide ETF",
        "sponsor":     "Davis Advisors",
        "mandate":     "Active global concentrated equity (value-leaning)",
        "inception":   "2017-01-11",
        "category":    "Active ETF",
        "file_glob":   "DavisSelectWorldwide*.csv",
        "sheet_name":  None,
    },
}


# Trailing security-name boilerplate to strip so the holdings table stays
# legible. Examples this cleans up:
#   "TAIWAN SEMICONDUCTOR SP ADR ADR"            -> "Taiwan Semiconductor"
#   "MICRON TECHNOLOGY INC COMMON STOCK USD.1"   -> "Micron Technology"
#   "ALPHABET INC CL A COMMON STOCK USD.001"     -> "Alphabet Cl A"
#   "ASML HOLDING NV COMMON STOCK EUR.09"        -> "Asml Holding"
# ---------------------------------------------------------------------------
# Ticker mapping — sponsors disclose tickers in their own conventions
# (Bloomberg-style, Korean A-prefix, etc.). yfinance is friendly to US
# tickers and most ADRs; foreign listings need explicit exchange suffixes.
#
# Strategy:
#   1. If the ticker is already a plain US-style symbol (1-5 alpha chars),
#      return as-is.
#   2. If it matches a known pattern (Korean A-prefix, Bloomberg-style with
#      space + 2-letter exchange code), translate to yfinance suffix form.
#   3. Apply manual overrides for holdings where the cleanest yfinance route
#      is the ADR rather than the foreign listing (e.g. Siemens -> SIEGY).
#   4. Otherwise return None — the holding will be flagged as not having a
#      risk row in the asset table but will still appear in the disclosure
#      panel.
# ---------------------------------------------------------------------------

# Bloomberg 2-letter country/exchange codes -> yfinance suffix
_BBG_SUFFIX = {
    "US": "",       # US (no suffix)
    "KS": ".KS",    # Korea
    "HK": ".HK",    # Hong Kong
    "NA": ".AS",    # Amsterdam (Netherlands)
    "GR": ".DE",    # Germany Xetra / Frankfurt
    "GY": ".DE",    # Alt Germany code some sponsors use
    "SS": ".ST",    # Stockholm
    "SM": ".MC",    # Madrid
    "IM": ".MI",    # Milan
    "FP": ".PA",    # Paris
    "BB": ".BR",    # Brussels
    "LN": ".L",     # London
    "JP": ".T",     # Tokyo
    "SE": ".SW",    # Switzerland (best guess; SAP's "GR" handled elsewhere)
    "SW": ".SW",    # Switzerland alt
    "IN": ".NS",    # India NSE
    "BZ": ".SA",    # Brazil
}

# Manual overrides for tickers where ADR is cleaner than foreign listing
# OR where the sponsor-disclosed symbol can't be auto-mapped.
_TICKER_OVERRIDES = {
    # CGGO-style (no exchange suffix, just the symbol)
    "A000660": "000660.KS",   # SK Hynix
    "A005930": "005930.KS",   # Samsung Electronics
    "A012450": "012450.KS",   # Hanwha Aerospace
    "SIE":     "SIEGY",        # Siemens ADR
    "AIR":     "EADSY",        # Airbus ADR
    "III":     "III.L",        # 3i Group (London listing)
    "PRX":     "PROSY",        # Prosus ADR
    "NESN":    "NSRGY",        # Nestle ADR
    "AV/":     "AV.L",         # Aviva (London)
    "BHARTI":  "BHARTIARTL.NS", # Bharti Airtel
    "7011":    "7011.T",       # Mitsubishi Heavy
    "VALE3":   "VALE",         # Vale ADR
    "2282":    "2282.HK",      # Hong Kong listing
    "SAAB B":  "SAAB-B.ST",    # Saab Sweden Class B
}


def _map_to_yf_ticker(ticker: str) -> str | None:
    """Translate a sponsor-format ticker into a yfinance-fetchable symbol."""
    if not isinstance(ticker, str):
        return None
    t = ticker.strip()
    if not t or t.lower() in ("nan", "none"):
        return None

    # Manual overrides first
    if t in _TICKER_OVERRIDES:
        return _TICKER_OVERRIDES[t]

    # Bloomberg-style: "TICKER XX" where XX is 2-letter exchange code
    parts = t.split()
    if len(parts) == 2 and len(parts[1]) == 2 and parts[1].isalpha():
        symbol, code = parts[0], parts[1].upper()
        if code in _BBG_SUFFIX:
            return symbol + _BBG_SUFFIX[code]

    # Korean A-prefix: A005930 -> 005930.KS
    if re.fullmatch(r"A\d{6}", t):
        return t[1:] + ".KS"

    # Pure US-style: alpha 1-5 chars (covers TSM, MU, etc.)
    if re.fullmatch(r"[A-Z]{1,5}", t):
        return t

    # Numeric-only Hong Kong (e.g., "2318" stand-alone)
    if re.fullmatch(r"\d{4,5}", t):
        return t + ".HK"

    return None


_NAME_NOISE_RX = re.compile(
    r"\s+(?:"
    r"COMMON\s+STOCK"
    r"|SP\s+ADR\s+ADR|ADR\s+ADR|SP\s+ADR|ADR"
    r"|REG"
    r"|USD\.[\d]+(?:[Ee]?-?\d+)?"
    r"|EUR\.[\d]+|GBP\.[\d.]+|JPY[\d.]*|KRW[\d.]+|HKD[\d.]+|CHF[\d.]+|SEK[\d.]+"
    r"|EUR[\d.]+|GBP[\d.]+|USD[\d.]+"
    r"|INC|PLC|CORP|CO\s+LTD|LTD|NV|SE|SA|AG|AB|AS|OY|NPV|PJSC|SAS"
    r"|CLASS\s+[A-Z]|CL\s+[A-Z]"
    r")\b",
    flags=re.IGNORECASE,
)


def _clean_security_name(name: str) -> str:
    """Strip boilerplate suffixes; preserve share-class hints (Cl A, Class A)."""
    if not isinstance(name, str):
        return ""
    s = name.strip()
    # Re-apply the regex until it stops changing — handles stacked suffixes.
    for _ in range(5):
        new = _NAME_NOISE_RX.sub("", s).strip()
        if new == s:
            break
        s = new
    # Squash internal whitespace and strip trailing punctuation that's left
    # over from things like "Samsung Electronics Co., Ltd." → "Samsung Electronics Co.,"
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[\s,.;:]+$", "", s)        # trailing punctuation
    s = re.sub(r",\s*,+", ",", s)            # collapse double commas
    s = re.sub(r"\.\s*\.+", ".", s)          # collapse double periods
    return s.title() if s else name


def _find_source_file(file_glob: str) -> str | None:
    """Locate a fund's source file by glob in ext-data/. Picks the latest by name."""
    if not os.path.isdir(EXT_DATA_DIR):
        return None
    import fnmatch
    matches = sorted([
        f for f in os.listdir(EXT_DATA_DIR)
        if fnmatch.fnmatch(f, file_glob)
    ])
    return os.path.join(EXT_DATA_DIR, matches[-1]) if matches else None


def _detect_header_row(raw: pd.DataFrame, max_scan: int = 12) -> int | None:
    """
    Scan the first few rows for the column-headers line. Different sponsors
    use different terminology so we accept any row that mentions a ticker-ish
    column AND a weight-ish column.
    """
    for i in range(min(max_scan, len(raw))):
        row_vals = [str(v) for v in raw.iloc[i].dropna().tolist()]
        joined = " | ".join(row_vals).lower()
        has_ticker = "ticker" in joined
        has_weight = any(s in joined for s in [
            "percent of net assets", "weight", "% of", "weighting",
        ])
        if has_ticker and has_weight:
            return i
    return None


def _detect_as_of(raw: pd.DataFrame, header_row: int) -> str | None:
    """Pull a date out of any row above the headers (file title line typically)."""
    for i in range(header_row):
        for v in raw.iloc[i].dropna():
            m = re.search(r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", str(v))
            if m:
                try:
                    return pd.to_datetime(m.group(1)).strftime("%Y-%m-%d")
                except Exception:
                    continue
    return None


def _read_holdings(path: str, sheet_name: str | None) -> tuple[pd.DataFrame, str | None]:
    """
    Read a holdings file (xlsx or csv), locate the header row, and return
    a clean DataFrame with normalized column names + an as-of date if found.
    """
    ext = os.path.splitext(path)[1].lower()

    if ext == ".csv":
        # Davis Advisors and similar ship a title row + trailing-comma padding.
        # Read with no header, find the data header line, then re-read.
        raw = pd.read_csv(path, header=None, dtype=str, keep_default_na=False,
                          on_bad_lines="skip")
        header_row = _detect_header_row(raw)
        if header_row is None:
            raise ValueError(f"Could not find header row in {path}")
        as_of = _detect_as_of(raw, header_row)
        df = pd.read_csv(path, header=header_row, dtype=str, keep_default_na=False,
                         on_bad_lines="skip")
        # Strip the columns that are just blank trailing-padding artifacts
        df = df.loc[:, [c for c in df.columns if str(c).strip() and not str(c).startswith("Unnamed")]]
        df.columns = [str(c).strip() for c in df.columns]
        # Numeric coercion happens later; keep strings here so we don't fight
        # comma-thousand-separators in Shares / Market Value.
        return df, as_of

    # xlsx path
    xl = pd.ExcelFile(path)
    if sheet_name is None or sheet_name not in xl.sheet_names:
        for s in xl.sheet_names:
            if "holding" in s.lower():
                sheet_name = s
                break
        else:
            sheet_name = xl.sheet_names[-1]
    raw = xl.parse(sheet_name, header=None)
    header_row = _detect_header_row(raw)
    if header_row is None:
        raise ValueError(f"Could not find header row in {path}::{sheet_name}")
    as_of = _detect_as_of(raw, header_row)
    df = xl.parse(sheet_name, header=header_row)
    df.columns = [str(c).strip() for c in df.columns]
    return df, as_of


def _normalize(df: pd.DataFrame, fund_ticker: str) -> dict:
    """Convert a holdings DataFrame to the canonical record shape."""
    # Find the relevant columns by best-effort matching (sponsor formats vary).
    def _col(candidates):
        for c in df.columns:
            cl = c.lower()
            for cand in candidates:
                if cand in cl:
                    return c
        return None

    name_col    = _col(["security name", "security", "name"])
    ticker_col  = _col(["ticker"])
    type_col    = _col(["asset type", "asset class", "type"])
    weight_col  = _col(["weighting", "percent of net assets", "% of net", "weight", "% market"])
    country_col = _col(["country"])

    if not all([name_col, weight_col]):
        raise ValueError(f"Missing required columns. Found: {df.columns.tolist()}")

    # Equity-only when the file gives us asset-type info — drop cash, FX
    # hedges, derivatives. When asset type is absent (Davis CSV), assume
    # everything is equity (their CSV doesn't include cash rows separately).
    keep = df.copy()
    if type_col is not None:
        keep = keep[keep[type_col].astype(str).str.lower().str.contains("equity", na=False)]

    # Coerce weight to numeric, handling string CSV (with possible % signs)
    weights_numeric = pd.to_numeric(
        keep[weight_col].astype(str).str.replace("%", "", regex=False).str.strip(),
        errors="coerce",
    )
    keep = keep.loc[weights_numeric.notna() & (weights_numeric > 0)].copy()
    keep["_weight_num"] = weights_numeric.loc[keep.index]

    # Detect whether weight is decimal (0.0672) or percent (6.72) by max value
    weight_is_decimal = keep["_weight_num"].max() <= 1.5

    holdings = []
    for _, row in keep.iterrows():
        weight_val = float(row["_weight_num"])
        weight_pct = weight_val * 100 if weight_is_decimal else weight_val
        raw_ticker = (str(row[ticker_col]).strip()
                      if ticker_col and pd.notna(row[ticker_col]) else "")
        rec = {
            "security": _clean_security_name(row[name_col]),
            "ticker":   raw_ticker,
            "weight":   round(weight_pct, 4),
        }
        # Attach yfinance-compatible mapping (or null when unmappable). This
        # determines whether the holding becomes an asset row in the risk
        # table or stays panel-only.
        yf = _map_to_yf_ticker(raw_ticker)
        if yf:
            rec["yf_ticker"] = yf
        if country_col is not None and pd.notna(row.get(country_col)):
            country = str(row[country_col]).strip()
            if country and country.lower() not in ("nan", "none", ""):
                rec["country"] = country
        holdings.append(rec)

    holdings.sort(key=lambda h: h["weight"], reverse=True)
    for i, h in enumerate(holdings, start=1):
        h["rank"] = i

    total_weight = sum(h["weight"] for h in holdings)

    # Concentration stats — top-10/top-25 weight sums quantify the
    # contrast between concentrated (CGGO, DWLD) and broad (DFAX) funds.
    top10 = round(sum(h["weight"] for h in holdings[:10]), 4)
    top25 = round(sum(h["weight"] for h in holdings[:25]), 4)

    return {
        "n_holdings":             len(holdings),
        "total_weight_pct":       round(total_weight, 4),
        "top10_concentration_pct": top10,
        "top25_concentration_pct": top25,
        "holdings":               holdings,
    }


def main():
    out = {
        "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "funds": {},
    }

    for ticker, meta in FUND_REGISTRY.items():
        path = _find_source_file(meta["file_glob"])
        if not path:
            print(f"  [skip] no holdings file for {ticker} matching {meta['file_glob']} in {EXT_DATA_DIR}")
            continue
        print(f"  Reading {ticker} from {os.path.basename(path)} ...")
        try:
            df, as_of = _read_holdings(path, meta["sheet_name"])
            payload  = _normalize(df, ticker)
        except Exception as e:
            print(f"    FAILED: {e}")
            continue

        out["funds"][ticker] = {
            "ticker":     ticker,
            "fund_name":  meta["fund_name"],
            "sponsor":    meta["sponsor"],
            "mandate":    meta["mandate"],
            "category":   meta["category"],
            "inception":  meta["inception"],
            "as_of":      as_of,
            "source_file": os.path.basename(path),
            **payload,
        }
        print(f"    {ticker}: {payload['n_holdings']} equity holdings, "
              f"top10={payload['top10_concentration_pct']:.1f}%, "
              f"top25={payload['top25_concentration_pct']:.1f}%, "
              f"as_of={as_of}")

    if not out["funds"]:
        print("No funds processed. Drop a holdings xlsx into ext-data/ and re-run.")
        sys.exit(1)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
