
/* ─────────────  CONFIG — fill these in  ─────────────
   WORKER_URL : your Cloudflare Worker URL, e.g. https://vv-serials.yourname.workers.dev
   WRITE_KEY  : the same string you set as WRITE_KEY in the Worker (leave '' if you didn't set one)
*/
const WORKER_URL = "https://vv-serials.massimiliano-d74.workers.dev";
const WRITE_KEY  = "";
/* ──────────────────────────────────────────────────── */

const $ = id => document.getElementById(id);
let state = { so:'', serial:'', stage:'so', scanner:null, scanning:false, manual:false };

if(!WORKER_URL) $('setup-warn').style.display='block';

const SUPPORTED = (typeof Html5QrcodeSupportedFormats!=='undefined') ? [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.QR_CODE,
] : undefined;

function looksLikeSO(s){ return /^[A-Z]?S?\d{4,}$/i.test(s) || /\bS\d{4,}\b/i.test(s); }
function cleanSO(s){ const m=String(s).toUpperCase().match(/S\s*\d{3,}/); return m?m[0].replace(/\s+/g,''):String(s).trim().toUpperCase(); }
function cleanSerial(s){ return String(s).trim().toUpperCase().replace(/\s+/g,''); }

function render(){
  $('so-val').textContent = state.so || 'scan the box label…';
  $('so-val').className = 'val' + (state.so?'':' empty');
  $('sr-val').textContent = state.serial || 'scan the MACU sticker…';
  $('sr-val').className = 'val' + (state.serial?'':' empty');
  $('slot-so').classList.toggle('done', !!state.so);
  $('slot-sr').classList.toggle('done', !!state.serial);
  $('submit-btn').disabled = !(state.so && state.serial);
  $('scan-btn').textContent = state.scanning ? '■ Stop camera'
      : (!state.so ? '📷 Scan order (SO)' : (!state.serial ? '📷 Scan serial' : '📷 Scan again'));
}

function flash(){ try{ navigator.vibrate && navigator.vibrate(60); }catch(e){} }
function showMsg(text, kind){ const m=$('msg'); m.textContent=text; m.className='msg '+kind; if(kind==='ok') setTimeout(()=>m.className='msg',3500); }

function onDetected(text){
  if(state.stage==='so'){
    state.so = cleanSO(text); state.stage='serial'; flash();
    $('cam-hint').textContent='Order captured — now scan the MACU serial.';
  } else {
    if(cleanSerial(text)===state.so) return;          // ignore re-reading the SO barcode
    state.serial = cleanSerial(text); flash();
    stopCam();
    $('cam-hint').textContent='Both captured. Review, then Register.';
  }
  render();
}

async function startCam(){
  if(typeof Html5Qrcode==='undefined'){ showMsg('Scanner did not load — reload the page. Meanwhile use “Type manually”.','err'); return; }
  if(!window.isSecureContext && !/^localhost|^127\./.test(location.hostname)){
    showMsg('Camera needs a secure address. Open this page at its https:// link, not a downloaded file.','err'); return;
  }
  if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)){
    showMsg('This browser blocks camera access. Try the device’s default browser, or type manually.','err'); return;
  }
  if(!state.scanner) state.scanner = new Html5Qrcode("reader", SUPPORTED?{ formatsToSupport: SUPPORTED, verbose:false }:{ verbose:false });
  const conf={ fps:12, qrbox:(w,h)=>{ const m=Math.floor(Math.min(w,h)*0.8); return {width:m,height:Math.floor(m*0.62)}; } };
  const R=$('reader'); R.style.display='block'; void R.offsetWidth;
  state.scanning = true; render(); $('cam-hint').textContent='Starting camera…';
  try{
    await state.scanner.start({ facingMode:"environment" }, conf, (t)=>onDetected(t), ()=>{});
    $('cam-hint').textContent = state.stage==='so' ? 'Point at the SO barcode on the box label.' : 'Point at the MACU serial barcode.';
  }catch(e1){
    try{
      const cams = await Html5Qrcode.getCameras();
      if(!cams || !cams.length) throw e1;
      const back = cams.find(c=>/back|rear|environment|arrière|achter/i.test(c.label||'')) || cams[cams.length-1];
      await state.scanner.start(back.id, conf, (t)=>onDetected(t), ()=>{});
      $('cam-hint').textContent = 'Point at the barcode.';
    }catch(e2){
      state.scanning=false; R.style.display='none'; render();
      const name=(e2&&(e2.name||e2.message))||String(e2);
      let tip='';
      if(/NotAllowed|Permission|denied/i.test(name)) tip=' — allow camera for this site in browser settings, then tap Scan again.';
      else if(/NotFound|Requested device/i.test(name)) tip=' — no camera found.';
      else if(/NotReadable|in use|busy/i.test(name)) tip=' — camera busy in another app; close it and retry.';
      showMsg('Camera could not start ('+name+')'+tip+' You can still use “Type manually”.','err');
    }
  }
}
async function stopCam(){
  if(state.scanner && state.scanning){ try{ await state.scanner.stop(); }catch(e){} }
  state.scanning=false; const R=$('reader'); if(R){R.style.display='none';R.innerHTML='';} $('cam-hint').textContent=''; render();
}

