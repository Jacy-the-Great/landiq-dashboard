# Weekly Brief email (Resend)

Sends a short weekly summary email built from the Pipedrive tables. Runs as a
Supabase Edge Function, triggered every Friday by a scheduled job.

You need to run these steps once — they need your Supabase login and Resend key,
so they can't be done from the dashboard.

## 1. Set the secrets

```bash
cd /Users/jacymacnee/Desktop/landiq-dashboard
supabase login                      # opens browser, one time
supabase link --project-ref ysdonnjezvoyrrizadik

supabase secrets set RESEND_API_KEY="re_xxxxxxxx"          # from resend.com/api-keys
supabase secrets set BRIEF_TO="jacymacnee1@gmail.com,james.strutt@dpie.nsw.gov.au"
supabase secrets set BRIEF_FROM="Land iQ <brief@yourverifieddomain.com>"
```

`BRIEF_FROM` must use a domain you've verified in Resend. To test before verifying
a domain, use `Land iQ <onboarding@resend.dev>` (Resend's sandbox sender).

## 2. Deploy the function

```bash
supabase functions deploy weekly-brief
```

Test it immediately:

```bash
curl -X POST "https://ysdonnjezvoyrrizadik.supabase.co/functions/v1/weekly-brief" \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY"
```

You should get `{"ok":true,...}` and an email should arrive.

## 3. Schedule it weekly

Run `weekly_brief_cron.sql` (in the project root) in the Supabase SQL editor.
It uses `pg_cron` + `pg_net` to call the function every Friday at 8am Sydney time.
