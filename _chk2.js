
/* ════════════════════════════════════════════════════════════════════════
   CONFIG  —  shared with the other Ahooga apps. Change here if anything moves.
   ════════════════════════════════════════════════════════════════════════ */
const VV_WORKER  = "https://vv-serials.massimiliano-d74.workers.dev";          // Deco Coat status registry (deco.html)
const CF_WORKER  = "https://ahooga-odoo-proxy.ahoogahouse-1050-be.workers.dev"; // Odoo XML-RPC proxy
const ODOO_URL   = "https://ahooga.odoo.com";
const ODOO_DB    = "logicasoft-aho-18-0-21599177";
const DSV_WORKER = "https://ahooga-dsv-proxy.ahoogahouse-1050-be.workers.dev";  // DSV booking proxy

/* Unpainted frame  →  custom-colour frame.  MY2026 / MY2027.
   The OUTPUT product is what the manufacturing order (mrp.production) builds;
   its BoM consumes the INPUT (unpainted) frame. */
const PART_MAP = {
  MY2026: { input:"FRNAA00280", output:"FRNAA00260", label:"Model year 2026" },
  MY2027: { input:"FRNAA00281", output:"FRNAA00261", label:"Model year 2027" }
};
const GROSS_FIELD = "x_gross_weight";   // product field with gross weight (same as dsv-ship); falls back to weight
/* ════════════════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const num = x => (x==null||x===''?0:Number(x));
function showMsg(t,k){ const m=$('msg'); m.innerHTML=t; m.className='msg '+k; if(k==='ok') setTimeout(()=>{m.className='msg';},5000); window.scrollTo({top:0,behavior:'smooth'}); }
function ago(ts){ if(!ts) return ''; const d=Date.now()-Date.parse(String(ts).replace(' ','T')+'Z'); const m=Math.round(d/60000);
  if(m<1) return 'just now'; if(m<60) return m+'m ago'; const h=Math.round(m/60); if(h<24) return h+'h ago';
  return new Date(String(ts).replace(' ','T')).toLocaleDateString([], {month:'short',day:'numeric'}); }

/* ── settings store ── */
const SET_KEY='cch_settings';
let SET = (function(){ try{ return Object.assign({}, JSON.parse(localStorage.getItem(SET_KEY)||'{}')); }catch(e){ return {}; } })();
function persist(){ try{ localStorage.setItem(SET_KEY, JSON.stringify(SET)); }catch(e){} }

/* ════════════════════════  Odoo XML-RPC client (from dsv-ship)  ════════════════════════ */
let odooUid=null;
function creds(){ return { user:$('cfg-user').value.trim(), key:$('cfg-key').value.trim() }; }
function proxyUrl(path){ return `${CF_WORKER}/odoo/${encodeURIComponent(ODOO_URL+path)}`; }
function v(x){
  if(x===null||x===undefined) return '<value><boolean>0</boolean></value>';
  if(typeof x==='boolean') return `<value><boolean>${x?1:0}</boolean></value>`;
  if(typeof x==='number'&&Number.isInteger(x)) return `<value><int>${x}</int></value>`;
  if(typeof x==='number') return `<value><double>${x}</double></value>`;
  if(Array.isArray(x)) return `<value><array><data>${x.map(v).join('')}</data></array></value>`;
  if(typeof x==='object'){ const m=Object.entries(x).map(([k,vv])=>`<member><name>${k}</name>${v(vv)}</member>`).join(''); return `<value><struct>${m}</struct></value>`; }
  return `<value><string>${String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string></value>`;
}
function parseXml(xml){
  const doc=new DOMParser().parseFromString(xml,'text/xml');
  if(doc.querySelector('fault')) throw new Error('Odoo: '+(doc.querySelector('faultString')?.textContent?.substring(0,300)||'fault'));
  function pv(n){ if(!n)return null; const c=n.firstElementChild; if(!c)return n.textContent;
    switch(c.tagName){
      case'int':case'i4':case'i8':return parseInt(c.textContent);
      case'double':return parseFloat(c.textContent);
      case'boolean':return c.textContent==='1';
      case'string':return c.textContent;
      case'nil':return null;
      case'array':return Array.from(c.querySelector('data')?.children||[]).map(pv);
      case'struct':{const o={};c.querySelectorAll(':scope>member').forEach(m=>{o[m.querySelector('name').textContent]=pv(m.querySelector('value'))});return o;}
      default:return c.textContent;
    } }
  return pv(doc.querySelector('methodResponse>params>param>value'));
}
async function odoo(model,method,args,kwargs={}){
  const {user,key}=creds();
  if(!user||!key) throw new Error('Enter your Odoo email and password in Settings.');
  if(!odooUid){
    const b=`<?xml version="1.0"?><methodCall><methodName>authenticate</methodName><params>${[v(ODOO_DB),v(user),v(key),v({})].map(x=>`<param>${x}</param>`).join('')}</params></methodCall>`;
    const r=await fetch(proxyUrl('/xmlrpc/2/common'),{method:'POST',headers:{'Content-Type':'application/xml'},body:b});
    odooUid=parseXml(await r.text());
    if(!odooUid||typeof odooUid!=='number') throw new Error('Odoo authentication failed — check your email and password/API key.');
  }
  const params=[v(ODOO_DB),v(odooUid),v(key),v(model),v(method),v(args),v(kwargs)];
  const b=`<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>${params.map(x=>`<param>${x}</param>`).join('')}</params></methodCall>`;
  const r=await fetch(proxyUrl('/xmlrpc/2/object'),{method:'POST',headers:{'Content-Type':'application/xml'},body:b});
  return parseXml(await r.text());
}

