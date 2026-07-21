# Deploying the cloud backend (Vercel)

The app works fully offline with zero setup — everything below is only for
smart push notifications, a cloud backup of your state, and photo storage.
Skip this entirely and the app still works exactly as before.

## What gets created

- **Vercel** hosts the static app (`index.html`/`app.js`/...) *and* four
  small serverless functions under `/api` — one project, one platform, no
  Railway needed.
- **Vercel Blob** is the only storage product required — it holds your
  synced `state.json`, your push subscription, and uploaded photos.
- **GitHub Actions** (already committed as `.github/workflows/notify.yml`)
  is the free scheduler that pings the notification endpoint 4x/day —
  used instead of Vercel's own Cron because the Hobby (free) plan limits
  Cron frequency; GitHub Actions has no such limit for a personal repo.

## One-time setup

1. **Import the repo into Vercel**: [vercel.com/new](https://vercel.com/new) → import `mysteryguy47/discipline` → deploy with default settings (no build command needed, it's static + `/api`).

2. **Create a Blob store**: in the Vercel project → **Storage** tab → **Create Database** → **Blob** → connect it to this project. This automatically adds a `BLOB_READ_WRITE_TOKEN` environment variable for you — nothing to copy manually. The code assumes a **Private** store (every `put`/`get` call passes `access: "private"`) — that's the safer default and what a personal habit tracker should use anyway. Photos are served through `/api/photo` (which streams the private blob through with your sync key as a query param) rather than a raw blob URL, specifically so this works with a private store.

3. **Add the remaining environment variables**: Project → **Settings → Environment Variables**, add:
   - `APP_SECRET` — a random string only you and the app know (shared with you in chat, not committed to git for obvious reasons)
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — the Web Push keypair (also shared in chat)
   - `VAPID_SUBJECT` — `mailto:your-email@example.com` (any email, used only for push-service contact per the Web Push spec)

   Prefer to generate your own instead of using the ones I generated? Run locally:
   ```
   npx web-push generate-vapid-keys        # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # APP_SECRET
   ```

4. **Redeploy** (Settings changes require a redeploy — Vercel prompts for this automatically, or trigger one from the Deployments tab).

5. **Add the same two values as GitHub Actions secrets** (so the free scheduler can call your API): repo → **Settings → Secrets and variables → Actions** →
   - `APP_URL` — your Vercel deployment URL, e.g. `https://discipline-yourname.vercel.app`
   - `APP_SECRET` — the same value as in step 3

6. **In the app itself** (Manage tab → Cloud sync & notifications):
   - Paste the same `APP_SECRET` value into **Sync key**, tap **Save key**
   - Tap **Enable notifications** and accept the iOS permission prompt

That's it — the app now syncs state to the cloud on every change, uploads photos there, and GitHub Actions will nudge you 4x/day with a message that knows your actual remaining tasks and streak.

## Notification schedule

Defined in `.github/workflows/notify.yml`, currently ~8:00 AM / 1:00 PM /
7:00 PM / 10:30 PM **IST**. The server-side day boundary in `api/notify.js`
also assumes IST. If you move timezones, update both the cron times (they're
in UTC) and the `+5:30` offset in `api/notify.js`.

You can also trigger a test push manually: repo → **Actions** → "Discipline nudges" → **Run workflow**, pick a slot.

## Notes / limits

- GitHub Actions schedules can drift a few minutes and may pause if the repo goes fully inactive for 60 days (a commit resets that clock).
- Photo upload and cloud sync require the phone to be online at that moment; there's no offline queue in v1 — the checkbox itself still works offline regardless.
- Everything here is single-user by design (one shared secret, one blob namespace) — not meant to scale beyond your own phone.
