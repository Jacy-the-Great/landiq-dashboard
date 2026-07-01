// Weekly Brief — Supabase Edge Function
// Builds a short weekly summary from the Pipedrive tables and emails it via Resend.
//
// Deploy + schedule instructions are in: supabase/functions/weekly-brief/README.md
//
// Required secrets (set with `supabase secrets set ...`):
//   RESEND_API_KEY   — your Resend API key
//   BRIEF_TO         — comma-separated recipient emails
//   BRIEF_FROM       — verified Resend sender, e.g. "Land iQ <brief@yourdomain.com>"
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TARGET_USERS = 600;
const TARGET_ARR = 2_400_000;

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const fmtCur = (n: number) =>
  n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1000 ? "$" + (n / 1000).toFixed(0) + "k" : "$" + Math.round(n);

async function fetchAll(sb: any, table: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb.from(table).select("raw").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    out.push(...data.map((r: any) => r.raw));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

Deno.serve(async () => {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [deals, people] = await Promise.all([
      fetchAll(sb, "liq_pipedrive_deals"),
      fetchAll(sb, "liq_pipedrive_people"),
    ]);

    const now = new Date();
    const isTrial = (s: string) => !!(s && s.toLowerCase().includes("trial"));
    const activePaid = people.filter((p) => {
      if (p["Person - Customer Type"] !== "Paid Subscription") return false;
      const rem = parseDate(p["Person - Date Access Removed"]);
      return !rem || rem > now;
    });

    const wonThisMonth = deals.filter((d) => {
      if (d["Deal - Status"] !== "Won" || d["Deal - Pipeline"] !== "2026 Sales") return false;
      const dt = parseDate(d["Deal - Won time"]);
      return dt && dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
    });
    const revThisMonth = wonThisMonth.reduce((s, d) => s + (parseFloat(d["Deal - Value"]) || 0), 0);
    const totalBooked = deals
      .filter((d) => d["Deal - Status"] === "Won")
      .reduce((s, d) => s + (parseFloat(d["Deal - Value"]) || 0), 0);

    // Renewals due in next 30 days (next anniversary of access granted)
    const cut = new Date(now); cut.setDate(cut.getDate() + 30);
    const renewals = new Set<string>();
    activePaid.forEach((p) => {
      const g = parseDate(p["Person - Date Access Granted"]);
      if (!g) return;
      const r = new Date(g);
      while (r < now) r.setFullYear(r.getFullYear() + 1);
      if (r <= cut) renewals.add((p["Person - Organisation"] || "Unknown").trim());
    });

    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a2530">
        <h2 style="color:#1a3c5e">Land iQ — weekly brief</h2>
        <p style="color:#667">${now.toDateString()}</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;border-bottom:1px solid #eee">Active paying customers</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">${activePaid.length} / ${TARGET_USERS} (${pct(activePaid.length, TARGET_USERS)}%)</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee">Won deals this month</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">${wonThisMonth.length}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee">Revenue this month</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">${fmtCur(revThisMonth)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee">Total contracted revenue</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">${fmtCur(totalBooked)} / $2.4M (${pct(totalBooked, TARGET_ARR)}%)</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee">Renewals due in 30 days</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">${renewals.size} organisation(s)</td></tr>
        </table>
        <p style="margin-top:16px"><a href="https://landiq-dashboard.vercel.app" style="color:#2e8bc0">Open the full dashboard →</a></p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("BRIEF_FROM") || "Land iQ <onboarding@resend.dev>",
        to: (Deno.env.get("BRIEF_TO") || "").split(",").map((s) => s.trim()).filter(Boolean),
        subject: `Land iQ weekly brief — ${activePaid.length} paying customers`,
        html,
      }),
    });
    const body = await resp.json();
    return new Response(JSON.stringify({ ok: resp.ok, resend: body }), {
      status: resp.ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