$('scan-btn').onclick = ()=>{ state.scanning ? stopCam() : startCam(); };

$('manual-btn').onclick = ()=>{
  state.manual = !state.manual;
  for(const [v,i] of [['so-val','so-in'],['sr-val','sr-in']]){
    $(v).style.display = state.manual?'none':'block';
    $(i).style.display = state.manual?'block':'none';
  }
  if(state.manual){ stopCam(); $('so-in').value=state.so; $('sr-in').value=state.serial; }
};
$('so-in').oninput = e=>{ state.so=cleanSO(e.target.value); $('submit-btn').disabled=!(state.so&&state.serial); };
$('sr-in').oninput = e=>{ state.serial=cleanSerial(e.target.value); $('submit-btn').disabled=!(state.so&&state.serial); };

$('reset-btn').onclick = ()=>{ stopCam(); state.so=''; state.serial=''; state.stage='so';
  $('so-in').value=''; $('sr-in').value=''; $('msg').className='msg'; render(); };

$('submit-btn').onclick = async ()=>{
  if(!WORKER_URL){ showMsg('Set WORKER_URL in this file first.','err'); return; }
  $('submit-btn').disabled=true; $('submit-btn').textContent='Saving…';
  try{
    const headers={'Content-Type':'application/json'};
    if(WRITE_KEY) headers['x-api-key']=WRITE_KEY;
    const resp = await fetch(WORKER_URL, { method:'POST', headers,
      body: JSON.stringify({ so:state.so, serial:state.serial, by:'VV' }) });
    const data = await resp.json();
    if(!resp.ok) throw new Error(data.error||('HTTP '+resp.status));
    showMsg('✓ Registered  '+state.so+'  →  '+state.serial,'ok');
    state.so=''; state.serial=''; state.stage='so'; $('so-in').value=''; $('sr-in').value=''; render();
    loadRecent();
  }catch(e){ showMsg('Could not save: '+(e&&e.message||e),'err'); }
  $('submit-btn').textContent='✓ Register pairing'; render();
};

