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
/* The pipeline is not a line, it is a loop.
 *
 *   Sales Forecast → Production Planner → PO Builder 26 → PO Builder 27 → Parts Stock
 *                                              ↑                              │
 *                                              └────── component_supply ───────┘
 *
 * Parts Stock tells the PO Builders how many bikes the components on hand can
 * actually build, so the first builder pass plans against a stale view of stock
 * and only the second reflects what is really at Velovisie. And if that second
 * pass moves the plan, parts_deadlines — the feed the email reads — was computed
 * from the plan before it moved. Hence both builders and Parts Stock run twice.
 *
 * The Production Planner comes second because the builders need to know which
 * bikes are already on open Okazi POs; those consume components up front and
 * would otherwise be planned for twice.
 *
 * Two passes, not more: the loop damps quickly in practice but nothing here
 * proves it converges, so this is a deliberate stopping point rather than a
 * fixed point. If pass two ever moves things materially, that is worth seeing
 * rather than burying under a third run. */
const P = {
  forecast: { page: 'sales-forecast-my27.html', key: 'sales_forecast_my27',  budgetMs: 6 * 60e3 },
  planner:  { page: 'MAX_planner.html',         key: 'production_basis',     budgetMs: 8 * 60e3 },
  po26:     { page: 'po-builder-bikes.html',    key: 'production_plan',      budgetMs: 8 * 60e3 },
  po27:     { page: 'po-builder-my27.html',     key: 'production_plan_my27', budgetMs: 8 * 60e3 },
  parts:    { page: 'parts-stock.html',         key: 'parts_deadlines',      budgetMs: 12 * 60e3 },
};
const STEPS = [
  { ...P.forecast, label: 'Sales Forecast MY27' },
  { ...P.planner,  label: 'Production Planner' },
  { ...P.po26,     label: 'PO Builder MY26 · pass 1' },
  { ...P.po27,     label: 'PO Builder MY27 · pass 1' },
  { ...P.parts,    label: 'Parts Stock · pass 1' },
  /* everything below re-plans now that real component availability is published */
  { ...P.po26,     label: 'PO Builder MY26 · pass 2' },
  { ...P.po27,     label: 'PO Builder MY27 · pass 2' },
  { ...P.parts,    label: 'Parts Stock · pass 2' },
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

/* Credentials go in under every name the pages look for, so this keeps
   working if one of them changes which key it reads. They live only in this
   throwaway browser profile and die with the job. */
const CRED = JSON.stringify({ user: USER, key: KEY });
const CRED_KEYS = [
  'ahooga_forecast_my27_cfg',
  'ahooga_pobuilder_my27_cfg',
  'ahooga_forecast_cfg',
  'mxp_cfg',
];

/* A blank browser is not a neutral browser.
 *
 * Several of these pages hold human decisions in localStorage — the custom
 * colour programme, the season shape, each market's target. A fresh profile
 * has none of them, so the page happily computes a DIFFERENT plan and
 * publishes it looking exactly as confident as the right one. On the first
 * automated run that silently dropped the 396-bike custom programme to zero.
 *
 * So before driving the forecast we read back the settings it published while
 * a person was using it, and put them in this browser first. The robot then
 * reproduces the human's plan rather than inventing its own. */
async function forecastSettings() {
  try {
    const r = await fetch(`${STORE}/store/forecast_settings_my27`, { cache: 'no-store' });
    if (!r.ok) return null;
    const t = (await r.text() || '').trim();
    return (!t || t === 'null') ? null : JSON.parse(t);
  } catch { return null; }
}
const SET = await forecastSettings();
if (!SET) {
  console.error('forecast_settings_my27 is missing — refusing to run, because the');
  console.error('forecast would be rebuilt without the custom programme or the season shape.');
  process.exit(1);
}
if (!(SET.custom > 0)) {
  console.error(`forecast_settings_my27 says custom = ${SET.custom}. That is almost certainly a`);
  console.error('previous automated run having overwritten it. Open Sales Forecast MY27 in a');
  console.error('real browser to restore it, then run this again.');
  process.exit(1);
}
console.log(`Settings: season ${SET.total} \u00b7 custom ${SET.custom} \u00b7 mix from ${SET.mix}`);

const results = [];

const browser = await chromium.launch();
try {
  for (const step of STEPS) {
    const before = await feedUpdated(step.key);
    console.log(`\n── ${step.label}`);
    console.log(`   feed ${step.key} was last published ${before || 'never'}`);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(([keys, cred, set]) => {
      const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
      for (const k of keys) put(k, cred);
      if (!set) return;
      /* the forecast's own saved config carries the three boxes as well */
      put('ahooga_forecast_my27_cfg', JSON.stringify({
        ...JSON.parse(cred), total: String(set.total), custom: String(set.custom), mix: set.mix
      }));
      if (Array.isArray(set.shape) && set.shape.length === 12) put('ahooga_forecast_my27_shape', JSON.stringify(set.shape));
      if (set.countryTargets) put('ahooga_forecast_my27_country_targets', JSON.stringify(set.countryTargets));
      if (set.colourTargets)  put('ahooga_forecast_my27_colour_targets',  JSON.stringify(set.colourTargets));
    }, [CRED_KEYS, CRED, SET]);

    const page = await ctx.newPage();
    const problems = [];
    page.on('console', m => { if (m.type() === 'error') problems.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => problems.push('pageerror: ' + String(e.message).slice(0, 300)));

    const url = `${SITE}/${step.page}?ci=${Date.now()}`;   // cache-bust every run
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90e3 });

    /* Wait for the STORE to move FORWARD, not merely to differ.
     *
     * KV reads are eventually consistent: a read seconds after a write can come
     * back with the previous value from another edge node. Testing `!==` treats
     * that stale read as success — on 16 Sep both second passes "passed" on a
     * timestamp ten minutes OLDER than the one before them, and the browser was
     * closed about five seconds after opening. The pages never finished.
     *
     * So: strictly newer than where we started, and confirmed by two consecutive
     * reads, so one lucky edge node cannot wave a step through. */
    const deadline = Date.now() + step.budgetMs;
    let after = null, moved = false, confirmations = 0;
    while (Date.now() < deadline) {
      await sleep(5000);
      const now = await feedUpdated(step.key);
      if (now && (!before || now > before)) {
        confirmations = (now === after) ? confirmations + 1 : 1;
        after = now;
        if (confirmations >= 2) { moved = true; break; }
      } else {
        confirmations = 0;          // went backwards or vanished: a stale read
      }
    }

    if (moved) {
      console.log(`   ✓ published ${after}`);
      results.push({ ...step, ok: true, after });
    } else {
      console.log(`   ✗ nothing newer than ${before || '(nothing)'} after ${Math.round(step.budgetMs / 60e3)} min`);
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

/* Did feeding real stock back into the builder actually change anything? If the
   second pass moves the plan a lot, somebody should know — it means production
   is being held back by components, which is a fact about the business, not a
   quirk of the job. */
try {
  const plan = await (await fetch(`${STORE}/store/production_plan_my27`)).json();
  const total = Object.values(plan.byFam || {})
    .reduce((a, arr) => a + arr.reduce((x, y) => x + (y || 0), 0), 0);
  console.log(`\nFinal MY27 plan after the component feedback: ${Math.round(total)} bikes.`);
} catch {}

/* Did we just publish a forecast that lost the custom programme? If so say it
   loudly — a silently smaller season is the most expensive kind of wrong. */
try {
  const after = await forecastSettings();
  if (after && after.custom !== SET.custom) {
    console.log(`\n!! custom programme changed ${SET.custom} \u2192 ${after.custom} during this run.`);
    console.log('   The settings did not reach the browser. Treat this run as suspect.');
    process.exitCode = 1;
  }
} catch {}

const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.log(`\n${failed.length} of ${results.length} did not publish. The email will go out on older`);
  console.log('numbers unless this is fixed before 07:00 UTC.');
  process.exit(1);
}
console.log(`\nAll ${results.length} steps published. The 07:00 email will be built on these.`);
