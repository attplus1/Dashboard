/* ECharts rendering helpers — Plus1 light theme. */
(function () {
  const COLORS = {
    text:'#5a6776', textStrong:'#1d2733', grid:'#e3e8ef', tip:'#ffffff',
    accent:'#F5821E', accent2:'#ffa24d', bench:'#3b6fb0',
    pos:'#15a36b', neg:'#e23b4e', warn:'#e0a020'
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
    axisLabel:{color:COLORS.text, fontFamily:FONT},
    splitLine:{lineStyle:{color:COLORS.grid, opacity:.35}} };
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
      lineStyle:{width:2.4, color:COLORS.accent},
      areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,
        [{offset:0,color:'rgba(245,130,30,.24)'},{offset:1,color:'rgba(245,130,30,0)'}])}
    }];
    if (m.benchEquity){
      const bbase = m.benchEquity.find(v=>v!=null) || 1;
      series.push({
        name: window.CONFIG.BENCHMARK_LABEL, type:'line', showSymbol:false,
        data: m.benchEquity.map(v=> v==null?null:+toUnit(v,bbase).toFixed(2)),
        connectNulls:true, lineStyle:{width:1.8, color:COLORS.bench, type:'dashed'}
      });
    }
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:64,right:18,top:34,bottom:34},
      legend:{data:series.map(s=>s.name), top:0, right:0, textStyle:{color:COLORS.text}},
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
        axisLabel:{color:COLORS.text, formatter:v=> unit==='percent'? v+'%' : fmtMoney(v)}},
      yAxis:{type:'category', data:rows.map(r=>r.ticker), ...axisBase,
        axisLabel:{color:COLORS.text, fontFamily:'JetBrains Mono, monospace'}},
      series:[{
        type:'bar', data:rows.map(r=>({value:+r.value.toFixed(2),
          itemStyle:{color:r.value>=0?COLORS.pos:COLORS.neg, borderRadius:[0,3,3,0]}})),
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
          {value:m.nFlat, name:'Breakeven', itemStyle:{color:'#67788c'}}
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

  // Small candlestick + MA50/MA200 card chart.
  function candleCard(el, candles){
    const c = echarts.init(el, null, {renderer:'canvas'});
    const dates = candles.map(d=>d.date);
    const ohlc = candles.map(d=>[d.open,d.close,d.low,d.high]);
    // Prefer MAs precomputed over the full history (so they span the whole
    // window); fall back to a windowed average for older/placeholder data.
    const hasMA = candles.some(d=>d.ma50!=null||d.ma200!=null);
    const ma = (n,key)=> hasMA
      ? candles.map(d=> d[key]==null?null:+d[key])
      : candles.map((_,i)=>{ if (i<n-1) return null;
          let s=0; for (let k=i-n+1;k<=i;k++) s+=candles[k].close; return +(s/n).toFixed(3); });
    c.setOption({
      backgroundColor:'transparent',
      grid:{left:6,right:6,top:8,bottom:6, containLabel:false},
      tooltip:{trigger:'axis', backgroundColor:COLORS.tip, borderColor:COLORS.grid,
        textStyle:{color:COLORS.textStrong, fontSize:11},
        formatter:p=>{const k=p.find(x=>x.seriesType==='candlestick'); if(!k) return '';
          const v=k.data; return `${k.axisValue}<br/>O ${v[1]} H ${v[4]}<br/>L ${v[3]} C ${v[2]}`;}},
      xAxis:{type:'category', data:dates, show:false, boundaryGap:true},
      yAxis:{type:'value', scale:true, show:false},
      series:[
        {type:'candlestick', data:ohlc,
          itemStyle:{color:COLORS.pos,color0:COLORS.neg,
            borderColor:COLORS.pos,borderColor0:COLORS.neg}},
        {type:'line', data:ma(50,'ma50'), showSymbol:false, connectNulls:true,
          lineStyle:{width:1.3,color:COLORS.accent}},
        {type:'line', data:ma(200,'ma200'), showSymbol:false, connectNulls:true,
          lineStyle:{width:1.3,color:COLORS.warn}}
      ]
    });
    return c;
  }

  function resizeAll(){ Object.values(instances).forEach(c=>c && c.resize()); }
  window.addEventListener('resize', resizeAll);

  window.Charts = { equityChart, tickerChart, outcomeChart, holdingChart, candleCard, resizeAll };
})();
