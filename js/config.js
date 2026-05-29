/* Global configuration: name→ticker mapping, constants, metric glossary. */
window.CONFIG = {
  // Annual risk-free rate used for Sharpe / Information ratio (AUD cash ~ RBA).
  RISK_FREE_ANNUAL: 0.0435,
  TRADING_DAYS: 252,
  BENCHMARK_LABEL: 'ASX 200',

  // Company name (as it appears in the broker statement) -> ASX ticker code.
  // Used to value open positions and link trades to the price feed.
  NAME_TO_TICKER: {
    '4Dmedical Ltd': '4DX',
    'ALS Ltd': 'ALQ',
    'APA Group': 'APA',
    'Adisyn Ltd': 'AI1',
    'Artrya Ltd': 'AYA',
    'Aurizon Holdings Ltd': 'AZJ',
    'Australian Strategic Materials Limited': 'ASM',
    'Codan Ltd': 'CDA',
    'Cuscal Ltd': 'CCL',
    'Dalrymple Bay Infrastructure Ltd': 'DBI',
    'Dyno Nobel Ltd': 'DNL',
    'Evolution Mining Ltd': 'EVN',
    'G50 Corp Ltd': 'G50',
    'IPD Group Ltd': 'IPG',
    'Iluka Resources Ltd': 'ILU',
    'Lindian Resources Ltd': 'LIN',
    'Liontown Ltd': 'LTR',
    'Macmahon Holdings Ltd': 'MAH',
    'Megaport Ltd': 'MP1',
    'Metals X Ltd': 'MLX',
    'Minerals 260 Ltd': 'MI6',
    'NRW Holdings': 'NWH',
    'Nick Scali Ltd': 'NCK',
    'PLS Group Ltd': 'PLS',
    'Redox Ltd': 'RDX',
    'Regis Resources Ltd': 'RRL',
    'Resolute Mining': 'RSG',
    'Santos Ltd': 'STO',
    'Smartgroup Corporation Ltd': 'SIQ',
    'Southern Cross Electrical Engineering LTD': 'SXE',
    'Starpharma Holdings Ltd': 'SPL',
    'Sunrise Energy Metals Ltd': 'SRL',
    'Superloop Ltd': 'SLC',
    'TPG Telecom Ltd': 'TPG',
    'Telstra (AU)': 'TLS',
    'Westgold Resources Ltd': 'WGX',
    'Woolworths Group Ltd': 'WOW'
  },

  GLOSSARY: [
    ['Total P&L', 'Sum of realised profit and loss across all closed trades in the period (gross of commission).'],
    ['Win rate', 'Winning trades divided by total closed trades.'],
    ['Profit factor', 'Gross profit ÷ gross loss. Above 1.0 is profitable; 2.0+ is strong.'],
    ['Avg win / loss', 'Mean P&L of winning trades and of losing trades, shown separately.'],
    ['Max drawdown', 'Largest peak-to-trough decline of the equity curve over the period.'],
    ['Sharpe ratio', 'Annualised excess return (over the risk-free rate) per unit of total volatility, computed from the daily equity return series.'],
    ['Information ratio', 'Annualised active return versus the ASX 200 benchmark, divided by tracking error (volatility of the active return).'],
    ['Avg holding period', 'Mean calendar days a position is held, split by winners, losers and overall.'],
    ['Total commissions', 'All commission charges paid in the period, taken directly from the statement.'],
    ['Total funding', 'Overnight financing ("Holding Cost") on leveraged positions over the period. Per-trade P&L and returns are GROSS of this — it is shown separately and folded into Net P&L.'],
    ['Net P&L', 'Gross realised P&L minus commission and overnight funding.'],
    ['Equity curve', 'The actual account balance over time (straight from the statement), so the starting point is robust to re-uploads. The ASX 200 is rebased to the same starting value.'],
    ['Return %', 'Per-trade P&L as a percentage of the notional position value at entry (entry price × shares).']
  ]
};
