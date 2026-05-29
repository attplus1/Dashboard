/* Trade reconstruction — ports the validated Python logic to the browser.
 *
 * Input  : rows = array of arrays (raw statement rows incl. header), newest-first.
 * Output : { trades, openPositions, totalCommission, firstDate, lastDate }
 */
(function () {
  const COL = { DATE:0, TYPE:1, ORDER:2, TRADE:3, REL:4, PRODUCT:5, UNITS:6,
                PRICE:7, STOP:9, VALUE:13, AMOUNT:14, BALANCE:15, FEE:17, HOLDING:20 };

  const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

  function num(s){
    if (s == null) return 0;
    s = String(s).replace(/,/g,'').replace(/%/g,'').replace(/Uts/gi,'').trim();
    if (s === '' || s === '-') return 0;
    const v = parseFloat(s);
    return isNaN(v) ? 0 : v;
  }
  function parseDate(v){
    if (v == null || v === '' || v === '-') return null;
    // Real Date object (SheetJS with cellDates:true).
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    // Excel serial date number.
    if (typeof v === 'number' && isFinite(v)){
      const d = new Date(Math.round((v - 25569) * 86400000));
      return isNaN(d.getTime()) ? null : d;
    }
    const s = String(v).trim();
    // "27 May 2026 11:14:09" / "27 September 2026" (time optional).
    let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m && MONTHS[m[2]] !== undefined)
      return new Date(+m[3], MONTHS[m[2]], +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
    // ISO yyyy-mm-dd[ hh:mm].
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0));
    // dd/mm/yyyy (Australian broker convention), time optional.
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m){ let y=+m[3]; if (y<100) y+=2000;
      return new Date(y, +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0)); }
    // Last resort.
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function tickerFor(name){
    return (window.CONFIG.NAME_TO_TICKER[name]) || name;
  }

  function reconstruct(rows){
    const data = rows.slice(1).filter(r => r && r.length > COL.AMOUNT);

    // Chronological order (file is newest-first).
    const chron = data.slice().reverse();

    // 1) Commissions, attributed to the order they relate to (REL column),
    //    plus a dated list for period-scoped totals.
    let totalCommission = 0;
    const commissionByOrder = {};
    const commissions = [];
    for (const r of chron){
      if (r[COL.TYPE] === 'Commission Charge'){
        const a = num(r[COL.AMOUNT]);          // negative
        totalCommission += a;
        commissionByOrder[r[COL.REL]] = (commissionByOrder[r[COL.REL]] || 0) + a;
        const d = parseDate(r[COL.DATE]);
        if (d) commissions.push({ dt:d, amount:a });
      }
    }

    // 1b) Overnight funding ("Holding Cost"). Per-position rows carry the cost
    //     in the HOLDING COST column and reference the position's order; the
    //     account-level rows carry the same totals in AMOUNT (dated, no double
    //     count) — used for period-scoped totals.
    let totalFunding = 0;
    const fundingByOrder = {};
    const fundings = [];
    for (const r of chron){
      if (r[COL.TYPE] !== 'Holding Cost') continue;
      const perPos = num(r[COL.HOLDING]);          // per-position cost (negative)
      if (perPos){
        fundingByOrder[r[COL.ORDER]] = (fundingByOrder[r[COL.ORDER]] || 0) + perPos;
      }
      const acct = num(r[COL.AMOUNT]);             // account-level dated cash hit
      if (acct){
        totalFunding += acct;
        const d = parseDate(r[COL.DATE]);
        if (d) fundings.push({ dt:d, amount:acct });
      }
    }

    // Account balance timeline (true equity, from the BALANCE column).
    const balanceSeries = [];
    for (const r of chron){
      const raw = r[COL.BALANCE];
      if (raw !== '' && raw !== '-' && raw != null){
        const d = parseDate(r[COL.DATE]);
        if (d) balanceSeries.push({ dt:d, balance:num(raw) });
      }
    }
    const initialCapital = balanceSeries.length ? balanceSeries[0].balance : 100000;

    // 2) Build opening legs.
    const opens = {};            // order# -> open object
    const queueByProduct = {};   // product -> [order#] FIFO
    for (const r of chron){
      const t = r[COL.TYPE];
      if (t === 'Buy Trade' || t === 'Sell Trade'){
        const o = {
          order: r[COL.ORDER], product: r[COL.PRODUCT], ticker: tickerFor(r[COL.PRODUCT]),
          units: num(r[COL.UNITS]), price: num(r[COL.PRICE]), dt: parseDate(r[COL.DATE]),
          dir: t === 'Buy Trade' ? 'long' : 'short',
          stop: num(r[COL.STOP]), remaining: num(r[COL.UNITS])
        };
        opens[r[COL.ORDER]] = o;
        (queueByProduct[r[COL.PRODUCT]] = queueByProduct[r[COL.PRODUCT]] || []).push(r[COL.ORDER]);
      }
    }

    // 3) Match exits → entries, build round trips.
    const trades = [];
    for (const r of chron){
      const t = r[COL.TYPE];
      if (t !== 'Close Trade' && t !== 'Stop Loss') continue;
      const product = r[COL.PRODUCT];
      const u = num(r[COL.UNITS]);
      const exitPx = num(r[COL.PRICE]);
      const pnl = num(r[COL.AMOUNT]);
      const when = parseDate(r[COL.DATE]);
      const rel = r[COL.REL];

      let entry = null;
      if (t === 'Close Trade' && opens[rel]) {
        entry = opens[rel];                                   // exact link
      } else {
        const q = queueByProduct[product] || [];              // FIFO fallback (stops)
        for (const oid of q){ if (opens[oid].remaining > 0){ entry = opens[oid]; break; } }
      }
      if (!entry) continue;
      entry.remaining -= u;

      const notional = entry.price * u;
      const ret = notional ? (pnl / notional * 100) : 0;
      const holdDays = (when && entry.dt) ? (when - entry.dt) / 86400000 : 0;
      const exitComm = commissionByOrder[r[COL.REL]] || 0;
      const funding = fundingByOrder[entry.order] || 0;
      const netPnl = pnl + (commissionByOrder[entry.order] || 0) + exitComm + funding;
      trades.push({
        product, ticker: entry.ticker, dir: entry.dir, units: u,
        entryPx: entry.price, exitPx, entryDt: entry.dt, exitDt: when,
        pnl, ret, holdDays, exitType: t,
        commission: (commissionByOrder[entry.order] || 0) + exitComm,
        funding, netPnl, netRet: notional ? (netPnl / notional * 100) : 0
      });
    }
    trades.sort((a,b) => a.exitDt - b.exitDt);

    // 4) Remaining open positions.
    const openPositions = [];
    for (const o of Object.values(opens)){
      if (o.remaining > 0.0001){
        openPositions.push({
          product: o.product, ticker: o.ticker, dir: o.dir, units: o.remaining,
          price: o.price, dt: o.dt, stop: o.stop,
          commission: commissionByOrder[o.order] || 0,
          funding: fundingByOrder[o.order] || 0
        });
      }
    }
    openPositions.sort((a,b) => b.dt - a.dt);

    const allDates = [];
    for (const t of trades){ allDates.push(t.entryDt, t.exitDt); }
    for (const o of openPositions){ allDates.push(o.dt); }
    const valid = allDates.filter(d => d instanceof Date && !isNaN(d.getTime())).map(d => d.getTime());
    const firstDate = valid.length ? new Date(Math.min(...valid)) : null;
    const lastDate  = valid.length ? new Date(Math.max(...valid)) : null;

    return { trades, openPositions, totalCommission, commissions,
             totalFunding, fundings, balanceSeries, initialCapital,
             firstDate, lastDate };
  }

  // Parse an ArrayBuffer / Uint8Array (csv/xlsx) via SheetJS, then reconstruct.
  // Shared by file upload and saved-state restore.
  function parseArrayBuffer(buf){
    const wb = XLSX.read(buf, { type:'array', cellDates:true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
    return reconstruct(rows);
  }

  function parseFile(file){
    return file.arrayBuffer().then(buf => parseArrayBuffer(new Uint8Array(buf)));
  }

  // Parse raw CSV text (the committed repo trade history).
  // IMPORTANT: use the SAME options as parseArrayBuffer — cellDates:true with
  // raw:true. With raw:false, SheetJS reformats detected date cells into an
  // ambiguous "m/d/yy" string (e.g. "29 May 2026" -> "5/29/26"), which the
  // dd/mm/yyyy matcher then misreads (day=5, month=29 -> overflows into 2028),
  // corrupting every date on the default-history load path.
  function parseCSVText(text){
    const wb = XLSX.read(text, { type:'string', cellDates:true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
    return reconstruct(rows);
  }

  window.TradeParser = { reconstruct, parseFile, parseArrayBuffer, parseCSVText };
})();
