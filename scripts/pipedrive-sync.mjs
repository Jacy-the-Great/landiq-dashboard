// Pipedrive → Supabase nightly sync
//
// Replaces the manual "upload the Deals/People CSV" step. It pulls straight from
// the Pipedrive API and writes rows into the SAME tables and the SAME shape the
// CSV import produced (liq_pipedrive_deals / liq_pipedrive_people, column `raw`,
// keys like "Deal - Title" / "Person - Customer Type"), so the dashboard needs
// no changes at all.
//
// How the field names stay identical to the CSV: Pipedrive's /dealFields and
// /personFields endpoints return every field (standard AND custom) with its
// human-readable `name`. A CSV export names its columns "Deal - <name>", so we
// rebuild that generically rather than hard-coding ~50 mappings. Custom fields
// therefore keep working even if you add new ones in Pipedrive.
//
// It also captures two things a CSV export CANNOT give us:
//   • Deal - Product quantity / name / amount  (from each deal's products)
//   • Deal - Max stage reached / order         (from each deal's change history,
//     so LOST deals still count at the furthest stage they actually reached —
//     this is what the OPTI-MAX funnel needs and why it was manual until now)
//
// Env (set as GitHub Actions secrets — never commit these):
//   PIPEDRIVE_TOKEN            your Pipedrive API token
//   PIPEDRIVE_DOMAIN           your company domain, e.g. "landiq"
//   SUPABASE_SERVICE_ROLE_KEY  Supabase → Project Settings → API → service_role
//   SUPABASE_URL               optional, defaults to the project URL below
//
// Run locally:  PIPEDRIVE_TOKEN=... PIPEDRIVE_DOMAIN=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/pipedrive-sync.mjs

const TOKEN  = process.env.PIPEDRIVE_TOKEN;
const DOMAIN = (process.env.PIPEDRIVE_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/, '').replace(/\/+$/, '');
const SB_URL = process.env.SUPABASE_URL || 'https://ysdonnjezvoyrrizadik.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Skip the slow per-deal passes with SKIP_DETAIL=1 (useful for a quick test run).
const SKIP_DETAIL = process.env.SKIP_DETAIL === '1';

