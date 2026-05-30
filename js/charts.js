/* ECharts rendering helpers — Plus1 light theme. */
(function () {
  const COLORS = {
    text:'#5a6776', textStrong:'#1d2733', grid:'#e3e8ef', tip:'#ffffff',
    accent:'#F5821E', accentD:'#d96f12', accent2:'#ffa24d', accentMid:'#ffb877', bench:'#8a96a3',
    pos:'#15a36b', neg:'#e23b4e', warn:'#e0a020',
    posDim:'#d4efe3', negDim:'#fbe0e3',        // pastel green/red (match the side-pill backgrounds)
    posMid:'#74c9a7', negMid:'#ee8d98',        // medium green/red — pastel-but-not-white gradient end
    markEntry:'#10b981', markExit:'#f43f5e'   // distinct green/red dots vs candles
  };
  const FONT = "Inter, system-ui, sans-serif";
  const instances = {};

  function init(id){
    const el = document.getElementById(id);
    if (!el) return null;
    if (instances[id]) instances[id].dispose();
    const c = echarts.init(el, null, { renderer:'canvas' });
    instances[id] = c;
    return c;
  }
  const axisBase = { axisLine:{lineStyle:{color:COLORS.grid}},
    axisLabel:{color:COLORS.text, fontFamily:FONT, margin:14},   // a little breathing room under axis labels
    splitLine:{lineStyle:{color:COLORS.grid, opacity:.35}} };
  // Gradient fills (pastel <-> saturated) for the summary charts.
  const gradH = (a,b) => new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:a},{offset:1,color:b}]);
  const gradV = (a,b) => new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:a},{offset:1,color:b}]);
  const XLABEL = {color:COLORS.text, fontFamily:FONT, margin:14};  // shared x-axis label spacing

  // Bottom range slider for modal charts, styled to match the overview date
  // slider: a slim plain track with an orange fill and white circular handles —
  // no in-slider price line.
  function zoomSlider(start, end){
    return {
      type:'slider', start, end, height:10, bottom:16,
      showDataShadow:false,                            // drop the mini price line
      backgroundColor:'rgba(120,135,150,.12)', borderColor:'transparent',
      fillerColor:'rgba(245,130,30,.22)',
      handleIcon:'path://M0,0 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0',
      handleSize:'150%',
      handleStyle:{ color:'#fff', borderColor:COLORS.accent, borderWidth:2,
        shadowBlur:4, shadowColor:'rgba(0,0,0,.18)' },
      moveHandleSize:0,
      emphasis:{ handleStyle:{ borderColor:COLORS.accentD } },
      textStyle:{ color:COLORS.text, fontSize:10 }, brushSelect:false
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
    const series = [{
      name:'Account', type:'line', data:acct, smooth:false, showSymbol:false,
      itemStyle:{color:COLORS.accent}, lineStyle:{width:2.4, color:COLORS.accent},
      areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,
        [{offset:0,color:'rgba(245,130,30,.24)'},{offset:1,color:'rgba(245,130,30,0)'}])}
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
    c.setOption({
      backgroundColor:'transparent',
      color:[COLORS.accent, COLORS.bench],
      grid:{left:64,right:18,top:34,bottom:34},
      legend:{data:series.map(s=>s.name), top:0, right:0, textStyle:{color:COLORS.text},
        icon:'roundRect'},
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong},
        valueFormatter:v=> v==null?'–':(unit==='percent'?fmtPct(v):fmtMoney(v))},
      xAxis:{type:'category', data:dates, boundaryGap:false, ...axisBase},
      yAxis:{type:'value', scale:true, ...axisBase,
        axisLabel:{color:COLORS.text, formatter:v=> unit==='percent'? v+'%' : fmtMoney(v)}},
      series
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
        axisLabel:{color:COLORS.text, fontFamily:'JetBrains Mono, monospace'}},
      series:[{
        type:'bar', data:rows.map(r=>({value:+r.value.toFixed(2),
          itemStyle:{color:r.value>=0?COLORS.pos:COLORS.neg,
                     borderRadius:[0,3,3,0]}})),
        barMaxWidth:18
      }]
    });
  }

  function outcomeChart(id, m){
    const c = init(id); if (!c) return;
    c.setOption({
      backgroundColor:'transparent',
      tooltip:{trigger:'item', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong}},
      legend:{bottom:0, textStyle:{color:COLORS.text}},
      series:[{
        type:'pie', radius:['52%','74%'], center:['50%','45%'], avoidLabelOverlap:true,
        itemStyle:{borderColor:'#ffffff', borderWidth:2},
        label:{color:COLORS.textStrong, formatter:'{b}\n{c}'},
        data:[
          {value:m.nWin, name:'Wins', itemStyle:{color:COLORS.pos}},
          {value:m.nLoss, name:'Losses', itemStyle:{color:COLORS.neg}},
          {value:m.nFlat, name:'Breakeven', itemStyle:{color:'#9aa6b2'}}
        ]
      }]
    });
  }

  function holdingChart(id, m){
    const c = init(id); if (!c) return;
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:46,right:20,top:20,bottom:30},
      tooltip:{trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:COLORS.tip,
        borderColor:COLORS.grid, textStyle:{color:COLORS.textStrong},
        valueFormatter:v=>v.toFixed(1)+' days'},
      xAxis:{type:'category', data:['Winners','Losers','All'], ...axisBase},
      yAxis:{type:'value', ...axisBase, axisLabel:{color:COLORS.text, formatter:'{value}d'}},
      series:[{type:'bar', barMaxWidth:48, data:[
        {value:+m.avgHoldWin.toFixed(1), itemStyle:{color:COLORS.pos}},
        {value:+m.avgHoldLoss.toFixed(1), itemStyle:{color:COLORS.neg}},
        {value:+m.avgHoldAll.toFixed(1), itemStyle:{color:COLORS.accent}}
      ], itemStyle:{borderRadius:[4,4,0,0]}}]
    });
  }

  // Candlestick + MA50/MA200. Scrollable/zoomable (dataZoom). `big` shows axes
  // and a zoom slider for the expanded full-screen view.
  function candleCard(el, candles, big){
    const c = echarts.init(el, null, {renderer:'canvas'});
    const dates = candles.map(d=>d.date);
    const ohlc = candles.map(d=>[d.open,d.close,d.low,d.high]);
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
    c.setOption({
      backgroundColor:'transparent',
      grid: big ? {left:54,right:18,top:16,bottom:64} : {left:6,right:6,top:8,bottom:6,containLabel:false},
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong, fontSize:11},
        formatter:p=>{const k=p.find(x=>x.seriesType==='candlestick'); if(!k) return '';
          const v=k.data; return `${k.axisValue}<br/>O ${v[1]} H ${v[4]}<br/>L ${v[3]} C ${v[2]}`;}},
      xAxis:{type:'category', data:dates, show:big, boundaryGap:true,
        axisLabel:{...XLABEL}, axisLine:{lineStyle:{color:COLORS.grid}}},
      // Preview: tight linear axis fitted to the visible 7-month window so the
      // candles fill the card vertically. Expanded: log axis for the full
      // multi-year history (which spans too many decades for linear).
      yAxis: big ? {type:'log', show:true, ...axisBase}
                 : {type:'value', scale:true, show:false},
      dataZoom:[
        big
          // Expanded: full zoom + pan via wheel/drag.
          ? {type:'inside', start:startPct, end:100,
             zoomOnMouseWheel:true, moveOnMouseMove:true, moveOnMouseWheel:false}
          // Preview: pan with the SCROLL WHEEL only — drag-pan is disabled so a
          // click cleanly expands the card. No zoom; y auto-scales.
          : {type:'inside', start:startPct, end:100, zoomLock:true,
             zoomOnMouseWheel:false, moveOnMouseWheel:true, moveOnMouseMove:false},
        ...(big ? [zoomSlider(startPct, 100)] : [])
      ],
      series:[
        {type:'candlestick', data:ohlc,
          itemStyle:{color:COLORS.pos,color0:COLORS.neg,
            borderColor:COLORS.pos,borderColor0:COLORS.neg}},
        {name:'MA50', type:'line', data:ma(50,'ma50'), showSymbol:false, connectNulls:true,
          lineStyle:{width:1.3,color:COLORS.accent}},
        {name:'MA200', type:'line', data:ma(200,'ma200'), showSymbol:false, connectNulls:true,
          lineStyle:{width:1.3,color:COLORS.warn}}
      ]
    });
    return c;
  }

  // Trade-outcome histogram (custom rects so bin width is exact) with a fitted
  // normal-distribution overlay. h.mode picks the metric/axis: 'dollar' shows
  // per-trade $ P&L, otherwise % return.
  function returnsDistChart(id, h){
    const c = init(id); if (!c) return;
    if (!h.bins.length){ document.getElementById(id).innerHTML =
      '<div class="chart-empty">Not enough trades to plot a distribution</div>'; return; }
    const isDollar = h.mode==='dollar';
    const axisName = isDollar ? 'P&L ($)' : 'Return %';
    const fmtAxis  = isDollar ? (v=>fmtMoney(v)) : (v=>v+'%');
    const fmtMid   = isDollar ? (v=>fmtMoney(v)) : (v=>v.toFixed(1)+'%');
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:46,right:18,top:16,bottom:38},
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong},
        formatter:p=>{ const b=p.find(x=>x.seriesName==='Trades');
          return (b? `${isDollar?'P&L':'Return'} ≈ ${fmtMid(+b.value[3])}<br/>${b.value[2]} trade(s)` : ''); }},
      xAxis:{type:'value', name:axisName, nameLocation:'middle', nameGap:24,
        nameTextStyle:{color:COLORS.text}, ...axisBase,
        axisLabel:{...XLABEL, formatter:v=>fmtAxis(v)}},
      yAxis:{type:'value', name:'Trades', ...axisBase, axisLabel:{color:COLORS.text}},
      series:[
        {name:'Trades', type:'custom', encode:{x:[0,1], y:2},
         itemStyle:{color:'rgba(245,130,30,.7)'},   // legend swatch matches bars
         data:h.bins.map(b=>[b.x0,b.x1,b.count,b.mid]),
         renderItem:(params,api)=>{
           const x0=api.coord([api.value(0),0]), x1=api.coord([api.value(1),0]);
           const top=api.coord([0,api.value(2)]), base=api.coord([0,0]);
           const w=Math.max(1,(x1[0]-x0[0])-1.5);
           return {type:'rect', shape:{x:x0[0]+0.75, y:top[1], width:w, height:base[1]-top[1]},
             style:{fill:COLORS.accent}};
         }},
        {name:'Density', type:'line', smooth:true, showSymbol:false, data:h.density,
         itemStyle:{color:COLORS.bench}, lineStyle:{color:COLORS.bench,width:2}}
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

    const lo = Math.max(0, Math.min(ei,xi)-20), hi = Math.min(n-1, Math.max(ei,xi)+20);
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:56,right:18,top:16,bottom:60},
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong, fontSize:11},
        formatter:p=>{const k=p.find(x=>x.seriesType==='candlestick'); if(!k) return '';
          const v=k.data; return `${k.axisValue}<br/>O ${v[1]} H ${v[4]}<br/>L ${v[3]} C ${v[2]}`;}},
      xAxis:{type:'category', data:dates, boundaryGap:true,
        axisLabel:{...XLABEL}, axisLine:{lineStyle:{color:COLORS.grid}}},
      yAxis:{type:'value', scale:true, ...axisBase},
      dataZoom:[
        {type:'inside', start:lo/n*100, end:hi/n*100, zoomOnMouseWheel:true, moveOnMouseMove:true},
        zoomSlider(lo/n*100, hi/n*100)
      ],
      series:[{
        type:'candlestick', data:ohlc,
        itemStyle:{color:COLORS.pos, color0:COLORS.neg, borderColor:COLORS.pos, borderColor0:COLORS.neg},
        markPoint:{ data:points },
        markLine:{ symbol:'none', label:{show:false},
          lineStyle:{color: mark.win ? COLORS.pos : COLORS.neg, width:2}, data:lineData }
      }]
    });
  }

  function resizeAll(){ Object.values(instances).forEach(c=>c && c.resize()); }
  window.addEventListener('resize', resizeAll);

  window.Charts = { equityChart, tickerChart, outcomeChart, holdingChart,
                    candleCard, returnsDistChart, tradeChart, resizeAll };
})();