/* ════════════════════════  DSV proxy client (from dsv-ship)  ════════════════════════ */
async function dsv(path,body){
  const r=await fetch(`${DSV_WORKER}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const t=await r.text(); let j; try{ j=JSON.parse(t); }catch(e){ j={ok:false,error:'DSV worker returned non-JSON: '+t.slice(0,200)}; }
  if(!r.ok && j && j.error==null) j.error='HTTP '+r.status;
  return j;
}
async function dsvPing(){
  const p=$('dsv-pill');
  try{ const r=await fetch(`${DSV_WORKER}/health`); const j=await r.json().catch(()=>({}));
    if(r.ok&&(j.ok||j.status==='ok')){ p.textContent='DSV: '+(j.env||'ready'); p.className='pill dsv ok'; }
    else { p.textContent='DSV: not ready'; p.className='pill dsv err'; }
  }catch(e){ p.textContent='DSV: unreachable'; p.className='pill dsv err'; }
}

/* ════════════════════════  vv-serials registry client  ════════════════════════ */
let STATUS=[], CONFIG={};
async function vvLoad(){
  const [s,c] = await Promise.all([
    fetch(VV_WORKER+'?type=status').then(r=>r.json()).catch(()=>[]),
    fetch(VV_WORKER+'?type=config').then(r=>r.json()).catch(()=>[])
  ]);
  STATUS = Array.isArray(s)?s:[];
  CONFIG = {}; if(Array.isArray(c)) c.forEach(r=>{ if(r&&r.so) CONFIG[r.so]=r; });
}
async function vvPost(payload){
  const r=await fetch(VV_WORKER,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({type:'status',by:'Handover'},payload))});
  const d=await r.json(); if(!r.ok) throw new Error(d.error||('HTTP '+r.status)); return d;
}

/* ════════ shared KV bus (same Cloudflare worker as the Odoo proxy) ════════ */
async function kvGet(key){ try{ const r=await fetch(`${CF_WORKER}/store/${encodeURIComponent(key)}`); const t=await r.text(); return t==='null'?null:JSON.parse(t); }catch(e){ return null; } }
async function kvSet(key,value){ try{ await fetch(`${CF_WORKER}/store/${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}); }catch(e){} }
/* publish a Velovisie arrival so the PO Builder can surface the order as ready to build */
async function bikeLineForSO(so){
  try{ const sol=await odoo('sale.order.line','search_read',[['&','&',['order_id.name','=',so],['product_id.categ_id.complete_name','ilike','Bikes'],['product_id.name','ilike','MAX']]],{fields:['product_id'],limit:1});
    if(sol&&sol.length&&Array.isArray(sol[0].product_id)) return sol[0].product_id[1]; }catch(e){}
  return '';
}
async function publishArrival(so){
  try{ await vvLoad(); }catch(e){}
  const fr=frameRec(so), c=CONFIG[so]||{}, my=getMY(so);
  const rec={ so, frameId:fr.frameId||'', model:await bikeLineForSO(so),
    productCode:(my&&PART_MAP[my]?PART_MAP[my].output:''), colour:(c.main&&c.main.name)||'', finish:(c.main&&c.main.finish)||'',
    arrivedAt:new Date().toISOString(), by:'Handover', status:'ready' };
  let list=await kvGet('vv_frame_arrivals'); if(!Array.isArray(list)) list=[];
  list=list.filter(x=>x&&x.so!==so); list.unshift(rec); list=list.slice(0,500);
  await kvSet('vv_frame_arrivals',list);
}

/* ════════════════════════  colour widgets (from deco.html)  ════════════════════════ */
function dotFor(d){ if(!d) return '';
  if(d.hex) return `<span class="dot ${/(matte)/i.test(d.finish||'')?'matte':''}" style="background:${d.hex}" title="${esc(d.name||'')}${d.finish?' · '+esc(d.finish):''}"></span>`;
  if(d.name) return `<span class="dot unknown" title="${esc(d.name)}">?</span>`; return ''; }
function dotsHtml(so){ const c=CONFIG[so]; if(!c) return ''; const dots=dotFor(c.main)+dotFor(c.rear);
  const t=c.hasText?`<span class="tchip" title="has personalised text">T</span>`:''; return (dots||t)?`<span class="dots">${dots}${t}</span>`:''; }
function colourLine(label,d){ if(!d||!d.name) return ''; const bits=[d.name+(d.finish?` (${d.finish.toLowerCase()})`:'')];
  if(d.ref) bits.push(`<b style="color:var(--ink)">${esc(d.ref)}</b>`); if(d.primer&&d.primer!=='x') bits.push(`primer ${esc(d.primer)}`);
  return `<div class="cnames"><span class="cl">${label}</span> ${bits.join(' · ')}</div>`; }
function namesHtml(so){ const c=CONFIG[so]; if(!c) return ''; let h=colourLine('Main',c.main)+colourLine('Rear',c.rear);
  if(c.hasText) h+=`<div class="cnames"><span class="cl">Text</span> <b style="color:var(--accent)">yes</b></div>`; return h; }
function poHtml(so){ const c=CONFIG[so]; if(!c||!c.decoPO) return ''; return `<div class="pobadge">PO&nbsp;·&nbsp;<b>${esc(c.decoPO)}</b></div>`; }

/* ── per-frame model-year choice (persisted per SO) ── */
function myKey(so){ return 'cch_my_'+so; }
function getMY(so){
  try{ const v=localStorage.getItem(myKey(so)); if(v) return v; }catch(e){}
  // best-effort auto-detect from config product code if present
  const c=CONFIG[so];
  const code=((c&&(c.framePart||c.part||c.sku))||'').toUpperCase();
  if(code.includes('00281')||code.includes('00261')) return 'MY2027';
  if(code.includes('00280')||code.includes('00260')) return 'MY2026';
  return SET.defaultMY||'MY2026';
}
function setMY(so,my){ try{ localStorage.setItem(myKey(so),my); }catch(e){} renderQueue(); }

/* ════════════════════════  tabs  ════════════════════════ */
function showTab(name){
  ['queue','hist','settings'].forEach(t=>{ $('tab-'+t).classList.toggle('active',t===name); $('t-'+t).classList.toggle('active',t===name); });
  if(name==='queue') loadQueue(false);
  if(name==='hist') renderHistory();
}

