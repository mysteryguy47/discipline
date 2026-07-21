/* ---------- storage ---------- */
const STORE_KEY = "discipline_v1";
const MILESTONES = [7, 14, 30, 60, 90, 180, 365];
const MIN_REWARD_COST = 30;

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
    archived: false, createdAt: today,
    ...extra
  });
  return {
    createdAt: today,
    points: 0,
    dayStreak: 0,
    dayStreakBest: 0,
    dayStreakEvalDate: today,
    dayStreakMilestonesAwarded: [],
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
  s.tasks.forEach(t => {
    delete t.streak;
    delete t.milestonesAwarded;
    delete t.lastDoneDate;
    if (t.type === "abstinence" && t.best === undefined) t.best = 0;
    if (t.type === "progressive" && t.daysAtLevel === undefined) t.daysAtLevel = 0;
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

// A "perfect day" = every currently-active task was completed that day
// (checkbox/progressive done, abstinence not slipped). Uses the CURRENT task
// list, so adding/removing tasks changes what's required — including
// retroactively for dates being re-checked (see caveat in NOTIFICATIONS.md).
function wasDayPerfect(dateStr) {
  const active = state.tasks.filter(t => !t.archived);
  if (active.length === 0) return false;
  return active.every(t => t.type === "abstinence"
    ? wasAbstinenceCleanOnDate(t, dateStr)
    : wasTaskDoneOnDate(t, dateStr));
}

/* ---------- rollover: finalize yesterday's day-streak once per new day ---------- */
function ensureRollover() {
  const today = todayStr();
  if (state.dayStreakEvalDate !== today) {
    if (state.dayStreakEvalDate) {
      const gap = daysBetween(state.dayStreakEvalDate, today);
      if (gap === 1 && wasDayPerfect(state.dayStreakEvalDate)) {
        state.dayStreak += 1;
        state.dayStreakBest = Math.max(state.dayStreakBest, state.dayStreak);
        checkDayStreakMilestones();
      } else {
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
      toast(`🔥 ${m}-day streak! +${m} pts`);
    }
  });
}

function logHistory(taskId, taskName, type, points, note) {
  state.history.unshift({ date: todayStr(), taskId, taskName, type, points, note: note || "" });
  if (state.history.length > 500) state.history.length = 500;
}

/* ---------- task actions ---------- */
function toggleCheckbox(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const today = todayStr();
  if (isDoneToday(t)) {
    // undo
    addPoints(-t.points);
    logHistory(t.id, t.name, "undone", -t.points);
    if (t.type === "progressive") t.daysAtLevel = Math.max(0, t.daysAtLevel - 1);
  } else {
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
  }
  save(state);
  render();
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
  toast(`Logged. "${t.name}" reset — and today's day-streak is now broken.`);
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
  toast(`🎉 Redeemed: ${r.name}`);
}

/* ---------- manage: add/edit/delete ---------- */
function upsertTask(data) {
  if (data.id) {
    const t = state.tasks.find(x => x.id === data.id);
    Object.assign(t, data);
  } else {
    const { id, ...rest } = data; // data.id is null in add-mode; drop it so it can't clobber the generated uid
    const base = { id: uid(), archived: false, createdAt: todayStr() };
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
}
function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  save(state);
  render();
}
function archiveTask(id, archived) {
  const t = state.tasks.find(x => x.id === id);
  if (t) t.archived = archived;
  save(state);
  render();
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
}
function deleteReward(id) {
  state.rewards = state.rewards.filter(r => r.id !== id);
  save(state);
  render();
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
  const perfectSoFar = active.length > 0 && active.every(t =>
    t.type === "abstinence" ? wasAbstinenceCleanOnDate(t, today) : isDoneToday(t));

  document.getElementById("summary").innerHTML = `
    <div class="card"><div class="num">${doneCount}/${totalCount}</div><div class="label">Today</div></div>
    <div class="card"><div class="num">${state.points}</div><div class="label">Points</div></div>
    <div class="card"><div class="num">${state.dayStreak}🔥</div><div class="label">Day streak · best ${state.dayStreakBest}</div></div>
  `;

  const groups = {};
  active.forEach(t => { (groups[t.group] = groups[t.group] || []).push(t); });

  const banner = perfectSoFar
    ? `<div class="perfect-banner">🎉 Everything's done — day-streak continues tomorrow morning.</div>`
    : "";

  const html = Object.keys(groups).map(g => `
    <section class="group">
      <h2>${g}</h2>
      ${groups[g].map(taskRowHtml).join("")}
    </section>
  `).join("") || `<div class="empty-hint">No tasks yet. Add some in Manage.</div>`;

  document.getElementById("todayList").innerHTML = banner + html;
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
  return `
    <div class="task-row ${done ? "done" : ""}">
      <div class="check" onclick="toggleCheckbox('${t.id}')">${done ? "✓" : ""}</div>
      <div class="task-info" onclick="toggleCheckbox('${t.id}')">
        <div class="task-name">${escapeHtml(t.name)}</div>
        ${sub ? `<div class="task-sub">${sub}</div>` : ""}
      </div>
      ${stepper}
      <div class="mood">${moodEmoji(t)}</div>
    </div>`;
}

function handleSlip(id) {
  const t = state.tasks.find(x => x.id === id);
  if (confirm(`Log a slip on "${t.name}"? This breaks today's day-streak.`)) logSlip(id);
}

function renderProgress() {
  const days = [];
  for (let i = 69; i >= 0; i--) days.push(addDays(todayStr(), -i));
  const cells = days.map(d => {
    const perfect = wasDayPerfect(d);
    const bg = perfect ? "var(--accent)" : "var(--bg-elev-2)";
    return `<div class="cell" title="${d}: ${perfect ? "perfect day" : "incomplete"}" style="background:${bg}"></div>`;
  }).join("");
  document.getElementById("heatmap").innerHTML = cells;

  const recent = state.history.slice(0, 40).map(h => `
    <div class="history-item">
      <span>${h.type === "slip" ? "⚠️ Slip – " : h.type === "redeem" ? "🎁 " : h.type === "milestone" ? "🏆 " : h.points >= 0 ? "✅ " : "↩️ "}${escapeHtml(h.taskName || "")}${h.note ? " – " + escapeHtml(h.note) : ""}</span>
      <span class="d">${h.date}${h.points ? ` · ${h.points > 0 ? "+" : ""}${h.points}` : ""}</span>
    </div>`).join("") || `<div class="empty-hint">Nothing logged yet.</div>`;
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
});
