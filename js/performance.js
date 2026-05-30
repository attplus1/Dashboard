/* Performance tab: KPIs, tables, glossary, chart orchestration. */
(function () {
  const $ = s => document.querySelector(s);
  const money = (v,d=2)=> (v<0?'-$':'$')+Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
  const pct = (v,d=1)=> (v>=0?'+':'')+v.toFixed(d)+'%';
  const cls = v => v>0?'val-pos':(v<0?'val-neg':'');
  const ratio = v => v==null?'—':(v===Infinity?'∞':v.toFixed(2));
  const fmtD = d => (d instanceof Date && !isNaN(d.getTime())) ? d.toLocaleDateString('en-AU') : '—';

  let _tradesShown = [];       // closed trades in the table (newest-first)
  let _topWins = [], _topLosses = [];   // current top winners / losers
  let _openPos = [], _prices = null;    // open positions + latest prices
  const _candleCache = {};     // ticker -> [[date,o,h,l,c],...] | null (in-memory)
  let _openToken = 0;          // guards against out-of-order async opens
  const LS_CANDLES = 'plus1_candles_v1:';   // per-ticker browser cache
  const CANDLE_TTL = 12 * 3600 * 1000;      // re-fetch a ticker at most ~twice a day

  function lsGetCandles(ticker){
    try { return JSON.parse(localStorage.getItem(LS_CANDLES + ticker)); }
    catch(e){ return null; }
  }
  function lsSetCandles(ticker, rows){
    try { localStorage.setItem(LS_CANDLES + ticker, JSON.stringify({ ts:Date.now(), rows })); }
    catch(e){
      // Quota hit: drop our cached candles and try once more.
      try {
        Object.keys(localStorage).forEach(k=>{ if (k.startsWith(LS_CANDLES)) localStorage.removeItem(k); });
        localStorage.setItem(LS_CANDLES + ticker, JSON.stringify({ ts:Date.now(), rows }));
      } catch(e2){ /* give up; still works from memory this session */ }
    }
  }

  // Synchronous peek: in-memory, or a still-fresh browser-cached copy. Returns
  // the rows array, null (known-missing), or undefined (must fetch).
  function peekCandles(ticker){
    if (ticker in _candleCache) return _candleCache[ticker];
    const c = lsGetCandles(ticker);
    if (c && c.rows && c.rows.length && (Date.now()-c.ts) < CANDLE_TTL){
      _candleCache[ticker] = c.rows;
      return c.rows;
    }
    return undefined;
  }

  // Lazily fetch one ticker's slim OHLC from data/candles/<TICKER>.json, caching
  // it in memory and in the browser so revisits only fetch tickers they lack.
  async function loadCandles(ticker){
    const peek = peekCandles(ticker);
    if (peek !== undefined) return peek;
    let rows = null;
    try {
      const r = await fetch('data/candles/'+encodeURIComponent(ticker)+'.json', {cache:'no-store'});
      if (r.ok){ const j = await r.json(); rows = j.candles || j; }
    } catch(e){ rows = null; }
    if (rows && rows.length){
      lsSetCandles(ticker, rows);
    } else {
      const stale = lsGetCandles(ticker);          // offline/failed: use stale copy if any
      if (stale && stale.rows && stale.rows.length) rows = stale.rows;
    }
    _candleCache[ticker] = rows;
    return rows;
  }

  // Candlestick-shaped shimmer placeholder shown while a chart loads.
  function chartSkeleton(){
    const h = [42,64,54,72,48,82,66,52,76,60,88,70,58,84,62,46,74,90,68,55,80,63,86,57];
    return '<div class="chart-skeleton" aria-label="Loading price history">'
      + h.map(v=>`<i style="height:${v}%"></i>`).join('') + '</div>';
  }
  const unavailable = t => '<div class="chart-empty">Price history isn\'t available for '+t+'.</div>';

  function kpiCard(label, value, sub, tone){
    return `<div class="kpi ${tone||''}">
      <div class="k-label">${label}</div>
      <div class="k-value ${tone==='pos'?'val-pos':tone==='neg'?'val-neg':''}">${value}</div>
      <div class="k-sub">${sub||''}</div></div>`;
  }

  function renderKPIs(m, commission, funding){
    const net = m.totalPnl + commission + funding;
    const cards = [
      kpiCard('Gross P&L', money(m.totalPnl,0), 'realised, before fees',
              m.totalPnl>=0?'pos':'neg'),
      kpiCard('Net P&L', money(net,0), 'after commission & funding', net>=0?'pos':'neg'),
      kpiCard('Total commission', money(commission,0), 'paid in period', commission<0?'neg':''),
      kpiCard('Total funding', money(funding,0), 'overnight financing', funding<0?'neg':''),
      kpiCard('Win rate', m.winRate.toFixed(1)+'%', `${m.nWin}W : ${m.nLoss}L`, ''),
      kpiCard('Total trades', String(m.nTotal), `${m.nWin} win · ${m.nLoss} loss · ${m.nFlat} flat`, ''),
      kpiCard('Profit factor', ratio(m.profitFactor),
              `GP ${money(m.grossProfit,0)} / GL ${money(m.grossLoss,0)}`, ''),
      kpiCard('Avg win / loss', money(m.avgWin,0),
              `loss ${money(m.avgLoss,0)} · avg ${money(m.avgPnl,0)}`, ''),
      kpiCard('Max drawdown', m.maxDrawdown.pct.toFixed(1)+'%', money(m.maxDrawdown.dollars,0), 'neg'),
      kpiCard('Sharpe ratio', ratio(m.sharpe), 'annualised, excess', ''),
      kpiCard('Information ratio', ratio(m.infoRatio), 'vs '+window.CONFIG.BENCHMARK_LABEL, ''),
      kpiCard('Avg hold (all)', m.avgHoldAll.toFixed(1)+'d',
              `W ${m.avgHoldWin.toFixed(1)}d · L ${m.avgHoldLoss.toFixed(1)}d`, '')
    ];
    $('#kpi-grid').innerHTML = cards.join('');
  }

  function renderTopTrades(m, unit){
    const row = (t,kind,i) => `<tr class="row-link" data-kind="${kind}" data-idx="${i}" title="Click for entry/exit chart">
      <td><b>${t.ticker}</b></td>
      <td><span class="pill ${t.dir}">${t.dir}</span></td>
      <td class="num ${cls(t.pnl)}">${money(t.pnl,0)}</td>
      <td class="num ${cls(t.ret)}">${pct(t.ret)}</td>
      <td class="num">${t.holdDays.toFixed(1)}</td>
      <td>${fmtD(t.exitDt)}</td></tr>`;
    const tt = window.Metrics.topTrades(m.trades, 5, unit);
    _topWins = tt.winners; _topLosses = tt.losers;
    $('#top-winners tbody').innerHTML = tt.winners.length
      ? tt.winners.map((t,i)=>row(t,'win',i)).join('') : `<tr class="empty-row"><td colspan="6">No winning trades.</td></tr>`;
    $('#top-losers tbody').innerHTML = tt.losers.length
      ? tt.losers.map((t,i)=>row(t,'lose',i)).join('') : `<tr class="empty-row"><td colspan="6">No losing trades.</td></tr>`;
    $('#top-winners tbody').querySelectorAll('tr.row-link').forEach(tr=>
      tr.addEventListener('click', ()=> openTradeModal(_topWins[+tr.dataset.idx])));
    $('#top-losers tbody').querySelectorAll('tr.row-link').forEach(tr=>
      tr.addEventListener('click', ()=> openTradeModal(_topLosses[+tr.dataset.idx])));
  }

  function renderDistribution(m, unit){
    const h = window.Metrics.returnsHistogram(m.trades, unit);
    const isDollar = unit==='dollar';
    const mu = isDollar ? money(h.mean,0) : pct(h.mean,2);
    const sg = isDollar ? money(h.std,0)  : h.std.toFixed(2)+'%';
    $('#dist-stats').innerHTML = h.n>=2
      ? `<span>μ <b>${mu}</b></span>
         <span>σ <b>${sg}</b></span>
         <span>n <b>${h.n}</b></span>`
      : '';
    window.Charts.returnsDistChart('dist-chart', h);
  }

  function renderOpenPositions(openPositions, prices){
    const tb = $('#open-positions-table tbody');
    _openPos = openPositions; _prices = prices;
    if (!openPositions.length){ tb.innerHTML = `<tr class="empty-row"><td colspan="13">No open positions.</td></tr>`; return; }
    const now = new Date();
    tb.innerHTML = openPositions.map((p,i)=>{
      const px = prices && prices[p.ticker] ? prices[p.ticker].last : null;
      const value = p.price*p.units;
      let uPnl=null, uPct=null, last='—';
      if (px!=null){
        last = px.toFixed(3);
        const dir = p.dir==='long'?1:-1;
        uPnl = (px-p.price)*p.units*dir;
        uPct = (px/p.price-1)*100*dir;
      }
      const stopTxt = p.stop ? p.stop.toFixed(3) : '—';
      let distTxt='—';
      if (p.stop && px!=null){ distTxt = (((px-p.stop)/px)*100).toFixed(1)+'%'; }
      else if (p.stop){ distTxt = (((p.price-p.stop)/p.price)*100).toFixed(1)+'%'; }
      const days = (p.dt instanceof Date && !isNaN(p.dt.getTime()))
        ? Math.max(0,Math.round((now-p.dt)/86400000)) : '—';
      return `<tr class="row-link" data-idx="${i}" title="Click for entry chart">
        <td><b>${p.ticker}</b></td>
        <td><span class="pill ${p.dir}">${p.dir}</span></td>
        <td class="num">${p.units.toLocaleString()}</td>
        <td class="num">${p.price.toFixed(3)}</td>
        <td class="num">${last}</td>
        <td class="num">${money(value,0)}</td>
        <td class="num ${cls(uPnl||0)}">${uPnl==null?'—':money(uPnl,0)}</td>
        <td class="num ${cls(uPct||0)}">${uPct==null?'—':pct(uPct)}</td>
        <td class="num">${stopTxt}</td>
        <td class="num">${distTxt}</td>
        <td>${fmtD(p.dt)}</td>
        <td class="num">${days}</td>
        <td class="num val-neg">${money(p.commission,2)}</td>
      </tr>`;
    }).join('');
    tb.querySelectorAll('tr.row-link').forEach(tr=>
      tr.addEventListener('click', ()=> openPositionModal(_openPos[+tr.dataset.idx])));
  }

  function renderTradesTable(trades){
    const tb = $('#trades-table tbody');
    if (!trades.length){ tb.innerHTML = `<tr class="empty-row"><td colspan="11">No closed trades in this period.</td></tr>`; return; }
    _tradesShown = trades.slice().reverse();           // table is newest-first
    tb.innerHTML = _tradesShown.map((t,i)=>`<tr class="row-link" data-idx="${i}" title="Click for entry/exit chart">
      <td><b>${t.ticker}</b></td>
      <td><span class="pill ${t.dir}">${t.dir}</span></td>
      <td class="num">${t.units.toLocaleString()}</td>
      <td class="num">${t.entryPx.toFixed(3)}</td>
      <td class="num">${t.exitPx.toFixed(3)}</td>
      <td class="num ${cls(t.pnl)}">${money(t.pnl,2)}</td>
      <td class="num ${cls(t.ret)}">${pct(t.ret)}</td>
      <td class="num">${t.holdDays.toFixed(1)}</td>
      <td>${fmtD(t.entryDt)}</td>
      <td>${fmtD(t.exitDt)}</td>
      <td><span class="pill exit">${t.exitType}</span></td>
    </tr>`).join('');
    tb.querySelectorAll('tr.row-link').forEach(tr=>
      tr.addEventListener('click', ()=> openTradeModal(_tradesShown[+tr.dataset.idx])));
  }

  // ---------- entry/exit chart popup (trades, top trades, open positions) ----------
  async function openChartModal(cfg){
    const token = ++_openToken;
    $('#trade-modal-ticker').textContent = cfg.ticker;
    $('#trade-modal-name').textContent   = cfg.name || '';
    const dirLabel = cfg.dir==='short' ? '▼ SHORT' : '▲ LONG';
    $('#trade-modal-side').innerHTML =
      `<span class="pos-badge ${cfg.dir}">${dirLabel}</span>`
      + (cfg.sideNote ? `<span class="side-note">${cfg.sideNote}</span>` : '');
    const mm = (l,v,tone)=>`<div class="mm"><span class="mm-l">${l}</span>
      <span class="mm-v ${tone||''}">${v}</span></div>`;
    $('#trade-modal-metrics').innerHTML = cfg.metrics.map(([l,v,tone])=>mm(l,v,tone)).join('');
    const modal = $('#trade-modal'); modal.hidden = false;
    const chartEl = $('#trade-modal-chart');
    const cached = peekCandles(cfg.ticker);
    if (cached !== undefined){                       // in-memory / fresh cache: render now
      chartEl.innerHTML = '';
      if (cached && cached.length) window.Charts.tradeChart('trade-modal-chart', cached, cfg.mark);
      else chartEl.innerHTML = unavailable(cfg.ticker);
      return;
    }
    chartEl.innerHTML = chartSkeleton();             // fetching: show skeleton
    const rows = await loadCandles(cfg.ticker);
    if (token !== _openToken || modal.hidden) return;   // superseded or closed
    chartEl.innerHTML = '';
    if (rows && rows.length) window.Charts.tradeChart('trade-modal-chart', rows, cfg.mark);
    else chartEl.innerHTML = unavailable(cfg.ticker);
  }

  function openTradeModal(t){
    if (!t) return;
    openChartModal({
      ticker:t.ticker, name:t.product, dir:t.dir, sideNote:t.exitType,
      metrics:[
        ['Entry', t.entryPx.toFixed(3)+' · '+fmtD(t.entryDt)],
        ['Exit',  t.exitPx.toFixed(3)+' · '+fmtD(t.exitDt)],
        ['Shares', t.units.toLocaleString()],
        ['P&L', money(t.pnl,2), cls(t.pnl)],
        ['Return', pct(t.ret), cls(t.ret)],
        ['Hold', t.holdDays.toFixed(1)+' d']
      ],
      mark:{ entryDt:t.entryDt, entryPx:t.entryPx, exitDt:t.exitDt, exitPx:t.exitPx, win:t.pnl>=0 }
    });
  }

  function openPositionModal(p){
    if (!p) return;
    const px = _prices && _prices[p.ticker] ? _prices[p.ticker].last : null;
    const dir = p.dir==='long'?1:-1;
    const uPnl = px!=null ? (px-p.price)*p.units*dir : null;
    const uPct = px!=null ? (px/p.price-1)*100*dir : null;
    const now = new Date();
    const days = (p.dt instanceof Date && !isNaN(p.dt.getTime()))
      ? Math.max(0,Math.round((now-p.dt)/86400000)) : '—';
    openChartModal({
      ticker:p.ticker, name:p.product, dir:p.dir, sideNote:'Open position',
      metrics:[
        ['Entry', p.price.toFixed(3)+' · '+fmtD(p.dt)],
        ['Last', px!=null ? px.toFixed(3) : '—'],
        ['Shares', p.units.toLocaleString()],
        ['Unreal. P&L', uPnl==null?'—':money(uPnl,2), uPnl==null?'':cls(uPnl)],
        ['Unreal. %', uPct==null?'—':pct(uPct), uPct==null?'':cls(uPct)],
        ['Stop', p.stop ? p.stop.toFixed(3) : '—'],
        ['Days held', String(days)]
      ],
      mark:{ entryDt:p.dt, entryPx:p.price, stop:p.stop||null, lastPx:px, win:true }
    });
  }
  function closeTradeModal(){ const m=$('#trade-modal'); if (m) m.hidden = true; }
  function wireTradeModal(){
    $('#trade-modal-close').addEventListener('click', closeTradeModal);
    $('#trade-modal-backdrop').addEventListener('click', closeTradeModal);
    document.addEventListener('keydown', e=>{ if (e.key==='Escape') closeTradeModal(); });
  }

  function renderGlossary(){
    $('#glossary').innerHTML = window.CONFIG.GLOSSARY.map(([t,d])=>
      `<div class="gloss-item"><b>${t}</b><p>${d}</p></div>`).join('');
  }

  // Full render given the current app state.
  function render(state){
    const { recon, from, to, unit, benchmark, prices } = state;
    const m = window.Metrics.compute(recon.trades, from, to, recon.balanceSeries, benchmark);
    const commission = window.Metrics.sumInRange(recon.commissions, from, to);
    const funding    = window.Metrics.sumInRange(recon.fundings, from, to);
    renderKPIs(m, commission, funding);
    window.Charts.equityChart('equity-chart', m, unit);
    window.Charts.tickerChart('ticker-chart', window.Metrics.byTicker(m.trades, unit), unit);
    window.Charts.outcomeChart('outcome-chart', m);
    window.Charts.holdingChart('holding-chart', m);
    renderDistribution(m, unit);
    renderTopTrades(m, unit);
    renderOpenPositions(recon.openPositions, prices);
    renderTradesTable(m.trades);
  }

  window.PerformanceTab = { render, renderGlossary, wireTradeModal };
})();
