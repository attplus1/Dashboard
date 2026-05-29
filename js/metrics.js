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

  // Cumulative-P&L equity sampled on benchmark trading dates (preferred) or daily.
  function buildEquitySeries(trades, from, to, initialCapital, benchmark){
    const closed = trades.slice().sort((a,b)=>a.exitDt-b.exitDt);
    // dates to sample on
    let dates;
    if (benchmark && benchmark.length){
      dates = benchmark.map(b=>b.date).filter(d=>{
        const dt=new Date(d); return dt>=from && dt<=to;
      });
    } else {
      dates=[]; for (let d=new Date(from); d<=to; d.setDate(d.getDate()+1)) dates.push(dayKey(d));
    }
    const series=[];
    let i=0, cum=0;
    for (const ds of dates){
      const dt=new Date(ds+'T23:59:59');
      while (i<closed.length && closed[i].exitDt<=dt){ cum+=closed[i].pnl; i++; }
      series.push({ date:ds, equity:initialCapital+cum, pnl:cum });
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

  // Align benchmark closes to the equity sample dates and rebase to initialCapital.
  function benchmarkSeries(benchmark, dates, initialCapital){
    if (!benchmark || !benchmark.length) return null;
    const map={}; benchmark.forEach(b=>map[b.date]=b.close);
    let base=null; const out=[];
    for (const ds of dates){
      const c=map[ds];
      if (c==null){ out.push(null); continue; }
      if (base==null) base=c;
      out.push(initialCapital*(c/base));
    }
    return out;
  }

  function compute(all, from, to, initialCapital, benchmark){
    const trades = filterTrades(all, from, to);
    const wins   = trades.filter(t=>t.pnl>0);
    const losses = trades.filter(t=>t.pnl<0);
    const flat   = trades.filter(t=>t.pnl===0);

    const totalPnl = sum(trades.map(t=>t.pnl));
    const grossProfit = sum(wins.map(t=>t.pnl));
    const grossLoss   = Math.abs(sum(losses.map(t=>t.pnl)));

    const equity = buildEquitySeries(trades, from, to, initialCapital, benchmark);
    const rets   = dailyReturns(equity);
    const rfDaily = C.RISK_FREE_ANNUAL / C.TRADING_DAYS;

    // Sharpe (annualised, excess of risk-free)
    const sd = std(rets);
    const sharpe = sd ? ((mean(rets)-rfDaily)/sd)*Math.sqrt(C.TRADING_DAYS) : null;

    // Information ratio vs benchmark
    let infoRatio=null;
    const benchEq = benchmarkSeries(benchmark, equity.map(e=>e.date), initialCapital);
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

    const mdd = maxDrawdown(equity);

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
      sharpe, infoRatio, maxDrawdown: mdd,
      equity, benchEquity: benchEq,
      nWin: wins.length, nLoss: losses.length, nFlat: flat.length, nTotal: trades.length
    };
  }

  // Commission total within [from,to].
  function commissionInRange(commissions, from, to){
    return sum(commissions.filter(c=>c.dt>=from && c.dt<=to).map(c=>c.amount));
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

  window.Metrics = { compute, commissionInRange, byTicker, filterTrades, mean };
})();
