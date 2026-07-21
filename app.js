/* ---------- storage ---------- */
const STORE_KEY = "discipline_v1";
const SYNC_KEY_STORAGE = "discipline_sync_key";
const MILESTONES = [7, 14, 30, 60, 90, 180, 365];
const MIN_REWARD_COST = 30;
// Public by design (Web Push spec) — safe to ship in client code.
const VAPID_PUBLIC_KEY = "BBy-uvZedB7Vp8rr64lif9daYZ7j2aZhjiCIRkPT5CxEIm12kJzTKZZ1ITXQXU4zornPN_4n4v4k9TKSelYAOLg";

function uid() { return Math.random().toString(36).slice(2, 10); }
function pad2(n) { return String(n).padStart(2, "0"); }
// All date math stays in local calendar time (no toISOString/UTC conversion),
// otherwise timezones ahead of UTC roll the date back by one.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDays(dateStr, n) {
  const [y, m, day] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = new Date(ay, am - 1, ad), db = new Date(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}
function yesterdayOf(dateStr) { return addDays(dateStr, -1); }

function defaultState() {
  const today = todayStr();
  const mk = (name, type, group, extra = {}) => ({
    id: uid(), name, type, group, points: 10,
    archived: false, createdAt: today, photos: {},
    ...extra
  });
  return {
    createdAt: today,
    points: 0,
    dayStreak: 0,
    dayStreakBest: 0,
    dayStreakEvalDate: today,
    dayStreakMilestonesAwarded: [],
    lockedDates: [],
    tasks: [
      mk("Wake-up check-in", "checkbox", "Anchors"),
      mk("Meditate 15–20 min", "checkbox", "Anchors"),
      mk("Morning walk", "checkbox", "Anchors"),
      mk("Evening walk", "checkbox", "Anchors"),
      mk("Beard oil", "checkbox", "Anchors"),
      mk("Push-ups", "progressive", "Body", { currentTarget: 5, startTarget: 5, increment: 1, holdDays: 2, unit: "reps", points: 15, daysAtLevel: 0 }),
      mk("Deep work block", "checkbox", "Work", { points: 20 }),
      mk("Content creation", "checkbox", "Work", { points: 15 }),
      mk("Handwriting practice – 15 min", "checkbox", "Learning"),
      mk("Duolingo Russian – 5 min", "checkbox", "Learning", { points: 5 }),
      mk("No junk food", "abstinence", "Challenges", { since: today, slips: [], best: 0 }),
      mk("No added sugar", "abstinence", "Challenges", { since: today, slips: [], best: 0 }),
      mk("No alcohol", "abstinence", "Challenges", { since: today, slips: [], best: 0 }),
    ],
    rewards: [
      { id: uid(), name: "Watch an episode guilt-free", cost: 30 },
      { id: uid(), name: "Order favorite food", cost: 70 },
      { id: uid(), name: "Buy something small I've wanted", cost: 150 },
    ],
    history: [],
  };
}

// Upgrades any older saved shape to the current schema so existing local data
// doesn't break when the app logic changes underneath it.
function migrate(s) {
  const today = todayStr();
  if (s.dayStreak === undefined) s.dayStreak = 0;
  if (s.dayStreakBest === undefined) s.dayStreakBest = 0;
  if (s.dayStreakEvalDate === undefined) s.dayStreakEvalDate = today;
  if (s.dayStreakMilestonesAwarded === undefined) s.dayStreakMilestonesAwarded = [];
  if (s.lockedDates === undefined) s.lockedDates = [];
  s.tasks.forEach(t => {
    delete t.streak;
    delete t.milestonesAwarded;
    delete t.lastDoneDate;
    if (t.type === "abstinence" && t.best === undefined) t.best = 0;
    if (t.type === "progressive" && t.daysAtLevel === undefined) t.daysAtLevel = 0;
    if (t.photos === undefined) t.photos = {};
  });
  return s;
}

