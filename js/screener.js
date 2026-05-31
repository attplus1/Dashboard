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
    if (isWatched(t)){
      WATCH = WATCH.filter(x=>x!==t);
      evictCandles(t);              // no longer watchlisted -> drop persisted candles
    } else {
      WATCH = WATCH.concat(t);
      persistCandles(t);            // promote its candles to the persistent store
    }
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

  let UNIVERSE = [];   // full ASX directory [{ticker,name}] — search spans this
  function setData(d, universe){
    DATA = d;
    const c = universe && (universe.constituents || universe);
    UNIVERSE = Array.isArray(c) ? c : [];
  }

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

  // The pool of resolved stocks for the active tier, each tagged with its 1-based
  // rank — the source for the screener grid (top-N).
  function tierPool(){
    const { list } = currentTier();
    return list.map((entry,i)=> Object.assign({ rank:i+1 }, stockOf(entry)));
  }

  // The full momentum ranking (ignores the Top 200/500 pill) as a ticker->rank map.
  function rankIndex(){
    const list = Array.isArray(DATA.ranked) ? DATA.ranked
               : ((DATA.ranked && DATA.ranked.full) || []);
    const idx = {};
    list.forEach((entry,i)=>{ const t = typeof entry==='string'?entry:entry.ticker; idx[t]=i+1; });
    return idx;
  }

  // The search pool: the ENTIRE ASX directory (universe.json), each row enriched
  // with momentum data (rank/score/candles) when the name is in the ranked set.
  // Falls back to the ranked list alone if the universe didn't load.
  function searchPool(){
    const ranks = rankIndex();
    if (UNIVERSE.length){
      return UNIVERSE.map(u => Object.assign(
        { ticker:u.ticker, name:u.name, rank:ranks[u.ticker]||null },
        (DATA.stocks||{})[u.ticker] || {}));
    }
    const list = Array.isArray(DATA.ranked) ? DATA.ranked
               : ((DATA.ranked && DATA.ranked.full) || []);
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

  // Candlestick-shaped shimmer placeholder shown while a card chart loads.
  function chartSkeleton(){
    const h = [42,64,54,72,48,82,66,52,76,60,88,70,58,84,62,46,74,90,68,55];
    return '<div class="chart-skeleton" aria-label="Loading price history">'
      + h.map(v=>`<i style="height:${v}%"></i>`).join('') + '</div>';
  }
  const unavailable = t => '<div class="chart-empty">Price history isn\'t available for '+t+'.</div>';

  // ---------- card rendering (shared by screener / watchlist / search) ----------
  // `domId` namespaces the chart container ids so the two grids never collide.
  function cardHTML(r, rank, idx, domId){
    const on = isWatched(r.ticker);
    const score = (r.score!=null) ? (r.score*100).toFixed(1)+'%' : '–';
    const scoreCls = (r.score!=null && r.score<0) ? ' neg' : '';
    const rankLbl = (rank!=null) ? ('#'+rank) : 'NR';   // NR = not momentum-ranked
    return `
      <div class="mom-card${on?' watched':''}" data-idx="${idx}" title="Click to expand">
        <div class="mom-card-head">
          <div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="mom-rank${rank==null?' nr':''}">${rankLbl}</span><span class="mom-ticker">${r.ticker}</span>
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
        <div class="mom-watchbar" data-ticker="${r.ticker}">
          <button class="wb-add" data-ticker="${r.ticker}">
            <span class="wb-label">${on?'On watchlist':'Add to watchlist'}</span>
          </button>
        </div>
      </div>`;
  }

  // Lazily fetch a slim per-ticker candle file (the same files the Overview
  // popups use). Compact [date,o,h,l,c] -> chart objects.
  //
  // Caching strategy (the optimisation): candles for WATCHLISTED names are
  // persisted in localStorage so the Watchlist tab loads instantly and offline.
  // Candles fetched while *browsing search results* are held only in a small
  // bounded in-memory LRU — they're evicted as you look at more names, so the
  // cache never balloons. Adding a name to the watchlist promotes its candles to
  // the persistent store; removing it drops them.
  const LS_CANDLES = 'plus1_wl_candles_v1';      // { ticker: rows } for watchlisted names
  const MEM_LIMIT = 24;                          // max non-watchlisted tickers kept in RAM
  const _memCache = new Map();                   // insertion-ordered -> used as LRU
  let _persist = (function(){ try { return JSON.parse(localStorage.getItem(LS_CANDLES))||{}; } catch(e){ return {}; } })();
  function _savePersist(){ try { localStorage.setItem(LS_CANDLES, JSON.stringify(_persist)); } catch(e){} }

  function _memPut(ticker, rows){
    _memCache.delete(ticker); _memCache.set(ticker, rows);   // move to newest
    while (_memCache.size > MEM_LIMIT){                       // evict oldest
      const oldest = _memCache.keys().next().value;
      _memCache.delete(oldest);
    }
  }
  // Promote / drop a ticker's candles in the persistent store as it joins/leaves
  // the watchlist. Returns nothing; safe if we don't have the candles yet.
  function persistCandles(ticker){
    const rows = _persist[ticker] || _memCache.get(ticker);
    if (rows && rows.length){ _persist[ticker] = rows; _savePersist(); }
  }
  function evictCandles(ticker){
    if (ticker in _persist){ delete _persist[ticker]; _savePersist(); }
  }

  async function loadCandles(ticker){
    if (ticker in _persist) return _persist[ticker];         // watchlisted: persistent
    if (_memCache.has(ticker)){ const r=_memCache.get(ticker); _memPut(ticker,r); return r; }
    let rows = null;
    try {
      const r = await fetch('data/candles/'+encodeURIComponent(ticker)+'.json', {cache:'no-store'});
      if (r.ok){ const j = await r.json(); const raw = j.candles || j;
        rows = raw.map(c => Array.isArray(c)
          ? { date:c[0], open:c[1], high:c[2], low:c[3], close:c[4] } : c); }
    } catch(e){ rows = null; }
    // Watchlisted names persist; everything else goes to the bounded LRU.
    if (rows && rows.length && isWatched(ticker)){ _persist[ticker]=rows; _savePersist(); }
    else _memPut(ticker, rows);
    return rows;
  }

  // Dispose one card's chart and drop it from the grid's chart list, so removing
  // a single card doesn't have to tear down and rebuild every other chart.
  function disposeCardChart(card, charts){
    const inst = card && card._chart;
    if (!inst) return;
    const i = charts.indexOf(inst);
    if (i>=0) charts.splice(i,1);
    try { inst.dispose(); } catch(e){}
    card._chart = null;
  }

  // Render a set of rows into a grid, mount their charts, and wire clicks.
  // `onOpen(idx)` opens the modal for that grid; `charts` collects instances.
  function paintGrid(grid, rows, domId, charts, onOpen){
    charts.forEach(c=>c.dispose()); charts.length = 0;
    grid.innerHTML = rows.map((r,i)=>cardHTML(r, r.rank!=null?r.rank:null, i, domId)).join('');
    rows.forEach((r,i)=>{
      const el = document.getElementById(`${domId}-${i}`);
      if (!el) return;
      const card = el.closest('.mom-card');   // so a single removal can dispose just this chart
      if (r.candles && r.candles.length){
        const inst = window.Charts.candleCard(el, r.candles, false);
        charts.push(inst); if (card) card._chart = inst;
      } else {
        // No bundled candles (e.g. a non-ranked search hit): fetch on demand.
        el.innerHTML = chartSkeleton();
        loadCandles(r.ticker).then(c=>{
          if (!document.body.contains(el)) return;       // grid re-rendered meanwhile
          el.innerHTML = '';
          if (c && c.length){ r.candles = c; const inst = window.Charts.candleCard(el, c, false); charts.push(inst); if (card) card._chart = inst; }
          else el.innerHTML = unavailable(r.ticker);
        });
      }
    });
    grid.querySelectorAll('.mom-card').forEach(card=>{
      card.addEventListener('click', e=>{
        if (e.target.closest('.mom-watchbar')) return;   // watch bar handled separately
        onOpen(+card.dataset.idx);
      });
    });
    grid.querySelectorAll('.mom-watchbar .wb-add').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        const removing = isWatched(btn.dataset.ticker);
        toggleWatch(btn.dataset.ticker);
        refreshStars();
        if (document.body.dataset.tab!=='watchlist') return;
        // On the Watchlist tab a removal drops the card — play a brief fade +
        // collapse on it before rebuilding, instead of an instant disappearance.
        if (removing){
          const card = btn.closest('.mom-card');
          if (card){
            const others = grid.querySelectorAll('.mom-card').length - 1;
            if (others > 0){
              // Drop just THIS card and slide the rest into place (FLIP), disposing
              // only its own chart so the others don't rebuild. Fade the leaving
              // card first (its box stays, so nothing shifts yet); then remove it
              // and animate each sibling from its old position to the new one.
              const sibs = Array.prototype.slice.call(grid.querySelectorAll('.mom-card')).filter(c=>c!==card);
              let done = false;
              const finish = ()=>{
                if (done) return; done = true;
                const before = sibs.map(c=>c.getBoundingClientRect());   // First
                disposeCardChart(card, charts);
                card.remove();
                const after = sibs.map(c=>c.getBoundingClientRect());    // Last
                sibs.forEach((c,i)=>{
                  const dx = before[i].left - after[i].left, dy = before[i].top - after[i].top;
                  if (!dx && !dy) return;                                // didn't move
                  c.style.transition = 'none';                          // Invert
                  c.style.transform  = `translate(${dx}px, ${dy}px)`;
                  requestAnimationFrame(()=>{                           // Play
                    c.style.transition = 'transform .5s cubic-bezier(.65,0,.35,1)';
                    c.style.transform  = '';
                    const te = ev=>{ if (ev.propertyName!=='transform') return;
                      c.style.transition=''; c.removeEventListener('transitionend', te); };
                    c.addEventListener('transitionend', te);
                  });
                });
              };
              card.addEventListener('transitionend', e=>{ if (e.propertyName==='opacity') finish(); });
              setTimeout(finish, 240);                                  // fallback
              requestAnimationFrame(()=>card.classList.add('leaving'));
            } else {
              // Last card: settle the grid straight to the empty-state height
              // instead of collapsing to zero and re-expanding into it.
              disposeCardChart(card, charts);
              const startH = grid.offsetHeight;
              renderWatchlist();                            // swap in the empty state
              const endH = grid.offsetHeight;
              grid.style.height = startH + 'px';
              void grid.offsetHeight;
              grid.style.transition = 'height .45s cubic-bezier(.65,0,.35,1)';
              grid.style.height = endH + 'px';
              const clear = ev=>{
                if (ev.target!==grid || ev.propertyName!=='height') return;
                grid.style.height = ''; grid.style.transition = '';
                grid.removeEventListener('transitionend', clear);
              };
              grid.addEventListener('transitionend', clear);
            }
            return;
          }
        }
        renderWatchlist();   // adding (rare on this tab) or no card found -> rebuild now
      });
    });
  }

  // Reflect the current watchlist state on every visible watch bar without a
  // full re-render (cheap; avoids tearing down charts).
  function refreshStars(){
    document.querySelectorAll('.mom-card .mom-watchbar').forEach(bar=>{
      const on = isWatched(bar.dataset.ticker);
      const card = bar.closest('.mom-card'); if (card) card.classList.toggle('watched', on);
      const lbl = bar.querySelector('.wb-label');
      if (lbl) lbl.textContent = on ? 'On watchlist' : 'Add to watchlist';
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
        const total = UNIVERSE.length || DATA.universe_count || 0;
        const capped = searchTotal>searchRows.length ? ` (showing first ${searchRows.length})` : '';
        meta.textContent = `${searchTotal} match${searchTotal===1?'':'es'} of ${total.toLocaleString()}${capped}`; }
      if (!searchRows.length){
        cardCharts.forEach(c=>c.dispose()); cardCharts=[];
        grid.innerHTML = `<div class="notice">No tickers match your search across the universe.</div>`;
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
    const pool = searchPool();      // the whole ASX directory, not the active tier
    const hits = pool.filter(r =>
      (r.ticker||'').toLowerCase().includes(q) ||
      (r.name||'').toLowerCase().includes(q));
    // Rank the matches: momentum-ranked names first (by rank), then the rest
    // alphabetically — so a known leader surfaces above the long tail.
    hits.sort((a,b)=>{
      if (a.rank && b.rank) return a.rank-b.rank;
      if (a.rank) return -1; if (b.rank) return 1;
      return (a.ticker||'').localeCompare(b.ticker||'');
    });
    searchTotal = hits.length;
    searchRows = hits.slice(0, SEARCH_CAP);
    render();
  }

  // ---------- watchlist tab ----------
  function watchPool(){
    // Resolve every watched ticker so its card carries name / rank / score and,
    // where we have them, candles. Momentum data (ranked names) wins; otherwise
    // fall back to the universe directory for the company name. Persisted
    // candles are attached so the grid renders without re-fetching.
    const ranks = rankIndex();
    const uniName = {}; UNIVERSE.forEach(u=> uniName[u.ticker]=u.name);
    return WATCH.map(t => {
      const base = Object.assign(
        { ticker:t, name:uniName[t]||t, rank:ranks[t]||null },
        (DATA && DATA.stocks && DATA.stocks[t]) || {});
      if (!base.candles && _persist[t]) base.candles = _persist[t];   // use persisted
      return base;
    }).filter(r => r && r.ticker);
  }
  function renderWatchlist(){
    const grid = $('#watchlist-cards'); if (!grid) return;
    watchRows = watchPool();
    if (!watchRows.length){
      watchCharts.forEach(c=>c.dispose()); watchCharts=[];
      grid.innerHTML = `<div class="empty-watch">
        <span class="ew-star">☆</span>
        <h3>Your watchlist is empty</h3>
        <p>Open the <b>Screener</b> and hit <b>Add to watchlist</b> on any card to
           pin it here. Your list is saved in this browser.</p></div>`;
      return;
    }
    paintGrid(grid, watchRows, 'wl', watchCharts, openWatchModal);
  }

  // ---------- expand modal ----------
  let _modalToken = 0;
  function fillModal(r, rank, total){
    const candles = r.candles || [];
    const s = periodStats(candles);
    $('#modal-ticker').textContent = r.ticker;
    $('#modal-name').textContent   = r.name || '';
    $('#modal-rank').textContent   = rank!=null ? `Rank #${rank}${total?(' of '+total):''}` : 'Not momentum-ranked';
    const metric = (label,val,tone)=>`<div class="mm"><span class="mm-l">${label}</span>
      <span class="mm-v ${tone||''}">${val}</span></div>`;
    const pc = v => v==null?'–':((v>=0?'+':'')+(v*100).toFixed(1)+'%');
    $('#modal-metrics').innerHTML =
      metric('6−1 momentum (ranking)', pc(r.score), r.score==null?'':(r.score>=0?'pos':'neg')) +
      metric('Return over period (incl. last month)', pc(s.periodReturn), s.periodReturn==null?'':(s.periodReturn>=0?'pos':'neg')) +
      metric('Volatility — period, annualised', s.volAnn==null?'–':(s.volAnn*100).toFixed(1)+'%') +
      metric('Daily volatility (period)', s.volDaily==null?'–':(s.volDaily*100).toFixed(2)+'%') +
      (r.capRank!=null ? metric('Market-cap rank (ASX)', '#'+r.capRank) : '') +
      metric('Last close', r.last!=null?('$'+r.last.toFixed(3)):'–');
    const modal = $('#mom-modal'); modal.hidden = false;
    if (bigChart){ bigChart.dispose(); bigChart=null; }
    const chartEl = $('#modal-chart');
    const token = ++_modalToken;
    const draw = c => { if (token!==_modalToken || modal.hidden) return;
      chartEl.innerHTML='';
      if (c && c.length) bigChart = window.Charts.candleCard(chartEl, c, true);
      else chartEl.innerHTML = unavailable(r.ticker); };
    if (candles.length){ requestAnimationFrame(()=>draw(candles)); }
    else { chartEl.innerHTML = chartSkeleton();          // non-ranked: fetch on open
      loadCandles(r.ticker).then(c=>{ if(c&&c.length) r.candles=c; draw(c); }); }
  }
  function openModal(idx){
    const r = currentRows[idx]; if (!r) return;
    fillModal(r, r.rank!=null?r.rank:null, null);
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

    // Search spans the whole universe, so the tier pill only affects the top-N
    // grid — no need to re-run an active search when it changes.
    wirePill('scr-universe-sel', ()=> render());
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