/* ════════════════════════  QUEUE  ════════════════════════ */
let RUN={};   // so -> {steps:[{key,label,status,detail}], busy, result:{moId,pickingId,bookingId}}
async function loadQueue(force){
  $('queue-sub').textContent='Loading…';
  try{ await vvLoad(); renderQueue(); }
  catch(e){ $('queue-sub').textContent='Could not reach the Deco Coat registry.'; }
}
function waitshipFrames(){ return STATUS.filter(r=>r.status==='WAITSHIP'); }
function renderQueue(){
  const frames=waitshipFrames();
  $('queue-sub').textContent = frames.length+' frame'+(frames.length===1?'':'s')+' waiting to ship'
    + ($('dryrun')&&$('dryrun').checked?' · DRY RUN (no writes)':'');
  renderBatchBar();
  const box=$('queue-cards');
  if(!frames.length){ box.innerHTML='<div class="empty">Nothing waiting to ship right now.</div>'; return; }
  box.innerHTML = frames.map(r=>{
    const so=r.so, my=getMY(so), pm=PART_MAP[my];
    const run=RUN[so];
    const myBtns=Object.keys(PART_MAP).map(k=>`<button class="${k===my?'sel':''}" onclick="setMY('${so}','${k}')">${k.replace('MY','MY ')}</button>`).join('');
    const stepsHtml = run ? `<div class="steps">${run.steps.map(s=>stepRow(so,s)).join('')}</div>` : '';
    const runBtn = run&&run.busy
      ? `<button class="btn btn-primary btn-sm" disabled><span class="spin"></span> Working…</button>`
      : `<button class="btn btn-primary btn-sm" onclick="runHandover(['${so}'])">${run?'↻ Re-run pending steps':'Process this frame →'}</button>`;
    return `<div class="fcard">
      <div class="fc-top"><label class="chk" style="margin-right:2px" title="select for batch"><input type="checkbox" ${SEL.has(so)?'checked':''} onchange="toggleSel('${so}')"></label><span class="so">${esc(so)}</span>${dotsHtml(so)}</div>
      ${namesHtml(so)}
      ${poHtml(so)}
      ${r.frameId?`<div class="fr">frame · ${esc(r.frameId)}</div>`:'<div class="fr" style="opacity:.55">no frame ID linked</div>'}
      <div class="my-pick">${myBtns}</div>
      <div class="pn">PO part <b>${esc(pm.output)}</b> <span class="muted">· ${pm.label}</span></div>
      <div class="row" style="margin-top:11px">${runBtn}</div>
      ${stepsHtml}
      ${run?resultHtml(so):''}
    </div>`;
  }).join('');
}
function stepRow(so,s){
  const ic = s.status==='done'?'✓' : s.status==='err'?'!' : s.status==='run'?'…' : '○';
  const cls = s.status||'';
  const retry = (s.status==='err') ? `<button class="btn btn-ghost btn-sm" onclick="runStep('${so}','${s.key}')">Retry</button>` : '';
  return `<div class="step ${cls}"><div class="ic">${ic}</div>
    <div class="body"><div class="t">${esc(s.label)}</div>${s.detail?`<div class="d ${s.status==='err'?'errtext':''}">${s.detail}</div>`:''}</div>
    <div class="act">${retry}</div></div>`;
}
/* clickable link straight to the Odoo record so you can double-check */
function odooLink(model,id){ return `<a href="${ODOO_URL}/web#id=${id}&model=${model}&view_type=form" target="_blank" rel="noopener">open in Odoo \u2197</a>`; }
function odooLinkTxt(model,id,txt){ return `<a href="${ODOO_URL}/web#id=${id}&model=${model}&view_type=form" target="_blank" rel="noopener">${esc(txt)} \u2197</a>`; }
/* the persistent "what just happened" summary shown under the steps */
function resultHtml(so){
  const r=RUN[so]&&RUN[so].result; if(!r||(!r.receiptId&&!r.pickingId&&!r.bookingId)) return '';
  const dry=$('dryrun')&&$('dryrun').checked;
  const done=RUN[so].complete;
  const head = dry ? '\ud83d\udc40 Preview only (dry run) — nothing was written to Odoo or DSV.'
    : (done?'\u2713 Handover complete — here is what was created:':'Partial — created so far:');
  const rows=[];
  if(r.receiptId) rows.push(`<div class="kv"><span>1 · PO receipt validated</span><span><b>${esc(r.receiptName||('#'+r.receiptId))}</b>${dry?'':' \u00b7 '+odooLink('stock.picking',r.receiptId)}${(!dry&&r.poId)?' \u00b7 PO '+odooLink('purchase.order',r.poId):''}</span></div>`
    +`<div class="kv"><span class="hint">&nbsp;&nbsp;received</span><span class="hint">${esc(r.outCode||'')}${r.serial?' \u00b7 serial '+esc(r.serial):''}${r.receiptState?' \u00b7 '+esc(r.receiptState):''}</span></div>`);
  if(r.pickingId) rows.push(`<div class="kv"><span>2 · Transfer \u2192 Velovisie</span><span><b>${esc(r.pickingName||('#'+r.pickingId))}</b>${dry?'':' \u00b7 '+odooLink('stock.picking',r.pickingId)}</span></div>`);
  if(r.bookingId) rows.push(`<div class="kv"><span>3 · DSV ${r.dsvDraft?'draft':'booking'}</span><span class="mono"><b>${esc(r.bookingId)}</b>${r.trackingUrl?' \u00b7 <a href="'+esc(r.trackingUrl)+'" target="_blank">track \u2197</a>':''}${r.labelBase64?' \u00b7 <a href="#" onclick="openLabel(\''+so+'\');return false;">label \u2197</a>':''}</span></div>`);
  if(r.emailedTo||r.emailCc) rows.push(`<div class="kv"><span>&nbsp;&nbsp;label email</span><span>${r.emailedTo?'to <b>'+esc(r.emailedTo)+'</b>':''}${r.emailCc?((r.emailedTo?' · ':'')+'cc '+esc(r.emailCc)):''}${r.emailState?' · status <b>'+esc(r.emailState)+'</b>'+(r.emailState==='sent'?' ✓':''):''}</span></div>`);
  if(r.shipped) rows.push(`<div class="kv"><span>4 · Deco Coat board</span><span>frame marked <b>shipped</b></span></div>`);
  const next = (!dry&&done) ? `<div class="hint" style="margin-top:8px">Next: when the frame physically arrives, validate the receipt under <b>Velovisie arrivals</b>.</div>` : '';
  const recheck = (!dry&&(r.receiptId||r.pickingId)) ? `<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="verifyHandover('${so}')">\u21bb Re-check status in Odoo</button><div id="verify-${so}" class="hint" style="margin-top:6px"></div>` : '';
  const cls = dry?'msg warn':(done?'msg ok':'msg warn');
  const dl = (!dry && r.labelBase64) ? `<div style="margin-top:10px"><button class="btn btn-blue btn-sm" onclick="dlLabel('${so}')">\u2b07 Download DSV label (PDF)</button></div>` : '';
  return `<div class="${cls}" style="display:block;margin-top:12px;margin-bottom:0"><div style="font-weight:800;margin-bottom:7px">${head}</div>${rows.join('')}${dl}${next}${recheck}</div>`;
}
/* re-read the live state from Odoo so you can confirm it really landed */
async function verifyHandover(so){
  const r=(RUN[so]&&RUN[so].result)||{}; const box=$('verify-'+so); if(box) box.textContent='Checking Odoo…';
  try{
    const parts=[];
    if(r.receiptId){ const p=await odoo('stock.picking','read',[[r.receiptId],['name','state']]); if(p&&p[0]) parts.push('Receipt '+p[0].name+': '+p[0].state); }
    if(r.pickingId){ const p=await odoo('stock.picking','read',[[r.pickingId],['name','state','carrier_tracking_ref']]); if(p&&p[0]) parts.push('Transfer '+p[0].name+': '+p[0].state+(p[0].carrier_tracking_ref?' \u00b7 DSV '+p[0].carrier_tracking_ref:'')); }
    if(box) box.innerHTML='\u2713 '+parts.map(esc).join(' &nbsp;\u00b7&nbsp; ');
  }catch(e){ if(box) box.textContent='Could not re-check: '+(e.message||e); }
}
window.verifyHandover=verifyHandover;

/* ── ensure settings are present before running ── */
function settingsReady(){
  const need=[['srcId','Anderlecht source location'],['dstId','Velovisie destination location'],['internalPT','internal picking type']];
  const missing=need.filter(([k])=>!SET[k]).map(([,l])=>l);
  return missing;
}

function newRun(so){
  return { busy:false, result:{}, steps:[
    /* receipt + Anderlecht->Velovisie move now happen at the Velovisie arrival scan (VV app) */
    { key:'dsv',      label:'DSV label — book the Deco Coat → Velovisie shipment',                             status:'' },
    { key:'deliver',  label:'Deliver label to Deco Coat + mark frame shipped',                                status:'' }
  ]};
}
function stepObj(so,key){ return RUN[so].steps.find(s=>s.key===key); }
function setStep(so,key,status,detail){ const s=stepObj(so,key); if(s){ s.status=status; if(detail!==undefined) s.detail=detail; } renderQueue(); }