function load() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) {
    const s = defaultState();
    save(s);
    return s;
  }
  try { return migrate(JSON.parse(raw)); }
  catch (e) { const s = defaultState(); save(s); return s; }
}
function save(state) { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

let state = load();

/* ---------- completion lookups (single source of truth: the history log) ---------- */
// history is stored newest-first (unshift), so the first match for a given
// taskId+date is that date's most recent action — correct even if a task was
// toggled done/undone multiple times on the same day.
function wasTaskDoneOnDate(t, dateStr) {
  for (const h of state.history) {
    if (h.taskId === t.id && h.date === dateStr && (h.type === "done" || h.type === "undone")) {
      return h.type === "done";
    }
  }
  return false;
}
function isDoneToday(t) { return wasTaskDoneOnDate(t, todayStr()); }

function wasAbstinenceCleanOnDate(t, dateStr) {
  return !t.slips.some(s => s.date === dateStr);
}

// A "perfect day" = every currently-active task is completed (checkbox/
// progressive done, abstinence not slipped), checked live against whatever
// the task list is RIGHT NOW — so adding/removing tasks changes what's
// required for today.
function wasDayPerfect(dateStr) {
  const active = state.tasks.filter(t => !t.archived);
  if (active.length === 0) return false;
  return active.every(t => t.type === "abstinence"
    ? wasAbstinenceCleanOnDate(t, dateStr)
    : wasTaskDoneOnDate(t, dateStr));
}

/* ---------- rollover: only handles FAILURE (a day that ended without being locked) ---------- */
// Success is credited instantly (see tryLockToday) the moment the last task
// is completed — rollover's only job is to notice a day that closed without
// ever reaching that point and zero the streak.
function ensureRollover() {
  const today = todayStr();
  if (state.dayStreakEvalDate !== today) {
    if (state.dayStreakEvalDate) {
      const gap = daysBetween(state.dayStreakEvalDate, today);
      const wasLocked = state.lockedDates.includes(state.dayStreakEvalDate);
      if (gap !== 1 || !wasLocked) {
        state.dayStreak = 0;
        state.dayStreakMilestonesAwarded = [];
      }
    }
    state.dayStreakEvalDate = today;
    save(state);
  }
}
ensureRollover();

/* ---------- points / milestones ---------- */
function addPoints(n) { state.points = Math.max(0, state.points + n); }

function checkDayStreakMilestones() {
  MILESTONES.forEach(m => {
    if (state.dayStreak >= m && !state.dayStreakMilestonesAwarded.includes(m)) {
      state.dayStreakMilestonesAwarded.push(m);
      addPoints(m);
      logHistory(null, "Day streak", "milestone", m, `${m}-day perfect streak`);
    }
  });
}

function logHistory(taskId, taskName, type, points, note) {
  state.history.unshift({ date: todayStr(), taskId, taskName, type, points, note: note || "" });
  if (state.history.length > 500) state.history.length = 500;
}

// Fires the instant the last pending task is completed, in whatever order.
// Locks today's completions (no more undo/late-slip credit) and celebrates.
function tryLockToday() {
  const today = todayStr();
  if (state.lockedDates.includes(today)) return;
  if (!wasDayPerfect(today)) return;
  state.lockedDates.push(today);
  state.dayStreak += 1;
  state.dayStreakBest = Math.max(state.dayStreakBest, state.dayStreak);
  logHistory(null, "Day streak", "streak_up", 0, `Day ${state.dayStreak} locked in`);
  checkDayStreakMilestones();
  save(state);
  render();
  celebrateStreak(state.dayStreak);
  notifyNow();
  syncState();
}

/* ---------- task actions ---------- */
function toggleCheckbox(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const today = todayStr();
  const locked = state.lockedDates.includes(today);
  if (isDoneToday(t)) {
    if (locked) { toast("Today's streak is locked in — no take-backs."); return; }
    addPoints(-t.points);
    logHistory(t.id, t.name, "undone", -t.points);
    if (t.type === "progressive") t.daysAtLevel = Math.max(0, t.daysAtLevel - 1);
    save(state);
    render();
    syncState();
    return;
  }
  const continuing = wasTaskDoneOnDate(t, yesterdayOf(today));
  addPoints(t.points);
  logHistory(t.id, t.name, "done", t.points);
  if (t.type === "progressive") {
    t.daysAtLevel = continuing ? t.daysAtLevel + 1 : 1;
    if (t.daysAtLevel >= t.holdDays) {
      t.currentTarget += t.increment;
      t.daysAtLevel = 0;
      toast(`⬆️ ${t.name} target now ${t.currentTarget} ${t.unit}`);
    }
  }
  save(state);
  render();
  tryLockToday();
  syncState();
}

function adjustProgressiveTarget(id, delta) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || isDoneToday(t)) return; // lock once marked done for the day
  t.currentTarget = Math.max(1, t.currentTarget + delta);
  save(state);
  render();
}

