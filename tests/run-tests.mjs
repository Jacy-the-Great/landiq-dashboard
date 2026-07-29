// Land iQ dashboard — regression test harness
//
// Zero-dependency. Extracts the real calculation functions AND the metric
// registry from index.html and runs them against fixture data, so a change that
// alters a metric's meaning turns a test red BEFORE anyone sees a wrong number.
//
// Run:            node tests/run-tests.mjs
// CI:             .github/workflows/checks.yml runs this on every push.
// Enforcement:    WARN LOUDLY, NEVER BLOCK (owner's decision) — a red run marks
//                 the commit ✗ in GitHub and obliges Claude to stop and flag it,
//                 but Vercel still deploys. See CLAUDE.md "Change-control protocol".
//
// Design note: functions are extracted from the single-file app by name. If one
// is renamed or restructured, extraction fails and the suite goes red — that is
// intentional: it forces the editor to update the tests alongside the change.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── 0. Every inline <script> block parses ────────────────────────────────────
console.log('\n0. Syntax');
{
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let m, blocks = 0, bad = 0, msg = '';
  while ((m = re.exec(html))) {
    blocks++;
    const open = m[0].slice(0, m[0].indexOf('>'));
    if (!m[1].trim() || /\bsrc=/.test(open)) continue;
    try { new Function(m[1]); } catch (e) { bad++; msg = e.message; }
  }
  check(`all ${blocks} inline script blocks parse`, bad === 0, msg);
}

// ── Function extraction ──────────────────────────────────────────────────────
function extractLine(startPat) {
  const i = html.search(startPat);
  if (i < 0) return null;
  return html.slice(i, html.indexOf('\n', i) + 1);
}
function extractBalanced(startPat) {
  const i = html.search(startPat);
  if (i < 0) return null;
  let depth = 0, seen = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return html.slice(i, j + 1) + '\n'; }
  }
  return null;
}