/* ── selection for batch handovers ── */
const SEL=new Set();
function toggleSel(so){ if(SEL.has(so)) SEL.delete(so); else SEL.add(so); renderQueue(); }
function clearSel(){ SEL.clear(); const a=$('sel-all'); if(a) a.checked=false; renderQueue(); }
function selectAllWaiting(on){ SEL.clear(); if(on) waitshipFrames().forEach(r=>SEL.add(r.so)); renderQueue(); }
window.toggleSel=toggleSel; window.clearSel=clearSel; window.selectAllWaiting=selectAllWaiting;
function renderBatchBar(){
  const bar=$('batch-bar'); if(!bar) return; const n=SEL.size;
  if(!n){ bar.innerHTML=''; return; }
  const dry=$('dryrun')&&$('dryrun').checked;
  bar.innerHTML=`<div class="msg warn" style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
    <b>${n} frame${n===1?'':'s'} selected</b>
    <span class="hint">\u2014 processed together and booked as ONE DSV shipment${n>=5?' (pallet)':''}.</span>
    <span style="flex:1"></span>
    <button class="btn btn-primary btn-sm" onclick="runHandover([...SEL])">${dry?'Preview':'Handover'} ${n} selected \u2192</button>
    <button class="btn btn-ghost btn-sm" onclick="clearSel()">Clear</button></div>`;
}

/* per-card button → single-frame handover (a batch of one) */
async function processFrame(so){ return runHandover([so]); }

/* run the handover for one OR many frames; books ONE DSV shipment for the whole batch */
async function runHandover(soList){
  const missing=settingsReady();
  if(missing.length){ showMsg('Finish Settings first \u2014 missing: '+missing.join(', ')+'.','warn'); showTab('settings'); return; }
  soList=(soList||[]).filter(Boolean); if(!soList.length){ showMsg('Select at least one frame first.','warn'); return; }
  const dry=$('dryrun')&&$('dryrun').checked;
  soList.forEach(so=>{ if(!RUN[so]) RUN[so]=newRun(so); RUN[so].busy=true; });
  renderQueue();
  // phase 1 — per frame: validate the PO receipt, then create the Anderlecht→Velovisie transfer
  // Receipt validation + the frame move to Velovisie now happen when Velovisie
  // scans the arriving box (VV app -> Velovisie receipt). Validating here as well
  // would double up (receipt already done, two transfers to Velovisie), so this
  // app only books the DSV label so Deco Coat can ship.
  const ready=[...soList];
  // phase 2 — ONE DSV booking covering every ready frame (pallet rule)
  const toBook=ready.filter(so=>stepObj(so,'dsv').status!=='done');
  if(toBook.length){
    toBook.forEach(so=>setStep(so,'dsv','run',''));
    try{
      const bk=await bookBatchDSV(toBook,dry);
      let emailedTo='',emailCc='',emailState='';
      if(!dry){ try{ const em=await emailLabelToDecoCoat(bk,toBook); emailedTo=(em&&em.to)||''; emailCc=(em&&em.cc)||''; emailState=(em&&em.state)||''; }catch(e){} }
      for(const so of toBook){
        const res=RUN[so].result;
        Object.assign(res,{ bookingId:bk.bookingId, dsvDraft:bk.draft, trackingUrl:bk.trackingUrl, labelBase64:bk.labelBase64, batchRef:bk.reference, batchCount:toBook.length, emailedTo, emailCc, emailState });
        if(!dry && res.pickingId){
          try{ await odoo('stock.picking','write',[[res.pickingId],{carrier_tracking_ref:String(bk.bookingId)}]); }catch(e){}
          if(bk.labelBase64){ try{ await odoo('ir.attachment','create',[{name:'DSV-'+bk.bookingId+'.pdf',type:'binary',mimetype:'application/pdf',datas:bk.labelBase64,res_model:'stock.picking',res_id:res.pickingId}]); }catch(e){} }
          try{ await odoo('stock.picking','message_post',[[res.pickingId]],{body:'DSV '+(bk.draft?'draft':'booking')+' '+bk.bookingId+(bk.trackingUrl?' \u00b7 '+bk.trackingUrl:''),message_type:'comment',subtype_xmlid:'mail.mt_note'}); }catch(e){}
        }
        const lbl=bk.labelBase64?` \u00b7 <a href="#" onclick="openLabel('${so}');return false;">label</a>`:'';
        setStep(so,'dsv','done',(dry?'<b>[dry run]</b> ':'')+`DSV ${bk.draft?'draft':'booking'} <b>${esc(String(bk.bookingId))}</b>${toBook.length>1?` \u00b7 one shipment of ${toBook.length} frames`:''}${bk.trackingUrl?` \u00b7 <a href="${esc(bk.trackingUrl)}" target="_blank">track</a>`:''}${lbl}`);
      }
    }catch(e){ toBook.forEach(so=>setStep(so,'dsv','err',esc(e&&e.message||e))); }
  }
  // phase 3 — per frame: push the label to Deco Coat + mark shipped
  for(const so of ready){
    if(stepObj(so,'dsv').status!=='done') continue;
    if(stepObj(so,'deliver').status==='done') continue;
    await runStep(so,'deliver',true);
  }
  soList.forEach(so=>{ RUN[so].busy=false; RUN[so].complete=RUN[so].steps.every(s=>s.status==='done'); });
  if(!dry) recordHistory(soList);
  clearSel(); await vvLoad(); renderQueue();
  const okN=soList.filter(so=>RUN[so].complete).length;
  if(okN===soList.length) showMsg((dry?'\ud83d\udc40 Dry-run preview for ':'\u2713 Handover complete for ')+okN+' frame'+(okN===1?'':'s')+(dry?' \u2014 nothing was written.':' \u2014 booked as one DSV shipment and saved to History.'), dry?'warn':'ok');
  else showMsg('\u26a0 '+okN+'/'+soList.length+' frames completed \u2014 open any red step for the reason, fix it, then run again (done steps are skipped).','err');
}
window.processFrame=processFrame; window.runHandover=runHandover;

