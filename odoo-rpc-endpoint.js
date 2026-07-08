/* ============================================================================
 *  ahooga-odoo-proxy  ·  /odoo/rpc  — authenticated Odoo RPC for the VV scan app
 * ----------------------------------------------------------------------------
 *  WHY: Velovisie has no Odoo profile. Instead of each operator entering Odoo
 *  credentials, the VV scan app (vv-scan.html) POSTs its Odoo calls here and the
 *  worker runs them server-side as the MAX Ordering Service account (the same
 *  profile the dealer portal uses). The API key never reaches the browser.
 *
 *  HOW TO INSTALL (additive — does not touch your existing /odoo/* or /store/*):
 *   1) Paste ALLOW, cors(), odooCall(), handleOdooRpc() (below) into your worker.
 *   2) In your fetch() router, add — BEFORE the generic /odoo/ passthrough:
 *
 *        const url = new URL(request.url);
 *        if (url.pathname === '/odoo/rpc') return handleOdooRpc(request, env);
 *        if (request.method === 'OPTIONS') return cors(new Response(null,{status:204}));
 *
 *      (The /odoo/rpc check must come first: the passthrough matches /odoo/<encoded-url>,
 *       and "rpc" is not a URL-encoded string, so they never collide — but order it first anyway.)
 *
 *   3) Configure (Cloudflare dashboard → Settings → Variables, or wrangler):
 *        Secrets:   ODOO_API_KEY   = <MAX Ordering Service API key — same one the dealer portal uses>
 *                   VV_TOKEN       = <any long random string; also put it in vv-scan.html VV_TOKEN>
 *        Plain vars: ODOO_URL      = https://ahooga.odoo.com
 *                    ODOO_DB       = logicasoft-aho-18-0-21599177
 *                    ODOO_LOGIN    = ahoogahouse.1050.be@gmail.com   (MAX Ordering Service)
 *
 *   4) In vv-scan.html set  const VV_TOKEN="...";  to the SAME value as the VV_TOKEN secret.
 * ==========================================================================*/

/* Only these model/method pairs can ever be called through this endpoint, so a
 * leaked token can do nothing beyond the custom-frame receipt flow. */
const ALLOW = {
  'purchase.order.line': ['search_read'],
  'sale.order.line':     ['search_read'],
  'stock.move':          ['search_read'],
  'stock.picking':       ['search_read','read','create','write','action_assign','action_confirm','button_validate','message_post'],
};

/* uid is stable for a given login+key — cache it across requests (per worker isolate). */
let CACHED_UID = null;

function cors(resp){
  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, x-vv-token');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(resp.body, { status: resp.status, headers: h });
}
function json(obj, status){
  return cors(new Response(JSON.stringify(obj), { status: status||200, headers: { 'Content-Type':'application/json' } }));
}

/* One Odoo JSON-RPC call (service "object" / "common"). Throws on transport error. */
async function odooRpc(env, service, method, args){
  const ODOO_URL = env.ODOO_URL || 'https://ahooga.odoo.com';
  const r = await fetch(ODOO_URL + '/jsonrpc', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', method:'call', id: Date.now(),
      params:{ service, method, args } })
  });
  const j = await r.json();
  if (j.error) { const e = new Error((j.error.data && j.error.data.message) || j.error.message || 'Odoo error'); e.odoo = j.error; throw e; }
  return j.result;
}

async function authUid(env){
  if (CACHED_UID) return CACHED_UID;
  const db = env.ODOO_DB, login = env.ODOO_LOGIN, key = env.ODOO_API_KEY;
  const uid = await odooRpc(env, 'common', 'authenticate', [db, login, key, {}]);
  if (!uid || typeof uid !== 'number') throw new Error('Odoo authentication failed for the service account.');
  CACHED_UID = uid;
  return uid;
}

async function execKw(env, model, method, args, kwargs){
  const db = env.ODOO_DB, key = env.ODOO_API_KEY;
  let uid = await authUid(env);
  try {
    return await odooRpc(env, 'object', 'execute_kw', [db, uid, key, model, method, args, kwargs || {}]);
  } catch (e) {
    // session/uid could be stale — re-auth once and retry
    CACHED_UID = null;
    uid = await authUid(env);
    return await odooRpc(env, 'object', 'execute_kw', [db, uid, key, model, method, args, kwargs || {}]);
  }
}

async function handleOdooRpc(request, env){
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (request.method !== 'POST')    return json({ error: 'POST only' }, 405);

  // shared-token gate (in addition to the app being behind mxp-auth)
  if (env.VV_TOKEN && request.headers.get('x-vv-token') !== env.VV_TOKEN)
    return json({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch(e){ return json({ error: 'Invalid JSON body' }, 400); }
  const { model, method, args, kwargs } = body || {};
  if (!model || !method) return json({ error: 'model and method are required' }, 400);

  // allowlist
  if (!ALLOW[model] || ALLOW[model].indexOf(method) === -1)
    return json({ error: `Not allowed: ${model}.${method}` }, 403);

  try {
    const result = await execKw(env, model, method, args || [], kwargs || {});
    return json({ result });
  } catch (e) {
    return json({ error: { message: String(e.message || e), data: e.odoo || null } }, 200);
  }
}

/* If you prefer a standalone module worker instead of merging, this default export
 * handles ONLY /odoo/rpc. Remove it if you paste the functions into your existing worker. */
export default {
  async fetch(request, env){
    const url = new URL(request.url);
    if (url.pathname === '/odoo/rpc') return handleOdooRpc(request, env);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    return new Response('Not found', { status: 404 });
  }
};