function logSlip(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const today = todayStr();
  const priorStreak = daysBetween(t.since, today);
  t.best = Math.max(t.best, priorStreak);
  t.slips.push({ date: today });
  t.since = today;
  logHistory(t.id, t.name, "slip", 0);
  save(state);
  render();
  syncState();
  toast(state.lockedDates.includes(today)
    ? `Logged. Today's day-streak stays locked in, but the clock restarts on "${t.name}".`
    : `Logged. "${t.name}" reset — and today's day-streak is now off the table.`);
}

/* ---------- reward actions ---------- */
function redeemReward(id) {
  const r = state.rewards.find(x => x.id === id);
  if (!r) return;
  if (state.points < r.cost) { toast("Not enough points yet."); return; }
  addPoints(-r.cost);
  logHistory(null, r.name, "redeem", -r.cost);
  save(state);
  render();
  syncState();
  toast(`🎉 Redeemed: ${r.name}`);
}

/* ---------- manage: add/edit/delete ---------- */
function upsertTask(data) {
  if (data.id) {
    const t = state.tasks.find(x => x.id === data.id);
    Object.assign(t, data);
  } else {
    const { id, ...rest } = data; // data.id is null in add-mode; drop it so it can't clobber the generated uid
    const base = { id: uid(), archived: false, createdAt: todayStr(), photos: {} };
    if (rest.type === "progressive") {
      base.currentTarget = rest.startTarget;
      base.daysAtLevel = 0;
    }
    if (rest.type === "abstinence") {
      base.since = todayStr();
      base.slips = [];
      base.best = 0;
    }
    state.tasks.push({ ...base, ...rest });
  }
  save(state);
  render();
  syncState();
}
function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  save(state);
  render();
  syncState();
}
function archiveTask(id, archived) {
  const t = state.tasks.find(x => x.id === id);
  if (t) t.archived = archived;
  save(state);
  render();
  syncState();
}
function upsertReward(data) {
  if (data.cost < MIN_REWARD_COST) {
    toast(`Rewards must cost at least ${MIN_REWARD_COST} points.`);
    return;
  }
  if (data.id) {
    const r = state.rewards.find(x => x.id === data.id);
    Object.assign(r, data);
  } else {
    const { id, ...rest } = data;
    state.rewards.push({ id: uid(), ...rest });
  }
  save(state);
  render();
  syncState();
}
function deleteReward(id) {
  state.rewards = state.rewards.filter(r => r.id !== id);
  save(state);
  render();
  syncState();
}