/* one consolidated DSV booking for a batch of frames (pallet of FRAMES_PER_PALLET) */
const FRAMES_PER_PALLET=10, PALLET_AT=5;
async function bookBatchDSV(sos,dry){
  const ref = sos.length>1 ? ('PALLET '+new Date().toISOString().slice(0,10)+' \u00d7'+sos.length) : sos[0];
  if(dry) return { bookingId:'(preview)', draft:true, trackingUrl:'', labelBase64:'', reference:ref };
  let pk = SET.pickupPartnerId ? await partnerAddr(SET.pickupPartnerId) : (SET.pickup||{});
  let cn = SET.consigneePartnerId ? await partnerAddr(SET.consigneePartnerId) : (SET.consignee||{});
  if(!cn.name||!cn.street) throw new Error('No consignee address \u2014 pick the Velovisie vendor in Settings.');
  const w=Number(SET.frameWeight)||22; let packagesList;
  if(sos.length>=PALLET_AT){
    const pallets=Math.max(1,Math.ceil(sos.length/FRAMES_PER_PALLET));
    const per=Math.ceil(sos.length/pallets); let left=sos.length; packagesList=[];
    for(let i=0;i<pallets;i++){ const m=Math.min(per,left); left-=m; packagesList.push({packageType:'EUR',quantity:1,totalWeight:Math.round(m*w*10)/10,length:120,width:80,height:150,description:('Frames x'+m).slice(0,30)}); }
  } else {
    packagesList=sos.map(so=>({packageType:'CTN',quantity:1,totalWeight:w,length:72,width:42,height:74,description:('Frame '+((frameRec(so).frameId)||so)).slice(0,30)}));
  }
  const payload={ reference:ref, autobook:!!SET.autobook, cargoDesc:'Custom colour frames', productCode:SET.dsvProductCode||'CMG', packageType:'CTN',
    pickup:(pk&&pk.street)?{name:pk.name,street:pk.street,zip:pk.zip,city:pk.city,countryCode:pk.cc,phone:pk.phone}:undefined,
    packagesList, totalWeight:packagesList.reduce((s,p)=>s+(p.totalWeight||0),0),
    consignee:{name:cn.name,street:cn.street,street2:cn.street2||'',zip:cn.zip||'',city:cn.city||'',countryCode:cn.cc||'',phone:cn.phone||'',email:cn.email||''} };
  const res=await dsv('/book',payload);
  if(!res.ok) throw new Error(res.error||'DSV booking failed.');
  if(!res.bookingId) throw new Error('DSV returned no booking ID. Raw: '+JSON.stringify(res).slice(0,140));
  return { bookingId:String(res.bookingId), draft:!!res.draft, trackingUrl:res.trackingUrl||'', labelBase64:res.labelBase64||'', reference:ref };
}

/* email the DSV label PDF to Deco Coat so they can print & apply it to the box/pallet */
async function emailLabelToDecoCoat(bk, sos){
  let to=(SET.decoEmail!==undefined?SET.decoEmail:'wietzehoppe@decocoat.nl').trim();
  if(!to && SET.pickupPartnerId){ try{ const pa=await partnerAddr(SET.pickupPartnerId); to=pa.email||''; }catch(e){} }
  const cc=(SET.labelCc!==undefined?SET.labelCc:'massimiliano@ahooga.bike').trim();
  if(!to && !cc) return { ok:false };
  let attIds=[];
  if(bk.labelBase64){ try{ const id=await odoo('ir.attachment','create',[{name:'DSV-'+bk.bookingId+'.pdf',type:'binary',mimetype:'application/pdf',datas:bk.labelBase64}]); if(id) attIds=[id]; }catch(e){} }
  const list=sos.map(so=>`${esc(so)}${frameRec(so).frameId?(' · '+esc(frameRec(so).frameId)):''}`).join('<br>');
  const body=`<p>Hello Deco Coat,</p><p>Attached is the DSV shipping label for the following custom-colour frame(s) to ship to Velovisie:</p><p>${list}</p><p>DSV booking <b>${esc(bk.bookingId)}</b>${bk.reference?(' · '+esc(bk.reference)):''}.<br>Please print it and apply it to the box/pallet. Thank you!</p><p>Ahooga</p>`;
  const vals={ subject:'DSV shipping label '+bk.bookingId+(sos.length>1?(' — '+sos.length+' frames'):''), body_html:body, email_to:(to||cc), auto_delete:false };
  if(to && cc) vals.email_cc=cc;
  if(attIds.length) vals.attachment_ids=[[6,0,attIds]];
  let mailId, state='queued';
  try{ mailId=await odoo('mail.mail','create',[vals]); }catch(e){ return { ok:false, err:(e&&e.message||e) }; }
  try{ await odoo('mail.mail','send',[[mailId]]); }catch(e){}
  try{ const m=await odoo('mail.mail','read',[[mailId],['state']]); if(m&&m[0]&&m[0].state) state=m[0].state; }catch(e){}
  return { ok:true, to, cc, state, mailId };
}