const pieces = {
  FY27_DEF: extractBalanced(/const FY27_DEF = \{/),
  fy27: extractBalanced(/function fy27\(\) \{/),
  fy27Range: extractBalanced(/function fy27Range\(\) \{/),
  NON_NEW_BUSINESS_PIPELINES: extractLine(/const NON_NEW_BUSINESS_PIPELINES = /),
  isNewBusinessPipeline: extractBalanced(/function isNewBusinessPipeline\(/),
  numOr: extractLine(/const numOr = /),
  pct: extractLine(/const pct = /),
  pdParseDate: extractBalanced(/const pdParseDate = /),
  pdValidDate: extractLine(/const pdValidDate = /),
  isTrialType: extractLine(/const isTrialType = /),
  OM_FS: extractLine(/const OM_FS = /),
  omReached: extractBalanced(/function omReached\(/),
  omModel: extractBalanced(/function omModel\(/),
  METRICS: extractBalanced(/const METRICS = \{/),
  mVal: extractBalanced(/function mVal\(/),
  mTest: extractBalanced(/function mTest\(/),
  mDoc: extractBalanced(/function mDoc\(/),
};

console.log('\n1. Extraction');
for (const [name, src] of Object.entries(pieces)) {
  check(`extracted ${name} from index.html`, !!src, 'definition not found — renamed/moved? Update tests/run-tests.mjs with the change.');
}
if (Object.values(pieces).some(v => !v)) finish();

// ── Sandbox: run the REAL functions with fixtures + a fixed "now" ────────────
const FIXED_NOW = new Date('2026-07-26T10:00:00');
function makeSandbox({ deals = [], people = [], ph = { weekly: [] }, ls = {} } = {}) {
  const store = { ...ls };
  const sandbox = {
    console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    _pd_deals: deals, _pd_people: people, _ph: ph,
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(FIXED_NOW.getTime()); } static now() { return FIXED_NOW.getTime(); } },
  };
  vm.createContext(sandbox);
  const bundle = ['FY27_DEF', 'fy27', 'fy27Range', 'NON_NEW_BUSINESS_PIPELINES', 'isNewBusinessPipeline', 'numOr', 'pct', 'pdParseDate', 'pdValidDate', 'isTrialType', 'OM_FS', 'omReached', 'omModel', 'METRICS', 'mVal', 'mTest', 'mDoc']
    .map(k => pieces[k]).join('\n');
  vm.runInContext(bundle + '\nthis.__x = { pct, pdParseDate, pdValidDate, isTrialType, omReached, omModel, METRICS, mVal, mTest, mDoc, numOr, isNewBusinessPipeline };', sandbox);
  return sandbox.__x;
}

// ── 2. Date parsing ──────────────────────────────────────────────────────────
console.log('\n2. Date parsing (Pipedrive "YYYY-MM-DD HH:MM:SS" must parse everywhere)');
{
  const { pdParseDate, pdValidDate } = makeSandbox();
  check('space-separated datetime parses', pdValidDate(pdParseDate('2026-05-14 01:15:21')));
  check('plain date parses', pdValidDate(pdParseDate('2026-05-14')));
  check('empty string → null (not a bogus date)', pdParseDate('') === null && pdParseDate('   ') === null);
  check('garbage → invalid', !pdValidDate(pdParseDate('not a date')));
}

// ── 3. Trial detection ───────────────────────────────────────────────────────
console.log('\n3. Trial detection (multi-value field — must use includes, never ===)');
{
  const { isTrialType } = makeSandbox();
  check('"2 Week Trial Licence" is a trial', isTrialType('2 Week Trial Licence'));
  check('"Extended Trial Licence" is a trial', isTrialType('Extended Trial Licence'));
  check('comma-separated multi-value containing a trial is a trial', isTrialType('Contact Register, 2 Week Trial Licence'));
  check('"Paid Subscription" is NOT a trial', !isTrialType('Paid Subscription'));
  check('empty/null is NOT a trial', !isTrialType('') && !isTrialType(null));
}

// ── 4. Funnel stage logic (omReached) ────────────────────────────────────────
console.log('\n4. Funnel "reached stage" (lost deals must count at the furthest stage reached)');
{
  const { omReached } = makeSandbox();
  const lostDeep = { 'Deal - Status': 'Lost', 'Deal - Stage': 'Closed Lost', 'Deal - Stages visited': 'Contact Made/Discovery | Meeting Scheduled | Negotiations | Closed Lost' };
  check('lost deal that reached Negotiations counts at stages 0–2', omReached(lostDeep, 0) && omReached(lostDeep, 1) && omReached(lostDeep, 2));
  check('…and NOT beyond (Closed Lost must not inflate the funnel)', !omReached(lostDeep, 3) && !omReached(lostDeep, 6));
  check('won deal counts at every stage', omReached({ 'Deal - Status': 'Won' }, 6));
  const noHist = { 'Deal - Status': 'Lost', 'Deal - Stage': 'Closed Lost' };
  check('lost deal with NO history counts at entry only (CSV fallback)', omReached(noHist, 0) && !omReached(noHist, 1));
  const openMid = { 'Deal - Status': 'Open', 'Deal - Stage': 'Order Form Sent' };
  check('open deal at Order Form counts through stage 3, not 4', omReached(openMid, 3) && !omReached(openMid, 4));
  check('"Contact Made" stage alias maps to Contact Made/Discovery', omReached({ 'Deal - Status': 'Open', 'Deal - Stage': 'Contact Made' }, 0));
}

// ── 5. Rolling-window model (omModel) ────────────────────────────────────────
console.log('\n5. OPTI-MAX rolling window (numerator and denominator must cover the SAME period)');
const mkDeal = (created, status, visited) => ({ 'Deal - Pipeline': '2026 Sales', 'Deal - Deal created': created, 'Deal - Status': status, 'Deal - Stages visited': visited });
const windowDeals = [];
for (let i = 0; i < 30; i++) windowDeals.push(mkDeal('2026-01-15 10:00:00', i < 10 ? 'Won' : 'Lost', 'Contact Made/Discovery | Negotiations'));
for (let i = 0; i < 60; i++) windowDeals.push(mkDeal('2026-03-15 10:00:00', i < 18 ? 'Won' : 'Open', 'Contact Made/Discovery | Meeting Scheduled | Negotiations'));
{
  const { omModel } = makeSandbox({ deals: windowDeals, ls: { liq_optimax: JSON.stringify({ roll_months: 6 }) } });
  const m = omModel();
  check('6-month window in Jul 2026 starts 1 Feb 2026', m.start.getFullYear() === 2026 && m.start.getMonth() === 1 && m.start.getDate() === 1, `got ${m.start}`);
  check('months = 6', m.months === 6);
  check('pre-window deals are EXCLUDED from the counts (60, not 90)', m.counts[0] === 60, `got ${m.counts[0]}`);
  check('won count is windowed too (18, not 28)', m.wonCount === 18, `got ${m.wonCount}`);
  check('per-month lead rate = 60 ÷ 6 = 10', Math.abs(m.leadsCurr - 10) < 1e-9, `got ${m.leadsCurr}`);
  check('funnel counts never increase down the funnel (monotonic)', m.counts.every((c, i) => i === 0 || c <= m.counts[i - 1]), JSON.stringify(m.counts));
  check('Sales-card values come from the SAME model (wonCurr = wonCount ÷ months)', Math.abs(m.wonCurr - m.wonCount / m.months) < 1e-9);
  const m3 = makeSandbox({ deals: windowDeals, ls: { liq_optimax: JSON.stringify({ roll_months: 3 }) } }).omModel();
  check('shrinking the window shrinks the COUNT as well as the divisor', m3.months === 3 && m3.counts[0] === 0, `months=${m3.months} count=${m3.counts[0]} (Mar deals fall outside May–Jul)`);
}

// ── 6. Metric registry — the REAL definitions, on fixtures ───────────────────
console.log('\n6. Metric registry (single source of truth for value AND tooltip)');
{
  const people = [
    { 'Person - Customer Type': 'Paid Subscription' },                                                        // active (no removal)
    { 'Person - Customer Type': 'Paid Subscription', 'Person - Date Access Removed': '2026-12-31' },          // active (future expiry)
    { 'Person - Customer Type': 'Paid Subscription', 'Person - Date Access Removed': '2026-01-01' },          // NOT active (past)
    { 'Person - Customer Type': 'Paid Subscription', 'Person - Date Access Removed': 'garbage-date' },        // NOT active (unparseable)
    { 'Person - Customer Type': '2 Week Trial Licence' },                                                     // active trial
    { 'Person - Customer Type': 'Extended Trial Licence', 'Person - Date Access Removed': '2026-01-01' },     // ended trial
    { 'Person - Customer Type': 'Contact Register' },
  ];
  const phWeekly = { weekly: [
    { week_start: '2026-07-06', active_users: 81, active_engaged: 30 },   // complete week
    { week_start: '2026-07-20', active_users: 33, active_engaged: 9 },    // PARTIAL (now = Sun 26 Jul; week ends 27 Jul)
  ] };
  const x = makeSandbox({ deals: windowDeals, people, ph: phWeekly, ls: { liq_optimax: JSON.stringify({ roll_months: 6 }) } });

  const need = ['label', 'src', 'desc', 'formula', 'compute'];
  const bad = Object.entries(x.METRICS).filter(([, m]) => !need.every(k => m[k]));
  check(`every registry entry declares label/src/desc/formula/compute (${Object.keys(x.METRICS).length} entries)`, bad.length === 0, bad.map(([k]) => k).join(','));

  check('active_paid = 2 (future expiry active; past + unparseable NOT)', x.mVal('active_paid') === 2, `got ${x.mVal('active_paid')}`);
  check('active_trials = 1 (ended trial excluded)', x.mVal('active_trials') === 1, `got ${x.mVal('active_trials')}`);
  check('close_rate = 28 won ÷ (28+20 closed) ≈ 58.3% — all-time, open deals excluded', Math.abs(x.mVal('close_rate') - (28 / (28 + 20) * 100)) < 0.01, `got ${x.mVal('close_rate')}`);
  check('win_rate = windowed 18 ÷ 60 = 30%', Math.abs(x.mVal('win_rate') - 30) < 1e-9, `got ${x.mVal('win_rate')}`);
  check('monthly_leads = 10/mo (same model as OPTI-MAX table)', Math.abs(x.mVal('monthly_leads') - 10) < 1e-9);
  check('active_users_week uses the LAST COMPLETE week (81, not partial 33)', x.mVal('active_users_week') === 81, `got ${x.mVal('active_users_week')}`);
  check('active_engaged_week from the same complete week (30)', x.mVal('active_engaged_week') === 30, `got ${x.mVal('active_engaged_week')}`);
  check('tooltip body is generated from the registry (mDoc contains src + formula)',
    x.mDoc('active_paid').includes(x.METRICS.active_paid.src) && x.mDoc('active_paid').includes(x.METRICS.active_paid.formula));
}

// ── 6b. FY2026-27 model metrics (targets from the FY27 forecast email) ───────
console.log('\n6b. FY27 model (window edges, retention, margin)');
{
  const fyDeals = [
    // margin fixture: 2026 Sales, won BEFORE FY27 (so they don't pollute fy27_revenue)
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Won', 'Deal - Won time': '2026-03-01 10:00:00', 'Deal - Value': '8000', 'Deal - Product quantity': '1' },
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Won', 'Deal - Won time': '2026-04-01 10:00:00', 'Deal - Value': '8000', 'Deal - Product quantity': '1' },
    // FY27 window edges — new-business pipeline
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Won', 'Deal - Won time': '2026-06-30 23:00:00', 'Deal - Value': '1000', 'Deal - Product quantity': '9' },  // day BEFORE FY27 → excluded
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Won', 'Deal - Won time': '2026-07-01 09:00:00', 'Deal - Value': '4000', 'Deal - Product quantity': '2' },  // first day → included
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Won', 'Deal - Won time': '2027-06-30 12:00:00', 'Deal - Value': '8000', 'Deal - Product quantity': '3' },  // last day → included
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Won', 'Deal - Won time': '2027-07-01 09:00:00', 'Deal - Value': '999',  'Deal - Product quantity': '9' },  // FY28 → excluded
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Open' },                                                                                                    // open → excluded
    // Renewal won INSIDE FY27: revenue counts toward $1.61M, seats must NOT count as "new"
    { 'Deal - Pipeline': '2027 Renewals', 'Deal - Status': 'Won', 'Deal - Won time': '2026-09-01 10:00:00', 'Deal - Value': '6000', 'Deal - Product quantity': '7' },
  ];
  const fyPeople = [
    // pre-FY27 cohort, churned inside FY27 → the only one that reduces retention
    { 'Person - Customer Type': 'Access Revoked', 'Person - Previous Customer Type': 'Contact Register, Paid Subscription', 'Person - Date Access Granted': '2025-09-01', 'Person - Date Access Removed': '2026-08-01' },
    { 'Person - Customer Type': 'Access Revoked', 'Person - Previous Customer Type': 'Paid Subscription', 'Person - Date Access Granted': '2025-09-01', 'Person - Date Access Removed': '2026-05-01' }, // churned BEFORE FY27 → no
    { 'Person - Customer Type': 'Access Revoked', 'Person - Previous Customer Type': '2 Week Trial Licence', 'Person - Date Access Granted': '2025-09-01', 'Person - Date Access Removed': '2026-08-01' }, // trial churn → no
    // acquired DURING FY27 then churned → must NOT decrement the pre-existing base
    { 'Person - Customer Type': 'Access Revoked', 'Person - Previous Customer Type': 'Paid Subscription', 'Person - Date Access Granted': '2026-08-15', 'Person - Date Access Removed': '2027-01-10' },
    { 'Person - Customer Type': 'Paid Subscription' },
  ];
  const x = makeSandbox({ deals: fyDeals, people: fyPeople });
  check('FY27 revenue counts 1 Jul 2026 → 30 Jun 2027 only, all pipelines (4000+8000+6000=18000)', x.mVal('fy27_revenue') === 18000, `got ${x.mVal('fy27_revenue')}`);
  check('FY27 new licences windowed the same way (2+3=5)', x.mVal('fy27_new_licences') === 5, `got ${x.mVal('fy27_new_licences')}`);
  check('renewal seats do NOT count as new licences (the 7-seat renewal is excluded)', x.mVal('fy27_new_licences') === 5, `got ${x.mVal('fy27_new_licences')} — renewal leaked in`);
  check('isNewBusinessPipeline: 2026 Sales yes; renewals/onboarding/internal no',
    x.isNewBusinessPipeline('2026 Sales') && x.isNewBusinessPipeline('Cold Outreach')
    && !x.isNewBusinessPipeline('2027 Renewals') && !x.isNewBusinessPipeline('General Onboarding Pipeline') && !x.isNewBusinessPipeline('WSP Internal Pipeline'));
  check('base retention = 180 − 1 (only the pre-FY27 cohort churn counts) = 179', x.mVal('fy27_base_retention') === 179, `got ${x.mVal('fy27_base_retention')}`);
  check('a customer WON during FY27 who churns does not reduce the base', x.mVal('fy27_base_retention') === 179, `got ${x.mVal('fy27_base_retention')} — FY27-acquired churn leaked in`);
  // Margin gets its OWN fixture: it reads every won 2026-Sales deal, so sharing
  // the FY27 window fixture above would silently change the expected average.
  const marginDeals = [
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Won', 'Deal - Won time': '2026-03-01 10:00:00', 'Deal - Value': '8000', 'Deal - Product quantity': '1' },
    { 'Deal - Pipeline': '2026 Sales', 'Deal - Status': 'Won', 'Deal - Won time': '2026-04-01 10:00:00', 'Deal - Value': '8000', 'Deal - Product quantity': '1' },
  ];
  const xm = makeSandbox({ deals: marginDeals });
  const margin = xm.mVal('licence_margin');   // avg price 16000÷2=8000; (8000−3499)÷8000 = 56.2625%
  check('licence margin = (8000−3499)÷8000 ≈ 56.3%', margin != null && Math.abs(margin - 56.2625) < 0.01, `got ${margin}`);
  const xm2 = makeSandbox({ deals: marginDeals, ls: { liq_fy27: JSON.stringify({ cost_per_licence_now: 584 }) } });
  check('config override flows through (3.0 cost $584 → margin ≈ 92.7%)', Math.abs(xm2.mVal('licence_margin') - ((8000 - 584) / 8000 * 100)) < 0.01, `got ${xm2.mVal('licence_margin')}`);
}

// ── 6c. Zero-vs-no-data and the empty-value placeholder ─────────────────────
console.log('\n6c. Zero is a real number; "no data" means absent source');
{
  const { numOr } = makeSandbox();
  check('numOr(0, hasSource) === 0 (renders "0", not "no data")', numOr(0, true) === 0);
  check('numOr(5, hasSource) === 5', numOr(5, true) === 5);
  check('numOr(anything, no source) === null (renders "no data")', numOr(0, false) === null && numOr(7, false) === null);
  check('numOr(null/undefined, hasSource) === 0', numOr(null, true) === 0 && numOr(undefined, true) === 0);
  // cardHTML must test disp against null, not truthiness, or a formatted "0" could vanish
  check('cardHTML renders on `disp != null` (not truthiness)', /\$\{disp != null \?/.test(html),
    'cardHTML reverted to a truthy check — a zero value would render as "no data"');
  // The bare-colon placeholder must not come back
  const colonPlaceholders = (html.match(/[:?]\s*':'/g) || []).length;
  check('no bare-colon empty-value placeholders remain (em dash instead)', colonPlaceholders === 0,
    `found ${colonPlaceholders} — use '—' for empty values`);
}

// ── 7. Drift guards — render sites must USE the registry ─────────────────────
console.log('\n7. Drift guards (no second copies of registry logic in render code)');
{
  const inlinePaidFilters = (html.match(/!== 'Paid Subscription'/g) || []).length;
  check('the active-paid predicate exists ONCE (in the registry) — no inline copies', inlinePaidFilters === 1,
    `found ${inlinePaidFilters}; a new inline copy of the paid filter was added — use mTest('active_paid') instead`);
  const mTestUses = (html.match(/mTest\('active_paid'\)/g) || []).length;
  const mValPaid = (html.match(/mVal\('active_paid'\)/g) || []).length;
  check(`render sites consume the registry (mTest×${mTestUses} + mVal×${mValPaid} ≥ 5)`, mTestUses + mValPaid >= 5);
  const mDocUses = (html.match(/mDoc\('/g) || []).length;
  check(`card tooltips are registry-generated (mDoc used ${mDocUses}×, ≥ 5)`, mDocUses >= 5);
}

finish();

function finish() {
  console.log('\n══════════════════════════════════════════');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\n⚠  FAILURES — a documented behaviour has changed:');
    for (const f of fails) console.log('   ✗ ' + f);
    console.log('\nPer CLAUDE.md change-control: STOP, do not quietly "fix" the test.');
    console.log('Either the edit broke real behaviour (revert/fix the code), or the');
    console.log('behaviour was changed ON PURPOSE — in which case flag it to the owner');
    console.log('with the consequences, get a decision, then update the test + DECISIONS.md.');
    process.exit(1);
  }
  process.exit(0);
}
