# Getting Discipline onto your iPhone + setting up nudges

## 1. Host it (so Safari can install it as a real app)

A PWA can only be "Added to Home Screen" properly from a real URL (not a local file). Easiest free option — GitHub Pages:

1. Create a new **public** GitHub repo (e.g. `discipline`).
2. Push everything in this folder to it.
3. In the repo: **Settings → Pages → Deploy from branch → main → / (root)**.
4. Wait ~1 minute, then your app is live at `https://<your-username>.github.io/discipline/`.

(If you'd rather not use GitHub, Netlify or Vercel both let you drag-and-drop this folder for a free URL in under a minute.)

## 2. Add it to your Home Screen

1. Open the URL from step 1 in **Safari** on your iPhone (must be Safari, not Chrome — Chrome on iOS can't install PWAs).
2. Tap the **Share** icon → **Add to Home Screen**.
3. It now opens full-screen, no Safari chrome, with its own icon — indistinguishable from a "real" app.

Everything you log is stored only in that app's local storage on your phone. Use the **Export backup** button in Manage occasionally (especially before iOS updates or if you're low on storage) — a browser/app data clear would otherwise wipe your streaks with no recovery.

## 3. The nudge layer (native iOS, not the app itself)

The app can't reliably push notifications to you in the background on iPhone without a real server — so instead of fighting that, use iOS's own tools. This is genuinely less setup than it sounds:

**Fastest option — Reminders app, recurring alerts:**
1. Open Reminders → create a list called "Discipline".
2. Add one reminder per anchor task (wake-up, meditate, walk ×2, push-ups, beard oil).
3. Tap each reminder → set a time → toggle **Repeat → Daily**.
4. Done. iOS will alert you at each time, every day, with zero maintenance.

**More Duolingo-like option — Shortcuts Automations (multiple nudges/day, custom text):**
1. Open **Shortcuts** app → **Automation** tab → **+** → **Time of Day**.
2. Set a time (e.g. 7:00 AM), set to repeat **Daily**.
3. Action: **Show Notification** → write your own nagging text (e.g. "132 days. Don't be the guy who broke it.").
4. Turn off "Ask Before Running" so it fires silently.
5. Repeat this 4-5 times for different times of day (morning, midday, evening, night) — exactly matching the Duolingo cadence you responded well to.

You can point some of these at specific unfinished tasks (e.g. an evening one just for the walk/pushups if mornings are usually covered) once you know your own patterns.

## 4. If you later want real stakes on 1-2 habits

The app intentionally does not hold money or verify proof — you decided the streak itself is the leverage for now. If that stops being enough down the line, two low-effort upgrades without touching this app:
- **Beeminder** (beeminder.com) — real financial commitment contracts, just for your hardest 1-2 habits.
- **A friend as the enforcement layer** — pre-arrange a Venmo/small payment they collect if you tell them you broke a streak. No code needed, just honesty.

Everything else stays exactly as it is here.