/* ── handover history (persisted on this device) ── */
const HIST_KEY='cch_history';
let HIST=(function(){ try{ return JSON.parse(localStorage.getItem(HIST_KEY)||'[]'); }catch(e){ return []; } })();
function persistHist(){
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(HIST.slice(0,300))); return; }catch(e){}
  // over quota — keep label PDFs only on the newest few entries
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(HIST.slice(0,300).map((h,i)=>i<8?h:Object.assign({},h,{labelBase64:''})))); return; }catch(e){}
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(HIST.slice(0,50).map(h=>Object.assign({},h,{labelBase64:''})))); }catch(e){}
}
function recordHistory(soList){
  const r0=so=>RUN[so].result||{};
  const entry={ ts:new Date().toISOString(),
    dsvBooking: soList.map(so=>r0(so).bookingId).find(Boolean)||'',
    dsvDraft: !!soList.map(so=>r0(so).dsvDraft).find(v=>v),
    trackingUrl: soList.map(so=>r0(so).trackingUrl).find(Boolean)||'',
    labelBase64: soList.map(so=>r0(so).labelBase64).find(Boolean)||'',
    frames: soList.map(so=>({ so, frameId:frameRec(so).frameId||'', out:r0(so).outCode||'',
      receipt:r0(so).receiptName||'', receiptId:r0(so).receiptId||null, poName:r0(so).poName||'', poId:r0(so).poId||null,
      transfer:r0(so).pickingName||'', pickingId:r0(so).pickingId||null, complete:!!RUN[so].complete })) };
  HIST.unshift(entry); persistHist();
}
function clearHistory(){ if(!confirm('Clear the local handover history?\n\n(Odoo records are NOT affected.)')) return; HIST=[]; persistHist(); renderHistory(); }
window.clearHistory=clearHistory;
function renderHistory(){
  const box=$('hist-list'); if(!box) return;
  if(!HIST.length){ box.innerHTML='<div class="empty">No handovers recorded yet. Completed (non-dry-run) handovers are saved here automatically.</div>'; return; }
  box.innerHTML=HIST.map((h,i)=>{
    const when=new Date(h.ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const dsv=h.dsvBooking?`<span class="mono"><b>${esc(h.dsvBooking)}</b>${h.dsvDraft?' (draft)':''}${h.trackingUrl?' \u00b7 <a href="'+esc(h.trackingUrl)+'" target="_blank">track \u2197</a>':''}</span>`:'<span class="muted">\u2014</span>';
    const rows=(h.frames||[]).map(f=>`<div class="kv"><span>${esc(f.so)} <span class="muted mono">${esc(f.frameId||'')}</span> <span class="muted">${esc(f.out||'')}</span></span>
      <span>${f.receiptId?odooLinkTxt('stock.picking',f.receiptId,'receipt '+(f.receipt||'')):esc(f.receipt||'\u2014')}${f.pickingId?' \u00b7 '+odooLinkTxt('stock.picking',f.pickingId,'transfer '+(f.transfer||'')):''}${f.complete?'':' \u00b7 <span style="color:var(--red)">incomplete</span>'}</span></div>`).join('');
    return `<div class="card" style="margin-bottom:10px">
      <div class="row"><b>${esc(when)}</b><span class="badge ${h.frames.length>1?'transit':'ready'}">${h.frames.length} frame${h.frames.length===1?'':'s'}</span><span style="flex:1"></span><span class="hint">DSV ${dsv}</span>${h.labelBase64?` <button class="btn btn-ghost btn-sm" onclick="dlLabelHist(${i})">\u2b07 label</button>`:''}</div>
      <div style="margin-top:8px">${rows}</div></div>`;
  }).join('');
}

/* run a single step; returns true on success */
async function runStep(so,key,chained){
  if(!RUN[so]) RUN[so]=newRun(so);
  const dry = $('dryrun') && $('dryrun').checked;
  setStep(so,key,'run','');
  try{
    let detail='';
    if(key==='receipt')   detail=await stepReceipt(so,dry);
    else if(key==='transfer') detail=await stepTransfer(so,dry);
    else if(key==='dsv')      detail=await stepDSV(so,dry);
    else if(key==='deliver')  detail=await stepDeliver(so,dry);
    setStep(so,key,'done',(dry?'<b>[dry run]</b> ':'')+detail);
    return true;
  }catch(e){ setStep(so,key,'err',esc(e&&e.message||String(e))); return false; }
}
window.processFrame=processFrame; window.runStep=runStep; window.setMY=setMY;

/* ── resolve products / frame info for an SO ── */
function frameRec(so){ return STATUS.find(r=>r.so===so)||{}; }
async function productByCode(code){
  const recs=await odoo('product.product','search_read',[[['default_code','=',code]]],{fields:['id','name','default_code','tracking','uom_id'],limit:1});
  if(!recs||!recs.length) throw new Error('Product '+code+' not found in Odoo (default_code).');
  return recs[0];
}
/* read a vendor/partner's address from Odoo (resolves the 2-letter country code) */
async function partnerAddr(id){
  const r=await odoo('res.partner','read',[[id],['name','street','street2','zip','city','country_id','phone','email']]);
  const p=(r&&r[0])||{};
  let cc='';
  if(Array.isArray(p.country_id)){ try{ const cs=await odoo('res.country','read',[[p.country_id[0]],['code']]); cc=(cs&&cs[0]&&cs[0].code)||''; }catch(e){} }
  return { name:p.name||'', street:p.street||'', street2:p.street2||'', zip:p.zip||'', city:p.city||'', cc, phone:p.phone||'', email:p.email||'' };
}

/* ── STEP A: validate the existing PO receipt from Deco Coat ──
   No manufacturing order: the custom-colour frame (FRNAA0026x) is PURCHASED from
   Deco Coat on a PO, which already created an incoming receipt. We find that receipt
   via the SO it references, set the frame serial, and validate it. */
async function stepReceipt(so,dry){
  const my=getMY(so), pm=PART_MAP[my];
  const frameId=(frameRec(so).frameId||'').trim();
  if(dry) return `Would find the Deco Coat PO receipt that references order <b>${esc(so)}</b> and validate it — receiving <b>${esc(pm.output)}</b>${frameId?` serial <b>${esc(frameId)}</b>`:''} into Anderlecht.`;
  // 1) find the purchase order via a PO line that references this sales order
  let poId=null, poName='';
  const pol=await odoo('purchase.order.line','search_read',[['|',['name','ilike',so],['order_id.origin','ilike',so]]],{fields:['order_id'],limit:1});
  if(pol&&pol.length&&Array.isArray(pol[0].order_id)){ poId=pol[0].order_id[0]; poName=pol[0].order_id[1]; }
  if(!poId) throw new Error('No purchase order references '+so+'. Check the PO to Deco Coat exists and mentions the SO on its lines.');
  // 2) find the open incoming receipt for that PO
  const picks=await odoo('stock.picking','search_read',[[['origin','=',poName],['picking_type_code','=','incoming'],['state','in',['assigned','confirmed','waiting']]]],{fields:['id','name','state'],limit:5});
  if(!picks||!picks.length) throw new Error('No open receipt found for PO '+poName+' (it may already be received).');
  const pk=picks[0];
  Object.assign(RUN[so].result,{ receiptId:pk.id, receiptName:pk.name, poId, poName, inCode:pm.input, outCode:pm.output, serial:frameId });
  // 3) set the frame serial on the custom-frame move line (if serial tracked)
  let serialNote='';
  if(frameId){
    try{
      const out=await productByCode(pm.output);
      const mls=await odoo('stock.move.line','search_read',[[['picking_id','=',pk.id],['product_id','=',out.id]]],{fields:['id'],limit:1});
      if(mls&&mls.length){ await odoo('stock.move.line','write',[[mls[0].id],{lot_name:frameId,quantity:1}]); serialNote=' · serial '+frameId; }
    }catch(e){ serialNote=' · (serial not set: '+(e.message||e).toString().slice(0,80)+')'; }
  }
  // 4) validate the receipt (handle the immediate-transfer / backorder wizard)
  let doneNote='validated';
  try{
    const res=await odoo('stock.picking','button_validate',[[pk.id]]);
    if(res && typeof res==='object' && (res.res_model||res.type)){
      try{ await odoo('stock.picking','button_validate',[[pk.id]],{context:{skip_backorder:true,picking_ids_not_to_backorder:[pk.id]}}); }
      catch(e){ doneNote='needs a manual "Validate" in Odoo (a wizard popped up)'; }
    }
  }catch(e){ doneNote='could not auto-validate ('+(e.message||e).toString().slice(0,90)+')'; }
  const p=await odoo('stock.picking','read',[[pk.id],['name','state']]);
  RUN[so].result.receiptState=(p&&p[0]&&p[0].state)||'';
  return `Receipt <b>${esc(pk.name)}</b> (PO ${esc(poName)}) — ${doneNote}${serialNote}. ${esc(pm.output)} received into Anderlecht.`;
}

/* ── STEP B: internal transfer Anderlecht → Velovisie ── */
async function stepTransfer(so,dry){
  const my=getMY(so), pm=PART_MAP[my];
  const frameId=(frameRec(so).frameId||'').trim();
  if(dry) return `Would create an internal transfer of <b>${esc(pm.output)}</b> (qty 1) from Anderlecht → Velovisie, origin <b>${esc(so)}</b>.`;
  const out=await productByCode(pm.output);
  const pick=await odoo('stock.picking','create',[{
    picking_type_id: SET.internalPT,
    location_id: SET.srcId,
    location_dest_id: SET.dstId,
    origin: so,
    move_ids_without_package: [[0,0,{
      name: pm.output,
      product_id: out.id,
      product_uom_qty: 1,
      product_uom: (Array.isArray(out.uom_id)?out.uom_id[0]:1),
      location_id: SET.srcId,
      location_dest_id: SET.dstId
    }]]
  }]);
  RUN[so].result.pickingId=pick;
  try{ await odoo('stock.picking','action_confirm',[[pick]]); }catch(e){}
  try{ await odoo('stock.picking','action_assign',[[pick]]); }catch(e){}
  // set the serial on the move line if tracked
  if(frameId && (out.tracking==='serial'||out.tracking==='lot')){
    try{
      const mls=await odoo('stock.move.line','search_read',[[['picking_id','=',pick]]],{fields:['id'],limit:1});
      if(mls&&mls.length) await odoo('stock.move.line','write',[[mls[0].id],{lot_name:frameId}]);
    }catch(e){}
  }
  const p=await odoo('stock.picking','read',[[pick],['name','state']]);
  const name=(p&&p[0]&&p[0].name)||('WH/'+pick);
  Object.assign(RUN[so].result,{ pickingName:name, pickingState:(p&&p[0]&&p[0].state)||'' });
  return `Transfer <b>${esc(name)}</b> created &amp; reserved. Awaiting validation at Velovisie.`;
}

/* ── STEP C: DSV label ── */
async function stepDSV(so,dry){
  const my=getMY(so), pm=PART_MAP[my];
  if(dry) return `Would book a DSV label, pickup <b>${esc(SET.pickupPartnerName||(SET.pickup&&SET.pickup.name)||'Deco Coat')}</b> → consignee <b>${esc(SET.consigneePartnerName||(SET.consignee&&SET.consignee.name)||'Okazi / Velovisie')}</b>, ref <b>${esc(so)}</b> (addresses read from Odoo at booking).`;
  // resolve addresses: prefer the chosen Odoo vendor, fall back to the manual override fields
  let pk = SET.pickupPartnerId ? await partnerAddr(SET.pickupPartnerId) : (SET.pickup||{});
  let cn = SET.consigneePartnerId ? await partnerAddr(SET.consigneePartnerId) : (SET.consignee||{});
  if(SET.pickup&&!SET.pickupPartnerId) pk=SET.pickup;
  if(SET.consignee&&!SET.consigneePartnerId) cn=SET.consignee;
  if(!cn.name||!cn.street) throw new Error('No consignee address — pick the Okazi/Velovisie vendor in Settings (or fill the manual override).');
  const pickingId=RUN[so].result.pickingId;
  const payload={
    reference: so,
    autobook: !!SET.autobook,
    cargoDesc: 'Custom colour frame '+pm.output,
    productCode: SET.dsvProductCode||'CMG',
    packageType: 'CTN',
    pickup: (pk&&pk.street)? { name:pk.name, street:pk.street, zip:pk.zip, city:pk.city, countryCode:pk.cc, phone:pk.phone } : undefined,
    packagesList: [{ packageType:'CTN', quantity:1, totalWeight: Number(SET.frameWeight)||22, length:72, width:42, height:74, description:('Frame '+(frameRec(so).frameId||so)).slice(0,30) }],
    totalWeight: Number(SET.frameWeight)||22,
    consignee: { name:cn.name, street:cn.street, street2:cn.street2||'', zip:cn.zip||'', city:cn.city||'', countryCode:cn.cc||'', phone:cn.phone||'', email:cn.email||'' }
  };
  const res=await dsv('/book',payload);
  if(!res.ok) throw new Error(res.error||'DSV booking failed.');
  const bookingId=res.bookingId; if(!bookingId) throw new Error('DSV did not return a booking ID. Raw: '+JSON.stringify(res).slice(0,160));
  RUN[so].result.bookingId=String(bookingId);
  RUN[so].result.labelBase64=res.labelBase64||'';
  RUN[so].result.trackingUrl=res.trackingUrl||'';
  RUN[so].result.dsvDraft=!!res.draft;
  // write tracking back to the transfer + attach the label PDF
  const pid=RUN[so].result.pickingId;
  if(pid){
    try{ await odoo('stock.picking','write',[[pid],{carrier_tracking_ref:String(bookingId)}]); }catch(e){}
    if(res.labelBase64){ try{ await odoo('ir.attachment','create',[{name:'DSV-'+bookingId+'.pdf',type:'binary',mimetype:'application/pdf',datas:res.labelBase64,res_model:'stock.picking',res_id:pid}]); }catch(e){} }
    try{ await odoo('stock.picking','message_post',[[pid]],{body:'DSV '+(res.draft?'draft':'booking')+' '+bookingId+(res.trackingUrl?' · '+res.trackingUrl:''),message_type:'comment',subtype_xmlid:'mail.mt_note'}); }catch(e){}
  }
  const printBtn = res.labelBase64 ? ` <a href="#" onclick="openLabel('${so}');return false;">print label</a>` : '';
  return `DSV ${res.draft?'draft':'booking'} <b>${esc(String(bookingId))}</b>${res.trackingUrl?` · <a href="${esc(res.trackingUrl)}" target="_blank">track</a>`:''}.${printBtn}`;
}
function openLabel(so){
  const b64=RUN[so]&&RUN[so].result&&RUN[so].result.labelBase64; if(!b64){ showMsg('No label PDF cached — fetch it from the transfer in Odoo.','warn'); return; }
  try{ const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})); window.open(url,'_blank'); }
  catch(e){ showMsg('Could not open label PDF.','err'); }
}
window.openLabel=openLabel;
/* force a real file download of a base64 PDF */
function downloadLabel(b64,name){
  try{
    const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const a=document.createElement('a'); a.href=url; a.download=(name||'DSV-label')+'.pdf';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000);
  }catch(e){ showMsg('Could not build the label PDF.','err'); }
}
function dlLabel(so){ const r=RUN[so]&&RUN[so].result; if(r&&r.labelBase64) downloadLabel(r.labelBase64,'DSV-'+(r.bookingId||so)); else showMsg('No label cached in this session — open it from the transfer in Odoo, or re-run the booking.','warn'); }
function dlLabelHist(i){ const h=HIST[i]; if(h&&h.labelBase64) downloadLabel(h.labelBase64,'DSV-'+(h.dsvBooking||'label')); else showMsg('This label was not kept locally (older entry) — download it from the transfer in Odoo.','warn'); }
window.dlLabel=dlLabel; window.dlLabelHist=dlLabelHist;

