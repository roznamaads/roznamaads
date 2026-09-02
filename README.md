# RoznamaAds.pk

Pakistani newspaper classified ads — digitized, AI-processed, and searchable.
Full product plan: see the project's Master Plan document (kept outside this repo).

## Stack
- **Frontend:** static HTML/CSS/JS (no build step, no framework)
- **Hosting:** Vercel (Hobby plan) — auto-deploys on push to `main`
- **Database + Storage:** Supabase (Postgres + Storage bucket `ad-images`)
- **AI:** Gemini API, called browser-side from the admin panel only (key stored in that browser's `localStorage`, never on the server)
- **Admin panel:** `admin/personal-toolkit.html` (password-gated, unlisted)

## Required Vercel Environment Variables

Set these under **Vercel → Project → Settings → Environment Variables**. They are used only by the serverless functions in `api/`, never exposed to the browser.

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | `api/admin/router.js`, `api/cron/expire-ads.js` | Same project URL as in `supabase-config.js`, but paired with the **service_role** key server-side |
| `SUPABASE_SERVICE_KEY` | `api/admin/router.js`, `api/cron/expire-ads.js` | Supabase **service_role** key — full DB access, bypasses Row Level Security. Never put this in any client-side file. |
| `ADMIN_API_SECRET` | `api/admin/router.js` | Shared secret the admin panel sends as the `x-admin-secret` header. Set/change it in the admin panel's System Settings tab and keep both in sync. |
| `CRON_SECRET` | `api/cron/expire-ads.js` | Set automatically by Vercel Cron; only needed if you're calling the cron endpoint manually for testing |

The **anon/publishable** Supabase key (in `supabase-config.js`, committed to the repo) is safe to expose publicly — it's restricted entirely by the Row Level Security policies documented in `supabase-schema.sql`, not by secrecy.

## Database

`supabase-schema.sql` in this repo is a reference copy of the `ads` and `ad_reports` table structure and RLS policies. It is **not run automatically** — it exists so the schema is version-controlled and can be recreated if ever needed. If you change columns or policies directly in the Supabase dashboard, update this file to match.

## Deployment Workflow

1. Write/edit code locally, test it
2. Package changed files via the Deployer tab in the admin panel (or manually via GitHub)
3. Push to the `roznamaads/roznamaads` GitHub repo in a single commit
4. Vercel auto-builds and deploys from the `main` branch

## Vercel Hobby Plan Limit

Hobby plan allows a maximum of 12 serverless functions per project. All admin actions are consolidated into `api/admin/router.js` (routed via a `vercel.json` rewrite) specifically to stay under this limit — avoid creating new files under `api/admin/` for individual actions; add a new `case` to the existing router instead.
