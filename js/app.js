/* App bootstrap: data loading, tabs, date-range slider, unit toggle, import. */
(function () {
  const $ = s => document.querySelector(s);
  const DAY = 86400000;

  const state = {
    recon: null, benchmark: null, prices: null,
    from: null, to: null, fullFrom: null, fullTo: null,
    unit: 'dollar'
  };

  // ---------- trade persistence (per-browser) ----------
  // A static site can't write back to the repo, so the last uploaded statement
  // is saved in the browser and auto-restored so you continue where you left off.
  const LS_KEY = 'plus1_trades_v1';
  function storeTrades(name, arrbuf){
    try {
      const bytes = new Uint8Array(arrbuf); let bin='';
      const CH=0x8000; for (let i=0;i<bytes.length;i+=CH)
        bin += String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
      localStorage.setItem(LS_KEY, JSON.stringify({ name, ts:Date.now(), b64:btoa(bin) }));
    } catch(e){ /* quota/full — non-fatal */ }
  }
  function loadStored(){
    try {
      const s = localStorage.getItem(LS_KEY); if (!s) return null;
      const { b64, name, ts } = JSON.parse(s);
      const bin = atob(b64); const bytes = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      return { bytes, name, ts };
    } catch(e){ return null; }
  }
  function clearStored(){ try { localStorage.removeItem(LS_KEY); } catch(e){} }

  // ---------- data loading ----------
  async function loadJSON(path){
    try { const r = await fetch(path, {cache:'no-store'}); if (!r.ok) throw 0; return await r.json(); }
    catch { return null; }
  }
  // The committed trade history (repo default, used when nothing is saved locally).
  async function loadRepoTrades(){
    try {
      const r = await fetch('data/trades.csv', {cache:'no-store'}); if (!r.ok) throw 0;
      return window.TradeParser.parseCSVText(await r.text());
    } catch { return null; }
  }
  function setReconciliation(recon){
    state.recon = recon;
    state.fullFrom = recon.firstDate ? new Date(recon.firstDate) : new Date();
    state.fullTo   = recon.lastDate  ? new Date(recon.lastDate)  : new Date();
    state.from = new Date(state.fullFrom);
    state.to   = new Date(state.fullTo);
    syncDateInputs(); positionHandles();
  }

  // ---------- rendering ----------
  function renderAll(){
    if (!state.recon){ renderEmpty(); return; }
    $('#tab-performance').classList.remove('no-data');
    ['equity-chart','ticker-chart','outcome-chart','holding-chart','dist-chart']
      .forEach(id => { const el=$('#'+id); if (el) el.innerHTML=''; });
    window.PerformanceTab.render({
      recon: state.recon, from: state.from, to: state.to,
      unit: state.unit, benchmark: state.benchmark, prices: state.prices
    });
  }

  // No file uploaded yet: clear everything and show a branded prompt.
  function renderEmpty(){
    $('#tab-performance').classList.add('no-data');
    const er = (n,msg) => `<tr class="empty-row"><td colspan="${n}">${msg}</td></tr>`;
    $('#kpi-grid').innerHTML = '';
    $('#equity-chart').innerHTML = `<div class="empty-cta">
        <img class="ec-mark" src="assets/logo.svg" alt="" />
        <h3>Import your trade history to begin</h3>
        <p>The performance review is empty until you upload a broker statement
           (<code>.csv</code> or <code>.xlsx</code>). Everything is processed in your
           browser — nothing is uploaded anywhere.</p>
        <span class="ec-btn" id="cta-import">＋ Import trades</span>
      </div>`;
    $('#cta-import').addEventListener('click', () => $('#file-input').click());
    ['ticker-chart','outcome-chart','holding-chart','dist-chart'].forEach(id =>
      { const el=$('#'+id); if (el) el.innerHTML='<div class="chart-empty">No data yet</div>'; });
    $('#dist-stats').innerHTML = '';
    $('#open-positions-table tbody').innerHTML = er(13,'Upload a file to see open positions.');
    $('#trades-table tbody').innerHTML = er(11,'Upload a file to see closed trades.');
    $('#top-winners tbody').innerHTML = er(6,'—');
    $('#top-losers tbody').innerHTML = er(6,'—');
  }

  // ---------- collapsible panels ----------
  const COLLAPSE_KEY = 'plus1_collapsed_v1';
  function loadCollapsed(){ try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY))||{}; } catch(e){ return {}; } }
  function saveCollapsed(o){ try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(o)); } catch(e){} }
  function wireCollapsibles(){
    const stored = loadCollapsed();
    document.querySelectorAll('.panel.collapsible').forEach(panel=>{
      const head = panel.querySelector('.panel-head');
      if (!head || head.querySelector('.collapse-toggle')) return;
      const h3 = head.querySelector('h3');
      const key = h3 ? h3.textContent.trim() : '';
      if (key && stored[key]) panel.classList.add('collapsed');
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'collapse-toggle';
      btn.setAttribute('aria-label', 'Collapse or expand section');
      btn.innerHTML = '<span class="chev">▾</span>';
      head.appendChild(btn);
      head.addEventListener('click', ()=>{
        const collapsed = panel.classList.toggle('collapsed');
        const s = loadCollapsed();
        if (collapsed) s[key] = 1; else delete s[key];
        saveCollapsed(s);
        if (!collapsed) setTimeout(()=>window.Charts && window.Charts.resizeAll && window.Charts.resizeAll(), 60);
      });
    });
  }

  function applySourceNotes(){
    const bnote = $('#data-source-note');
    if (!state.benchmark){
      bnote.className='source-note placeholder';
      bnote.innerHTML='ASX 200 benchmark not loaded — run the <code>update-data</code> workflow.';
    } else if (state.benchmark.placeholder){
      bnote.className='source-note placeholder';
      bnote.textContent='Benchmark + prices are placeholder data. Run the data workflow for live values.';
    } else {
      bnote.className='source-note live';
      bnote.innerHTML='<span class="live-dot"></span>Live · ASX 200 &amp; prices · '+(state.benchmark.asof||'');
    }
  }

  // ---------- date inputs ----------
  const iso = d => d.toISOString().slice(0,10);
  function syncDateInputs(){
    $('#date-from').value = iso(state.from);
    $('#date-to').value   = iso(state.to);
    $('#date-from').min = $('#date-to').min = iso(state.fullFrom);
    $('#date-from').max = $('#date-to').max = iso(state.fullTo);
    $('#range-label-from').textContent = state.fullFrom.toLocaleDateString('en-AU');
    $('#range-label-to').textContent   = state.fullTo.toLocaleDateString('en-AU');
  }
  function clampRange(){
    if (state.from < state.fullFrom) state.from = new Date(state.fullFrom);
    if (state.to   > state.fullTo)   state.to   = new Date(state.fullTo);
    if (state.from > state.to)       state.from = new Date(state.to);
  }

  // ---------- range slider ----------
  function span(){ return Math.max(1, state.fullTo - state.fullFrom); }
  function frac(d){ return (d - state.fullFrom) / span(); }
  function positionHandles(){
    if (!state.fullFrom || !state.fullTo) return;
    const f = frac(state.from)*100, t = frac(state.to)*100;
    $('#handle-from').style.left = f+'%';
    $('#handle-to').style.left   = t+'%';
    $('#slider-fill').style.left = f+'%';
    $('#slider-fill').style.width = (t-f)+'%';
  }
  function dragHandle(which){
    if (!state.fullFrom) return;
    const slider = $('#range-slider');
    const move = e => {
      const rect = slider.getBoundingClientRect();
      const x = (e.touches?e.touches[0].clientX:e.clientX) - rect.left;
      let r = Math.min(1, Math.max(0, x/rect.width));
      const d = new Date(state.fullFrom.getTime() + r*span());
      if (which==='from'){ state.from = d; if (state.from>state.to) state.from=new Date(state.to); }
      else { state.to = d; if (state.to<state.from) state.to=new Date(state.from); }
      positionHandles(); syncDateInputs();
    };
    const up = () => { document.removeEventListener('mousemove',move);
      document.removeEventListener('mouseup',up);
      document.removeEventListener('touchmove',move);
      document.removeEventListener('touchend',up); renderAll(); };
    document.addEventListener('mousemove',move);
    document.addEventListener('mouseup',up);
    document.addEventListener('touchmove',move,{passive:true});
    document.addEventListener('touchend',up);
  }

  // ---------- wiring ----------
  function wire(){
    // tabs
    document.querySelectorAll('.tab').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        document.body.dataset.tab = btn.dataset.tab;   // header toggle hides on screener
        $('#tab-'+btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab==='screener') window.ScreenerTab.render();
        setTimeout(()=>window.Charts.resizeAll(),50);
      });
    });
    // unit toggle
    document.querySelectorAll('.seg-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active'); state.unit=btn.dataset.unit; renderAll();
      });
    });
    // date inputs
    $('#date-from').addEventListener('change',e=>{
      state.from=new Date(e.target.value+'T00:00:00'); clampRange(); positionHandles(); renderAll();
    });
    $('#date-to').addEventListener('change',e=>{
      state.to=new Date(e.target.value+'T23:59:59'); clampRange(); positionHandles(); renderAll();
    });
    $('#range-reset').addEventListener('click',()=>{
      state.from=new Date(state.fullFrom); state.to=new Date(state.fullTo);
      syncDateInputs(); positionHandles(); renderAll();
    });
    // slider handles
    $('#handle-from').addEventListener('mousedown',()=>dragHandle('from'));
    $('#handle-to').addEventListener('mousedown',()=>dragHandle('to'));
    $('#handle-from').addEventListener('touchstart',()=>dragHandle('from'),{passive:true});
    $('#handle-to').addEventListener('touchstart',()=>dragHandle('to'),{passive:true});
    // screener topN
    $('#scr-topn').addEventListener('change',()=>window.ScreenerTab.render());
    // import (file picker + drag-and-drop both route here)
    $('#file-input').addEventListener('change',e=>importFile(e.target.files[0]));
    wireDragDrop();
  }

  // Parse + load a dropped/picked statement (shared by the picker and drag-drop).
  async function importFile(f){
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const recon = window.TradeParser.parseArrayBuffer(new Uint8Array(buf));
      storeTrades(f.name, buf);              // persist so it continues next visit
      setReconciliation(recon); renderAll();
    } catch(err){ alert('Could not parse "'+(f.name||'file')+'": '+err.message); }
  }

  // Drag a .csv/.xlsx anywhere onto the page to import it. A counter tracks
  // enter/leave across child elements so the overlay doesn't flicker.
  function wireDragDrop(){
    const overlay = $('#drop-overlay');
    let depth = 0;
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types||[]).includes('Files');
    window.addEventListener('dragenter', e=>{
      if (!hasFiles(e)) return;
      e.preventDefault(); depth++; if (overlay) overlay.classList.add('show');
    });
    window.addEventListener('dragover', e=>{
      if (!hasFiles(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect='copy';
    });
    window.addEventListener('dragleave', e=>{
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth-1); if (!depth && overlay) overlay.classList.remove('show');
    });
    window.addEventListener('drop', e=>{
      if (!hasFiles(e)) return;
      e.preventDefault(); depth=0; if (overlay) overlay.classList.remove('show');
      importFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }

  // ---------- init ----------
  async function init(){
    document.body.dataset.tab = 'performance';   // default active tab (header toggle visible)
    wire();
    window.ScreenerTab.wireModal();
    window.PerformanceTab.wireTradeModal();
    window.PerformanceTab.renderGlossary();
    wireCollapsibles();

    // Market data loads for the benchmark/prices and the screener, but trade
    // data is NOT auto-loaded — the performance page stays empty until upload.
    const [bench, prices, momentum] = await Promise.all([
      loadJSON('data/benchmark.json'),
      loadJSON('data/prices.json'), loadJSON('data/momentum.json')
    ]);

    state.benchmark = bench;            // { placeholder, asof, data:[{date,close}] }
    state.prices = prices ? prices.prices : null;

    // Trade history precedence: a statement you uploaded on this device
    // (saved locally) wins; otherwise fall back to the committed repo history.
    const stored = loadStored();
    if (stored){
      try { setReconciliation(window.TradeParser.parseArrayBuffer(stored.bytes)); }
      catch(e){ clearStored(); }
    }
    if (!state.recon){
      const repo = await loadRepoTrades();
      if (repo) setReconciliation(repo);
    }

    applySourceNotes();
    renderAll();                        // import prompt if nothing restored

    window.ScreenerTab.setData(momentum);
  }

  // Metrics.compute expects benchmark as array of {date,close}; adapt here.
  const _origRender = window.PerformanceTab.render;
  window.PerformanceTab.render = function(s){
    const b = s.benchmark && s.benchmark.data ? s.benchmark.data : null;
    _origRender(Object.assign({}, s, { benchmark:b }));
  };

  document.addEventListener('DOMContentLoaded', init);
})();