/* ---------- backup ---------- */
function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `discipline-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.tasks) throw new Error("bad file");
      state = migrate(parsed);
      save(state);
      ensureRollover();
      render();
      toast("Backup restored.");
    } catch (e) { toast("Couldn't read that file."); }
  };
  reader.readAsText(file);
}

/* ---------- cloud sync + push notifications ---------- */
// Background syncs (syncState, called after every action) stay silent on
// failure so routine use never gets interrupted by toasts — but every
// attempt's outcome is persisted so the Manage tab can show what's actually
// going on, instead of a wrong key or dead deployment failing invisibly.
const LAST_SYNC_KEY = "discipline_last_sync";
function getSyncKey() { return localStorage.getItem(SYNC_KEY_STORAGE) || ""; }
function setSyncKey(k) { localStorage.setItem(SYNC_KEY_STORAGE, k); }
function getLastSync() {
  try { return JSON.parse(localStorage.getItem(LAST_SYNC_KEY) || "null"); }
  catch (e) { return null; }
}
function setLastSync(ok, detail) {
  localStorage.setItem(LAST_SYNC_KEY, JSON.stringify({ ok, detail, at: new Date().toISOString() }));
  renderSyncStatus();
}

async function pushStateToCloud() {
  const key = getSyncKey();
  if (!key) return { ok: false, detail: "no sync key set" };
  try {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-secret": key },
      body: JSON.stringify(state),
    });
    if (res.status === 401) return { ok: false, detail: "sync key doesn't match — check for typos" };
    if (!res.ok) return { ok: false, detail: `server error (${res.status})` };
    return { ok: true, detail: "synced" };
  } catch (e) {
    return { ok: false, detail: "network error — is the backend deployed?" };
  }
}

let syncTimer;
function syncState() {
  const key = getSyncKey();
  if (!key) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const result = await pushStateToCloud();
    setLastSync(result.ok, result.detail);
  }, 1500);
}

function notifyNow() {
  const key = getSyncKey();
  if (!key) return;
  fetch("/api/notify?slot=celebrate", { headers: { "x-app-secret": key } }).catch(() => {});
}

async function saveSyncKeyFromInput() {
  const v = document.getElementById("syncKeyInput").value.trim();
  if (!v) { toast("Enter a key first."); return; }
  setSyncKey(v);
  toast("Checking connection…");
  const result = await pushStateToCloud();
  setLastSync(result.ok, result.detail);
  toast(result.ok ? "✅ Synced to cloud." : `❌ Sync failed: ${result.detail}`);
}

function renderSyncStatus() {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  if (!getSyncKey()) { el.textContent = "Not connected — paste your sync key above and tap Save key."; return; }
  const last = getLastSync();
  if (!last) { el.textContent = "Key saved — not synced yet. Tap Save key to test the connection."; return; }
  const when = new Date(last.at).toLocaleTimeString();
  el.textContent = last.ok ? `✅ Last synced ${when}` : `❌ Last sync failed at ${when}: ${last.detail}`;
}

async function restoreFromCloud() {
  const key = getSyncKey();
  if (!key) { toast("Set your sync key first."); return; }
  if (!confirm("This replaces everything on this phone with the cloud copy. Continue?")) return;
  try {
    const res = await fetch("/api/state", { headers: { "x-app-secret": key } });
    if (!res.ok) throw new Error("failed");
    const data = await res.json();
    state = migrate(data);
    save(state);
    ensureRollover();
    render();
    toast("Restored from cloud.");
  } catch (e) { toast("Couldn't reach the cloud backup."); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast("Push isn't supported in this browser."); return;
  }
  const key = getSyncKey();
  if (!key) { toast("Set your cloud sync key first."); return; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("Notification permission denied."); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-secret": key },
      body: JSON.stringify(sub),
    });
    toast("Notifications enabled.");
  } catch (e) {
    toast("Couldn't enable notifications — is the backend deployed?");
  }
}

/* ---------- photo attachments ---------- */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhoto(taskId, date, dataUrl) {
  const key = getSyncKey();
  if (!key) throw new Error("no sync key configured");
  const res = await fetch("/api/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-secret": key },
    body: JSON.stringify({ taskId, date, image: dataUrl }),
  });
  if (!res.ok) throw new Error("upload failed");
  const data = await res.json();
  return data.url;
}

let pendingPhotoTaskId = null;
function triggerPhotoPicker(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  const today = todayStr();
  if (t && state.lockedDates.includes(today) && isDoneToday(t)) {
    toast("This task is locked in for today — can't change its photo.");
    return;
  }
  pendingPhotoTaskId = taskId;
  document.getElementById("photoInput").click();
}

async function attachPhoto(file) {
  const taskId = pendingPhotoTaskId;
  const t = state.tasks.find(x => x.id === taskId);
  if (!t || !file) return;
  const today = todayStr();
  toast("Uploading photo…");
  try {
    const compressed = await compressImage(file);
    const url = await uploadPhoto(taskId, today, compressed);
    t.photos[today] = url;
    save(state);
    render();
    syncState();
    toast("Photo attached.");
  } catch (e) {
    toast("Photo upload failed — set up cloud sync in Manage, or check your connection.");
  }
}

/* ---------- celebration animation ---------- */
function celebrateStreak(n) {
  const overlay = document.getElementById("celebrateOverlay");
  if (!overlay) return;
  const emojis = ["🔥", "✨", "🎉"];
  const particles = Array.from({ length: 16 }, (_, i) => {
    const angle = (360 / 16) * i;
    const dist = 70 + Math.random() * 60;
    const dx = Math.cos(angle * Math.PI / 180) * dist;
    const dy = Math.sin(angle * Math.PI / 180) * dist;
    return `<span class="particle" style="--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;animation-delay:${(Math.random() * 0.15).toFixed(2)}s;">${emojis[i % emojis.length]}</span>`;
  }).join("");
  overlay.innerHTML = `
    <div class="celebrate-card">
      <div class="celebrate-particles">${particles}</div>
      <div class="celebrate-flame">🔥</div>
      <div class="celebrate-num">${n}</div>
      <div class="celebrate-label">Day streak — locked in</div>
    </div>`;
  overlay.classList.add("show");
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(() => overlay.classList.remove("show"), 2400);
}
let celebrateTimer;

/* ---------- UI: toast ---------- */
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---------- rendering ---------- */
let currentView = "today";

function render() {
  document.getElementById("todayDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  renderToday();
  renderProgress();
  renderRewards();
  renderManage();
  renderSyncStatus();
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + currentView));
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === currentView));
}

function switchView(v) { currentView = v; render(); }

function moodEmoji(t) {
  if (t.type === "abstinence") return "";
  if (isDoneToday(t)) return "";
  const hour = new Date().getHours();
  if (hour < 12) return "😐";
  if (hour < 18) return "😒";
  return "😠";
}

function renderToday() {
  const active = state.tasks.filter(t => !t.archived);
  const actionable = active.filter(t => t.type !== "abstinence");
  const doneCount = actionable.filter(isDoneToday).length;
  const totalCount = actionable.length;
  const today = todayStr();
  const locked = state.lockedDates.includes(today);

  document.getElementById("summary").innerHTML = `
    <div class="card"><div class="num">${doneCount}/${totalCount}</div><div class="label">Today</div></div>
    <div class="card"><div class="num">${state.points}</div><div class="label">Points</div></div>
    <div class="card"><div class="num">${state.dayStreak}🔥</div><div class="label">Day streak · best ${state.dayStreakBest}</div></div>
  `;

  const groups = {};
  active.forEach(t => { (groups[t.group] = groups[t.group] || []).push(t); });

  const banner = locked
    ? `<div class="perfect-banner">🔒 Today's streak is locked in. Nice.</div>`
    : "";

  const html = Object.keys(groups).map(g => `
    <section class="group">
      <h2>${g}</h2>
      ${groups[g].map(taskRowHtml).join("")}
    </section>
  `).join("") || `<div class="empty-hint">No tasks yet. Add some in Manage.</div>`;

  document.getElementById("todayList").innerHTML = banner + html;
}

