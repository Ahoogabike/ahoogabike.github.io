#!/usr/bin/env node
/* =====================================================================
 *  refresh-feeds.mjs — open the three planning pages so the morning
 *  email is built on today's numbers instead of whenever somebody last
 *  happened to open a browser.
 *
 *  It drives real Chromium against the real published pages, in order,
 *  and after each one it waits for that page's feed in the shared store
 *  to carry a NEW timestamp. Watching the store rather than the page is
 *  deliberate: a page can look like it finished and still have published
 *  nothing, which is exactly how a whole day was lost on 16 Sep 2026.
 *
 *  Run locally the same way CI does:
 *      ODOO_USER=… ODOO_KEY=… node scripts/refresh-feeds.mjs
 * ===================================================================== */
 
import { chromium } from 'playwright';
 
const SITE  = process.env.SITE  || 'https://ahoogabike.github.io';
const STORE = process.env.STORE || 'https://ahooga-odoo-proxy.ahoogahouse-1050-be.workers.dev';
const USER  = process.env.ODOO_USER;
const KEY   = process.env.ODOO_KEY;
 
if (!USER || !KEY) {
  console.error('ODOO_USER and ODOO_KEY must be set.');
  process.exit(1);
}
 
/* The order is the pipeline. Each page eats the one above it, so running
   them out of order produces a plan built on yesterday's forecast. */
const STEPS = [
  { page: 'sales-forecast-my27.html', key: 'sales_forecast_my27',   label: 'Sales Forecast MY27', budgetMs: 6 * 60e3 },
  { page: 'po-builder-my27.html',     key: 'production_plan_my27',  label: 'PO Builder MY27',     budgetMs: 8 * 60e3 },
  /* MY26 is a handful of bikes finishing in October, but Parts Stock merges it
     with MY27 and a stale plan here would show up as a stale warning on the
     email. A warning nobody can act on is a warning people learn to ignore. */
  { page: 'po-builder-bikes.html',    key: 'production_plan',       label: 'PO Builder MY26',     budgetMs: 8 * 60e3 },
  { page: 'parts-stock.html',         key: 'parts_deadlines',       label: 'Parts Stock',         budgetMs: 12 * 60e3 },
];
 
const sleep = ms => new Promise(r => setTimeout(r, ms));
 
async function feedUpdated(key) {
  try {
    const r = await fetch(`${STORE}/store/${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const t = (await r.text() || '').trim();
    if (!t || t === 'null') return null;
    const j = JSON.parse(t);
    return j.updated || null;
  } catch { return null; }
}
 
/* Credentials go in under every name the three pages look for, so this
   keeps working if one of them changes which key it reads. They live only
   in this throwaway browser profile and die with the job. */
const seed = JSON.stringify({ user: USER, key: KEY });
const SEED_KEYS = [
  'ahooga_forecast_my27_cfg',
  'ahooga_pobuilder_my27_cfg',
  'ahooga_forecast_cfg',
  'mxp_cfg',
];
 
const results = [];
 
const browser = await chromium.launch();
try {
  for (const step of STEPS) {
    const before = await feedUpdated(step.key);
    console.log(`\n── ${step.label}`);
    console.log(`   feed ${step.key} was last published ${before || 'never'}`);
 
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(([keys, value]) => {
      for (const k of keys) { try { localStorage.setItem(k, value); } catch {} }
    }, [SEED_KEYS, seed]);
 
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', m => { if (m.type() === 'error') problems.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => problems.push('pageerror: ' + String(e.message).slice(0, 300)));
 
    const url = `${SITE}/${step.page}?ci=${Date.now()}`;   // cache-bust every run
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90e3 });
 
    /* Wait for the STORE to move, not for anything on screen. */
    const deadline = Date.now() + step.budgetMs;
    let after = null, moved = false;
    while (Date.now() < deadline) {
      await sleep(5000);
      after = await feedUpdated(step.key);
      if (after && after !== before) { moved = true; break; }
    }
 
    if (moved) {
      console.log(`   ✓ published ${after}`);
      results.push({ ...step, ok: true, after });
    } else {
      console.log(`   ✗ nothing new after ${Math.round(step.budgetMs / 60e3)} min`);
      if (problems.length) console.log('   page errors:\n     ' + problems.slice(0, 5).join('\n     '));
      try { await page.screenshot({ path: `failed-${step.page}.png`, fullPage: false }); } catch {}
      results.push({ ...step, ok: false, problems: problems.slice(0, 5) });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
 
console.log('\n─────────────────────────────────────────────');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'}  ${r.label}`);
 
const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.log(`\n${failed.length} of ${results.length} did not publish. The email will go out on older`);
  console.log('numbers unless this is fixed before 07:00 UTC.');
  process.exit(1);
}
console.log('\nAll three feeds refreshed. The 07:00 email will be built on these.');