if (!TOKEN)  fail('PIPEDRIVE_TOKEN is not set.');
if (!DOMAIN) fail('PIPEDRIVE_DOMAIN is not set (your Pipedrive subdomain, e.g. "landiq").');
if (!SB_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is not set.');

const BASE = `https://${DOMAIN}.pipedrive.com/api/v1`;

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Pipedrive GET with retry on rate-limit / transient errors ────────────────
async function pd(path, params = {}) {
  const qs = new URLSearchParams({ ...params, api_token: TOKEN });
  const url = `${BASE}${path}?${qs}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      await sleep(1000 * (attempt + 1)); continue;         // network blip
    }
    if (res.status === 429 || res.status >= 500) {         // throttled / server error
      const wait = Number(res.headers.get('retry-after') || 0) * 1000 || 2000 * (attempt + 1);
      await sleep(wait); continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      fail(`Pipedrive ${res.status} on ${path}: ${body.slice(0, 200)}` +
        (res.status === 401 ? '\n  (401 = bad or expired API token)' : '') +
        (res.status === 404 ? `\n  (404 = wrong company domain "${DOMAIN}")` : ''));
    }
    return res.json();
  }
  fail(`Gave up after repeated rate-limiting on ${path}`);
}

// Fetch every page of a collection endpoint.
async function pdAll(path, params = {}) {
  const out = [];
  let start = 0;
  for (;;) {
    const r = await pd(path, { ...params, start, limit: 500 });
    const batch = r.data || [];
    out.push(...batch);
    const more = r.additional_data?.pagination;
    if (more?.more_items_in_collection) start = more.next_start ?? start + 500;
    else return out;
  }
}

// Run async work over a list with limited concurrency (keeps us under the rate limit).
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0, done = 0, lastLog = Date.now();
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
      done++;
      if (Date.now() - lastLog > 15000) { console.log(`   …${done}/${items.length}`); lastLog = Date.now(); }
    }
  }));
  return out;
}

// ── Turn one Pipedrive record into the CSV-style object the dashboard expects ─
function buildMapper(fields, prefix, lookups) {
  // option id → label, per field key (for enum / set custom fields)
  const optMap = {};
  for (const f of fields) {
    if (Array.isArray(f.options) && f.options.length) {
      optMap[f.key] = Object.fromEntries(f.options.map(o => [String(o.id), o.label]));
    }
  }
  return rec => {
    const row = {};
    for (const f of fields) {
      const name = f.name;
      if (!name) continue;
      const lname = name.toLowerCase();

      // The key in /dealFields doesn't always match the property on the record
      // (e.g. Pipeline is "pipeline_id" on a deal). Try the field key, then the
      // ±"_id" variants, before giving up.
      let v = rec[f.key];
      if (v === undefined && f.key.endsWith('_id')) v = rec[f.key.replace(/_id$/, '')];
      if (v === undefined) v = rec[f.key + '_id'];

      // Relations resolved by field NAME, which is stable even when the key isn't.
      if (lname === 'pipeline')      v = lookups.pipelines[rec.pipeline_id ?? v] ?? v;
      else if (lname === 'stage')    v = lookups.stages[rec.stage_id ?? v]?.name ?? v;
      else if (lname === 'owner')    v = lookups.users[(rec.user_id && typeof rec.user_id === 'object' ? rec.user_id.id : rec.user_id) ?? v] ?? (typeof v === 'object' ? v?.name : v);

      if (v === undefined || v === null || v === '') { row[`${prefix} - ${name}`] = ''; continue; }

      // Remaining relations come back either as an object (with .name/.value) or a bare id.
      if (typeof v === 'object' && !Array.isArray(v)) v = v.name ?? v.value ?? v.id ?? '';

      if (f.key === 'status') v = String(v).charAt(0).toUpperCase() + String(v).slice(1);  // won → Won
      else if (optMap[f.key]) {
        const ids = Array.isArray(v) ? v : String(v).split(',');
        v = ids.map(id => optMap[f.key][String(id).trim()] ?? String(id).trim()).join(', ');
      }
      row[`${prefix} - ${name}`] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    row[`${prefix} - ID`] = String(rec.id ?? '');
    return row;
  };
}

// ── Replace a whole Supabase table (same delete-all + batch-insert as the app) ─
async function replaceTable(table, rows) {
  const del = await fetch(`${SB_URL}/rest/v1/${table}?imported_at=gte.1970-01-01T00:00:00Z`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'return=minimal' },
  });
  if (!del.ok) fail(`Could not clear ${table}: ${del.status} ${await del.text().catch(() => '')}`);

  const BATCH = 200;
  let stored = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(r => ({ raw: r }));
    const ins = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(batch),
    });
    if (!ins.ok) fail(`Insert into ${table} failed at row ${i}: ${ins.status} ${await ins.text().catch(() => '')}`);
    stored += batch.length;
  }

  // Verify what the table actually holds, the same way the app's import does.
  const chk = await fetch(`${SB_URL}/rest/v1/${table}?select=raw`, {
    method: 'HEAD',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
  });
  const dbCount = Number((chk.headers.get('content-range') || '').split('/')[1] ?? stored);
  if (dbCount !== rows.length) {
    console.warn(`   ⚠ ${table}: sent ${rows.length} but the table holds ${dbCount}`);
  }
  return dbCount;
}

// ── main ────────────────────────────────────────────────────────────────────
console.log(`Pipedrive sync → ${BASE}`);

const [dealFields, personFields, pipelinesRaw, stagesRaw, usersRaw] = await Promise.all([
  pdAll('/dealFields'), pdAll('/personFields'),
  pdAll('/pipelines'), pdAll('/stages'), pdAll('/users'),
]);

const lookups = {
  pipelines: Object.fromEntries(pipelinesRaw.map(p => [p.id, p.name])),
  stages: Object.fromEntries(stagesRaw.map(s => [s.id, { name: s.name, order: s.order_nr ?? 0, pipeline: s.pipeline_id }])),
  users: Object.fromEntries(usersRaw.map(u => [u.id, u.name])),
};
console.log(`✓ schema: ${dealFields.length} deal fields, ${personFields.length} person fields, ${stagesRaw.length} stages`);

const [dealsRaw, personsRaw] = await Promise.all([
  pdAll('/deals', { status: 'all_not_deleted' }),
  pdAll('/persons'),
]);
console.log(`✓ fetched ${dealsRaw.length} deals, ${personsRaw.length} people`);

const dealMap = buildMapper(dealFields, 'Deal', lookups);
const personMap = buildMapper(personFields, 'Person', lookups);
const deals = dealsRaw.map(dealMap);
const people = personsRaw.map(personMap);

if (!SKIP_DETAIL) {
  // Products → "Deal - Product quantity/name/amount" (drives the licence numbers)
  console.log('· products…');
  const withProducts = dealsRaw.map((d, i) => ({ d, i })).filter(x => (x.d.products_count ?? 0) > 0);
  await pool(withProducts, 5, async ({ d, i }) => {
    const r = await pd(`/deals/${d.id}/products`, {});
    const items = r.data || [];
    if (!items.length) return;
    deals[i]['Deal - Product quantity'] = String(items.reduce((s, p) => s + (Number(p.quantity) || 0), 0));
    deals[i]['Deal - Product amount']   = String(items.reduce((s, p) => s + (Number(p.sum) || 0), 0));
    deals[i]['Deal - Product name']     = items.map(p => p.name).filter(Boolean).join(', ');
  });
  console.log(`  ✓ products for ${withProducts.length} deals`);

  // Stage history → the furthest stage each deal EVER reached. A CSV export only
  // has the current stage, so a lost deal's journey is erased; this restores it.
  console.log('· stage history…');
  await pool(dealsRaw, 5, async (d, i) => {
    const seen = new Set();
    if (d.stage_id != null) seen.add(d.stage_id);
    const r = await pd(`/deals/${d.id}/flow`, { limit: 100 });
    for (const item of (r.data || [])) {
      if (item.object !== 'dealChange') continue;
      const ch = item.data || {};
      if (ch.field_key !== 'stage_id') continue;
      for (const v of [ch.old_value, ch.new_value]) {
        const n = Number(v);
        if (Number.isFinite(n)) seen.add(n);
      }
    }
    const known = [...seen].filter(s => lookups.stages[s]);
    if (!known.length) return;
    // Record EVERY stage the deal ever sat in, ordered. We deliberately do not
    // reduce this to a single "furthest by order_nr" here: a pipeline that has a
    // terminal "Closed Lost" stage would make that stage win on order for every
    // lost deal, erasing the journey we came here to recover. The dashboard picks
    // the furthest stage that is an actual funnel stage.
    const ordered = known.sort((a, b) => lookups.stages[a].order - lookups.stages[b].order);
    deals[i]['Deal - Stages visited'] = ordered.map(s => lookups.stages[s].name).join(' | ');
    const last = ordered[ordered.length - 1];
    deals[i]['Deal - Max stage reached'] = lookups.stages[last].name;
    deals[i]['Deal - Max stage order']   = String(lookups.stages[last].order);
  });
  const moved = deals.filter(r => r['Deal - Max stage reached'] && r['Deal - Max stage reached'] !== r['Deal - Stage']).length;
  console.log(`  ✓ stage history done — ${moved} deals reached a stage beyond their current one`);
}

console.log('· writing to Supabase…');
const dc = await replaceTable('liq_pipedrive_deals', deals);
const pc = await replaceTable('liq_pipedrive_people', people);
console.log(`✓ done — ${dc} deals, ${pc} people in Supabase`);

// ── Sanity summary: the funnel the dashboard will now draw ───────────────────
// Printed every run so a bad sync is obvious in the log rather than silently
// producing a wrong-looking funnel in the dashboard.
if (!SKIP_DETAIL) {
  const FSALL = ['Contact Made/Discovery', 'Meeting Scheduled', 'Negotiations',
    'Order Form Sent', 'Signed Order Form Returned', 'Invoice Sent', 'Payment Received'];
  const fsIdx = Object.fromEntries(FSALL.map((s, i) => [s, i]));
  const sales = deals.filter(d => d['Deal - Pipeline'] === '2026 Sales');
  const furthest = d => {
    let best = -1;
    for (let nm of String(d['Deal - Stages visited'] || '').split('|')) {
      nm = nm.trim(); if (nm === 'Contact Made') nm = 'Contact Made/Discovery';
      const i = fsIdx[nm]; if (i != null && i > best) best = i;
    }
    return best;
  };
  const reached = (d, i) => d['Deal - Status'] === 'Won' || furthest(d) >= i;
  const counts = FSALL.map((_, i) => sales.filter(d => reached(d, i)).length);
  const withHist = sales.filter(d => d['Deal - Stages visited']).length;
  const lost = sales.filter(d => d['Deal - Status'] === 'Lost');
  const lostMid = lost.filter(d => furthest(d) > 0).length;

  // Distinct pipeline values, so a renamed/missing pipeline is obvious immediately.
  const pipeCounts = {};
  for (const d of deals) { const p = d['Deal - Pipeline'] ?? '(missing key)'; pipeCounts[p] = (pipeCounts[p] || 0) + 1; }
  console.log(`\n   pipelines seen: ${Object.entries(pipeCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `"${k}"=${v}`).join('  ')}`);
  const sampleKeys = Object.keys(deals[0] || {}).filter(k => /Pipeline|Stage|Status/i.test(k));
  console.log(`   related keys on a deal: ${JSON.stringify(sampleKeys)}`);

  console.log(`\n── 2026 Sales sanity check ──`);
  console.log(`   ${sales.length} deals · ${withHist} with stage history · ${lost.length} lost (${lostMid} of them got past first contact)`);
  console.log(`   reached-stage (all time): ${FSALL.map((s, i) => s.split(/[ /]/)[0] + '=' + counts[i]).join('  ')}`);
  if (!withHist) console.warn('   ⚠ no stage history on any 2026 Sales deal — the funnel will fall back to the CSV estimate');
  if (counts.some((c, i) => i && c > counts[i - 1])) console.warn('   ⚠ a later stage has MORE deals than an earlier one — that should be impossible');

  // ── People / paying-customer sanity check ──────────────────────────────────
  // The dashboard's "active paying seats" filters Customer Type === 'Paid
  // Subscription' exactly, so print the distinct Customer Type values (with
  // counts) — a relabelled or set-valued field shows up here instantly.
  const ctCounts = {};
  for (const p of people) { const v = p['Person - Customer Type'] ?? '(missing key)'; ctCounts[v] = (ctCounts[v] || 0) + 1; }
  const now = Date.now();
  const parse = s => { const d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? null : d; };
  const activePaid = people.filter(p => {
    if (p['Person - Customer Type'] !== 'Paid Subscription') return false;
    const rem = parse(p['Person - Date Access Removed']);
    return !rem || rem.getTime() > now;
  }).length;
  const paidAny = people.filter(p => /paid/i.test(p['Person - Customer Type'] || '')).length;
  console.log(`\n── People sanity check ──`);
  console.log(`   Customer Type values: ${Object.entries(ctCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `"${k}"=${v}`).join('  ')}`);
  console.log(`   active paying seats (exact 'Paid Subscription', access not removed): ${activePaid}`);
  console.log(`   people whose type merely CONTAINS "paid": ${paidAny}`);
  if (paidAny > activePaid * 1.15) console.warn(`   ⚠ ${paidAny - activePaid} people say "paid" but don't match exactly — likely a relabelled/multi-value Customer Type dropping out of the count`);
}
