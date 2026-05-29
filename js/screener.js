/* Momentum screener tab: renders ranked buy list as candlestick cards. */
(function () {
  const $ = s => document.querySelector(s);
  let DATA = null;
  const cardCharts = [];

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
    if (DATA.placeholder){
      note.className='source-note placeholder';
      note.textContent='Placeholder data — run the data workflow for a live Stooq scan.';
    } else {
      note.className='source-note live';
      note.textContent='Live Stooq scan · '+(DATA.asof||'');
    }

    const topN = parseInt($('#scr-topn').value,10);
    const rows = DATA.ranked.slice(0, topN);

    cardCharts.forEach(c=>c.dispose()); cardCharts.length=0;
    grid.innerHTML = rows.map((r,i)=>`
      <div class="mom-card">
        <div class="mom-card-head">
          <div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="mom-rank">#${i+1}</span>
              <span class="mom-ticker">${r.ticker}</span>
            </div>
            <div class="mom-name">${r.name||''}</div>
          </div>
          <div class="mom-score">
            <div class="s-val">${(r.score*100).toFixed(1)}%</div>
            <div class="s-lbl">6−1 mom</div>
          </div>
        </div>
        <div class="mom-chart" id="mom-${r.ticker}-${i}"></div>
        <div class="mom-card-foot">
          <div class="ma-key"><span class="ma50">MA50</span><span class="ma200">MA200</span></div>
          <div>${r.last!=null?('$'+r.last.toFixed(3)):''}</div>
        </div>
      </div>`).join('');

    rows.forEach((r,i)=>{
      const el = document.getElementById(`mom-${r.ticker}-${i}`);
      if (el && r.candles && r.candles.length){
        cardCharts.push(window.Charts.candleCard(el, r.candles));
      }
    });
  }

  window.ScreenerTab = { setData, render };
})();