/* ── STEP D: deliver label to Deco Coat + mark shipped ── */
async function stepDeliver(so,dry){
  const bId=RUN[so].result.bookingId||'';
  if(dry) return `Would push the DSV reference to the Deco Coat app (so they can print the label) and mark <b>${esc(so)}</b> as shipped.`;
  // push label availability + DSV reference back to the vv-serials registry so deco.html can show a print button
  try{ await vvPost({ so, dsvBooking:bId, labelBase64:(RUN[so].result.labelBase64||''), trackingUrl:(RUN[so].result.trackingUrl||'') }); }catch(e){}
  // mark the Deco Coat frame as shipped (closes its loop on the painter's board)
  await vvPost({ so, status:'SHIPPED' });
  await vvLoad();
  RUN[so].result.shipped=true;
  return `Deco Coat notified (DSV ${esc(bId||'—')}); frame marked <b>shipped</b>. Now validate on arrival in the Velovisie tab.`;
}

/* ════════════════════════  SETTINGS  ════════════════════════ */
function fillSettingsForm(){
  $('cfg-user').value = SET.user||'';
  $('cfg-dsvprod').value = SET.dsvProductCode||'CMG';
  $('cfg-autobook').checked = !!SET.autobook;
  $('cfg-decoemail').value = (SET.decoEmail!==undefined?SET.decoEmail:'wietzehoppe@decocoat.nl');
  $('cfg-labelcc').value = (SET.labelCc!==undefined?SET.labelCc:'massimiliano@ahooga.bike');
  const pk=SET.pickup||{}, cn=SET.consignee||{};
  $('pk-name').value=pk.name||''; $('pk-street').value=pk.street||''; $('pk-zip').value=pk.zip||''; $('pk-city').value=pk.city||''; $('pk-cc').value=pk.cc||''; $('pk-phone').value=pk.phone||'';
  $('cn-name').value=cn.name||''; $('cn-street').value=cn.street||''; $('cn-zip').value=cn.zip||''; $('cn-city').value=cn.city||''; $('cn-cc').value=cn.cc||''; $('cn-phone').value=cn.phone||'';
  // show the saved vendor choice even before re-connecting
  if(SET.pickupPartnerId) $('cfg-pickv').innerHTML=`<option value="${SET.pickupPartnerId}" selected>${esc(SET.pickupPartnerName||('partner #'+SET.pickupPartnerId))}</option>`;
  if(SET.consigneePartnerId) $('cfg-consv').innerHTML=`<option value="${SET.consigneePartnerId}" selected>${esc(SET.consigneePartnerName||('partner #'+SET.consigneePartnerId))}</option>`;
  $('ep-vv').textContent=VV_WORKER; $('ep-odoo').textContent=CF_WORKER; $('ep-dsv').textContent=DSV_WORKER; $('ep-db').textContent=ODOO_DB;
}
function saveSettings(){
  SET.user=$('cfg-user').value.trim();
  SET.dsvProductCode=$('cfg-dsvprod').value.trim()||'CMG';
  SET.autobook=$('cfg-autobook').checked;
  SET.decoEmail=$('cfg-decoemail').value.trim();
  SET.labelCc=$('cfg-labelcc').value.trim();
  SET.pickup={ name:$('pk-name').value.trim(), street:$('pk-street').value.trim(), zip:$('pk-zip').value.trim(), city:$('pk-city').value.trim(), cc:$('pk-cc').value.trim().toUpperCase(), phone:$('pk-phone').value.trim() };
  SET.consignee={ name:$('cn-name').value.trim(), street:$('cn-street').value.trim(), zip:$('cn-zip').value.trim(), city:$('cn-city').value.trim(), cc:$('cn-cc').value.trim().toUpperCase(), phone:$('cn-phone').value.trim() };
  if($('cfg-src').value) SET.srcId=parseInt($('cfg-src').value);
  if($('cfg-dst').value) SET.dstId=parseInt($('cfg-dst').value);
  if($('cfg-pt').value) SET.internalPT=parseInt($('cfg-pt').value);
  SET.mfgPT = $('cfg-mpt').value? parseInt($('cfg-mpt').value):null;
  const pv=$('cfg-pickv'), cv=$('cfg-consv');
  if(pv&&pv.value){ SET.pickupPartnerId=parseInt(pv.value); SET.pickupPartnerName=pv.options[pv.selectedIndex].text; }
  if(cv&&cv.value){ SET.consigneePartnerId=parseInt(cv.value); SET.consigneePartnerName=cv.options[cv.selectedIndex].text; }
  persist(); $('save-state').textContent='Saved.'; setTimeout(()=>{$('save-state').textContent='';},2500);
  refreshSetupWarn();
}
window.saveSettings=saveSettings;

