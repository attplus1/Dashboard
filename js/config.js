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
    'Catalyst Metals Ltd': 'CYL',
    'Downer EDI Ltd': 'DOW',
    'European Lithium Ltd': 'EUR',
    'IGO Ltd': 'IGO',
    'News Corp - B (AU)': 'NWS',
    'Perseus Mining Ltd': 'PRU',
    'SRG Global Ltd': 'SRG',
    'Whitehaven Coal Ltd': 'WHC',
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

  // Grouped glossary. Audience: equities traders who know the basics but not
  // risk-adjusted ratios — so those get the fullest, plain-English treatment,
  // and obvious terms (win rate, avg win/loss, etc.) are omitted.
  GLOSSARY: [
    ['Risk-adjusted ratios', [
      ['Sharpe ratio',
       'How much return you earned above a "safe" cash rate for each unit of overall volatility (how much the account bounces around). It answers "was the return worth the bumpiness?" Higher is better — as a rough guide, above 1 is good, above 2 is excellent. Can be negative if you underperformed cash.'],
      ['Sortino ratio',
       'Like Sharpe, but it only counts downside volatility — the losing days. Big upside swings are not penalised, since you don\'t mind those. It better reflects "bad" risk; higher is better.'],
      ['Calmar ratio',
       'Annualised return divided by the worst peak-to-trough drop (max drawdown). It answers "how much did I make relative to the most painful loss along the way?" Higher is better.'],
      ['Information ratio',
       'How much you beat (or trailed) the ASX 200 benchmark, divided by how consistently you did so. It measures skill at outperforming the index rather than just riding the market — higher means more reliable outperformance.'],
      ['Max drawdown',
       'The largest peak-to-trough fall in the account over the period, shown as a % and in dollars. A gauge of the worst losing stretch you would have had to sit through.']
    ]],
    ['How figures are calculated', [
      ['Gross vs Net P&L',
       'Gross P&L is the realised result straight from the statement, before costs. Net P&L subtracts commission and overnight funding.'],
      ['Total funding',
       'Overnight financing ("Holding Cost") charged on leveraged positions held overnight. Per-trade P&L and returns are shown gross of this; it is tracked separately and folded into Net P&L.'],
      ['Return %',
       'A trade\'s P&L as a percentage of its notional value at entry (entry price × shares) — i.e. the move on the full position size, not on margin posted.'],
      ['Profit factor',
       'Gross profit divided by gross loss. Above 1.0 means winners outweigh losers; 2.0+ is strong.'],
      ['Equity curve',
       'Your actual account balance over time, taken directly from the statement. The ASX 200 is rebased to your starting balance so the two lines are directly comparable.'],
      ['Most profitable day',
       'The entry weekday with the highest total P&L (or average return, per the display toggle), drawn from the weekday chart above.'],
      ['Net expectancy',
       'The average net result you can expect per closed trade — Net P&L (gross plus commission and funding) divided by the number of trades. Positive means a typical trade adds to the account after costs.']
    ]]
  ]
};
