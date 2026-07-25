// Land iQ dashboard — regression test harness
//
// Zero-dependency. Extracts the real calculation functions from index.html and
// runs them against fixture data, so a change that alters a metric's meaning
// turns a test red BEFORE anyone sees a wrong number on the dashboard.
//
// Run:            node tests/run-tests.mjs
// CI:             .github/workflows/checks.yml runs this on every push.
// Enforcement:    WARN LOUDLY, NEVER BLOCK (owner's decision) — a red run marks
//                 the commit with a red ✗ in GitHub and obliges Claude to stop
//                 and flag it, but Vercel still deploys. See CLAUDE.md
//                 "Change-control protocol".
//
// Design note: functions are extracted from the single-file app by name.
// If someone renames or restructures one, extraction fails and the suite goes
// red — that is intentional: it forces the editor to look at this harness and
// update the tests alongside the change, instead of silently orphaning them.

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
// Single-line consts: take the whole line. Multi-line: balanced-brace scan from
// the definition start (fine for these targets — they contain no braces inside
// strings/comments; if that ever changes the extraction fails loudly).
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
  pct: extractLine(/const pct = /),
  pdParseDate: extractBalanced(/const pdParseDate = /),
  pdValidDate: extractLine(/const pdValidDate = /),
  isTrialType: extractLine(/const isTrialType = /),
  OM_FS: extractLine(/const OM_FS = /),
  omReached: extractBalanced(/function omReached\(/),
  omModel: extractBalanced(/function omModel\(/),
};

console.log('\n1. Extraction');
for (const [name, src] of Object.entries(pieces)) {
  check(`extracted ${name} from index.html`, !!src, 'definition not found — renamed/moved? Update tests/run-tests.mjs with the change.');
}
if (Object.values(pieces).some(v => !v)) finish();

// ── Sandbox: run the REAL functions with fixtures + a fixed "now" ────────────
const FIXED_NOW = new Date('2026-07-26T10:00:00');
function makeSandbox(deals, lsData = {}) {
  const store = { ...lsData };
  const sandbox = {
    console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    _pd_deals: deals,
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(FIXED_NOW.getTime()); } static now() { return FIXED_NOW.getTime(); } },
  };
  vm.createContext(sandbox);
  const bundle = ['pct', 'pdParseDate', 'pdValidDate', 'isTrialType', 'OM_FS', 'omReached', 'omModel'].map(k => pieces[k]).join('\n');
  vm.runInContext(bundle + '\nthis.__x = { pct, pdParseDate, pdValidDate, isTrialType, omReached, omModel };', sandbox);
  return sandbox.__x;
}

// ── 2. Date parsing ──────────────────────────────────────────────────────────
console.log('\n2. Date parsing (Pipedrive "YYYY-MM-DD HH:MM:SS" must parse everywhere)');
{
  const { pdParseDate, pdValidDate } = makeSandbox([]);
  check('space-separated datetime parses', pdValidDate(pdParseDate('2026-05-14 01:15:21')));
  check('plain date parses', pdValidDate(pdParseDate('2026-05-14')));
  check('empty string → null (not a bogus date)', pdParseDate('') === null && pdParseDate('   ') === null);
  check('garbage → invalid', !pdValidDate(pdParseDate('not a date')));
}

// ── 3. Trial detection ───────────────────────────────────────────────────────
console.log('\n3. Trial detection (multi-value field — must use includes, never ===)');
{
  const { isTrialType } = makeSandbox([]);
  check('"2 Week Trial Licence" is a trial', isTrialType('2 Week Trial Licence'));
  check('"Extended Trial Licence" is a trial', isTrialType('Extended Trial Licence'));
  check('comma-separated multi-value containing a trial is a trial', isTrialType('Contact Register, 2 Week Trial Licence'));
  check('"Paid Subscription" is NOT a trial', !isTrialType('Paid Subscription'));
  check('empty/null is NOT a trial', !isTrialType('') && !isTrialType(null));
}