function opt(list,sel,fmt){ return ['<option value="">— choose —</option>'].concat(list.map(x=>`<option value="${x.id}"${x.id===sel?' selected':''}>${esc(fmt(x))}</option>`)).join(''); }
async function connectAndDiscover(){
  const st=$('connect-state'); st.textContent='Connecting…'; odooUid=null;
  try{
    SET.user=$('cfg-user').value.trim(); SET.key=undefined; persist();
    await odoo('res.users','search_read',[[['id','=',1]]],{fields:['name'],limit:1});
    $('conn-pill').textContent='✓ Connected'; $('conn-pill').className='pill ok';
    st.textContent='Discovering locations, picking types, vendors and products…';
    // locations (internal, usable)
    const locs=await odoo('stock.location','search_read',[[['usage','=','internal']]],{fields:['id','complete_name','name'],limit:200,order:'complete_name'});
    const fmtL=x=>x.complete_name||x.name;
    $('cfg-src').innerHTML=opt(locs,SET.srcId,fmtL);
    $('cfg-dst').innerHTML=opt(locs,SET.dstId,fmtL);
    // picking types
    const pts=await odoo('stock.picking.type','search_read',[[['code','=','internal']]],{fields:['id','name','warehouse_id'],limit:60,order:'name'});
    $('cfg-pt').innerHTML=opt(pts,SET.internalPT,x=>(Array.isArray(x.warehouse_id)?x.warehouse_id[1]+' · ':'')+x.name);
    const mpts=await odoo('stock.picking.type','search_read',[[['code','=','mrp_operation']]],{fields:['id','name','warehouse_id'],limit:60,order:'name'});
    $('cfg-mpt').innerHTML=opt(mpts.length?mpts:[],SET.mfgPT,x=>(Array.isArray(x.warehouse_id)?x.warehouse_id[1]+' · ':'')+x.name);
    // vendors (for DSV pickup = Deco Coat, consignee = Okazi / Velovisie)
    const vendors=await odoo('res.partner','search_read',[[['supplier_rank','>',0]]],{fields:['id','name','city'],limit:400,order:'name'});
    const fmtV=x=>x.name+(x.city?' · '+x.city:'');
    $('cfg-pickv').innerHTML=opt(vendors,SET.pickupPartnerId,fmtV);
    $('cfg-consv').innerHTML=opt(vendors,SET.consigneePartnerId,fmtV);
    // BoM check
    await checkBoms();
    st.textContent='Discovered. Pick the vendors + rows and Save.';
  }catch(e){ $('conn-pill').textContent='Connection error'; $('conn-pill').className='pill err'; st.textContent='Could not connect: '+(e.message||e); }
}
window.connectAndDiscover=connectAndDiscover;
async function checkBoms(){
  const box=$('bom-check'); let rows=[];
  for(const k of Object.keys(PART_MAP)){
    const pm=PART_MAP[k];
    let ok=false, note='';
    try{
      const prod=await odoo('product.product','search_read',[[['default_code','=',pm.output]]],{fields:['id','tracking'],limit:1});
      ok=!!(prod&&prod.length); note=ok?('product #'+prod[0].id+' · tracking '+(prod[0].tracking||'none')):('product '+pm.output+' not found');
    }catch(e){ note=(e.message||e).toString().slice(0,80); }
    rows.push(`<div class="kv"><span>${k}: ${pm.output}</span><span>${ok?'✓ ':'⚠ '}${esc(note)}</span></div>`);
  }
  box.innerHTML=rows.join('');
}
function refreshSetupWarn(){
  const w=$('setup-warn'); const missing=settingsReady();
  if(missing.length){ w.style.display='block'; w.innerHTML='⚙ Finish setup in <b>Settings</b> — missing: '+missing.join(', ')+'.'; }
  else w.style.display='none';
}

/* ════════════════════════  init  ════════════════════════ */
fillSettingsForm(); refreshSetupWarn(); dsvPing(); loadQueue(false);