function photoControlHtml(t) {
  const today = todayStr();
  const url = t.photos && t.photos[today];
  const lockedForThis = state.lockedDates.includes(today) && isDoneToday(t);
  if (url) {
    return `<img src="${url}" class="photo-thumb" onclick="triggerPhotoPicker('${t.id}')" title="${lockedForThis ? "Locked in" : "Tap to replace"}">`;
  }
  return `<button class="photo-btn" onclick="triggerPhotoPicker('${t.id}')" title="Attach photo">📷</button>`;
}

function taskRowHtml(t) {
  if (t.type === "abstinence") {
    const streakVal = daysBetween(t.since, todayStr());
    return `
      <div class="task-row">
        <div class="check" style="color:var(--text-dim);border-color:var(--border);background:transparent;">–</div>
        <div class="task-info">
          <div class="task-name">${escapeHtml(t.name)}</div>
          <div class="task-sub">clean for ${streakVal} day${streakVal === 1 ? "" : "s"} · best ${t.best}</div>
        </div>
        <button class="btn small danger" onclick="handleSlip('${t.id}')">Slipped</button>
      </div>`;
  }
  const done = isDoneToday(t);
  const locked = state.lockedDates.includes(todayStr());
  let stepper = "";
  if (t.type === "progressive" && !done) {
    stepper = `
      <div class="stepper">
        <button onclick="adjustProgressiveTarget('${t.id}', -1)">−</button>
        <div class="val">${t.currentTarget}</div>
        <button onclick="adjustProgressiveTarget('${t.id}', 1)">+</button>
      </div>`;
  }
  const sub = t.type === "progressive" ? `${t.currentTarget} ${t.unit} target` : "";
  const checkMark = done ? (locked ? "🔒" : "✓") : "";
  return `
    <div class="task-row ${done ? "done" : ""}">
      <div class="check ${done && locked ? "locked" : ""}" onclick="toggleCheckbox('${t.id}')">${checkMark}</div>
      <div class="task-info" onclick="toggleCheckbox('${t.id}')">
        <div class="task-name">${escapeHtml(t.name)}</div>
        ${sub ? `<div class="task-sub">${sub}</div>` : ""}
      </div>
      ${photoControlHtml(t)}
      ${stepper}
      <div class="mood">${moodEmoji(t)}</div>
    </div>`;
}

