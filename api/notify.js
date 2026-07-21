const webpush = require("web-push");
const { checkAuth, readBlobJson } = require("./_lib");

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:you@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const STATE_PATH = "discipline/state.json";
const SUB_PATH = "discipline/subscription.json";

function pad2(n) { return String(n).padStart(2, "0"); }
// The server runs in UTC; shift by IST (+5:30) to match the phone's local
// calendar date. Hardcoded for now — see SETUP.md if you travel timezones.
function istTodayStr() {
  const now = new Date(Date.now() + (5 * 60 + 30) * 60000);
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

function wasTaskDoneOnDate(state, t, dateStr) {
  for (const h of state.history) {
    if (h.taskId === t.id && h.date === dateStr && (h.type === "done" || h.type === "undone")) {
      return h.type === "done";
    }
  }
  return false;
}

function buildMessage(slot, state, today) {
  const active = (state.tasks || []).filter(t => !t.archived);
  const remaining = active.filter(t => t.type !== "abstinence" && !wasTaskDoneOnDate(state, t, today));
  const streak = state.dayStreak || 0;
  const names = remaining.slice(0, 3).map(t => t.name).join(", ");
  const extra = remaining.length > 3 ? ` +${remaining.length - 3} more` : "";
  const list = names + extra;

  if (slot === "celebrate") {
    return { title: `🔥 Day ${streak} locked in`, body: "Every task done — streak's safe. See you tomorrow." };
  }
  if (remaining.length === 0) return null; // nothing to nag about

  switch (slot) {
    case "morning":
      return { title: `Day ${streak} — keep it going`, body: `${remaining.length} to go: ${list}` };
    case "midday":
      return { title: "Halfway check-in", body: `Still open: ${list}` };
    case "evening":
      return { title: `Evening — ${remaining.length} left`, body: `Don't let day ${streak + 1} slip away: ${list}` };
    case "night":
      return { title: "⚠️ Streak at risk", body: `Midnight's close. Left: ${list}` };
    default:
      return { title: "Discipline", body: `${remaining.length} tasks left today: ${list}` };
  }
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const slot = (req.query && req.query.slot) || "default";

  const state = await readBlobJson(STATE_PATH);
  if (!state) return res.status(200).json({ skipped: "no state synced from the phone yet" });

  const sub = await readBlobJson(SUB_PATH);
  if (!sub) return res.status(200).json({ skipped: "no push subscription registered yet" });

  const today = istTodayStr();
  if (slot !== "celebrate" && (state.lockedDates || []).includes(today)) {
    return res.status(200).json({ skipped: "today is already locked in" });
  }

  const message = buildMessage(slot, state, today);
  if (!message) return res.status(200).json({ skipped: "nothing remaining to nag about" });

  try {
    await webpush.sendNotification(sub, JSON.stringify(message));
    return res.status(200).json({ sent: true, message });
  } catch (e) {
    return res.status(500).json({ error: "push send failed", detail: String(e && e.message || e) });
  }
};
