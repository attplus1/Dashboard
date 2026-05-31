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

  // Minimal stat tile (Robinhood/Stake style): small label, big value, optional
  // tiny sub. tone -> pos/neg colours the value.
  function kTile(label, value, sub, tone, span){
    return `<div class="ktile${span?' span2':''}">
      <div class="kt-label">${label}</div>
      <div class="kt-value ${tone==='pos'?'val-pos':tone==='neg'?'val-neg':''}">${value}</div>
      ${sub?`<div class="kt-sub">${sub}</div>`:''}</div>`;
  }

  function renderKPIs(m, commission, funding, unit, wkRows){
    const net = m.totalPnl + commission + funding;
    const fmtVal = v => unit==='percent' ? pct(v,1) : money(v,0);
    const bestDay = window.Metrics.bestBucket(wkRows);
    // Net trade expectancy: average net $ outcome per closed trade (gross P&L plus
    // commission + funding, spread across the trade count).
    const expectancy = m.nTotal ? net / m.nTotal : null;
    const netPos = net>=0;
    // Headline return on starting equity, if we have an equity curve.
    let heroSub = `Gross ${money(m.totalPnl,0)} · fees ${money(commission+funding,0)}`;
    if (m.equity && m.equity.length){
      const base = m.equity[0].equity;
      if (base) heroSub = `${pct(net/base*100,1)} on starting equity`;
    }

    // Colour a ratio value by its sign (positive = good = green, negative = red).
    const rcls = v => v==null ? '' : (v>0?'val-pos':(v<0?'val-neg':''));

    // Hero Net P&L card — background tints green (profit) or red (loss).
    const hero = `<div class="kpi-hero tinted ${netPos?'pos':'neg'}">
      <span class="kh-tint"></span>
      <div class="kh-label">Net P&amp;L</div>
      <div class="kh-value ${netPos?'val-pos':'val-neg'}">${money(net,0)}</div>
      <div class="kh-sub">${heroSub}</div>
      <div class="kh-foot">
        <span><i>Gross</i><b class="${cls(m.totalPnl)}">${money(m.totalPnl,0)}</b></span>
        <span><i>Commission</i><b class="${cls(commission)}">${money(commission,0)}</b></span>
        <span><i>Funding</i><b class="${cls(funding)}">${money(funding,0)}</b></span>
      </div>
    </div>`;

    // Hero Trade Activity card (rows like the ratios card).
    const activity = `<div class="kpi-hero">
      <div class="kh-label">Trade Activity</div>
      <div class="kh-ratios">
        <div><i>Total trades</i><b>${m.nTotal}</b></div>
        <div><i>Avg trade</i><b class="${cls(m.avgPnl)}">${money(m.avgPnl,0)}</b></div>
        <div><i>Avg win</i><b class="val-pos">${money(m.avgWin,0)}</b></div>
        <div><i>Avg loss</i><b class="val-neg">${money(m.avgLoss,0)}</b></div>
      </div>
    </div>`;

    // Hero Risk-adjusted ratios card (values coloured by sign).
    const ratios = `<div class="kpi-hero">
      <div class="kh-label">Risk-Adjusted Ratios</div>
      <div class="kh-ratios">
        <div><i>Sharpe</i><b class="${rcls(m.sharpe)}">${ratio(m.sharpe)}</b></div>
        <div><i>Sortino</i><b class="${rcls(m.sortino)}">${ratio(m.sortino)}</b></div>
        <div><i>Calmar</i><b class="${rcls(m.calmar)}">${ratio(m.calmar)}</b></div>
        <div><i>Information ratio</i><b class="${rcls(m.infoRatio)}">${ratio(m.infoRatio)}</b></div>
      </div>
    </div>`;

    // Smaller stat tiles for the remaining metrics (original-style grid).
    const tiles = [
      kTile('Profit factor', ratio(m.profitFactor), '', ''),
      kTile('Max drawdown', m.maxDrawdown.pct.toFixed(1)+'%', money(m.maxDrawdown.dollars,0), 'neg'),
      kTile('Most profitable day',
            bestDay ? bestDay.label : '—',
            bestDay ? fmtVal(bestDay.value) : '', bestDay && bestDay.value>=0?'pos':(bestDay?'neg':'')),
      kTile('Net expectancy',
            expectancy==null ? '—' : money(expectancy,2),
            'per trade', expectancy==null ? '' : (expectancy>=0?'pos':'neg'))
    ];
    $('#kpi-grid').innerHTML =
      `<div class="kpi-heroes">${hero}${activity}${ratios}</div>` +
      `<div class="kpi-tiles">${tiles.join('')}</div>`;
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
  }

  function renderDistribution(m, unit){
    const h = window.Metrics.returnsHistogram(m.trades, unit);
    const isDollar = unit==='dollar';
    const mu = isDollar ? money(h.mean,0) : pct(h.mean,2);
    const sg = isDollar ? money(h.std,0)  : h.std.toFixed(2)+'%';
    $('#dist-stats').innerHTML = h.n>=2
      ? `<span>μ <b>${mu}</b></span>
         <span>σ <b>${sg}</b></span>
         <span>n <b>${h.n}</b></span>
         <span class="dist-legend">
           <span class="dl-item"><i class="dl-swatch dl-trades"></i>Loss / Win</span>
           <span class="dl-item"><i class="dl-swatch dl-density"></i>Density</span>
         </span>`
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
    // This container's innerHTML gets swapped between skeleton / message / chart,
    // which detaches any live ECharts canvas. Drop the prior instance so init()
    // builds a fresh one instead of reusing one whose canvas we've wiped.
    window.Charts.disposeOne('trade-modal-chart');
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
        ['Entry', t.entryPx.toFixed(3)+` <span class="mm-date">${fmtD(t.entryDt)}</span>`],
        ['Exit',  t.exitPx.toFixed(3)+` <span class="mm-date">${fmtD(t.exitDt)}</span>`],
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
        ['Entry', p.price.toFixed(3)+` <span class="mm-date">${fmtD(p.dt)}</span>`],
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
  // Delegated row clicks: one listener per <tbody> (these elements are static),
  // so rebuilding rows on each render doesn't re-bind a handler per row. Each row
  // carries a data-idx into the matching module-level array.
  function delegateRows(sel, pick){
    const tb = $(sel); if (!tb) return;
    tb.addEventListener('click', e=>{
      const tr = e.target.closest('tr.row-link');
      if (tr && tb.contains(tr)) pick(+tr.dataset.idx);
    });
  }
  function wireTradeModal(){
    $('#trade-modal-close').addEventListener('click', closeTradeModal);
    $('#trade-modal-backdrop').addEventListener('click', closeTradeModal);
    document.addEventListener('keydown', e=>{ if (e.key==='Escape') closeTradeModal(); });
    delegateRows('#top-winners tbody',          i=> openTradeModal(_topWins[i]));
    delegateRows('#top-losers tbody',           i=> openTradeModal(_topLosses[i]));
    delegateRows('#open-positions-table tbody', i=> openPositionModal(_openPos[i]));
    delegateRows('#trades-table tbody',         i=> openTradeModal(_tradesShown[i]));
  }

  function renderGlossary(){
    $('#glossary').innerHTML = window.CONFIG.GLOSSARY.map(([group, items])=>`
      <div class="gloss-group">
        <h4 class="gloss-group-title">${group}</h4>
        <div class="gloss-items">
          ${items.map(([t,d])=>`<div class="gloss-item"><b>${t}</b><p>${d}</p></div>`).join('')}
        </div>
      </div>`).join('');
  }

  // The core metric set (equity curve, ratios, drawdown) depends only on the
  // trade set + date window + benchmark — not the $/% display unit. Cache it so a
  // unit toggle (or any re-render at the same scope) skips the heavy recompute.
  let _mCache = null;
  function metricsFor(recon, from, to, benchmark){
    if (_mCache && _mCache.recon===recon && _mCache.benchmark===benchmark
        && _mCache.from===+from && _mCache.to===+to) return _mCache;
    const m = window.Metrics.compute(recon.trades, from, to, recon.balanceSeries, benchmark);
    const commission = window.Metrics.sumInRange(recon.commissions, from, to);
    const funding    = window.Metrics.sumInRange(recon.fundings, from, to);
    _mCache = { recon, benchmark, from:+from, to:+to, m, commission, funding };
    return _mCache;
  }

  // Full render given the current app state.
  function render(state){
    const { recon, from, to, unit, prices } = state;
    // App hands us the raw benchmark blob; Metrics.compute wants the bare array.
    const benchmark = state.benchmark && state.benchmark.data ? state.benchmark.data : state.benchmark;
    const { m, commission, funding } = metricsFor(recon, from, to, benchmark);
    // Weekday / hour buckets feed both the KPI tiles and their charts — compute
    // each once and share.
    const wkRows = window.Metrics.byWeekday(m.trades, unit);
    const hrRows = window.Metrics.byHour(m.trades, unit);
    renderKPIs(m, commission, funding, unit, wkRows);
    window.Charts.equityChart('equity-chart', m, unit);
    window.Charts.tickerChart('ticker-chart', window.Metrics.byTicker(m.trades, unit), unit);
    window.Charts.categoryBarChart('weekday-chart', wkRows, unit);
    window.Charts.categoryBarChart('hour-chart', hrRows, unit);
    window.Charts.outcomeChart('outcome-chart', m);
    window.Charts.holdingChart('holding-chart', m);
    renderDistribution(m, unit);
    renderTopTrades(m, unit);
    renderOpenPositions(recon.openPositions, prices);
    renderTradesTable(m.trades);
  }

  window.PerformanceTab = { render, renderGlossary, wireTradeModal };
})();
