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

    // Sortino: excess return per unit of DOWNSIDE deviation (penalises only
    // losing days). Calmar: annualised return ÷ max drawdown depth.
    const downside = rets.filter(r=>r<rfDaily).map(r=>r-rfDaily);
    const dd = downside.length
      ? Math.sqrt(downside.reduce((s,x)=>s+x*x,0)/downside.length) : 0;
    const sortino = dd ? ((mean(rets)-rfDaily)/dd)*Math.sqrt(C.TRADING_DAYS) : null;

    const mdd = maxDrawdown(equity);
    let calmar = null;
    if (equity.length>1 && mdd.pct<0){
      const totRet = baseEquity ? equity[equity.length-1].equity/baseEquity - 1 : 0;
      const years = Math.max(rets.length,1)/C.TRADING_DAYS;
      const annRet = years>0 ? Math.pow(1+totRet, 1/years)-1 : totRet;
      calmar = annRet / (Math.abs(mdd.pct)/100);
    }

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
      sharpe, sortino, calmar, infoRatio, maxDrawdown: mdd,
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

  // Aggregate P&L / mean return by a bucket key derived from each trade's ENTRY
  // time. `keyOf(date)->index` and `labels` define the buckets; returns one row
  // per bucket (including empties so the axis is stable).
  function byEntryBucket(trades, mode, labels, keyOf){
    const g = labels.map(()=>({pnl:0, rets:[], n:0}));
    for (const t of trades){
      const d = t.entryDt;
      if (!(d instanceof Date) || isNaN(d.getTime())) continue;
      const k = keyOf(d); if (k==null || k<0 || k>=labels.length) continue;
      g[k].pnl += t.pnl; g[k].rets.push(t.ret); g[k].n++;
    }
    return labels.map((label,i)=>({
      label, pnl:g[i].pnl, ret:g[i].rets.length?mean(g[i].rets):0, n:g[i].n,
      value: mode==='percent' ? (g[i].rets.length?mean(g[i].rets):0) : g[i].pnl
    }));
  }

  // P&L/return by weekday of entry (Mon–Fri; weekends folded in if present).
  function byWeekday(trades, mode){
    const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    // JS getDay(): 0=Sun..6=Sat -> map to Mon-first index.
    const rows = byEntryBucket(trades, mode, labels, d=>(d.getDay()+6)%7);
    // Drop trailing weekend buckets if they have no trades, to keep it tidy.
    while (rows.length>5 && rows[rows.length-1].n===0) rows.pop();
    return rows;
  }

  // P&L/return by hour of entry, across the full ASX cash-equities trading day
  // (10:00–16:00 AEST). Hours 10–15 are shown even with no trades yet, so empty
  // buckets are visible; any entry outside that range still gets its own bucket.
  function byHour(trades, mode){
    const ASX_OPEN = 10, ASX_CLOSE = 16;   // hour buckets 10..15 (entry hour)
    const hours = new Set();
    for (let h=ASX_OPEN; h<ASX_CLOSE; h++) hours.add(h);
    for (const t of trades){
      const d = t.entryDt;
      if (d instanceof Date && !isNaN(d.getTime())) hours.add(d.getHours());
    }
    const sorted = [...hours].sort((a,b)=>a-b);
    const labels = sorted.map(h=>String(h).padStart(2,'0'));
    const idxOf = {}; sorted.forEach((h,i)=>idxOf[h]=i);
    return byEntryBucket(trades, mode, labels, d=>idxOf[d.getHours()]);
  }

  // The bucket with the highest value (P&L or mean return) — for the KPI tiles.
  function bestBucket(rows){
    if (!rows || !rows.length) return null;
    return rows.reduce((a,b)=> b.value>a.value ? b : a);
  }

  // Histogram of trade outcomes with a smoothed density curve overlaid. `mode`
  // selects the metric: 'dollar' bins per-trade $ P&L, otherwise % return.
  let _histMemo = { trades:null, mode:null, res:null };
  function returnsHistogram(trades, mode){
    // The KDE loop is the heaviest per-render cost; skip it when neither the
    // trade set (array identity) nor the metric has changed since last time.
    if (_histMemo.trades===trades && _histMemo.mode===mode) return _histMemo.res;
    const pick = mode==='dollar' ? (t=>t.pnl) : (t=>t.ret);
    const vals = trades.map(pick).filter(v=>isFinite(v));
    if (vals.length < 2){
      const empty = { bins:[], density:[], mean:0, std:0, n:vals.length, mode };
      _histMemo = { trades, mode, res:empty };
      return empty;
    }
    const lo=Math.min(...vals), hi=Math.max(...vals);
    const nbins = Math.max(6, Math.min(24, Math.ceil(Math.sqrt(vals.length))+2));
    const span = (hi-lo)||1, w = span/nbins;
    const counts = new Array(nbins).fill(0);
    for (const v of vals){ let i=Math.floor((v-lo)/w); if(i>=nbins)i=nbins-1; if(i<0)i=0; counts[i]++; }
    const bins = counts.map((c,i)=>({ x0:lo+i*w, x1:lo+(i+1)*w, mid:lo+(i+0.5)*w, count:c }));
    const m=mean(vals), s=std(vals);
    // Kernel density estimate (Gaussian kernel, Silverman bandwidth) scaled to
    // the count histogram. Unlike a normal fit, a KDE follows the actual shape —
    // skew and heavy tails included — and tapers to zero just past the data
    // rather than stopping mid-air at the min/max.
    const density=[];
    if (s>0){
      const n=vals.length;
      const h = 1.06 * s * Math.pow(n, -1/5) || w;     // bandwidth
      const lo2 = lo - 2.5*h, hi2 = hi + 2.5*h, steps=120;
      const scale = w / h / Math.sqrt(2*Math.PI);      // -> counts (density × n × w)
      for (let j=0;j<=steps;j++){
        const x = lo2 + (hi2-lo2)*j/steps;
        let d=0;
        for (const v of vals){ const z=(x-v)/h; d += Math.exp(-0.5*z*z); }
        density.push([+x.toFixed(3), +(d*scale).toFixed(3)]);
      }
    }
    const res = { bins, density, mean:m, std:s, n:vals.length, mode };
    _histMemo = { trades, mode, res };
    return res;
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

  window.Metrics = { compute, sumInRange, byTicker, byWeekday, byHour, bestBucket,
                     returnsHistogram, topTrades };
})();
