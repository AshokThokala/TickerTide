"""The set of instruments the pipeline tracks by default."""

INDICES = {
    "^GSPC": "S&P 500",
    "^DJI": "Dow Jones",
    "^IXIC": "Nasdaq",
    "^RUT": "Russell 2000",
    "^VIX": "VIX",
    "GC=F": "Gold",
    "CL=F": "Crude Oil",
    "BTC-USD": "Bitcoin",
}

# Offline fallback only: the live universe is the S&P 500 list from
# constituents.py. Used when no constituents source has ever been reachable.
SECTORS = {
    "Information Technology": ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO"],
    "Communication Services": ["GOOGL", "META", "NFLX", "DIS", "T", "VZ"],
    "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX"],
    "Consumer Staples": ["WMT", "PG", "KO", "PEP", "COST"],
    "Financials": ["JPM", "BAC", "WFC", "GS", "MS", "V", "MA"],
    "Health Care": ["LLY", "UNH", "JNJ", "MRK", "ABBV", "PFE"],
    "Industrials": ["CAT", "BA", "GE", "HON", "UPS"],
    "Energy": ["XOM", "CVX", "COP"],
    "Utilities": ["NEE", "DUK", "SO"],
    "Real Estate": ["PLD", "AMT", "O"],
    "Materials": ["LIN", "SHW", "FCX"],
}