async function loadRecent(){
  if(!WORKER_URL) return;
  try{
    const resp = await fetch(WORKER_URL); const list = await resp.json();
    list.sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
    $('recent').innerHTML = list.slice(0,12).map(r=>{
      const t = r.ts ? new Date(r.ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="rec"><span class="so">${r.so}</span><span class="sr">${r.serial}</span><span class="t">${t}</span></div>`;
    }).join('') || '<div class="hint" style="text-align:left">No registrations yet.</div>';
  }catch(e){ /* offline / not configured */ }
}


/* ════════════════ Velovisie receipt → validate Odoo transfer + notify PO Builder ════════════════ */
const CF_WORKER="https://ahooga-odoo-proxy.ahoogahouse-1050-be.workers.dev";
const ODOO_URL="https://ahooga.odoo.com";
const ODOO_DB="logicasoft-aho-18-0-21599177";
const VV_TOKEN="REPLACE_WITH_SHARED_TOKEN";   /* must match the VV_TOKEN secret set in the ahooga-odoo-proxy worker */
let odooUid=null;
function rcCreds(){ return { user:(($('rc-user')||{}).value||'').trim(), key:(($('rc-key')||{}).value||'').trim() }; }
(function(){ try{ const c=JSON.parse(localStorage.getItem('mxp_cfg')||'{}'); if(c.user&&$('rc-user'))$('rc-user').value=c.user; if(c.key&&$('rc-key'))$('rc-key').value=c.key; }catch(e){} })();
function _px(p){ return CF_WORKER+'/odoo/'+encodeURIComponent(ODOO_URL+p); }
function _xv(x){
  if(x===null||x===undefined) return '<value><boolean>0</boolean></value>';
  if(typeof x==='boolean') return '<value><boolean>'+(x?1:0)+'</boolean></value>';
  if(typeof x==='number'&&Number.isInteger(x)) return '<value><int>'+x+'</int></value>';
  if(typeof x==='number') return '<value><double>'+x+'</double></value>';
  if(Array.isArray(x)) return '<value><array><data>'+x.map(_xv).join('')+'</data></array></value>';
  if(typeof x==='object'){ var m=Object.entries(x).map(function(kv){return '<member><name>'+kv[0]+'</name>'+_xv(kv[1])+'</member>';}).join(''); return '<value><struct>'+m+'</struct></value>'; }
  return '<value><string>'+String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</string></value>';
}
function _xp(xml){
  var doc=new DOMParser().parseFromString(xml,'text/xml');
  var f=doc.querySelector('fault'); if(f) throw new Error('Odoo: '+((doc.querySelector('faultString')&&doc.querySelector('faultString').textContent.substring(0,200))||'fault'));
  function pv(n){ if(!n)return null; var c=n.firstElementChild; if(!c)return n.textContent;
    switch(c.tagName){ case'int':case'i4':case'i8':return parseInt(c.textContent); case'double':return parseFloat(c.textContent);
      case'boolean':return c.textContent==='1'; case'string':return c.textContent; case'nil':return null;
      case'array':{var d=c.querySelector('data');return Array.from(d?d.children:[]).map(pv);}
      case'struct':{var o={};c.querySelectorAll(':scope>member').forEach(function(m){o[m.querySelector('name').textContent]=pv(m.querySelector('value'));});return o;}
      default:return c.textContent; } }
  return pv(doc.querySelector('methodResponse>params>param>value'));
}
async function odoo(model,method,args,kwargs){
  /* No per-user Odoo login: the ahooga-odoo-proxy worker authenticates server-side
     as the MAX Ordering Service account and runs the call. Velovisie just scans. */
  kwargs=kwargs||{};
  var r=await fetch(CF_WORKER+'/odoo/rpc',{ method:'POST',
    headers:{'Content-Type':'application/json','x-vv-token':VV_TOKEN},
    body:JSON.stringify({ model:model, method:method, args:args||[], kwargs:kwargs }) });
  var j=null; try{ j=await r.json(); }catch(e){ throw new Error('Odoo proxy returned a non-JSON response ('+r.status+').'); }
  if(!r.ok || (j&&j.error)){ var em=(j&&j.error&&(j.error.message||j.error.data&&j.error.data.message||j.error))||('Odoo proxy error '+r.status); throw new Error(String(em)); }
  return j?j.result:null;
}
async function kvGet(key){ try{ var r=await fetch(CF_WORKER+'/store/'+encodeURIComponent(key)); var x=await r.text(); return x==='null'?null:JSON.parse(x); }catch(e){ return null; } }
async function kvSet(key,value){ try{ await fetch(CF_WORKER+'/store/'+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}); }catch(e){} }

function showView(v){
  $('view-register').style.display = v==='register'?'block':'none';
  $('view-receipt').style.display  = v==='receipt'?'block':'none';
  $('t2-reg').classList.toggle('active', v==='register');
  $('t2-rec').classList.toggle('active', v==='receipt');
  try{ stopCam(); }catch(e){} rcStopCam();
  if(v==='receipt') renderReceipts();
}
window.showView=showView;
function rcMsg(text,kind){ var m=$('msg'); m.textContent=text; m.className='msg '+(kind||'err'); if(kind==='ok') setTimeout(function(){m.className='msg';},5000); }

var rc={ scanner:null, scanning:false, busy:false };
$('rc-conn').onclick=async function(){ var c=rcCreds(); if(!c.user||!c.key){ rcMsg('Enter your Odoo email and password / API key.'); return; }
  odooUid=null; $('rc-state').textContent='Connecting…';
  try{ try{ localStorage.setItem('mxp_cfg',JSON.stringify({user:c.user,key:c.key})); }catch(e){}
    await odoo('res.users','search_read',[[['id','=',1]]],{fields:['name'],limit:1}); $('rc-state').textContent='✓ Connected'; }
  catch(e){ $('rc-state').textContent='Could not connect: '+((e&&e.message)||e); } };

$('rc-scan').onclick=function(){ rc.scanning?rcStopCam():rcStartCam(); };
async function rcStartCam(){
  if(typeof Html5Qrcode==='undefined'){ rcMsg('Scanner did not load — reload the page.'); return; }
  if(!window.isSecureContext && !/^localhost|^127\./.test(location.hostname)){ rcMsg('Camera needs a secure https address.'); return; }
  if(!rc.scanner) rc.scanner=new Html5Qrcode('reader2', (typeof SUPPORTED!=='undefined'&&SUPPORTED)?{formatsToSupport:SUPPORTED,verbose:false}:{verbose:false});
  var conf={fps:12,qrbox:function(w,h){var m=Math.floor(Math.min(w,h)*0.8);return {width:m,height:Math.floor(m*0.62)};}};
  var R=$('reader2'); R.style.display='block'; void R.offsetWidth; rc.scanning=true; $('rc-scan').textContent='■ Stop camera'; $('rc-hint').textContent='Point at the frame serial / SO barcode.';
  try{ await rc.scanner.start({facingMode:'environment'},conf,function(t){rcDetected(t);},function(){}); }
  catch(e1){ try{ var cams=await Html5Qrcode.getCameras(); var back=(cams&&cams.length)?((cams.find(function(c){return /back|rear|environment|achter|arri/i.test(c.label||'');}))||cams[cams.length-1]):null; if(!back) throw e1; await rc.scanner.start(back.id,conf,function(t){rcDetected(t);},function(){}); }
    catch(e2){ rc.scanning=false; R.style.display='none'; $('rc-scan').textContent='📷 Scan arrived frame'; rcMsg('Camera could not start ('+((e2&&(e2.name||e2.message))||e2)+'). Use “Type SO / serial”.'); } }
}
async function rcStopCam(){ if(rc.scanner&&rc.scanning){ try{ await rc.scanner.stop(); }catch(e){} } rc.scanning=false; var R=$('reader2'); if(R){R.style.display='none';R.innerHTML='';} var b=$('rc-scan'); if(b) b.textContent='📷 Scan arrived frame'; }
function rcDetected(text){ var code=String(text||'').trim(); if(!code||rc.busy) return; rc.busy=true; try{flash();}catch(e){} receiveFrame(code).finally(function(){ setTimeout(function(){rc.busy=false;},1400); }); }
$('rc-manual').onclick=function(){ var i=$('rc-in'); i.style.display=(i.style.display==='none'||!i.style.display)?'block':'none'; if(i.style.display==='block'){ rcStopCam(); i.focus(); } };
$('rc-in').addEventListener('keydown',function(e){ if(e.key==='Enter'){ var v=e.target.value.trim(); if(v){ rcDetected(v); e.target.value=''; } } });

async function regList(){ try{ return await fetch(WORKER_URL).then(function(r){return r.json();}); }catch(e){ return []; } }
async function soForCode(code, list){
  if(looksLikeSO(code)) return cleanSO(code);
  var s=cleanSerial(code); var hit=(list||[]).find(function(r){return cleanSerial(r.serial||'')===s;}); return hit?cleanSO(hit.so||''):'';
}
async function configFor(so){ try{ var c=await fetch(WORKER_URL+'?type=config').then(function(r){return r.json();}); return (Array.isArray(c)?c:[]).find(function(r){return r&&r.so===so;})||null; }catch(e){ return null; } }
async function bikeLineForSO(so){ try{ var sol=await odoo('sale.order.line','search_read',[['&','&',['order_id.name','=',so],['product_id.categ_id.complete_name','ilike','Bikes'],['product_id.name','ilike','MAX']]],{fields:['product_id'],limit:1}); if(sol&&sol.length&&Array.isArray(sol[0].product_id)) return sol[0].product_id[1]; }catch(e){} return ''; }

/* ── Deco Coat → Anderlecht → Velovisie route (IDs read from Odoo) ── */
const PT_RECEIPT    = 1;    /* "Anderlecht Receipts" (incoming) — Vendors -> AND/In Transit         */
const PT_STORAGE    = 203;  /* "Storage"             (internal) — AND/In Transit -> AND/Warehouse   */
const PT_TO_VELO    = 249;  /* "Resupply Velovisie"  (incoming) — AND/Warehouse -> Velovisie        */
const LOC_INTRANSIT = 9;    /* AND/In Transit  */
const LOC_WAREHOUSE = 8;    /* AND/Warehouse   */
const LOC_VELOVISIE = 166;  /* Physical Locations/Subcontracting Location/Velovisie */

/* Validate one picking, coping with the immediate-transfer / backorder wizard. */
async function rcValidatePicking(pkId){
  try{ await odoo('stock.picking','action_assign',[[pkId]]); }catch(e){}
  var res=await odoo('stock.picking','button_validate',[[pkId]]);
  if(res && typeof res==='object' && (res.res_model||res.type)){
    await odoo('stock.picking','button_validate',[[pkId]],{context:{skip_backorder:true,picking_ids_not_to_backorder:[pkId]}});
  }
}
/* Create a simple 1-line internal move and validate it. */
async function rcMoveAndValidate(ptId,srcLoc,dstLoc,prodId,origin,label){
  var pk=await odoo('stock.picking','create',[{
    picking_type_id: ptId, location_id: srcLoc, location_dest_id: dstLoc, origin: origin,
    move_ids_without_package: [[0,0,{ name: label, product_id: prodId, product_uom_qty: 1, product_uom: 1, location_id: srcLoc, location_dest_id: dstLoc }]]
  }]);
  try{ await odoo('stock.picking','action_confirm',[[pk]]); }catch(e){}
  await rcValidatePicking(pk);
  var pr=await odoo('stock.picking','read',[[pk],['name']]); return { id:pk, name:(pr&&pr[0]&&pr[0].name)||('#'+pk) };
}

/* Velovisie scan on arrival: validate the Deco Coat P0 receipt into Anderlecht,
   move it In Transit -> Warehouse, then create + validate the Warehouse -> Velovisie
   transfer, and flag the order ready to build. */
async function receiveFrame(code){
  $('rc-hint').textContent='Looking up “'+code+'”…';
  var list=await regList();
  var so=await soForCode(code,list);
  if(!so){ rcMsg('Could not identify an order for “'+code+'”. Scan the SO barcode or a registered frame serial.'); $('rc-hint').textContent=''; return; }

  /* find the Deco Coat purchase order (P0####) that references this sales order */
  var poId=null, poName='', frameProd=null;
  try{
    var pol=await odoo('purchase.order.line','search_read',[['|',['name','ilike',so],['order_id.origin','ilike',so]]],{fields:['order_id','product_id'],limit:1});
    if(pol&&pol.length&&Array.isArray(pol[0].order_id)){ poId=pol[0].order_id[0]; poName=pol[0].order_id[1]; if(Array.isArray(pol[0].product_id)) frameProd=pol[0].product_id[0]; }
  }catch(e){ rcMsg('Odoo error looking up the purchase order: '+((e&&e.message)||e)); $('rc-hint').textContent=''; return; }
  if(!poName){ rcMsg('No Deco Coat purchase order references '+so+'. Check the P0 order exists and mentions the SO on its lines.','err'); $('rc-hint').textContent=''; return; }

  /* guard against a re-scan: if this order was already transferred to Velovisie, stop */
  try{
    var already=await odoo('stock.picking','search_read',[[['origin','=',so],['location_dest_id','=',LOC_VELOVISIE],['state','=','done']]],{fields:['name'],limit:1});
    if(already&&already.length){ rcMsg('✓ '+so+' was already received & transferred to Velovisie ('+already[0].name+').','ok'); $('rc-hint').textContent=''; return; }
  }catch(e){}

  var done=[];

  /* STEP 1 — validate the Anderlecht receipt(s) of the P0 order (Vendors -> AND/In Transit) */
  try{
    $('rc-hint').textContent='Validating the '+poName+' receipt…';
    var recs=await odoo('stock.picking','search_read',[[['origin','=',poName],['picking_type_id','=',PT_RECEIPT],['state','in',['assigned','confirmed','waiting']]]],{fields:['id','name'],limit:10});
    for(var i=0;i<recs.length;i++){ await rcValidatePicking(recs[i].id); done.push(recs[i].name); }
  }catch(e){ rcMsg('Could not validate the '+poName+' receipt: '+((e&&e.message)||e),'err'); $('rc-hint').textContent=''; return; }

  /* STEP 2 — the frame is now in AND/In Transit; move it In Transit -> Warehouse.
     Validate the Storage transfer Odoo created, or create it if none exists. */
  try{
    $('rc-hint').textContent='Moving In Transit -> Warehouse…';
    var stor=await odoo('stock.picking','search_read',[[['origin','=',poName],['picking_type_id','=',PT_STORAGE],['state','in',['assigned','confirmed','waiting']]]],{fields:['id','name'],limit:10});
    if(stor&&stor.length){ for(var j=0;j<stor.length;j++){ await rcValidatePicking(stor[j].id); done.push(stor[j].name); } }
    else if(frameProd){ var mv=await rcMoveAndValidate(PT_STORAGE,LOC_INTRANSIT,LOC_WAREHOUSE,frameProd,poName,code); done.push(mv.name); }
  }catch(e){ rcMsg('Receipt done, but the In Transit -> Warehouse move failed: '+((e&&e.message)||e),'err'); $('rc-hint').textContent=''; return; }

  /* STEP 3 — create & validate the AND/Warehouse -> Velovisie transfer */
  var newPickName='';
  try{
    $('rc-hint').textContent='Transferring Warehouse -> Velovisie…';
    if(!frameProd){
      try{ var m2=await odoo('stock.move','search_read',[[['origin','=',poName]]],{fields:['product_id'],limit:1}); if(m2&&m2.length&&Array.isArray(m2[0].product_id)) frameProd=m2[0].product_id[0]; }catch(e){}
    }
    if(!frameProd) throw new Error('could not resolve the frame product from '+poName);
    var toVV=await rcMoveAndValidate(PT_TO_VELO,LOC_WAREHOUSE,LOC_VELOVISIE,frameProd,so,code);
    newPickName=toVV.name; done.push(newPickName);
    try{ await odoo('stock.picking','message_post',[[toVV.id]],{body:'Painted frame received & transferred to Velovisie — scanned in the VV app ('+so+', PO '+poName+').',message_type:'comment',subtype_xmlid:'mail.mt_note'}); }catch(e){}
  }catch(e){ rcMsg('Receipt & warehouse steps done, but the Velovisie transfer failed: '+((e&&e.message)||e),'err'); $('rc-hint').textContent=''; return; }

  /* notify the PO Builder that this order is ready to build */
  var serial = looksLikeSO(code) ? '' : cleanSerial(code);
  if(!serial){ var h=(list||[]).find(function(r){return cleanSO(r.so||'')===so;}); if(h) serial=cleanSerial(h.serial||''); }
  var cfg=await configFor(so); var model=await bikeLineForSO(so);
  var rec={ so:so, frameId:serial, model:model, colour:(cfg&&cfg.main&&cfg.main.name)||'', finish:(cfg&&cfg.main&&cfg.main.finish)||'', arrivedAt:new Date().toISOString(), by:'VV', status:'ready' };
  try{ var arr=await kvGet('vv_frame_arrivals'); if(!Array.isArray(arr)) arr=[]; arr=arr.filter(function(x){return x&&x.so!==so;}); arr.unshift(rec); arr=arr.slice(0,500); await kvSet('vv_frame_arrivals',arr); }catch(e){}
  await rcStopCam();
  rcMsg('✓ '+so+' received — '+poName+' receipt validated, moved to warehouse, transferred to Velovisie ('+done.join(', ')+'). Sent to the PO Builder as ready to build.','ok');
  $('rc-hint').textContent=''; _recLog.unshift({so:so,frameId:serial,name:newPickName||poName,ts:new Date().toISOString()}); renderReceipts();
}
var _recLog=[];
function renderReceipts(){ var box=$('rc-recent'); if(!box) return; if(!_recLog.length){ box.innerHTML='<div class="hint" style="text-align:left">No receipts yet this session.</div>'; return; }
  box.innerHTML=_recLog.slice(0,15).map(function(r){ return '<div class="rec"><span class="so">'+r.so+'</span><span class="sr">'+(r.frameId||'')+' · '+(r.name||'')+'</span><span class="t">'+new Date(r.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'</span></div>'; }).join(''); }

render(); loadRecent(); showView('register');
