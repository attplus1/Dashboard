/* Performance metric calculations over a date-scoped set of trades. */
(function () {
  const C = window.CONFIG;

  const sum   = a => a.reduce((s,x)=>s+x,0);
  const mean  = a => a.length ? sum(a)/a.length : 0;
  const std   = a => { if (a.length<2) return 0; const m=mean(a);
                       return Math.sqrt(sum(a.map(x=>(x-m)**2))/(a.length-1)); };
  const dayKey = d => d.toISOString().slice(0,10);

  // Trades whose EXIT falls within [from,to].
  function filterTrades(trades, from, to){
    return trades.filter(t => t.exitDt >= from && t.exitDt <= to);
  }

  // Equity curve from the ACTUAL account balance (robust to re-uploads: balances
  // are absolute values straight from the statement, so the starting point never
  // depends on derived figures). Forward-filled onto the sample dates.
  function buildEquitySeries(balanceSeries, from, to, benchmark){
    const bs = (balanceSeries||[]).slice().sort((a,b)=>a.dt-b.dt);
    if (!bs.length) return [];
    let dates;
    if (benchmark && benchmark.length){
      dates = benchmark.map(b=>b.date).filter(d=>{ const dt=new Date(d); return dt>=from && dt<=to; });
    } else {
      dates=[]; for (let d=new Date(from); d<=to; d.setDate(d.getDate()+1)) dates.push(dayKey(d));
    }
    // Seed with the last balance on/before the window start so the curve begins
    // at the real account value at that date.
    let cur = bs[0].balance, j = 0;
    while (j<bs.length && bs[j].dt < from){ cur = bs[j].balance; j++; }
    const series=[];
    for (const ds of dates){
      const dt=new Date(ds+'T23:59:59');
      while (j<bs.length && bs[j].dt<=dt){ cur=bs[j].balance; j++; }
      series.push({ date:ds, equity:cur });
    }
    return series;
  }

  function dailyReturns(series){
    const r=[];
    for (let k=1;k<series.length;k++){
      const p=series[k-1].equity;
      r.push(p ? (series[k].equity-p)/p : 0);
    }
    return r;
  }

  function maxDrawdown(series){
    let peak=-Infinity, mdd=0, peakV=0, troughV=0, curPeak=-Infinity;
    for (const s of series){
      if (s.equity>peak){ peak=s.equity; curPeak=s.equity; }
      const dd=peak ? (s.equity-peak)/peak : 0;
      if (dd<mdd){ mdd=dd; peakV=curPeak; troughV=s.equity; }
    }
    return { pct: mdd*100, dollars: troughV-peakV };
  }

  // Align benchmark closes to the equity sample dates and rebase to the equity's
  // starting value so the two curves share a common origin.
  function benchmarkSeries(benchmark, dates, baseEquity){
    if (!benchmark || !benchmark.length) return null;
    const map={}; benchmark.forEach(b=>map[b.date]=b.close);
    let base=null; const out=[];
    for (const ds of dates){
      const c=map[ds];
      if (c==null){ out.push(null); continue; }
      if (base==null) base=c;
      out.push(baseEquity*(c/base));
    }
    return out;
  }

  function compute(all, from, to, balanceSeries, benchmark){
    const trades = filterTrades(all, from, to);
    const wins   = trades.filter(t=>t.pnl>0);
    const losses = trades.filter(t=>t.pnl<0);
    const flat   = trades.filter(t=>t.pnl===0);

    const totalPnl = sum(trades.map(t=>t.pnl));
    const grossProfit = sum(wins.map(t=>t.pnl));
    const grossLoss   = Math.abs(sum(losses.map(t=>t.pnl)));

    const equity = buildEquitySeries(balanceSeries, from, to, benchmark);
    const baseEquity = equity.length ? equity[0].equity : 0;
    const rets   = dailyReturns(equity);
    const rfDaily = C.RISK_FREE_ANNUAL / C.TRADING_DAYS;

    const sd = std(rets);
    const sharpe = sd ? ((mean(rets)-rfDaily)/sd)*Math.sqrt(C.TRADING_DAYS) : null;

    let infoRatio=null;
    const benchEq = benchmarkSeries(benchmark, equity.map(e=>e.date), baseEquity);
    if (benchEq){
      const benchRet=[];
      for (let k=1;k<benchEq.length;k++){
        benchRet.push((benchEq[k]!=null && benchEq[k-1]!=null && benchEq[k-1])
          ? (benchEq[k]-benchEq[k-1])/benchEq[k-1] : null);
      }
      const active=[];
      for (let k=0;k<rets.length;k++){ if (benchRet[k]!=null) active.push(rets[k]-benchRet[k]); }
      const te=std(active);
      infoRatio = te ? (mean(active)/te)*Math.sqrt(C.TRADING_DAYS) : null;
    }

    return {
      trades, wins, losses, flat,
      totalPnl, grossProfit, grossLoss,
      winRate: trades.length ? wins.length/trades.length*100 : 0,
      avgWin: wins.length ? grossProfit/wins.length : 0,
      avgLoss: losses.length ? -grossLoss/losses.length : 0,
      avgPnl: trades.length ? totalPnl/trades.length : 0,
      profitFactor: grossLoss ? grossProfit/grossLoss : (grossProfit>0?Infinity:0),
      avgHoldAll:    mean(trades.map(t=>t.holdDays)),
      avgHoldWin:    mean(wins.map(t=>t.holdDays)),
      avgHoldLoss:   mean(losses.map(t=>t.holdDays)),
      avgRet:        mean(trades.map(t=>t.ret)),
      sharpe, infoRatio, maxDrawdown: maxDrawdown(equity),
      equity, benchEquity: benchEq,
      nWin: wins.length, nLoss: losses.length, nFlat: flat.length, nTotal: trades.length
    };
  }

  // Period-scoped cash totals (commissions / funding share the same shape).
  function sumInRange(items, from, to){
    return sum(items.filter(c=>c.dt>=from && c.dt<=to).map(c=>c.amount));
  }

  // Per-ticker aggregation for the bar chart.
  function byTicker(trades, mode){
    const g={};
    for (const t of trades){
      (g[t.ticker]=g[t.ticker]||{pnl:0,rets:[],n:0,name:t.product});
      g[t.ticker].pnl+=t.pnl; g[t.ticker].rets.push(t.ret); g[t.ticker].n++;
    }
    const rows=Object.entries(g).map(([ticker,v])=>({
      ticker, name:v.name, pnl:v.pnl, ret:mean(v.rets), n:v.n,
      value: mode==='percent' ? mean(v.rets) : v.pnl
    }));
    rows.sort((a,b)=>a.value-b.value);
    return rows;
  }

  // Histogram of trade outcomes with a fitted normal curve overlaid. `mode`
  // selects the metric: 'dollar' bins per-trade $ P&L, otherwise % return.
  function returnsHistogram(trades, mode){
    const pick = mode==='dollar' ? (t=>t.pnl) : (t=>t.ret);
    const vals = trades.map(pick).filter(v=>isFinite(v));
    if (vals.length < 2) return { bins:[], normal:[], mean:0, std:0, n:vals.length, mode };
    const lo=Math.min(...vals), hi=Math.max(...vals);
    const nbins = Math.max(6, Math.min(24, Math.ceil(Math.sqrt(vals.length))+2));
    const span = (hi-lo)||1, w = span/nbins;
    const counts = new Array(nbins).fill(0);
    for (const v of vals){ let i=Math.floor((v-lo)/w); if(i>=nbins)i=nbins-1; if(i<0)i=0; counts[i]++; }
    const bins = counts.map((c,i)=>({ x0:lo+i*w, x1:lo+(i+1)*w, mid:lo+(i+0.5)*w, count:c }));
    const m=mean(vals), s=std(vals);
    // Normal PDF scaled to counts (×n×binWidth) sampled across the range.
    const normal=[];
    if (s>0){
      const steps=80;
      for (let k=0;k<=steps;k++){
        const x=lo+span*k/steps;
        const pdf=Math.exp(-((x-m)**2)/(2*s*s))/(s*Math.sqrt(2*Math.PI));
        normal.push([+x.toFixed(3), +(pdf*vals.length*w).toFixed(3)]);
      }
    }
    return { bins, normal, mean:m, std:s, n:vals.length, mode };
  }

  // Top winners/losers ranked by the active display metric so the table lines
  // up with the returns histogram: 'percent' ranks by return %, otherwise by
  // dollar P&L. Sign of ret and pnl always agree, so the win/loss split is the
  // same either way.
  function topTrades(trades, n, mode){
    const key = mode==='percent' ? (t=>t.ret) : (t=>t.pnl);
    const sorted = trades.slice().sort((a,b)=>key(b)-key(a));
    return { winners: sorted.slice(0,n).filter(t=>key(t)>0),
             losers:  sorted.slice(-n).reverse().filter(t=>key(t)<0) };
  }

  window.Metrics = { compute, sumInRange, byTicker, returnsHistogram, topTrades,
                     filterTrades, mean, std };
})();
