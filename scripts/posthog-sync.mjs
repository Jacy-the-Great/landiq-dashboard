// PostHog → Supabase summary sync
// Pulls small aggregates from the PostHog API and writes them into the
// public.ph_* summary tables. Run nightly by .github/workflows/posthog-sync.yml,
// or locally with:  node scripts/posthog-sync.mjs
//
// Env vars (set as GitHub secrets):
//   POSTHOG_API_KEY              personal API key (query/read scope)
//   POSTHOG_PROJECT_ID           numeric project id
//   SUPABASE_SERVICE_ROLE_KEY    service-role key (write access)
// Optional:
//   POSTHOG_HOST   default https://us.posthog.com
//   SUPABASE_URL   default https://ysdonnjezvoyrrizadik.supabase.co

const PH_HOST   = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const PH_KEY    = process.env.POSTHOG_API_KEY;
const PH_PROJ   = process.env.POSTHOG_PROJECT_ID || '307005';
const SB_URL    = process.env.SUPABASE_URL || 'https://ysdonnjezvoyrrizadik.supabase.co';
const SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!PH_KEY || !PH_PROJ || !SB_KEY) {
  console.error('Missing env vars. Need POSTHOG_API_KEY, POSTHOG_PROJECT_ID, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

// ── Run one HogQL query against PostHog, return array of row-objects ─────────
async function hogql(query) {
  const res = await fetch(`${PH_HOST}/api/projects/${PH_PROJ}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) throw new Error(`PostHog query failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  const cols = json.columns || [];
  return (json.results || []).map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// ── Replace a whole Supabase table (delete all, then bulk insert) ────────────
async function replaceTable(table, pkCol, rows) {
  const del = await fetch(`${SB_URL}/rest/v1/${table}?${pkCol}=not.is.null`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'return=minimal' },
  });
  if (!del.ok && del.status !== 404) throw new Error(`Delete ${table} failed (${del.status}): ${await del.text()}`);
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const ins = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(batch),
    });
    if (!ins.ok) throw new Error(`Insert ${table} failed (${ins.status}): ${await ins.text()}`);
  }
  console.log(`  ${table}: wrote ${rows.length} rows`);
}

const EXCLUDE = `event NOT LIKE '$%' AND event NOT LIKE '%click%' AND event NOT IN ('$web_vitals','$dead_click','$rageclick','$pageleave')`;

async function main() {
  console.log('Pulling summaries from PostHog…');

  console.log('• user lifecycle');
  // email: from PostHog person properties where set; else the distinct_id itself
  // when it already looks like an email address. Used to link usage to customers.
  const lifecycleCols = `
           min(toDate(timestamp))              AS first_seen,
           max(toDate(timestamp))              AS last_seen,
           count(distinct toDate(timestamp))   AS active_days,
           count()                             AS total_events,
           toStartOfWeek(min(timestamp), 1)    AS cohort_week,
           toStartOfMonth(min(timestamp))      AS cohort_month`;
  let lifecycle;
  try {
    lifecycle = await hogql(`
      SELECT distinct_id, ${lifecycleCols},
             any(person.properties.email)      AS email
      FROM events GROUP BY distinct_id LIMIT 1000000`);
  } catch (e) {
    console.warn('  person email join unavailable, falling back to distinct_id only:', e.message.slice(0, 120));
    lifecycle = await hogql(`
      SELECT distinct_id, ${lifecycleCols}, NULL AS email
      FROM events GROUP BY distinct_id LIMIT 1000000`);
  }
  const lifecycleRows = lifecycle.map(r => {
    const did = String(r.distinct_id);
    const email = (r.email && String(r.email).includes('@')) ? String(r.email).toLowerCase()
                : (did.includes('@') ? did.toLowerCase() : null);
    return {
      distinct_id: did, first_seen: r.first_seen, last_seen: r.last_seen,
      active_days: r.active_days, total_events: r.total_events,
      cohort_week: r.cohort_week, cohort_month: r.cohort_month,
      email,
    };
  });
  try {
    await replaceTable('ph_lifecycle', 'distinct_id', lifecycleRows);
  } catch (e) {
    if (!String(e.message).includes('email')) throw e;
    // email column not added yet (posthog_add_emails.sql not run) — sync without it
    console.warn('  ph_lifecycle has no email column yet — run posthog_add_emails.sql to enable customer matching');
    await replaceTable('ph_lifecycle', 'distinct_id', lifecycleRows.map(({ email, ...rest }) => rest));
  }

  console.log('• daily');
  const daily = await hogql(`
    SELECT toDate(timestamp) AS day,
           count(distinct distinct_id) AS active_users,
           count() AS total_events,
           count(distinct if(event = '$identify', distinct_id, NULL)) AS login_users
    FROM events GROUP BY day ORDER BY day LIMIT 100000`);
  await replaceTable('ph_daily', 'day', daily);

  console.log('• weekly');
  const weekly = await hogql(`
    SELECT toStartOfWeek(timestamp, 1) AS week_start,
           count(distinct distinct_id) AS active_users,
           count() AS total_events,
           count(distinct if(event = '$identify', distinct_id, NULL)) AS login_users
    FROM events GROUP BY week_start ORDER BY week_start LIMIT 100000`);
  await replaceTable('ph_weekly', 'week_start', weekly);

  console.log('• monthly');
  const monthly = await hogql(`
    SELECT toStartOfMonth(timestamp) AS month_start, count(distinct distinct_id) AS mau
    FROM events GROUP BY month_start ORDER BY month_start LIMIT 100000`);
  await replaceTable('ph_monthly', 'month_start', monthly);

  console.log('• feature daily (last 180 days)');
  const featDaily = await hogql(`
    SELECT toDate(timestamp) AS day,
           splitByChar('.', event)[1] AS feature,
           event AS event_name,
           count(distinct distinct_id) AS active_users,
           count() AS events
    FROM events
    WHERE timestamp >= now() - INTERVAL 180 DAY AND ${EXCLUDE}
    GROUP BY day, feature, event_name LIMIT 500000`);
  await replaceTable('ph_feature_daily', 'day', featDaily);

  console.log('• feature adoption (all time)');
  const adoption = await hogql(`
    SELECT splitByChar('.', event)[1] AS feature, count(distinct distinct_id) AS users_who_tried
    FROM events WHERE ${EXCLUDE} GROUP BY feature LIMIT 100000`);
  await replaceTable('ph_feature_adoption_tbl', 'feature', adoption);

  console.log('Done. Summaries updated.');
}

main().catch(e => { console.error('SYNC FAILED:', e.message); process.exit(1); });
