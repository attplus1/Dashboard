/* Momentum screener tab: ranked buy list as candlestick cards + expand modal. */
(function () {
  const $ = s => document.querySelector(s);
  let DATA = null;
  let cardCharts = [];
  let bigChart = null;

  const std = a => { if (a.length<2) return 0; const m=a.reduce((s,x)=>s+x,0)/a.length;
    return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)); };

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

  function render(){
    const grid = $('#screener-cards');
    if (!DATA || !DATA.ranked || !DATA.ranked.length){
      grid.innerHTML = `<div class="notice">No screener data yet. The scheduled
        <code>update-data</code> GitHub Action populates <code>data/momentum.json</code>
        from Stooq. Run that workflow to see ranked momentum candidates here.</div>`;
      return;
    }
    $('#scr-universe').textContent = (DATA.universe_count || DATA.ranked.length).toLocaleString();
    $('#scr-asof').textContent = DATA.asof || '–';

    const note = $('#screener-source-note');
    if (DATA.placeholder){ note.className='source-note placeholder';
      note.textContent='Placeholder data — run the data workflow for a live scan.'; }
    else if (DATA.complete===false){ note.className='source-note placeholder';
      note.textContent=`Scan updating… ${(DATA.universe_count||0).toLocaleString()} tickers so far · ${DATA.asof||''}`; }
    else { note.className='source-note live'; note.textContent='Live scan · '+(DATA.asof||''); }

    const topN = parseInt($('#scr-topn').value,10);
    const rows = DATA.ranked.slice(0, topN);

    cardCharts.forEach(c=>c.dispose()); cardCharts=[];
    grid.innerHTML = rows.map((r,i)=>`
      <div class="mom-card" data-idx="${i}" title="Click to expand">
        <div class="mom-card-head">
          <div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="mom-rank">#${i+1}</span><span class="mom-ticker">${r.ticker}</span>
            </div>
            <div class="mom-name">${r.name||''}</div>
          </div>
          <div class="mom-score"><div class="s-val">${(r.score*100).toFixed(1)}%</div>
            <div class="s-lbl">6−1 mom</div></div>
        </div>
        <div class="mom-chart" id="mom-${i}"></div>
        <div class="mom-card-foot">
          <div class="ma-key"><span class="ma50">MA50</span><span class="ma200">MA200</span></div>
          <div>${r.last!=null?('$'+r.last.toFixed(3)):''}</div>
        </div>
      </div>`).join('');

    rows.forEach((r,i)=>{
      const el = document.getElementById(`mom-${i}`);
      if (el && r.candles && r.candles.length)
        cardCharts.push(window.Charts.candleCard(el, r.candles, false));
    });
    grid.querySelectorAll('.mom-card').forEach(card=>
      card.addEventListener('click', ()=> openModal(+card.dataset.idx)));
  }

  // ---------- expand modal ----------
  function openModal(idx){
    const r = DATA.ranked[idx]; if (!r) return;
    const s = periodStats(r.candles||[]);
    $('#modal-ticker').textContent = r.ticker;
    $('#modal-name').textContent   = r.name || '';
    $('#modal-rank').textContent   = `Rank #${idx+1} of ${DATA.ranked.length}`;
    const metric = (label,val,tone)=>`<div class="mm"><span class="mm-l">${label}</span>
      <span class="mm-v ${tone||''}">${val}</span></div>`;
    const pc = v => v==null?'–':((v>=0?'+':'')+(v*100).toFixed(1)+'%');
    $('#modal-metrics').innerHTML =
      metric('6−1 momentum (ranking)', pc(r.score), r.score>=0?'pos':'neg') +
      metric('Return over period (incl. last month)', pc(s.periodReturn), s.periodReturn>=0?'pos':'neg') +
      metric('Volatility — period, annualised', s.volAnn==null?'–':(s.volAnn*100).toFixed(1)+'%') +
      metric('Daily volatility (period)', s.volDaily==null?'–':(s.volDaily*100).toFixed(2)+'%') +
      metric('Last close', r.last!=null?('$'+r.last.toFixed(3)):'–');

    const modal = $('#mom-modal'); modal.hidden = false;
    if (bigChart){ bigChart.dispose(); bigChart=null; }
    // init after layout so the chart sizes to the modal
    requestAnimationFrame(()=>{ bigChart = window.Charts.candleCard($('#modal-chart'), r.candles||[], true); });
  }
  function closeModal(){
    $('#mom-modal').hidden = true;
    if (bigChart){ bigChart.dispose(); bigChart=null; }
  }

  function wireModal(){
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-backdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', e=>{ if (e.key==='Escape') closeModal(); });
  }

  window.ScreenerTab = { setData, render, wireModal };
})();
