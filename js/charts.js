/* ECharts rendering helpers — Plus1 light theme. */
(function () {
  const COLORS = {
    text:'#5a6776', textStrong:'#1d2733', grid:'#e3e8ef', tip:'#ffffff',
    accent:'#8B5CF6', accentD:'#7340e0', bench:'#8a96a3',
    densityLine:'#1d2733',   // dark (site text colour) density overlay
    pos:'#15a36b', neg:'#e23b4e', ma200:'#c4b0f5',
    markEntry:'#10b981', markExit:'#f43f5e'   // distinct green/red dots vs candles
  };
  const FONT = "Manrope, system-ui, sans-serif";
  const instances = {};

  // Snappier defaults: ECharts' out-of-the-box entry animation is ~1s with
  // easing, which is what makes the dashboard feel sluggish on load and on every
  // re-render. Trim to a quick, still-smooth ~280ms. Applied centrally by
  // wrapping each instance's setOption once, so individual charts don't need to
  // repeat it (and an explicit option can still override).
  const ANIM = { animation:true, animationDuration:280, animationDurationUpdate:280,
                 animationEasing:'cubicOut', animationEasingUpdate:'cubicOut' };
  function tuneAnim(c){
    if (!c || c.__animTuned) return c;
    const orig = c.setOption.bind(c);
    c.setOption = (opt, ...rest) => orig(Object.assign({}, ANIM, opt), ...rest);
    c.__animTuned = true;
    return c;
  }

  // Reuse a live ECharts instance across re-renders (clearing its option) rather
  // than disposing + recreating the canvas every time — far less churn on a unit
  // toggle or date-range drag. A container that gets its innerHTML wiped (empty
  // state, "not enough data") drops its instance via disposeOne/disposeAll, so a
  // fresh one is created here when one is next needed.
  function init(id){
    const el = document.getElementById(id);
    if (!el) return null;
    let c = instances[id];
    if (!c || c.isDisposed()){
      c = tuneAnim(echarts.init(el, null, { renderer:'canvas' }));
      instances[id] = c;
    } else {
      c.clear();
    }
    return c;
  }
  function disposeOne(id){
    const c = instances[id];
    if (c && !c.isDisposed()) c.dispose();
    delete instances[id];
  }
  function disposeAll(){ Object.keys(instances).forEach(disposeOne); }
  const axisBase = { axisLine:{lineStyle:{color:COLORS.grid}},
    axisLabel:{color:COLORS.text, fontFamily:FONT, margin:14},   // a little breathing room under axis labels
    splitLine:{lineStyle:{color:COLORS.grid, opacity:.35}} };
  const XLABEL = {color:COLORS.text, fontFamily:FONT, margin:14};  // shared x-axis label spacing

  // Bottom range slider for modal charts, styled to match the overview date
  // slider: a slim plain track with an orange fill and white circular handles —
  // no in-slider price line.
  function zoomSlider(start, end){
    return {
      type:'slider', start, end, height:12, bottom:6,
      filterMode:'filter',                             // recompute series in view -> y-axis rescales on zoom
      showDataShadow:false,                            // drop the mini price line
      backgroundColor:'rgba(120,135,150,.12)', borderColor:'transparent',
      fillerColor:'rgba(139,92,246,.26)',
      handleIcon:'path://M0,0 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0',
      handleSize:'150%',
      handleStyle:{ color:'#fff', borderColor:COLORS.accent, borderWidth:2,
        shadowBlur:4, shadowColor:'rgba(0,0,0,.18)' },
      moveHandleSize:0,
      emphasis:{ handleStyle:{ borderColor:COLORS.accentD } },
      showDetail:false,        // no handle labels — the visible range is shown above the slider instead
      brushSelect:false
    };
  }

  const fmtMoney = v => (v<0?'-$':'$') + Math.abs(v).toLocaleString(undefined,{maximumFractionDigits:0});
  const fmtPct = v => (v>=0?'+':'') + v.toFixed(2) + '%';

  function equityChart(id, m, unit){
    const c = init(id); if (!c) return;
    const dates = m.equity.map(e=>e.date);
    const toUnit = (eq, base) => unit==='percent' ? (eq/base-1)*100 : eq;
    const base = m.equity.length ? m.equity[0].equity : 1;
    const acct = m.equity.map(e=>+toUnit(e.equity, base).toFixed(2));
    // Colour the account curve by performance over the window: green if it
    // finished up, red if down.
    const lastEqRaw = m.equity.length ? m.equity[m.equity.length-1].equity : base;
    const acctUp = lastEqRaw >= base;
    const lineCol = acctUp ? COLORS.pos : COLORS.neg;
    const areaRGB = acctUp ? '21,163,107' : '226,59,78';
    const series = [{
      name:'Account', type:'line', data:acct, smooth:false, showSymbol:false,
      itemStyle:{color:lineCol}, lineStyle:{width:2.4, color:lineCol},
      areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,
        [{offset:0,color:`rgba(${areaRGB},.22)`},{offset:1,color:`rgba(${areaRGB},0)`}])}
    }];
    if (m.benchEquity){
      const bbase = m.benchEquity.find(v=>v!=null) || 1;
      series.push({
        name: window.CONFIG.BENCHMARK_LABEL, type:'line', showSymbol:false,
        data: m.benchEquity.map(v=> v==null?null:+toUnit(v,bbase).toFixed(2)),
        connectNulls:true, itemStyle:{color:COLORS.bench},
        lineStyle:{width:1.8, color:COLORS.bench, type:'dashed'}
      });
    }
    // Headline: latest account equity + total change over the visible window
    // (Robinhood/Stake style), drawn top-left above the plot.
    const lastEq = m.equity.length ? m.equity[m.equity.length-1].equity : 0;
    const chg = lastEq - base, chgPct = base ? chg/base*100 : 0;
    const up = chg>=0;
    const headline = [
      { type:'text', left:0, top:0, z:5,
        style:{ text:fmtMoney(lastEq), fill:COLORS.textStrong, fontSize:26, fontFamily:FONT, fontWeight:700 } },
      { type:'text', left:0, top:33, z:5,
        style:{ text:`${up?'▲':'▼'} ${fmtMoney(Math.abs(chg))} (${fmtPct(chgPct)}) in range`,
          fill:up?COLORS.pos:COLORS.neg, fontSize:12, fontFamily:FONT, fontWeight:600 } }
    ];
    c.setOption({
      backgroundColor:'transparent',
      color:[lineCol, COLORS.bench],
      grid:{left:64,right:18,top:86,bottom:34},   // room for the equity headline + a clear gap
      graphic:headline,
      legend:{data:series.map(s=>s.name), top:0, right:0,
        icon:'roundRect', itemWidth:11, itemHeight:11, itemGap:16,
        textStyle:{color:COLORS.text, fontSize:12.5}},
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong},
        valueFormatter:v=> v==null?'–':(unit==='percent'?fmtPct(v):fmtMoney(v))},
      xAxis:{type:'category', data:dates, boundaryGap:false, ...axisBase},
      yAxis:{type:'value', scale:true, ...axisBase,
        axisLabel:{color:COLORS.text, formatter:v=> unit==='percent'? v+'%' : fmtMoney(v)}},
      series
    });
  }

  // Underwater / drawdown curve: distance below the running peak over time (<=0),
  // shaded red down to a dashed line at the deepest drawdown. `unit` switches the
  // axis between % and $; the dashed threshold reuses m.maxDrawdown so it matches
  // the KPI tile exactly.
  function drawdownChart(id, m, unit){
    const c = init(id); if (!c) return;
    const dd = m.drawdown || [];
    const dates = dd.map(d=>d.date);
    const vals  = dd.map(d=> +(unit==='percent' ? d.pct : d.dollars).toFixed(2));
    const thresh = +(unit==='percent' ? m.maxDrawdown.pct : m.maxDrawdown.dollars).toFixed(2);
    const valFmt = v => unit==='percent' ? v.toFixed(1)+'%' : fmtMoney(v);
    // Percent ticks can land on fractional intervals (e.g. 0.5%); show up to 2
    // decimals (trailing zeros trimmed) so labels aren't rounded to duplicates.
    const axFmt  = v => unit==='percent' ? (+v.toFixed(2))+'%' : fmtMoney(v);
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:58, right:18, top:16, bottom:30},
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong},
        valueFormatter:v=> v==null?'–':valFmt(v)},
      xAxis:{type:'category', data:dates, boundaryGap:false, ...axisBase},
      // Drawdown is always <=0, so pin the top at 0 and let ECharts choose a
      // rounded min + interval (clean thousands) rather than padding the trough
      // to an odd value like -4330.
      yAxis:{type:'value', max:0, ...axisBase,
        axisLabel:{color:COLORS.text, formatter:v=>axFmt(v)}},
      series:[{
        name:'Drawdown', type:'line', data:vals, showSymbol:false,
        lineStyle:{width:1.9, color:COLORS.neg}, itemStyle:{color:COLORS.neg},
        areaStyle:{color:'rgba(226,59,78,.13)'},   // shade between the curve and 0
        markLine:{ silent:true, symbol:'none',
          lineStyle:{color:COLORS.neg, type:'dashed', width:1.2},
          label:{ formatter:'Max drawdown '+valFmt(thresh), position:'insideStartTop',
            color:COLORS.neg, fontSize:10, fontWeight:'bold' },
          data:[{ yAxis: thresh }] }
      }]
    });
  }

  function tickerChart(id, rows, unit){
    const c = init(id); if (!c) return;
    const nameByTicker = {}; rows.forEach(r => nameByTicker[r.ticker] = r.name || r.ticker);
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:80,right:24,top:14,bottom:30},
      tooltip:{trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:COLORS.tip,
        borderColor:COLORS.grid, textStyle:{color:COLORS.textStrong},
        formatter:params=>{ const p=params[0]; const v=p.value;
          const nm=nameByTicker[p.name]||p.name;
          return `<b>${nm}</b> <span style="color:${COLORS.text}">${p.name}</span><br/>`
               + (unit==='percent'?fmtPct(v):fmtMoney(v)); }},
      xAxis:{type:'value', ...axisBase,
        axisLabel:{...XLABEL, formatter:v=> unit==='percent'? v+'%' : fmtMoney(v)}},
      yAxis:{type:'category', data:rows.map(r=>r.ticker), ...axisBase,
        axisLabel:{color:COLORS.text, fontFamily:FONT}},
      series:[{
        type:'bar', data:rows.map(r=>({value:+r.value.toFixed(2),
          itemStyle:{color:r.value>=0?COLORS.pos:COLORS.neg,
                     borderRadius:[0,3,3,0]}})),
        barMaxWidth:18
      }]
    });
  }

  // Vertical category bars coloured by sign — used for P&L/return by weekday or
  // by hour of entry. `rows` = [{label, value, pnl, ret, n}], `unit` = display.
  function categoryBarChart(id, rows, unit){
    const c = init(id); if (!c) return;
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:52, right:18, top:16, bottom:30},
      tooltip:{trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:COLORS.tip,
        borderColor:COLORS.grid, textStyle:{color:COLORS.textStrong},
        formatter:params=>{ const p=params[0]; const r=rows[p.dataIndex]||{};
          return `<b>${p.name}</b><br/>${unit==='percent'?fmtPct(p.value):fmtMoney(p.value)}`
               + `<br/><span style="color:${COLORS.text}">${r.n||0} trade(s)</span>`; }},
      xAxis:{type:'category', data:rows.map(r=>r.label), ...axisBase, axisLabel:{...XLABEL}},
      yAxis:{type:'value', scale:true, ...axisBase,
        axisLabel:{color:COLORS.text, formatter:v=> unit==='percent'? v+'%' : fmtMoney(v)}},
      series:[{
        type:'bar', barMaxWidth:38,
        data:rows.map(r=>({value:+r.value.toFixed(2),
          itemStyle:{color:r.value>=0?COLORS.pos:COLORS.neg, borderRadius:[4,4,0,0]}}))
      }]
    });
  }

  // Trade outcomes: a big win-rate headline + a 100% win/loss/breakeven split
  // bar. Rendered as HTML (not ECharts) so it inherits the site font.
  function outcomeChart(id, m){
    const el = document.getElementById(id); if (!el) return;
    const n = m.nTotal||0;
    const wr = n ? (m.nWin/n*100) : 0;
    const pct1 = v => (n? (v/n*100):0);
    const segs = [
      ['win', m.nWin, pct1(m.nWin)],
      ['loss', m.nLoss, pct1(m.nLoss)],
      ['flat', m.nFlat, pct1(m.nFlat)]
    ].filter(s=>s[1]>0);
    el.innerHTML = `
      <div class="oc-head">
        <span class="oc-rate">${wr.toFixed(1)}<i>%</i></span>
        <span class="oc-sub">win rate · <b>${m.nTotal}</b> trades</span>
      </div>
      <div class="oc-bar">
        ${segs.map(s=>`<span class="oc-seg oc-${s[0]}" style="width:${s[2]}%"
            title="${s[1]} (${s[2].toFixed(1)}%)">${s[2]>=14?`<i>${Math.round(s[2])}%</i>`:''}</span>`).join('')}
      </div>
      <div class="oc-legend">
        <span><i class="oc-dot oc-win"></i>Wins ${m.nWin}</span>
        <span><i class="oc-dot oc-loss"></i>Losses ${m.nLoss}</span>
        <span><i class="oc-dot oc-flat"></i>Breakeven ${m.nFlat}</span>
      </div>`;
  }

  // Average holding period: three stat tiles (Winners / Losers / Overall).
  function holdingChart(id, m){
    const el = document.getElementById(id); if (!el) return;
    const tile = (lbl,val,cls) => `<div class="hold-tile">
        <div class="hold-lbl">${lbl}</div>
        <div class="hold-val ${cls}">${(val||0).toFixed(1)}<i>d</i></div></div>`;
    el.innerHTML = `<div class="hold-tiles">
        ${tile('Winners', m.avgHoldWin, 'val-pos')}
        ${tile('Losers', m.avgHoldLoss, 'val-neg')}
        ${tile('Overall', m.avgHoldAll, 'val-accent')}
      </div>`;
  }

  // Volume bars overlaid on the BOTTOM of the price chart (same grid + x-axis),
  // on their own hidden y-axis whose max is inflated so the bars only fill the
  // lower ~22% of the height — a relative-volume strip, no axis or numbers. `up`
  // flags colour each bar green/red. Returns option fragments to mix in.
  function volumeLayer(vols, upFlags, hasVol){
    if (!hasVol) return { yAxes:[], series:[] };
    const maxV = Math.max(1, ...vols);
    return {
      yAxes:[{ type:'value', show:false, min:0, max:maxV*4.5,   // bars ~bottom 22%
        gridIndex:0, axisLabel:{show:false}, axisLine:{show:false},
        splitLine:{show:false}, axisTick:{show:false} }],
      series:[{ name:'Volume', type:'bar', xAxisIndex:0, yAxisIndex:1, data:vols,
        barWidth:'60%', silent:true, z:1,
        itemStyle:{color:(p)=> upFlags[p.dataIndex] ? 'rgba(21,163,107,.40)' : 'rgba(226,59,78,.40)'} }]
    };
  }

  // Candlestick + MA50/MA200. Scrollable/zoomable (dataZoom). `big` shows axes,
  // a zoom slider, and (when volume is present) a volume-bar panel — expanded
  // (modal) view only; the small preview cards stay clean.
  function candleCard(el, candles, big){
    const c = tuneAnim(echarts.init(el, null, {renderer:'canvas'}));
    const dates = candles.map(d=>d.date);
    const ohlc = candles.map(d=>[d.open,d.close,d.low,d.high]);
    const hasVol = big && candles.some(d=>d.volume>0);
    const vols = candles.map(d=>d.volume||0);
    const upFlags = candles.map(d=>d.close>=d.open);
    const vol = volumeLayer(vols, upFlags, hasVol);
    const hasMA = candles.some(d=>d.ma50!=null||d.ma200!=null);
    const ma = (n,key)=> hasMA
      ? candles.map(d=> d[key]==null?null:+d[key])
      : candles.map((_,i)=>{ if (i<n-1) return null;
          let s=0; for (let k=i-n+1;k<=i;k++) s+=candles[k].close; return +(s/n).toFixed(3); });
    // Preview cards open on just the ~7-month momentum window (the 6-1 lookback,
    // ~147 trading days); the expanded view shows the full available history.
    // A log price axis keeps the long expanded charts readable — momentum names
    // spike from a low base, which a linear axis would squash to a flat line.
    const MOM_BARS = 147;
    const startPct = big ? 0 : Math.max(0, 100 - (MOM_BARS / candles.length * 100));
    const priceGrid = big ? {left:54,right:18,top:16,bottom:74}
                          : {left:6,right:6,top:8,bottom:6,containLabel:false};
    c.setOption({
      backgroundColor:'transparent',
      grid:[ priceGrid ],
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong, fontSize:11},
        formatter:p=>{const k=p.find(x=>x.seriesType==='candlestick'); if(!k) return '';
          const v=k.data; const vb=p.find(x=>x.seriesName==='Volume');
          return `${k.axisValue}<br/>O ${v[1]} H ${v[4]}<br/>L ${v[3]} C ${v[2]}`
               + (vb? `<br/>Vol ${(+vb.data).toLocaleString()}` : '');}},
      xAxis:[ {type:'category', data:dates, show:big, boundaryGap:true,
        axisLabel:{...XLABEL}, axisLine:{lineStyle:{color:COLORS.grid}}} ],
      // Linear axis with scale:true so it always re-fits to the VISIBLE window
      // (paired with dataZoom filterMode:'filter') — candles fill the height at
      // any zoom. Preview hides the axis; expanded shows it. The volume bars ride
      // a second, hidden y-axis on the SAME grid (see volumeLayer).
      yAxis:[ {type:'value', scale:true, show:big, ...(big?axisBase:{})}, ...vol.yAxes ],
      dataZoom:[
        big
          // Expanded: full zoom + pan via wheel/drag. filterMode:'filter' drops
          // out-of-view bars so the (scale:true) y-axis re-fits the visible range.
          ? {type:'inside', start:startPct, end:100, filterMode:'filter',
             zoomOnMouseWheel:true, moveOnMouseMove:true, moveOnMouseWheel:false}
          // Preview: pan with the SCROLL WHEEL only — drag-pan is disabled so a
          // click cleanly expands the card. No zoom; y auto-scales.
          : {type:'inside', start:startPct, end:100, zoomLock:true, filterMode:'filter',
             zoomOnMouseWheel:false, moveOnMouseWheel:true, moveOnMouseMove:false},
        ...(big ? [zoomSlider(startPct, 100)] : [])
      ],
      series:[
        {type:'candlestick', data:ohlc,
          itemStyle:{color:COLORS.pos,color0:COLORS.neg,
            borderColor:COLORS.pos,borderColor0:COLORS.neg}},
        {name:'MA50', type:'line', data:ma(50,'ma50'), showSymbol:false, connectNulls:true,
          lineStyle:{width:1.3,color:COLORS.ma200}},
        {name:'MA200', type:'line', data:ma(200,'ma200'), showSymbol:false, connectNulls:true,
          lineStyle:{width:1.3,color:COLORS.accent}},
        ...vol.series
      ]
    });
    return c;
  }

  // Trade-outcome histogram (custom rects so bin width is exact) with a fitted
  // normal-distribution overlay. h.mode picks the metric/axis: 'dollar' shows
  // per-trade $ P&L, otherwise % return.
  function returnsDistChart(id, h){
    if (!h.bins.length){ disposeOne(id); const el=document.getElementById(id);
      if (el) el.innerHTML = '<div class="chart-empty">Not enough trades to plot a distribution</div>'; return; }
    const c = init(id); if (!c) return;
    const isDollar = h.mode==='dollar';
    const fmtAxis  = isDollar ? (v=>fmtMoney(v)) : (v=>v+'%');
    const fmtMid   = isDollar ? (v=>fmtMoney(v)) : (v=>v.toFixed(1)+'%');
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:46,right:18,top:16,bottom:24},
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong},
        formatter:p=>{ const b=p.find(x=>x.seriesName==='Trades');
          return (b? `${isDollar?'P&L':'Return'} ≈ ${fmtMid(+b.value[3])}<br/>${b.value[2]} trade(s)` : ''); }},
      xAxis:{type:'value', ...axisBase,
        axisLabel:{...XLABEL, formatter:v=>fmtAxis(v)}},
      yAxis:{type:'value', name:'Trades', ...axisBase, axisLabel:{color:COLORS.text}},
      series:[
        {name:'Trades', type:'custom', encode:{x:[0,1], y:2},
         itemStyle:{color:COLORS.pos},   // legend swatch
         data:h.bins.map(b=>[b.x0,b.x1,b.count,b.mid]),
         renderItem:(params,api)=>{
           const x0=api.coord([api.value(0),0]), x1=api.coord([api.value(1),0]);
           const top=api.coord([0,api.value(2)]), base=api.coord([0,0]);
           const w=Math.max(1,(x1[0]-x0[0])-1.5);
           // Colour by sign of the bin: losses red, wins green.
           const fill = api.value(3) < 0 ? COLORS.neg : COLORS.pos;
           return {type:'rect', shape:{x:x0[0]+0.75, y:top[1], width:w, height:base[1]-top[1]},
             style:{fill}};
         }},
        {name:'Density', type:'line', smooth:true, showSymbol:false, data:h.density,
         itemStyle:{color:COLORS.densityLine}, lineStyle:{color:COLORS.densityLine,width:2.5}}
      ]
    });
  }

  // Trade/position price chart: candlesticks for one ticker with entry (and, for
  // closed trades, exit) marked as dots, a line connecting them (green win / red
  // loss), and an optional dashed stop line. `rows` are compact
  // [date,open,high,low,close] arrays; `mark` = { entryDt, entryPx, exitDt?,
  // exitPx?, stop?, lastPx?, win? }.
  function tradeChart(id, rows, mark){
    const c = init(id); if (!c) return;
    const dates = rows.map(r=>r[0]);
    const ohlc  = rows.map(r=>[r[1], r[4], r[3], r[2]]);   // ECharts: [open,close,low,high]
    const hasVol  = rows.some(r=>r[5]>0);
    const vols    = rows.map(r=>r[5]||0);
    const upFlags = rows.map(r=>r[4]>=r[1]);               // close>=open
    const vol     = volumeLayer(vols, upFlags, hasVol);
    const key = d => (d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10));
    const nearest = k => {
      const i = dates.indexOf(k); if (i>=0) return i;
      const kt = new Date(k).getTime(); let best=0, bd=Infinity;
      dates.forEach((d,j)=>{ const dd=Math.abs(new Date(d).getTime()-kt); if(dd<bd){bd=dd;best=j;} });
      return best;
    };
    const n = rows.length;
    const ei = nearest(key(mark.entryDt));
    const hasExit = mark.exitPx!=null && mark.exitDt;
    const xi = hasExit ? nearest(key(mark.exitDt)) : n-1;
    const dot = (i,price,label,col) => ({
      coord:[dates[i], price], value:label, symbol:'circle', symbolSize:13,
      itemStyle:{color:col, borderColor:'#fff', borderWidth:2, shadowBlur:4, shadowColor:'rgba(0,0,0,.25)'},
      label:{show:true, position:'top', formatter:label, color:COLORS.textStrong, fontSize:11,
        backgroundColor:'rgba(255,255,255,.85)', padding:[2,4], borderRadius:3}
    });
    const points = [ dot(ei, mark.entryPx, 'Entry '+(+mark.entryPx).toFixed(3), COLORS.markEntry) ];
    if (hasExit) points.push(dot(xi, mark.exitPx, 'Exit '+(+mark.exitPx).toFixed(3), COLORS.markExit));
    else if (mark.lastPx!=null) points.push(dot(n-1, mark.lastPx, 'Last '+(+mark.lastPx).toFixed(3), COLORS.bench));

    const lineData = [];
    if (hasExit) lineData.push([{coord:[dates[ei], mark.entryPx]}, {coord:[dates[xi], mark.exitPx]}]);
    if (mark.stop) lineData.push({ yAxis: mark.stop,
      lineStyle:{color:COLORS.neg, type:'dashed', width:1.2},
      label:{show:true, formatter:'Stop '+(+mark.stop).toFixed(3), position:'insideEndTop',
        color:COLORS.neg, fontSize:10} });

    // Default window: ~20 bars either side of the trade. If the trade reaches
    // the last bar (e.g. an open position), pin the right edge to 100% so the
    // most recent candle is always shown without zooming out.
    const lo = Math.max(0, Math.min(ei,xi)-20), hi = Math.min(n-1, Math.max(ei,xi)+20);
    const startPct = lo/n*100;
    const endPct = hi>=n-1 ? 100 : (hi+1)/n*100;
    c.setOption({
      backgroundColor:'transparent',
      grid:[ {left:56,right:18,top:16,bottom:74} ],
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong, fontSize:11},
        formatter:p=>{const k=p.find(x=>x.seriesType==='candlestick'); if(!k) return '';
          const v=k.data; const vb=p.find(x=>x.seriesName==='Volume');
          return `${k.axisValue}<br/>O ${v[1]} H ${v[4]}<br/>L ${v[3]} C ${v[2]}`
               + (vb? `<br/>Vol ${(+vb.data).toLocaleString()}` : '');}},
      xAxis:[ {type:'category', data:dates, boundaryGap:true,
        axisLabel:{...XLABEL}, axisLine:{lineStyle:{color:COLORS.grid}}} ],
      yAxis:[ {type:'value', scale:true, ...axisBase}, ...vol.yAxes ],
      dataZoom:[
        {type:'inside', start:startPct, end:endPct, filterMode:'filter',
         zoomOnMouseWheel:true, moveOnMouseMove:true},
        zoomSlider(startPct, endPct)
      ],
      series:[{
        type:'candlestick', data:ohlc,
        itemStyle:{color:COLORS.pos, color0:COLORS.neg, borderColor:COLORS.pos, borderColor0:COLORS.neg},
        markPoint:{ data:points },
        markLine:{ symbol:'none', label:{show:false},
          lineStyle:{color: mark.win ? COLORS.pos : COLORS.neg, width:2}, data:lineData }
      }, ...vol.series]
    });
  }

  // Export a modal (header + chart + sidebar) to a PNG. html2canvas rasterises
  // the DOM subtree, but it can't read a live <canvas> reliably across browsers,
  // so we first paint the ECharts chart into a static <img> overlay (via the
  // chart's own getDataURL — which keeps candles, markers, MA lines and volume),
  // snapshot the card, then restore the live chart. `chartInst` is the ECharts
  // instance inside `cardEl`; `name` seeds the download filename.
  async function exportModalPNG(cardEl, chartInst, name){
    if (!cardEl || typeof html2canvas === 'undefined') return false;
    const chartEl = chartInst && !chartInst.isDisposed() ? chartInst.getDom() : null;
    let overlay = null;
    if (chartEl){
      const url = chartInst.getDataURL({ type:'png', pixelRatio:2, backgroundColor:'#fff' });
      overlay = document.createElement('img');
      overlay.src = url;
      overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill';
      chartEl.style.position = 'relative';
      chartEl.appendChild(overlay);                 // cover the live canvas for the snapshot
      const canv = chartEl.querySelector('canvas'); if (canv) canv.style.visibility='hidden';
    }
    try {
      const shot = await html2canvas(cardEl, { backgroundColor:'#fff', scale:2,
        useCORS:true, logging:false,
        ignoreElements:el=>el.classList && (el.classList.contains('modal-close')
                          || el.classList.contains('export-btn')) });
      const a = document.createElement('a');
      a.download = (name||'chart').replace(/[^\w.-]+/g,'_') + '.png';
      a.href = shot.toDataURL('image/png');
      a.click();
      return true;
    } catch(e){ return false; }
    finally {
      if (overlay){ overlay.remove();
        const canv = chartEl.querySelector('canvas'); if (canv) canv.style.visibility=''; }
    }
  }

  // Resize only the charts that are actually on screen — a hidden tab's canvases
  // have zero size and resizing them just thrashes for nothing.
  function resizeAll(){
    Object.values(instances).forEach(c=>{
      if (!c || c.isDisposed()) return;
      const el = c.getDom();
      if (el && el.offsetParent !== null) c.resize();   // offsetParent null => not displayed
    });
  }
  // Debounce window resizes so dragging the window edge doesn't re-lay-out every
  // canvas on every pixel.
  let resizeTimer = null;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeAll, 150);
  });

  window.Charts = { equityChart, drawdownChart, tickerChart, categoryBarChart, outcomeChart,
                    holdingChart, candleCard, returnsDistChart, tradeChart,
                    resizeAll, disposeOne, disposeAll,
                    exportModalPNG, instance:(id)=>instances[id] };
})();
