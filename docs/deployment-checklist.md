# Production Deployment Checklist

This app is a static Vite PWA with Supabase Auth and Postgres. A successful local build does not verify production environment settings, deployed RLS policies, or account isolation.

## Before deploying

- [ ] Confirm the Supabase project is the intended production project.
- [ ] In Supabase, run `supabase/schema.sql` in the SQL Editor. Do not rerun it on a populated project without first checking for existing triggers and policies; this script's policy and trigger creation is not fully idempotent.
- [ ] Confirm Row Level Security is enabled for `profiles`, `notes`, `notebooks`, `note_tags`, `reminders`, `attachments`, and `sync_queue`.
- [ ] Confirm the policies in `supabase/schema.sql` are present and scoped to `auth.uid()`.
- [ ] Set the Supabase Auth Site URL to the production app URL and add production and preview URLs to the allowed redirect URLs as needed.
- [ ] Ensure email confirmation and password recovery settings match the intended sign-in experience.

Use this read-only query in the Supabase SQL Editor to inspect RLS enablement:

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'notes', 'notebooks', 'note_tags',
    'reminders', 'attachments', 'sync_queue'
  )
order by c.relname;
```

Inspect the configured policies:

```sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'notes', 'notebooks', 'note_tags',
    'reminders', 'attachments', 'sync_queue'
  )
order by tablename, policyname;
```

## Vercel project settings

- Framework preset: **Vite**
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `dist`
- Add these environment variables for both Preview and Production:
  - `VITE_SUPABASE_URL`: the production Supabase project URL
  - `VITE_SUPABASE_ANON_KEY`: that project's publishable/anon client key
- Never put a Supabase `service_role` key in a `VITE_` variable or in client-side code.

Deploy a Preview first. Verify it points at the intended Supabase project before promoting it to Production. Environment variable changes require a new deployment.

This workspace has a Git repository and an `origin` remote. Before a Vercel Git-based deployment, confirm the remote points to the intended provider and authenticate an authorized GitHub/Vercel workflow. Alternatively, use an already-authorized deployment workflow.

## Post-deployment verification

- [ ] Open the production URL over HTTPS and confirm the app loads without console or network errors.
- [ ] Sign in and verify the session persists after a full page reload.
- [ ] Create and edit a note online; confirm it appears on another reload.
- [ ] Create or edit a note offline, reconnect, and confirm the note syncs.
- [ ] Test account isolation with two authorized test accounts: each account must see only its own notes. Do not use production users' private data for this test.
- [ ] Install the PWA on a mobile browser and verify launch and offline app-shell behavior.
- [ ] On Android, open the HTTPS app in Chrome and use the browser menu's **Install app** / **Add to Home screen** action. Launch the installed app, sign in with a test account, create a test note, enable airplane mode, verify the app shell and note remain available, then reconnect and confirm sync.
- [ ] On iPhone, open the HTTPS app in Safari, use **Share → Add to Home Screen**, launch it from the Home Screen, and repeat the signed-in offline/reconnect note check. Verify the app remains usable after closing and reopening it.
- [ ] Record device model, OS/browser versions, install outcome, offline/reconnect outcome, and any console or sync errors. Browser viewport emulation does not replace these physical-device checks.
- [ ] Check the Vercel deployment logs and Supabase Auth/database logs for failures.

## Verification boundary

The local production build, offline note persistence, and offline PWA app-shell reload have been checked. A dedicated Supabase test account was used to verify sign-in persistence across reloads, online note upload and remote pull after clearing local IndexedDB, and offline edit/reconnect sync. Temporary test notes for that account were soft-deleted and a fresh pull showed no active notes. An existing Vercel production deployment (`https://notes-pwa-bice.vercel.app/`) is Ready from the `main` branch; the deployed HTTPS app and service-worker offline reload were checked. The login layout had no horizontal overflow at 360px, 390px, 768px, and 1366px viewport widths, and the deployed PWA manifest, worker, and icon endpoints responded successfully. These are browser viewport checks, not tests on physical devices. This environment has no connected Android device/ADB bridge or local install-capable browser, so Android/iPhone installation and real-device offline behavior remain pending. Live Supabase RLS state, cross-account isolation, and a Preview deployment for a new code revision also remain unverified.