function handleSlip(id) {
  const t = state.tasks.find(x => x.id === id);
  if (confirm(`Log a slip on "${t.name}"?`)) logSlip(id);
}

function renderProgress() {
  const days = [];
  for (let i = 69; i >= 0; i--) days.push(addDays(todayStr(), -i));
  const today = todayStr();
  const cells = days.map(d => {
    const perfect = d === today ? wasDayPerfect(d) : state.lockedDates.includes(d);
    const bg = perfect ? "var(--accent)" : "var(--bg-elev-2)";
    return `<div class="cell" title="${d}: ${perfect ? "perfect day" : "incomplete"}" style="background:${bg}"></div>`;
  }).join("");
  document.getElementById("heatmap").innerHTML = cells;

  const recent = state.history.slice(0, 40).map(h => {
    const icon = h.type === "slip" ? "⚠️ Slip – " : h.type === "redeem" ? "🎁 " : h.type === "milestone" ? "🏆 " : h.type === "streak_up" ? "🔒 " : h.points >= 0 ? "✅ " : "↩️ ";
    return `
    <div class="history-item">
      <span>${icon}${escapeHtml(h.taskName || "")}${h.note ? " – " + escapeHtml(h.note) : ""}</span>
      <span class="d">${h.date}${h.points ? ` · ${h.points > 0 ? "+" : ""}${h.points}` : ""}</span>
    </div>`;
  }).join("") || `<div class="empty-hint">Nothing logged yet.</div>`;
  document.getElementById("historyList").innerHTML = recent;

  const challengeRows = state.tasks.filter(t => t.type === "abstinence" && !t.archived).map(t => `
    <div class="history-item"><span>${escapeHtml(t.name)}</span><span class="d">clean ${daysBetween(t.since, todayStr())}d · best ${t.best}d</span></div>
  `).join("");
  document.getElementById("streakSummary").innerHTML = `
    <div class="history-item"><span>Day streak</span><span class="d">current ${state.dayStreak} · best ${state.dayStreakBest}</span></div>
    ${challengeRows}
  `;
}

function renderRewards() {
  document.getElementById("rewardBalance").textContent = state.points;
  document.getElementById("rewardsList").innerHTML = state.rewards.map(r => `
    <div class="reward-row">
      <div>
        <div class="rname">${escapeHtml(r.name)}</div>
        <div class="rcost">${r.cost} pts</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn small ${state.points >= r.cost ? "" : "secondary"}" onclick="redeemReward('${r.id}')">Redeem</button>
        <button class="btn small secondary" onclick="openRewardSheet('${r.id}')">Edit</button>
      </div>
    </div>
  `).join("") || `<div class="empty-hint">No rewards yet — add one below.</div>`;
}