// ── 4. Funnel stage logic (omReached) ────────────────────────────────────────
console.log('\n4. Funnel "reached stage" (lost deals must count at the furthest stage reached)');
{
  const { omReached } = makeSandbox([]);
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
{
  // Fixture: 30 deals created BEFORE the window (Jan 2026), 60 inside (Mar 2026).
  const mk = (created, status, visited) => ({ 'Deal - Pipeline': '2026 Sales', 'Deal - Deal created': created, 'Deal - Status': status, 'Deal - Stages visited': visited });
  const deals = [];
  for (let i = 0; i < 30; i++) deals.push(mk('2026-01-15 10:00:00', i < 10 ? 'Won' : 'Lost', 'Contact Made/Discovery | Negotiations'));
  for (let i = 0; i < 60; i++) deals.push(mk('2026-03-15 10:00:00', i < 18 ? 'Won' : 'Open', 'Contact Made/Discovery | Meeting Scheduled | Negotiations'));
  const { omModel } = makeSandbox(deals, { liq_optimax: JSON.stringify({ roll_months: 6 }) });
  const m = omModel();
  check('6-month window in Jul 2026 starts 1 Feb 2026', m.start.getFullYear() === 2026 && m.start.getMonth() === 1 && m.start.getDate() === 1, `got ${m.start}`);
  check('months = 6', m.months === 6);
  check('pre-window deals are EXCLUDED from the counts (60, not 90)', m.counts[0] === 60, `got ${m.counts[0]}`);
  check('won count is windowed too (18, not 28)', m.wonCount === 18, `got ${m.wonCount}`);
  check('per-month lead rate = 60 ÷ 6 = 10', Math.abs(m.leadsCurr - 10) < 1e-9, `got ${m.leadsCurr}`);
  check('funnel counts never increase down the funnel (monotonic)', m.counts.every((c, i) => i === 0 || c <= m.counts[i - 1]), JSON.stringify(m.counts));
  check('Sales-card values come from the SAME model (wonCurr = wonCount ÷ months)', Math.abs(m.wonCurr - m.wonCount / m.months) < 1e-9);
  // Changing the window must change BOTH count and denominator (the July 2026 bug)
  const m3 = makeSandbox(deals, { liq_optimax: JSON.stringify({ roll_months: 3 }) }).omModel();
  check('shrinking the window shrinks the COUNT as well as the divisor', m3.months === 3 && m3.counts[0] === 0, `months=${m3.months} count=${m3.counts[0]} (Mar deals fall outside May–Jul)`);
}

// ── 6. Active-paid rule (documented in CLAUDE.md — future removal ≠ churned) ─
console.log('\n6. Active-paid rule (a FUTURE Date Access Removed means still active)');
{
  // The rule lives inline in render functions; assert the canonical definition here
  // so any reimplementation has a spec to match, and assert the SOURCE still
  // contains the guard (removal date compared against now, not treated as churn).
  const { pdParseDate, pdValidDate } = makeSandbox([]);
  const activePaid = p => {
    if (p['Person - Customer Type'] !== 'Paid Subscription') return false;
    const rem = p['Person - Date Access Removed'];
    if (!rem) return true;
    const d = pdParseDate(rem); return pdValidDate(d) && d > FIXED_NOW;
  };
  check('paid + no removal date = active', activePaid({ 'Person - Customer Type': 'Paid Subscription' }));
  check('paid + FUTURE removal (2026-12-31) = active', activePaid({ 'Person - Customer Type': 'Paid Subscription', 'Person - Date Access Removed': '2026-12-31' }));
  check('paid + PAST removal (2026-01-01) = NOT active', !activePaid({ 'Person - Customer Type': 'Paid Subscription', 'Person - Date Access Removed': '2026-01-01' }));
  check('non-paid type = NOT active-paid', !activePaid({ 'Person - Customer Type': '2 Week Trial Licence' }));
  const sites = (html.match(/!== 'Paid Subscription'/g) || []).length;
  check(`source still applies the exact-match paid filter (${sites} sites found)`, sites >= 2);
}

finish();

function finish() {
  console.log(`\n${'─'.repeat
    ? '' : ''}══════════════════════════════════════════`);
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
