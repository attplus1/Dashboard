/* Momentum screener tab: ranked buy list as candlestick cards + expand modal.
   Also powers the ticker search and the separate Watchlist tab. */
(function () {
  const $ = s => document.querySelector(s);
  let DATA = null;
  let cardCharts = [];           // live ECharts instances in the screener grid
  let watchCharts = [];          // live ECharts instances in the watchlist grid
  let bigChart = null;
  let currentRows = [];          // resolved stock objects currently displayed (screener)
  let watchRows = [];            // resolved stock objects in the watchlist grid
  let searchRows = null;         // non-null while a search filter is active

  const std = a => { if (a.length<2) return 0; const m=a.reduce((s,x)=>s+x,0)/a.length;
    return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)); };

  // ---------- watchlist persistence (per-browser) ----------
  const LS_WATCH = 'plus1_watchlist_v1';
  function loadWatch(){ try { return JSON.parse(localStorage.getItem(LS_WATCH))||[]; } catch(e){ return []; } }
  function saveWatch(arr){ try { localStorage.setItem(LS_WATCH, JSON.stringify(arr)); } catch(e){} }
  let WATCH = loadWatch();
  const isWatched = t => WATCH.includes(t);
  function toggleWatch(t){
    if (isWatched(t)) WATCH = WATCH.filter(x=>x!==t);
    else WATCH = WATCH.concat(t);
    saveWatch(WATCH);
  }

  // Momentum-period stats from the candle series (window = 6 months + skipped
  // month = ~147 trading days). Volatility deliberately spans the WHOLE period
  // (does NOT exclude the last month).
  function periodStats(candles){
    const SKIP=21, LOOK=126, W=SKIP+LOOK, n=candles.length;
    const c=candles.map(d=>d.close);
    if (n < W+1) return {};
    const periodReturn = c[n-1]/c[n-1-W]-1;          // full window incl. last month
    const formation    = c[n-1-SKIP]/c[n-1-W]-1;     // 6-1 (ranking) return
    const rets=[]; for (let i=n-W;i<n;i++) rets.push(c[i]/c[i-1]-1);
    const volD=std(rets);
    return { periodReturn, formation, volDaily:volD, volAnn:volD*Math.sqrt(252) };
  }

  function setData(d){ DATA = d; }

  // Read a pill segmented control's current value.
  function pillValue(id){ const el=$('#'+id); return el ? el.dataset.value : null; }

  // Selected universe tier ('200' | '500' | 'full'). Resolves the ranked ticker
  // list and whether the tier is actually populated (enough market caps) yet.
  function currentTier(){
    const tier = pillValue('scr-universe-sel') || 'full';
    // Legacy momentum.json (ranked = array of stock objects) -> treat as full.
    if (Array.isArray(DATA.ranked))
      return { tier:'full', list: DATA.ranked, legacy:true, active:true };
    const ranked = DATA.ranked || {};
    const list = ranked[tier] || ranked.full || [];
    const active = tier==='full'
      || (DATA.caps_ready === true && (DATA.cap_count||0) >= (+tier));
    return { tier, list, legacy:false, active };
  }

  // A ranked entry may be a ticker code (new structure -> look up in stocks map)
  // or a full object (legacy structure).
  function stockOf(entry){
    if (typeof entry === 'string')
      return Object.assign({ ticker:entry }, (DATA.stocks||{})[entry] || {});
    return entry;
  }

  // The full pool of resolved stocks for the active tier, each tagged with its
  // 1-based rank — used by search (and as the source for the screener grid).
  function tierPool(){
    const { list } = currentTier();
    return list.map((entry,i)=> Object.assign({ rank:i+1 }, stockOf(entry)));
  }

  function hasData(){
    return DATA && DATA.ranked && (Array.isArray(DATA.ranked) ? DATA.ranked.length
                                   : (DATA.ranked.full||[]).length);
  }
  function noDataNotice(){
    return `<div class="notice">No screener data yet. The scheduled
      <code>update-data</code> GitHub Action populates <code>data/momentum.json</code>
      from yfinance. Run that workflow to see ranked momentum candidates here.</div>`;
  }

  // ---------- card rendering (shared by screener / watchlist / search) ----------
  // `domId` namespaces the chart container ids so the two grids never collide.
  function cardHTML(r, rank, idx, domId){
    const on = isWatched(r.ticker) ? ' on' : '';
    const score = (r.score!=null) ? (r.score*100).toFixed(1)+'%' : '–';
    const scoreCls = (r.score!=null && r.score<0) ? ' neg' : '';
    return `
      <div class="mom-card" data-idx="${idx}" title="Click to expand">
        <button class="mom-star${on}" data-ticker="${r.ticker}" title="Toggle watchlist"
          aria-label="Toggle watchlist">${isWatched(r.ticker)?'★':'☆'}</button>
        <div class="mom-card-head">
          <div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="mom-rank">#${rank}</span><span class="mom-ticker">${r.ticker}</span>
            </div>
            <div class="mom-name">${r.name||''}</div>
          </div>
          <div class="mom-score"><div class="s-val${scoreCls}">${score}</div>
            <div class="s-lbl">6−1 mom</div></div>
        </div>
        <div class="mom-chart" id="${domId}-${idx}"></div>
        <div class="mom-card-foot">
          <div class="ma-key"><span class="ma50">MA50</span><span class="ma200">MA200</span></div>
          <div class="mom-price">${r.last!=null?('$'+r.last.toFixed(3)):''}</div>
        </div>
      </div>`;
  }

  // Render a set of rows into a grid, mount their charts, and wire clicks.
  // `onOpen(idx)` opens the modal for that grid; `charts` collects instances.
  function paintGrid(grid, rows, domId, charts, onOpen){
    charts.forEach(c=>c.dispose()); charts.length = 0;
    grid.innerHTML = rows.map((r,i)=>cardHTML(r, r.rank||(i+1), i, domId)).join('');
    rows.forEach((r,i)=>{
      const el = document.getElementById(`${domId}-${i}`);
      if (el && r.candles && r.candles.length)
        charts.push(window.Charts.candleCard(el, r.candles, false));
    });
    grid.querySelectorAll('.mom-card').forEach(card=>{
      card.addEventListener('click', e=>{
        if (e.target.closest('.mom-star')) return;       // star handled separately
        onOpen(+card.dataset.idx);
      });
    });
    grid.querySelectorAll('.mom-star').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        toggleWatch(btn.dataset.ticker);
        refreshStars();
        // Only rebuild the watchlist grid if it's the visible tab; otherwise it
        // renders fresh on the next tab switch (no point mounting hidden charts).
        if (document.body.dataset.tab==='watchlist') renderWatchlist();
      });
    });
  }

  // Reflect the current watchlist state on every visible star without a full
  // re-render (cheap; avoids tearing down charts).
  function refreshStars(){
    document.querySelectorAll('.mom-star').forEach(btn=>{
      const on = isWatched(btn.dataset.ticker);
      btn.classList.toggle('on', on);
      btn.textContent = on ? '★' : '☆';
    });
  }

  // ---------- screener tab ----------
  function render(){
    const grid = $('#screener-cards');
    if (!hasData()){ grid.innerHTML = noDataNotice(); return; }

    const { tier, legacy, active } = currentTier();
    const pool = tierPool();
    const tierSize = tier==='full' ? null : +tier;

    // "Universe scanned": tier size when the tier is live, else the full count.
    const uni = (tier!=='full' && active) ? tierSize : (DATA.universe_count || pool.length);
    $('#scr-universe').textContent = uni.toLocaleString();
    $('#scr-asof').textContent = DATA.asof || '–';

    const note = $('#screener-source-note');
    if (DATA.placeholder){ note.className='source-note placeholder';
      note.textContent='Placeholder data — run the data workflow for a live scan.'; }
    else if (!legacy && tier!=='full' && !active){ note.className='source-note placeholder';
      note.textContent=`Top ${tierSize} by market cap — still gathering market caps `
        +`(${(DATA.cap_count||0).toLocaleString()} so far); showing the full universe meanwhile.`; }
    else if (DATA.complete===false){ note.className='source-note placeholder';
      note.textContent=`Scan updating… ${(DATA.universe_count||0).toLocaleString()} tickers so far · ${DATA.asof||''}`; }
    else { note.className='source-note live';
      note.innerHTML='<span class="sn-title">Live scan</span><span>as of '+(DATA.asof||'—')+'</span>'; }

    // A search filter, when active, takes over the grid; otherwise show top-N.
    const meta = $('#scr-search-meta');
    if (searchRows){
      currentRows = searchRows;
      if (meta){ meta.hidden=false;
        const capped = searchTotal>searchRows.length ? ` (showing first ${searchRows.length})` : '';
        meta.textContent = `${searchTotal} match${searchTotal===1?'':'es'} of ${pool.length.toLocaleString()}${capped}`; }
      if (!searchRows.length){
        cardCharts.forEach(c=>c.dispose()); cardCharts=[];
        grid.innerHTML = `<div class="notice">No tickers match your search in this universe.</div>`;
        return;
      }
    } else {
      const topN = parseInt(pillValue('scr-topn')||'20',10);
      currentRows = pool.slice(0, topN);
      if (meta) meta.hidden=true;
    }

    paintGrid(grid, currentRows, 'mom', cardCharts, openModal);
  }

  // ---------- search ----------
  const SEARCH_CAP = 30;          // cap rendered cards so a broad match stays light
  let searchTotal = 0;            // total matches before the cap (for the meta line)
  function runSearch(q){
    q = (q||'').trim().toLowerCase();
    if (!q){ searchRows = null; searchTotal = 0; render(); return; }
    const pool = tierPool();
    const hits = pool.filter(r =>
      (r.ticker||'').toLowerCase().includes(q) ||
      (r.name||'').toLowerCase().includes(q));
    searchTotal = hits.length;
    searchRows = hits.slice(0, SEARCH_CAP);
    render();
  }

  // ---------- watchlist tab ----------
  function watchPool(){
    // Resolve every watched ticker against the stocks map / ranked pool so the
    // cards carry candles + score. Tag with the ticker's tier rank if known.
    const pool = hasData() ? tierPool() : [];
    const byTicker = {}; pool.forEach(r=> byTicker[r.ticker]=r);
    return WATCH.map(t => byTicker[t] || stockOf(t)).filter(r => r && r.ticker);
  }
  function renderWatchlist(){
    const grid = $('#watchlist-cards'); if (!grid) return;
    watchRows = watchPool();
    if (!watchRows.length){
      watchCharts.forEach(c=>c.dispose()); watchCharts=[];
      grid.innerHTML = `<div class="empty-watch">
        <span class="ew-star">☆</span>
        <h3>Your watchlist is empty</h3>
        <p>Open the <b>Screener</b> and tap the star on any card to pin it here.
           Your list is saved in this browser.</p></div>`;
      return;
    }
    paintGrid(grid, watchRows, 'wl', watchCharts, openWatchModal);
  }

  // ---------- expand modal ----------
  function fillModal(r, rank, total){
    const s = periodStats(r.candles||[]);
    $('#modal-ticker').textContent = r.ticker;
    $('#modal-name').textContent   = r.name || '';
    $('#modal-rank').textContent   = rank!=null ? `Rank #${rank}${total?(' of '+total):''}` : '';
    const metric = (label,val,tone)=>`<div class="mm"><span class="mm-l">${label}</span>
      <span class="mm-v ${tone||''}">${val}</span></div>`;
    const pc = v => v==null?'–':((v>=0?'+':'')+(v*100).toFixed(1)+'%');
    $('#modal-metrics').innerHTML =
      metric('6−1 momentum (ranking)', pc(r.score), r.score>=0?'pos':'neg') +
      metric('Return over period (incl. last month)', pc(s.periodReturn), s.periodReturn>=0?'pos':'neg') +
      metric('Volatility — period, annualised', s.volAnn==null?'–':(s.volAnn*100).toFixed(1)+'%') +
      metric('Daily volatility (period)', s.volDaily==null?'–':(s.volDaily*100).toFixed(2)+'%') +
      (r.capRank!=null ? metric('Market-cap rank (ASX)', '#'+r.capRank) : '') +
      metric('Last close', r.last!=null?('$'+r.last.toFixed(3)):'–');
    const modal = $('#mom-modal'); modal.hidden = false;
    if (bigChart){ bigChart.dispose(); bigChart=null; }
    requestAnimationFrame(()=>{ bigChart = window.Charts.candleCard($('#modal-chart'), r.candles||[], true); });
  }
  function openModal(idx){
    const r = currentRows[idx]; if (!r) return;
    fillModal(r, r.rank||(idx+1), null);
  }
  function openWatchModal(idx){
    const r = watchRows[idx]; if (!r) return;
    fillModal(r, r.rank, null);
  }
  function closeModal(){
    $('#mom-modal').hidden = true;
    if (bigChart){ bigChart.dispose(); bigChart=null; }
  }

  // Turn a pill segmented control into a working selector. `onChange(value)`.
  function wirePill(id, onChange){
    const seg = $('#'+id); if (!seg) return;
    seg.querySelectorAll('.seg-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        seg.querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        seg.dataset.value = btn.dataset.value;
        onChange(btn.dataset.value);
      });
    });
  }

  function wireModal(){
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-backdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', e=>{ if (e.key==='Escape') closeModal(); });

    // Changing the universe invalidates any active search (different pool).
    wirePill('scr-universe-sel', ()=>{ if (searchRows) runSearch($('#scr-search').value); else render(); });
    wirePill('scr-topn', ()=> render());

    const search = $('#scr-search'), clear = $('#scr-search-clear');
    if (search){
      let t=null;
      search.addEventListener('input', ()=>{
        if (clear) clear.hidden = !search.value;
        clearTimeout(t); t=setTimeout(()=>runSearch(search.value), 140);   // debounce
      });
      search.addEventListener('keydown', e=>{ if (e.key==='Escape'){ search.value=''; if(clear) clear.hidden=true; runSearch(''); }});
    }
    if (clear) clear.addEventListener('click', ()=>{
      search.value=''; clear.hidden=true; runSearch(''); search.focus();
    });
  }

  window.ScreenerTab = { setData, render, renderWatchlist, wireModal };
})();
