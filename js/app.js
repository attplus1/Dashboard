/* App bootstrap: data loading, tabs, date-range slider, unit toggle, import. */
(function () {
  const $ = s => document.querySelector(s);
  const DAY = 86400000;

  const state = {
    recon: null, benchmark: null, prices: null,
    from: null, to: null, fullFrom: null, fullTo: null,
    unit: 'dollar'
  };

  // ---------- data loading ----------
  async function loadJSON(path){
    try { const r = await fetch(path, {cache:'no-store'}); if (!r.ok) throw 0; return await r.json(); }
    catch { return null; }
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
    ['equity-chart','ticker-chart','outcome-chart','holding-chart']
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
    ['ticker-chart','outcome-chart','holding-chart'].forEach(id =>
      { const el=$('#'+id); if (el) el.innerHTML='<div class="chart-empty">No data yet</div>'; });
    $('#open-positions-table tbody').innerHTML = er(13,'Upload a file to see open positions.');
    $('#trades-table tbody').innerHTML = er(11,'Upload a file to see closed trades.');
  }

  function applySourceNotes(){
    const bnote = $('#data-source-note');
    if (!state.benchmark){
      bnote.className='source-note placeholder';
      bnote.innerHTML='ASX 200 benchmark not loaded — run the <code>update-data</code> workflow.';
    } else if (state.benchmark.placeholder){
      bnote.className='source-note placeholder';
      bnote.textContent='Benchmark + prices are placeholder data. Run the data workflow for live Stooq values.';
    } else {
      bnote.className='source-note live';
      bnote.textContent='Live ASX 200 + prices · '+(state.benchmark.asof||'');
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
    // import
    $('#file-input').addEventListener('change',async e=>{
      const f=e.target.files[0]; if(!f) return;
      try { setReconciliation(await window.TradeParser.parseFile(f)); renderAll(); }
      catch(err){ alert('Could not parse file: '+err.message); }
    });
  }

  // ---------- init ----------
  async function init(){
    wire();
    window.PerformanceTab.renderGlossary();

    // Market data loads for the benchmark/prices and the screener, but trade
    // data is NOT auto-loaded — the performance page stays empty until upload.
    const [bench, prices, momentum] = await Promise.all([
      loadJSON('data/benchmark.json'),
      loadJSON('data/prices.json'), loadJSON('data/momentum.json')
    ]);

    state.benchmark = bench;            // { placeholder, asof, data:[{date,close}] }
    state.prices = prices ? prices.prices : null;

    applySourceNotes();
    renderAll();                        // shows the import prompt (no recon yet)

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
