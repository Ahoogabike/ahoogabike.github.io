/* ============================================================================
 * Ahooga Custom Colors — "Create PO in Odoo" add-on
 * ----------------------------------------------------------------------------
 * Adds direct purchase-order creation to Deco Coat, the same way the Shopify
 * Convert app creates sale orders directly in Odoo (sale.order.create). Until
 * now the Custom Colors app only EXPORTED an Excel file for you to import by
 * hand under Purchase ▸ Orders ▸ Import. This wires up the missing write:
 * purchase.order.create + button_confirm, over the SAME XML-RPC connection
 * (odooCall) the app already uses to READ Deco Coat POs.
 *
 * Drop-in: include this file with a single tag right before </body> in
 * ahooga-custom-colors.html, AFTER the main inline <script>:
 *
 *     <script src="ahooga-custom-colors-po-addon.js"></script>
 *
 * It reuses the app's globals (odooCall, cfg, kvGet/kvSet, save, renderCustom,
 * formsAlert, orderCols, selectedCustomOrders, decoCoatPO, …). No edits to the
 * existing code are required.
 * ==========================================================================*/
(function () {
  'use strict';

  // ── shared KV key + default mapping ────────────────────────────────────────
  // Frame type (detectBikeType => emax / amax / modular / folding / other; use
  // '*' for "any") + whether the order carries a DEV personalized text  ->  the
  // Odoo purchase product and its unit price. The lookup falls back from
  // (type, hasText) → (type, no-text) → ('*', hasText) → ('*', no-text).
  var FRAME_PO_MAP_KEY = 'custom_color_po_frame_map';
  var DEFAULT_FRAME_PO_MAP = [
    { bikeType: 'emax', hasText: false, code: 'FRNAA00260', price: 159, label: '[FRNAA00260] Frame pre-assy AOFV2C (MAX) (Custom)' },
    { bikeType: 'emax', hasText: true,  code: '',           price: 159, label: '' },
    { bikeType: 'amax', hasText: false, code: 'FRNAA00260', price: 159, label: '[FRNAA00260] Frame pre-assy AOFV2C (MAX) (Custom)' },
    { bikeType: 'amax', hasText: true,  code: '',           price: 159, label: '' },
    { bikeType: '*',    hasText: false, code: 'FRNAA00260', price: 159, label: '[FRNAA00260] Frame pre-assy AOFV2C (MAX) (Custom)' }
  ];

  // expose on window so they can be inspected/called from the console too
  var W = window;
  W.framePoMap = W.framePoMap || null;
  var _framePoLoaded = false;

  // ── tiny local helpers (the app's esc/toArr are function-local, not global) ─
  function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
  function esc(s) { return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  // `cfg` and `poData` in the app are `let` globals -> NOT window properties,
  // but they ARE visible by bare name to this classic script (shared global
  // lexical scope). Read them safely without throwing if absent.
  function getCfg() { try { return (typeof cfg !== 'undefined' && cfg) ? cfg : {}; } catch (e) { return {}; } }
  function getPoData() {
    try { if (typeof poData !== 'undefined' && poData) return poData; } catch (e) {}
    if (!W.poData) W.poData = {};
    return W.poData;
  }
  function alertMsg(msg, kind) {
    if (typeof W.formsAlert === 'function') return W.formsAlert(msg, kind);
    try { console[(kind === 'danger' ? 'error' : 'log')]('[PO add-on] ' + msg); } catch (e) {}
    if (kind === 'danger' || kind === 'warn') alert(msg);
  }

  // ── make the app's XML-RPC encoder float-safe (int stayed int before, which
  //    would have mangled a decimal price like 159.50). Pure improvement. ─────
  function patchXmlrpcDoubles() {
    if (typeof W.buildXmlrpc !== 'function' || W.buildXmlrpc.__poAddonPatched) return;
    var orig = W.buildXmlrpc;
    W.buildXmlrpc = function (method, params) {
      var enc = function (v) {
        if (typeof v === 'string') return '<value><string>' + v.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</string></value>';
        if (typeof v === 'number') return Number.isInteger(v)
          ? '<value><int>' + v + '</int></value>'
          : '<value><double>' + v + '</double></value>';
        if (typeof v === 'boolean') return '<value><boolean>' + (v ? 1 : 0) + '</boolean></value>';
        if (Array.isArray(v)) return '<value><array><data>' + v.map(enc).join('') + '</data></array></value>';
        if (typeof v === 'object' && v !== null) {
          var members = Object.keys(v).map(function (k) { return '<member><name>' + k + '</name>' + enc(v[k]) + '</member>'; }).join('');
          return '<value><struct>' + members + '</struct></value>';
        }
        return '<value><string>' + v + '</string></value>';
      };
      return '<?xml version="1.0"?><methodCall><methodName>' + method + '</methodName><params>'
        + params.map(function (p) { return '<param>' + enc(p) + '</param>'; }).join('') + '</params></methodCall>';
    };
    W.buildXmlrpc.__poAddonPatched = true;
    W.buildXmlrpc.__orig = orig;
  }

  // ── mapping load / save (shared via Cloudflare KV, like the rest of the app) ─
  async function ensureFramePoMap(force) {
    if (_framePoLoaded && !force && W.framePoMap) return W.framePoMap;
    var m = null;
    try { if (typeof W.kvGet === 'function') m = await W.kvGet(FRAME_PO_MAP_KEY); } catch (e) {}
    W.framePoMap = (Array.isArray(m) && m.length) ? m : DEFAULT_FRAME_PO_MAP.map(function (r) { return Object.assign({}, r); });
    _framePoLoaded = true;
    return W.framePoMap;
  }
  async function saveFramePoMap() {
    try { if (typeof W.kvSet === 'function') await W.kvSet(FRAME_PO_MAP_KEY, W.framePoMap); } catch (e) {}
  }

  // ── per-order lookup ────────────────────────────────────────────────────────
  function frameHasText(o) {
    try {
      var c = (typeof W.orderCols === 'function') ? W.orderCols(o) : {};
      return !!(c && c.personalText && String(c.personalText).trim());
    } catch (e) { return !!(o && o.personalText && String(o.personalText).trim()); }
  }
  function framePoLookup(o) {
    var bt = (o && o.bikeType) || 'other';
    var ht = frameHasText(o);
    var rows = W.framePoMap || [];
    var pick = function (b, t) {
      return rows.find(function (r) {
        return String(r.bikeType).toLowerCase() === String(b).toLowerCase()
          && !!r.hasText === !!t && String(r.code || '').trim();
      });
    };
    return pick(bt, ht) || pick(bt, false) || pick('*', ht) || pick('*', false) || null;
  }
  W.framePoLookup = framePoLookup;

  // ── Odoo resolvers ──────────────────────────────────────────────────────────
  var _decoVendorId; // cache
  async function resolveDecoCoatVendor() {
    if (_decoVendorId !== undefined) return _decoVendorId;
    var ids = arr(await W.odooCall('res.partner', 'search',
      [['|', ['name', 'ilike', 'deco coat'], ['name', 'ilike', 'decocoat']]], { limit: 1 }));
    _decoVendorId = ids.length ? ids[0] : null;
    return _decoVendorId;
  }
  async function resolveOdooProduct(code) {
    code = String(code || '').trim();
    if (!code) return null;
    if (/^id:\d+$/.test(code)) {
      var id = parseInt(code.slice(3), 10);
      var ex = arr(await W.odooCall('product.product', 'search', [[['id', '=', id]]], { limit: 1 }));
      return ex.length ? id : null;
    }
    var ids = arr(await W.odooCall('product.product', 'search',
      [['|', ['default_code', '=', code], ['barcode', '=', code]]], { limit: 1 }));
    if (!ids.length) ids = arr(await W.odooCall('product.product', 'search', [[['default_code', 'ilike', code]]], { limit: 1 }));
    return ids.length ? ids[0] : null;
  }

  // ── the main action: create + confirm a Deco Coat purchase order ────────────
  async function createDecoCoatPO(opts) {
    opts = opts || {};
    var appCfg = getCfg();
    if (!(appCfg.db && appCfg.key)) { alertMsg('Connect to Odoo first (Settings tab).', 'warn'); return; }
    if (typeof W.odooCall !== 'function') { alertMsg('Odoo client not ready — reload the page.', 'danger'); return; }

    patchXmlrpcDoubles();
    await ensureFramePoMap();

    var list = opts.selected ? W.selectedCustomOrders()
      : (opts.all ? W.currentCustomOrders() : W.newCustomOrders());
    if (!list || !list.length) {
      alertMsg(opts.selected
        ? 'No orders selected — tick the checkboxes in the table first.'
        : 'No new custom orders to put on a PO. Sync Odoo first.', 'warn');
      return;
    }

    var hasPO = function (o) { try { return W.decoCoatPO(o) || W.orderPO(o); } catch (e) { return ''; } };
    var already = list.filter(function (o) { return hasPO(o); });
    var todo = list.filter(function (o) { return !hasPO(o); });
    if (!todo.length) {
      alertMsg('All selected orders already have a Deco Coat PO ('
        + already.map(hasPO).filter(Boolean).join(', ') + ').', 'warn');
      return;
    }

    var btn = document.getElementById('po-create-btn');
    var prevLabel = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Creating PO…'; }

    try {
      var vendorId;
      try { vendorId = await resolveDecoCoatVendor(); }
      catch (e) { alertMsg('Could not look up the Deco Coat vendor: ' + e.message, 'danger'); return; }
      if (!vendorId) { alertMsg('No “Deco Coat” vendor found in Odoo (res.partner). Check the vendor name.', 'danger'); return; }

      var order_line = [], unmapped = [], used = [];
      for (var i = 0; i < todo.length; i++) {
        var o = todo[i];
        var m = framePoLookup(o);
        if (!m) { unmapped.push(o.name + ' (' + (o.bikeType || '?') + (frameHasText(o) ? ' +text' : '') + ')'); continue; }
        var pid;
        try { pid = await resolveOdooProduct(m.code); }
        catch (e) { unmapped.push(o.name + ' [product lookup failed: ' + e.message + ']'); continue; }
        if (!pid) { unmapped.push(o.name + ' [product “' + m.code + '” not found in Odoo]'); continue; }

        var c = (typeof W.orderCols === 'function') ? W.orderCols(o) : {};
        var cfgTxt = 'Main: ' + (c.mainColor || '') + (c.mainFinish ? ' (' + c.mainFinish + ')' : '')
          + ' | Rear: ' + (c.rearColor || c.mainColor || '') + (c.rearFinish ? ' (' + c.rearFinish + ')' : '')
          + ' | Logo: ' + (c.logoColor || '') + (c.logoSize ? ' (' + c.logoSize + ')' : '');
        var ptext = (c.personalText || '').toString().trim();
        var lineName = (m.label || m.code)
          + '\nBike SKU: ' + (o.sku || '')
          + '\nSO#: ' + (o.name || '')               // SO# kept so detectDecocoatPOs() links it back
          + '\nConfiguration: ' + cfgTxt
          + (ptext ? '\nPersonalized text: ' + ptext : '');
        order_line.push([0, 0, {
          product_id: pid,
          name: lineName,
          product_qty: Math.max(1, parseInt(o.qty, 10) || 1),
          price_unit: num(m.price)
        }]);
        used.push(o);
      }

      if (!order_line.length) {
        alertMsg('Could not build any PO line.' + (unmapped.length
          ? ' Unmapped: ' + unmapped.join('; ') + '. Open “⚙ Frame products” and fill the codes.' : ''), 'danger');
        return;
      }

      // create as RFQ, then confirm to a real purchase order (assigns P0…)
      var poId, poName, poState;
      var vals = {
        partner_id: vendorId,
        origin: 'Custom colour ' + used.map(function (o) { return o.name; }).join(', '),
        order_line: order_line
      };
      poId = await W.odooCall('purchase.order', 'create', [vals]);
      if (Array.isArray(poId)) poId = poId[0];
      try { await W.odooCall('purchase.order', 'button_confirm', [[poId]]); }
      catch (e) { console.warn('[PO add-on] confirm failed, PO left as RFQ:', e && e.message); }
      var rec = arr(await W.odooCall('purchase.order', 'read', [[poId], ['name', 'state']]))[0] || {};
      poName = rec.name || ('#' + poId);
      poState = rec.state || 'draft';

      // write the PO back onto the orders + the poData cache, then persist
      for (var j = 0; j < used.length; j++) {
        var u = used[j];
        u.decoCoatPO = poName; u.poRef = poName;
        if (u.status === 'queued') u.status = 'inprod';
      }
      try {
        var pd = getPoData();
        pd[poName] = {
          name: poName,
          dateOrder: new Date().toISOString().slice(0, 10),
          datePlanned: '',
          partner: 'Deco Coat',
          lines: used.map(function (o) {
            var mm = framePoLookup(o);
            return { name: (mm && (mm.label || mm.code) || '') + ' · SO#: ' + o.name, qty: 1, price: num(mm && mm.price) };
          })
        };
      } catch (e) {}
      try { if (typeof W.save === 'function') W.save(); } catch (e) {}
      try { if (typeof W.renderCustom === 'function') W.renderCustom(); } catch (e) {}

      var msg = '✓ Created & confirmed Deco Coat PO ' + poName + ' (' + poState + ') with '
        + order_line.length + ' line(s) in Odoo.';
      if (already.length) msg += ' Skipped ' + already.length + ' already on a PO.';
      if (unmapped.length) msg += ' ⚠ Not added (no frame-product mapping): ' + unmapped.join('; ') + '.';
      alertMsg(msg, unmapped.length ? 'warn' : 'success');
    } catch (e) {
      alertMsg('Odoo PO creation failed: ' + (e && e.message ? e.message : e), 'danger');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = prevLabel; }
    }
  }
  W.createDecoCoatPO = createDecoCoatPO;

  // ── editable mapping panel ──────────────────────────────────────────────────
  function toggleFramePoMap() {
    var p = document.getElementById('frame-po-map-panel');
    if (!p) return;
    var show = (p.style.display === 'none' || !p.style.display);
    p.style.display = show ? 'block' : 'none';
    if (show) ensureFramePoMap().then(renderFramePoMap);
  }
  function renderFramePoMap() {
    var body = document.getElementById('frame-po-map-body');
    if (!body) return;
    var rows = W.framePoMap || [];
    body.innerHTML =
      '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'
      + 'Each row maps a custom frame to its Odoo <b>purchase</b> product. '
      + '<b>Frame type</b>: emax / amax / modular / folding / other (use <code>*</code> for any). '
      + '<b>Has text</b>: ticked = order carries a DEV personalized text. '
      + 'Lookup falls back: (type, text) → (type, no-text) → (*, …). Shared with the team via KV.'
      + '</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<thead><tr>'
      + '<th style="text-align:left;padding:4px">Frame type</th>'
      + '<th style="text-align:center;padding:4px">Has text</th>'
      + '<th style="text-align:left;padding:4px">Odoo product code</th>'
      + '<th style="text-align:left;padding:4px">Label (PO line title)</th>'
      + '<th style="text-align:right;padding:4px">Price €</th>'
      + '<th style="padding:4px"></th>'
      + '</tr></thead><tbody>'
      + rows.map(function (r, i) {
        return '<tr>'
          + '<td style="padding:3px"><input value="' + esc(r.bikeType || '') + '" oninput="poAddon.edit(' + i + ',\'bikeType\',this.value)" style="width:92px"/></td>'
          + '<td style="padding:3px;text-align:center"><input type="checkbox" ' + (r.hasText ? 'checked' : '') + ' onchange="poAddon.edit(' + i + ',\'hasText\',this.checked)"/></td>'
          + '<td style="padding:3px"><input value="' + esc(r.code || '') + '" oninput="poAddon.edit(' + i + ',\'code\',this.value)" placeholder="e.g. FRNAA00260" style="width:140px"/></td>'
          + '<td style="padding:3px"><input value="' + esc(r.label || '') + '" oninput="poAddon.edit(' + i + ',\'label\',this.value)" style="width:100%;min-width:180px"/></td>'
          + '<td style="padding:3px;text-align:right"><input type="number" step="0.01" value="' + (r.price != null ? r.price : '') + '" oninput="poAddon.edit(' + i + ',\'price\',this.value)" style="width:80px;text-align:right"/></td>'
          + '<td style="padding:3px;text-align:center"><button class="btn btn-danger btn-sm" onclick="poAddon.remove(' + i + ')">✕</button></td>'
          + '</tr>';
      }).join('')
      + '</tbody></table>'
      + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'
      + '<button class="btn btn-secondary btn-sm" onclick="poAddon.add()">+ Add row</button>'
      + '<button class="btn btn-success btn-sm" onclick="poAddon.save()">💾 Save mapping</button>'
      + '<button class="btn btn-secondary btn-sm" onclick="poAddon.reload()">↻ Reload</button>'
      + '</div>';
  }
  function edit(i, k, v) {
    if (!W.framePoMap || !W.framePoMap[i]) return;
    if (k === 'hasText') W.framePoMap[i][k] = !!v;
    else if (k === 'price') W.framePoMap[i][k] = (v === '' ? '' : num(v));
    else W.framePoMap[i][k] = v;
  }
  function add() {
    W.framePoMap = W.framePoMap || [];
    W.framePoMap.push({ bikeType: '*', hasText: false, code: '', price: 159, label: '' });
    renderFramePoMap();
  }
  function remove(i) { if (W.framePoMap) { W.framePoMap.splice(i, 1); renderFramePoMap(); } }
  async function save() { await saveFramePoMap(); alertMsg('Frame-product mapping saved (shared via KV).', 'success'); }
  function reload() { ensureFramePoMap(true).then(renderFramePoMap); }

  // expose the small UI callbacks under a namespace (avoids clashing with the
  // app's own global save()/add() etc.)
  W.poAddon = { edit: edit, add: add, remove: remove, save: save, reload: reload, toggle: toggleFramePoMap, create: createDecoCoatPO };

  // ── inject the button + panel next to the existing Excel-export button ──────
  function injectUI() {
    if (document.getElementById('po-create-btn')) return true; // already injected
    // find the existing "PO → Odoo import" export button by its onclick
    var exportBtn = Array.prototype.slice.call(document.querySelectorAll('button'))
      .find(function (b) { return /exportPOImport\s*\(/.test(b.getAttribute('onclick') || ''); });
    if (!exportBtn) return false;
    var bar = exportBtn.parentNode;
    if (!bar) return false;

    // 1) "Create PO in Odoo" — placed right after the export button
    var createBtn = document.createElement('button');
    createBtn.id = 'po-create-btn';
    createBtn.className = 'btn btn-primary btn-sm';
    createBtn.title = 'Create AND confirm a Deco Coat purchase order directly in Odoo for the ticked orders — no Excel import needed.';
    createBtn.setAttribute('onclick', 'poAddon.create({selected:true})');
    createBtn.innerHTML = '⚡ Create PO in Odoo (selected)';
    exportBtn.insertAdjacentElement('afterend', createBtn);

    // 2) "Frame products" — toggles the editable mapping table
    var mapBtn = document.createElement('button');
    mapBtn.id = 'po-map-btn';
    mapBtn.className = 'btn btn-secondary btn-sm';
    mapBtn.title = 'Edit the frame type → Odoo product / price mapping used when creating the PO.';
    mapBtn.setAttribute('onclick', 'poAddon.toggle()');
    mapBtn.innerHTML = '⚙ Frame products';
    createBtn.insertAdjacentElement('afterend', mapBtn);

    // 3) the (hidden) editable panel, inserted just after the whole button bar
    var panel = document.createElement('div');
    panel.id = 'frame-po-map-panel';
    panel.style.cssText = 'display:none;margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2)';
    panel.innerHTML = '<div style="font-weight:600;font-size:13px;margin-bottom:6px">Frame → Odoo product mapping (for direct PO creation)</div><div id="frame-po-map-body"></div>';
    bar.insertAdjacentElement('afterend', panel);
    return true;
  }

  function init() {
    patchXmlrpcDoubles();
    if (!injectUI()) {
      // the Custom Colors view may not be in the DOM yet — retry briefly
      var tries = 0;
      var t = setInterval(function () {
        if (injectUI() || ++tries > 40) clearInterval(t); // ~10s max
      }, 250);
    }
    // warm the mapping cache (non-blocking)
    ensureFramePoMap().catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