function renderManage() {
  const html = state.tasks.map(t => `
    <div class="task-row" style="${t.archived ? "opacity:.5;" : ""}">
      <div class="task-info">
        <div class="task-name">${escapeHtml(t.name)}</div>
        <div class="task-sub">${t.type} · ${escapeHtml(t.group)} · ${t.points} pts${t.type === "progressive" ? ` · +${t.increment} every ${t.holdDays}d` : ""}</div>
      </div>
      <button class="btn small secondary" onclick="openTaskSheet('${t.id}')">Edit</button>
      <button class="btn small secondary" onclick="archiveTask('${t.id}', ${!t.archived})">${t.archived ? "Unarchive" : "Archive"}</button>
    </div>
  `).join("") || `<div class="empty-hint">No tasks yet.</div>`;
  document.getElementById("manageList").innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- task sheet (add/edit) ---------- */
let editingTaskId = null;
function openTaskSheet(id) {
  editingTaskId = id || null;
  const t = id ? state.tasks.find(x => x.id === id) : null;
  document.getElementById("taskSheetTitle").textContent = id ? "Edit task" : "Add task";
  document.getElementById("taskName").value = t ? t.name : "";
  document.getElementById("taskGroup").value = t ? t.group : "Anchors";
  document.getElementById("taskPoints").value = t ? t.points : 10;
  setTaskType(t ? t.type : "checkbox");
  document.getElementById("taskStart").value = t && t.type === "progressive" ? t.currentTarget : 5;
  document.getElementById("taskIncrement").value = t && t.type === "progressive" ? t.increment : 1;
  document.getElementById("taskHold").value = t && t.type === "progressive" ? t.holdDays : 2;
  document.getElementById("taskUnit").value = t && t.type === "progressive" ? t.unit : "reps";
  document.getElementById("deleteTaskBtn").style.display = id ? "inline-flex" : "none";
  document.getElementById("taskSheet").classList.add("open");
}
function closeTaskSheet() { document.getElementById("taskSheet").classList.remove("open"); }
function setTaskType(type) {
  document.querySelectorAll("#typeChips .chip").forEach(c => c.classList.toggle("selected", c.dataset.type === type));
  document.getElementById("progressiveFields").style.display = type === "progressive" ? "block" : "none";
}
function getSelectedType() {
  const sel = document.querySelector("#typeChips .chip.selected");
  return sel ? sel.dataset.type : "checkbox";
}
function saveTaskFromSheet() {
  const name = document.getElementById("taskName").value.trim();
  if (!name) { toast("Give it a name."); return; }
  const type = getSelectedType();
  const data = {
    id: editingTaskId,
    name,
    group: document.getElementById("taskGroup").value.trim() || "General",
    points: parseInt(document.getElementById("taskPoints").value, 10) || 10,
    type,
  };
  if (type === "progressive") {
    data.startTarget = parseInt(document.getElementById("taskStart").value, 10) || 1;
    if (!editingTaskId) data.currentTarget = data.startTarget;
    data.increment = parseInt(document.getElementById("taskIncrement").value, 10) || 1;
    data.holdDays = parseInt(document.getElementById("taskHold").value, 10) || 1;
    data.unit = document.getElementById("taskUnit").value.trim() || "reps";
  }
  upsertTask(data);
  closeTaskSheet();
}
function deleteTaskFromSheet() {
  if (editingTaskId && confirm("Delete this task and its history record?")) {
    deleteTask(editingTaskId);
    closeTaskSheet();
  }
}

/* ---------- reward sheet ---------- */
let editingRewardId = null;
function openRewardSheet(id) {
  editingRewardId = id || null;
  const r = id ? state.rewards.find(x => x.id === id) : null;
  document.getElementById("rewardSheetTitle").textContent = id ? "Edit reward" : "Add reward";
  document.getElementById("rewardName").value = r ? r.name : "";
  document.getElementById("rewardCost").value = r ? r.cost : 50;
  document.getElementById("deleteRewardBtn").style.display = id ? "inline-flex" : "none";
  document.getElementById("rewardSheet").classList.add("open");
}
function closeRewardSheet() { document.getElementById("rewardSheet").classList.remove("open"); }
function saveRewardFromSheet() {
  const name = document.getElementById("rewardName").value.trim();
  if (!name) { toast("Give it a name."); return; }
  const cost = parseInt(document.getElementById("rewardCost").value, 10) || 0;
  if (cost < MIN_REWARD_COST) { toast(`Rewards must cost at least ${MIN_REWARD_COST} points.`); return; }
  upsertReward({ id: editingRewardId, name, cost });
  closeRewardSheet();
}
function deleteRewardFromSheet() {
  if (editingRewardId && confirm("Delete this reward?")) {
    deleteReward(editingRewardId);
    closeRewardSheet();
  }
}

/* ---------- init ---------- */
window.addEventListener("DOMContentLoaded", () => {
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("importInput").addEventListener("change", e => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
  });
  document.getElementById("photoInput").addEventListener("change", e => {
    if (e.target.files[0]) attachPhoto(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("syncKeyInput").value = getSyncKey();
});
