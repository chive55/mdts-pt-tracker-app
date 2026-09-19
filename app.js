import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const $ = (id) => document.getElementById(id);
const cfg = window.MDTS_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("PASTE");
const supabase = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

let profile = null;
let editingDate = null;

function show(viewId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(viewId).classList.remove("hidden");
  window.scrollTo(0, 0);
}
function showError(elId, msg) {
  const el = $(elId);
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearMsg(elId) {
  $(elId).classList.add("hidden");
}
function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return todayStr(dt);
}
function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
}
function activitySummary(a) {
  const parts = [];
  if (a.sets && a.reps) parts.push(`${a.sets}x${a.reps}`);
  else if (a.reps) parts.push(`${a.reps} reps`);
  else if (a.sets) parts.push(`${a.sets} sets`);
  if (a.distance) parts.push(a.distance);
  if (a.time) parts.push(a.time);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/* ---------- Auth ---------- */

function wireAuthTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const isSignup = tab.dataset.tab === "signup";
      $("form-signin").classList.toggle("hidden", isSignup);
      $("form-signup").classList.toggle("hidden", !isSignup);
      clearMsg("auth-error");
    });
  });
}

async function getOrCreateProfile(user, fallbackName, extra) {
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const meta = (user.user_metadata) || {};
  const name = meta.name || fallbackName || "Member";
  const { data: ins, error: insErr } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      name,
      email: user.email,
      rank: meta.rank || (extra && extra.rank) || "",
      flight: meta.flight || (extra && extra.flight) || "",
    })
    .select().single();
  if (insErr) throw insErr;
  return ins;
}

async function enterApp(user, fallbackName, extra) {
  try {
    profile = await getOrCreateProfile(user, fallbackName, extra);
  } catch (e) {
    showError("auth-error", "Signed in, but could not load your profile: " + e.message);
    return;
  }
  $("btn-signout").classList.remove("hidden");
  $("btn-bell").classList.remove("hidden");
  if (profile.role === "admin") {
    document.querySelectorAll(".admin-only").forEach((el) => el.classList.remove("hidden"));
    await populateLogForMembers();
    resetLogForm();
  }
  show("view-dashboard");
  await loadDashboard();
  await loadNotifications();
}

function wireAuthForms() {
  $("form-signup").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("auth-error");
    const name = $("signup-name").value.trim();
    const email = $("signup-email").value.trim();
    const password = $("signup-password").value;
    const rank = $("signup-rank").value;
    const flight = $("signup-flight").value.trim();
    if (name.length < 2) return showError("auth-error", "Please enter your full name.");
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { name, rank, flight } },
      });
      if (error) throw error;
      if (!data.session) {
        const note = $("auth-note");
        note.textContent = "Account created. Email confirmation is on, so check your inbox for the confirmation link, then sign in.";
        note.classList.remove("hidden");
        return;
      }
      await enterApp(data.user, name, { rank, flight });
    } catch (err) {
      showError("auth-error", err.message);
    }
  });

  $("form-signin").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("auth-error");
    const email = $("signin-email").value.trim();
    const password = $("signin-password").value;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await enterApp(data.user);
    } catch (err) {
      showError("auth-error", "Email or password is incorrect.");
    }
  });

  $("btn-signout").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}

/* ---------- Dashboard ---------- */

/* ---------- Workout log form: session type + intensity pickers ---------- */

const RANKS = ["AB", "Amn", "A1C", "SrA", "SSgt", "TSgt", "MSgt", "SMSgt", "CMSgt",
  "2d Lt", "1st Lt", "Capt", "Maj", "Lt Col", "Col", "Civ"];

const SESSION_TYPES = [
  { name: "Running", title: "Aerobic run", location: "Base track", duration: 30, distance: 2.5, reps: null },
  { name: "Weightlifting", title: "Strength training", location: "Base gym", duration: 45, distance: null, reps: 50 },
  { name: "Swimming", title: "Swim laps", location: "Base pool", duration: 40, distance: 0.5, reps: null },
  { name: "Calisthenics", title: "Push-ups and sit-ups", location: "Squadron fitness area", duration: 35, distance: null, reps: 50 },
  { name: "Cycling", title: "Endurance ride", location: "Base trail", duration: 45, distance: 5.0, reps: null },
  { name: "Rowing", title: "Rowing intervals", location: "Base gym", duration: 30, distance: null, reps: null },
  { name: "Ruck March", title: "Ruck march", location: "Base perimeter route", duration: 60, distance: 4.0, reps: null },
  { name: "HIIT / Cross-Training", title: "HIIT circuit", location: "Fitness annex", duration: 40, distance: null, reps: null },
  { name: "Unit PT", title: "Unit PT formation", location: "Parade field", duration: 60, distance: null, reps: null },
  { name: "Flexibility & Yoga", title: "Mobility and recovery", location: "Fitness annex", duration: 30, distance: null, reps: null },
];

const INTENSITIES = [
  { level: "Low", hint: "RPE 1-3", desc: "Easy recovery pace", rpe: 3, cls: "sel-low" },
  { level: "Moderate", hint: "RPE 4-6", desc: "Steady aerobic zone", rpe: 6, cls: "sel-mod" },
  { level: "High", hint: "RPE 7-8", desc: "Hard effort", rpe: 8, cls: "sel-high" },
  { level: "Maximum", hint: "RPE 9-10", desc: "All-out effort", rpe: 10, cls: "sel-max" },
];

let selSessionType = "Running";
let selIntensity = "Moderate";

function setOn(selector, attr, val) {
  document.querySelectorAll(selector).forEach((c) =>
    c.classList.toggle("on", c.dataset[attr] === String(val)));
}

function buildPickers() {
  const sp = $("session-picker");
  sp.innerHTML = "";
  SESSION_TYPES.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pick-btn" + (t.name === selSessionType ? " selected" : "");
    b.textContent = t.name;
    b.addEventListener("click", () => selectSessionType(t.name, true));
    sp.appendChild(b);
  });
  const ip = $("intensity-picker");
  ip.innerHTML = "";
  INTENSITIES.forEach((it) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "intensity-card" + (it.level === selIntensity ? " " + it.cls : "");
    b.title = it.desc;
    b.innerHTML = `<div class="lv">${it.level}</div><div class="hint">${it.hint}</div>`;
    b.addEventListener("click", () => selectIntensity(it.level, true));
    ip.appendChild(b);
  });
}

function selectSessionType(name, applyDefaults) {
  selSessionType = name;
  document.querySelectorAll("#session-picker .pick-btn").forEach((b) =>
    b.classList.toggle("selected", b.textContent === name));
  const t = SESSION_TYPES.find((x) => x.name === name);
  if (applyDefaults && t) {
    $("log-title").value = t.title;
    $("log-location").value = t.location;
    $("log-duration").value = t.duration;
    $("log-distance").value = t.distance == null ? "" : t.distance;
    $("log-reps").value = t.reps == null ? "" : t.reps;
    setOn("#duration-chips .qchip", "val", t.duration);
  }
}

function selectIntensity(level, applyRpe) {
  selIntensity = level;
  const cls = (INTENSITIES.find((i) => i.level === level) || {}).cls || "";
  document.querySelectorAll("#intensity-picker .intensity-card").forEach((b) => {
    const on = b.querySelector(".lv").textContent === level;
    b.className = "intensity-card" + (on ? " " + cls : "");
  });
  if (applyRpe) {
    const it = INTENSITIES.find((i) => i.level === level);
    if (it) $("log-rpe").value = it.rpe;
  }
}

function sessionSummary(log) {
  const parts = [];
  if (log.session_type) parts.push(log.session_type);
  if (log.intensity) parts.push(log.intensity + (log.rpe ? ` (RPE ${log.rpe})` : ""));
  if (log.distance_miles) parts.push(`${log.distance_miles} mi`);
  if (log.reps) parts.push(`${log.reps} reps`);
  if (log.location) parts.push(log.location);
  return parts.join(" · ");
}

function logWhat(log) {
  if (log.session_type || log.title) {
    const s = sessionSummary(log);
    return (log.title || log.session_type) + (s ? " (" + s + ")" : "");
  }
  return (log.activities || []).map((a) => a.name + activitySummary(a)).join("; ");
}

function logDetailHTML(log) {
  if (log.session_type || log.title) {
    const tags = log.ptl_verified ? '<span class="tag ptl">PTL verified</span>' : "";
    return `
      <div class="log-meta">${log.duration_minutes} minutes${log.intensity ? " · " + esc(log.intensity) : ""}${log.rpe ? " · RPE " + log.rpe : ""}</div>
      <div class="log-title">${esc(log.title || log.session_type || "PT session")}</div>
      ${sessionSummary(log) ? `<div class="log-sub">${esc(sessionSummary(log))}</div>` : ""}
      ${log.notes ? `<div class="log-notes">${esc(log.notes)}</div>` : ""}
      ${tags ? `<div class="log-tags">${tags}</div>` : ""}`;
  }
  const acts = (log.activities || []).map((a) => `<li>${esc(a.name)}${activitySummary(a)}</li>`).join("");
  return `
    <div class="log-meta">${log.duration_minutes} minutes</div>
    <ul>${acts}</ul>
    ${log.notes ? `<div class="log-notes">${esc(log.notes)}</div>` : ""}`;
}

function resetLogForm() {
  editingDate = null;
  $("log-form-title").textContent = "Log PT";
  const wrap = $("log-for-wrap");
  if (profile && profile.role === "admin") {
    wrap.classList.remove("hidden");
    $("log-for-member").value = profile.id;
  } else {
    wrap.classList.add("hidden");
  }
  $("log-date").value = todayStr();
  $("log-date").disabled = false;
  selectSessionType("Running", true);
  selectIntensity("Moderate", true);
  $("log-notes").value = "";
  $("log-ptl").checked = false;
  $("btn-cancel-edit").classList.add("hidden");
  clearMsg("log-error");
  $("log-saved").classList.add("hidden");
  setOn("#date-chips .qchip", "days", "0");
}

async function populateLogForMembers() {
  const sel = $("log-for-member");
  sel.innerHTML = "";
  const { data, error } = await supabase.from("profiles").select("id,name,rank").order("name");
  if (error || !data) return;
  data.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = (m.rank ? m.rank + " " : "") + m.name + (m.id === profile.id ? " (you)" : "");
    sel.appendChild(o);
  });
  sel.value = profile.id;
}

function logTargetId() {
  if (profile && profile.role === "admin" && !$("log-for-wrap").classList.contains("hidden")) {
    return $("log-for-member").value || profile.id;
  }
  return profile.id;
}

function openLogFor(memberId, memberName) {
  document.querySelectorAll(".viewnav-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll('.viewnav-btn[data-view="dashboard"]').forEach((b) => b.classList.add("active"));
  show("view-dashboard");
  resetLogForm();
  if (memberId && memberId !== profile.id) {
    $("log-for-member").value = memberId;
    $("log-form-title").textContent = "Log PT for " + memberName;
  }
  window.scrollTo(0, 0);
}

function calcStreak(datesDesc) {
  const set = new Set(datesDesc);
  let cursor = todayStr();
  if (!set.has(cursor)) cursor = addDaysStr(cursor, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = addDaysStr(cursor, -1);
  }
  return streak;
}

async function loadDashboard() {
  const { data: logs, error } = await supabase
    .from("pt_logs").select("*").eq("user_id", profile.id).order("log_date", { ascending: false });
  if (error) {
    showError("log-error", "Could not load your logs: " + error.message);
    return;
  }
  const dates = logs.map((l) => l.log_date);
  $("stat-streak").textContent = calcStreak(dates);
  $("stat-total").textContent = logs.length;
  $("stat-minutes").textContent = logs.reduce((s, l) => s + (l.duration_minutes || 0), 0);

  const weekStart = presetRange("week").start;
  const weekCount = logs.filter((l) => l.log_date >= weekStart).length;
  const target = 5;
  $("target-count").textContent = `${weekCount} / ${target}`;
  $("target-fill").style.width = Math.min(100, Math.round((weekCount / target) * 100)) + "%";

  await loadPfaSummary();

  const list = $("history-list");
  list.innerHTML = "";
  if (!logs.length) {
    list.innerHTML = '<p class="muted">No logs yet. Your first entry will show up here.</p>';
    return;
  }
  logs.forEach((log) => {
    const div = document.createElement("div");
    div.className = "log-item";
    div.innerHTML = `
      <div class="log-date">${prettyDate(log.log_date)}</div>
      ${logDetailHTML(log)}
      <div class="log-actions"><button type="button" class="link-btn">Edit</button></div>`;
    div.querySelector(".link-btn").addEventListener("click", () => startEdit(log));
    list.appendChild(div);
  });
}

function startEdit(log) {
  editingDate = log.log_date;
  $("log-form-title").textContent = "Edit log for " + prettyDate(log.log_date);
  $("log-date").value = log.log_date;
  $("log-date").disabled = true;
  if (profile && profile.role === "admin") {
    $("log-for-member").value = profile.id;
  }
  const legacyTitle = (log.activities && log.activities[0] && log.activities[0].name) || "";
  selectSessionType(log.session_type || "Running", false);
  selectIntensity(log.intensity || "Moderate", false);
  $("log-title").value = log.title || legacyTitle;
  $("log-location").value = log.location || "";
  $("log-duration").value = log.duration_minutes || "";
  setOn("#duration-chips .qchip", "val", log.duration_minutes || "");
  $("log-rpe").value = log.rpe || "";
  $("log-distance").value = log.distance_miles || "";
  $("log-reps").value = log.reps || "";
  $("log-notes").value = log.notes || "";
  $("log-ptl").checked = !!log.ptl_verified;
  $("btn-cancel-edit").classList.remove("hidden");
  clearMsg("log-error");
  $("log-saved").classList.add("hidden");
  window.scrollTo(0, 0);
}

function wireLogForm() {
  buildPickers();
  document.querySelectorAll("#duration-chips .qchip").forEach((c) => {
    c.addEventListener("click", () => {
      $("log-duration").value = c.dataset.val;
      setOn("#duration-chips .qchip", "val", c.dataset.val);
    });
  });
  $("log-duration").addEventListener("input", () =>
    setOn("#duration-chips .qchip", "val", $("log-duration").value));
  document.querySelectorAll("#date-chips .qchip").forEach((c) => {
    c.addEventListener("click", () => {
      $("log-date").value = addDaysStr(todayStr(), -parseInt(c.dataset.days, 10));
      setOn("#date-chips .qchip", "days", c.dataset.days);
    });
  });
  $("log-for-member").addEventListener("change", () => {
    const sel = $("log-for-member");
    const isSelf = sel.value === profile.id;
    $("log-form-title").textContent = isSelf
      ? "Log PT"
      : "Log PT for " + sel.options[sel.selectedIndex].textContent.replace(/ \(you\)$/, "");
  });
  $("btn-cancel-edit").addEventListener("click", resetLogForm);
  $("form-log").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("log-error");
    $("log-saved").classList.add("hidden");
    const logDate = editingDate || $("log-date").value;
    if (!logDate) return showError("log-error", "Pick a date.");
    const duration = parseInt($("log-duration").value, 10);
    if (!Number.isFinite(duration) || duration < 5)
      return showError("log-error", "Enter the duration in minutes (at least 5).");
    const title = $("log-title").value.trim() || selSessionType + " session";
    const rpeRaw = parseInt($("log-rpe").value, 10);
    const distRaw = parseFloat($("log-distance").value);
    const repsRaw = parseInt($("log-reps").value, 10);
    const notes = $("log-notes").value.trim();
    try {
      const targetId = logTargetId();
      const { error } = await supabase.from("pt_logs").upsert(
        {
          user_id: targetId,
          log_date: logDate,
          session_type: selSessionType,
          intensity: selIntensity,
          rpe: Number.isFinite(rpeRaw) ? Math.min(10, Math.max(1, rpeRaw)) : null,
          title,
          location: $("log-location").value.trim(),
          distance_miles: Number.isFinite(distRaw) && distRaw > 0 ? distRaw : null,
          reps: Number.isFinite(repsRaw) && repsRaw > 0 ? repsRaw : null,
          ptl_verified: $("log-ptl").checked,
          duration_minutes: duration,
          notes,
          activities: [],
        },
        { onConflict: "user_id,log_date" }
      );
      if (error) throw error;
      $("log-saved").classList.remove("hidden");
      resetLogForm();
      await loadDashboard();
    } catch (err) {
      showError("log-error", "Could not save: " + err.message);
    }
  });
}

function pfaPill(m) {
  const due = m.pfa_due_date;
  if (!due) return '<span class="badge badge-na">Not set</span>';
  const days = Math.round((new Date(due + "T12:00:00") - new Date(todayStr() + "T12:00:00")) / 86400000);
  if (days < 0) return '<span class="badge badge-missing">Overdue</span>';
  if (days <= 30) return '<span class="badge badge-due">Due soon</span>';
  return '<span class="badge badge-logged">Current</span>';
}

function pfaDueText(m) {
  if (!m.pfa_due_date) return "Not set";
  const days = Math.round((new Date(m.pfa_due_date + "T12:00:00") - new Date(todayStr() + "T12:00:00")) / 86400000);
  const when = days < 0 ? `${-days}d overdue` : days === 0 ? "due today" : `${days}d remaining`;
  return `${m.pfa_due_date} (${when})`;
}

async function loadPfaSummary() {
  const box = $("pfa-summary");
  const { data: tests } = await supabase
    .from("pfa_tests").select("test_date,score,rating")
    .eq("user_id", profile.id).order("test_date", { ascending: false }).limit(1);
  const last = tests && tests[0];
  const scoreLine = last
    ? `<div class="pfa-score">${esc(String(last.score))}<span class="pfa-rating">${esc(last.rating || "")}</span></div>
       <div class="muted">Last test ${prettyDate(last.test_date)}</div>`
    : profile.pfa_score != null
      ? `<div class="pfa-score">${esc(String(profile.pfa_score))}</div>`
      : '<p class="muted">No official PFA recorded yet.</p>';
  box.innerHTML = `
    ${scoreLine}
    <div class="pfa-due">PFA due: <strong>${esc(pfaDueText(profile))}</strong></div>`;
}

/* ---------- Notifications ---------- */

let notifCache = [];

async function loadNotifications() {
  const { data, error } = await supabase
    .from("notifications").select("*").eq("user_id", profile.id)
    .order("created_at", { ascending: false }).limit(50);
  if (error) return;
  notifCache = data || [];
  renderNotifications();
}

function renderNotifications() {
  const unread = notifCache.filter((n) => !n.read_at).length;
  const count = $("bell-count");
  count.textContent = unread > 9 ? "9+" : String(unread);
  count.classList.toggle("hidden", unread === 0);
  const list = $("notif-list");
  if (!notifCache.length) {
    list.innerHTML = '<p class="muted">No alerts.</p>';
    return;
  }
  list.innerHTML = notifCache.map((n) => `
    <div class="notif ${n.read_at ? "" : "unread"}">
      <div class="notif-title">${esc(n.title)}</div>
      ${n.body ? `<div class="notif-body">${esc(n.body)}</div>` : ""}
      <div class="notif-time">${new Date(n.created_at).toLocaleString()}</div>
    </div>`).join("");
}

function openNotifs() {
  $("notif-drawer").classList.remove("hidden");
  $("notif-backdrop").classList.remove("hidden");
}

function closeNotifs() {
  $("notif-drawer").classList.add("hidden");
  $("notif-backdrop").classList.add("hidden");
}

async function markNotifsRead() {
  const ids = notifCache.filter((n) => !n.read_at).map((n) => n.id);
  if (!ids.length) return;
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
  notifCache.forEach((n) => { if (!n.read_at) n.read_at = new Date().toISOString(); });
  renderNotifications();
}

function wireNotifs() {
  $("btn-bell").addEventListener("click", openNotifs);
  $("btn-notif-close").addEventListener("click", closeNotifs);
  $("notif-backdrop").addEventListener("click", closeNotifs);
  $("btn-notif-read").addEventListener("click", markNotifsRead);
}

/* ---------- Admin ---------- */

function wireNav() {
  document.querySelectorAll(".viewnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view;
      document.querySelectorAll(".viewnav-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(`.viewnav-btn[data-view="${target}"]`).forEach((b) => b.classList.add("active"));
      if (target === "admin") {
        show("view-admin");
        loadRoster();
      } else if (target === "reports") {
        show("view-reports");
        loadReports();
      } else {
        show("view-dashboard");
      }
    });
  });
  $("admin-date").addEventListener("change", loadRoster);
  $("roster-search").addEventListener("input", () => {
    const date = $("admin-date").value || todayStr();
    renderRoster(date, lastRosterLoggedBy);
  });
  $("btn-report-close").addEventListener("click", closeModals);
  $("modal-backdrop").addEventListener("click", closeModals);
  wireMemberEdit();
  wirePfaModal();
  wireNotifs();
  wireReports();
}

function memberLabel(m) {
  return (m.rank ? m.rank + " " : "") + m.name;
}

let rosterCache = [];
let lastRosterLoggedBy = new Map();

async function loadRoster() {
  const date = $("admin-date").value || todayStr();
  $("admin-date").value = date;
  const [{ data: members, error: mErr }, { data: logs, error: lErr }] = await Promise.all([
    supabase.from("profiles").select("id,name,email,role,rank,flight,pfa_due_date,pfa_score,created_at").order("name"),
    supabase.from("pt_logs").select("user_id,duration_minutes").eq("log_date", date),
  ]);
  if (mErr || lErr) {
    $("admin-summary").textContent = "Could not load the roster.";
    return;
  }
  rosterCache = members || [];
  lastRosterLoggedBy = new Map((logs || []).map((l) => [l.user_id, l.duration_minutes]));
  renderRoster(date, lastRosterLoggedBy);
}

function renderRoster(date, loggedBy) {
  const q = ($("roster-search").value || "").trim().toLowerCase();
  const members = rosterCache.filter((m) =>
    !q || (m.name + " " + (m.email || "") + " " + (m.flight || "") + " " + (m.rank || "")).toLowerCase().includes(q)
  );
  const loggedCount = rosterCache.filter((m) => loggedBy.has(m.id)).length;
  $("admin-summary").textContent = `${loggedCount} of ${rosterCache.length} members logged PT on ${prettyDate(date)}.`;

  const list = $("roster-list");
  list.innerHTML = "";
  if (!members.length) {
    list.innerHTML = '<p class="muted">No members match.</p>';
    return;
  }
  members.forEach((m) => {
    const logged = loggedBy.has(m.id);
    const row = document.createElement("div");
    row.className = "roster-row";
    row.innerHTML = `
      <div class="roster-main">
        <div class="roster-name">${esc(memberLabel(m))}
          <span class="role-badge ${m.role === "admin" ? "is-admin" : ""}">${m.role === "admin" ? "Admin" : "Member"}</span>
        </div>
        <div class="roster-sub">${esc([m.flight, m.email].filter(Boolean).join(" • "))}${logged ? ` • ${loggedBy.get(m.id)} min` : ""}</div>
        <div class="roster-pfa">${pfaPill(m)}${m.pfa_score != null ? ` <span class="sub">PFA ${esc(String(m.pfa_score))}</span>` : ""}</div>
      </div>
      <span class="badge ${logged ? "on" : "off"}">${logged ? "Logged" : "Missing"}</span>
      <div class="roster-btns">
        <button type="button" class="btn btn-ghost btn-sm" data-act="report">Report</button>
        ${m.id !== profile.id ? `<button type="button" class="btn btn-danger" data-act="remove">Remove</button>` : ""}
      </div>`;
    row.querySelector('[data-act="report"]').addEventListener("click", (e) => {
      e.stopPropagation();
      openMemberReport(m.id);
    });
    const rmBtn = row.querySelector('[data-act="remove"]');
    if (rmBtn) {
      rmBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove ${m.name}? This deletes their profile and all of their PT logs.`)) return;
        const { error } = await supabase.from("profiles").delete().eq("id", m.id);
        if (error) alert("Could not remove: " + error.message);
        else {
          alert(`${m.name} was removed. To fully block sign in, also delete them under Authentication > Users in Supabase.`);
          loadRoster();
        }
      });
    }
    row.addEventListener("click", () => openMemberReport(m.id));
    list.appendChild(row);
  });
}

/* ----- Member report modal ----- */

let reportMemberId = null;

function openModal(id) {
  $(id).classList.remove("hidden");
  $("modal-backdrop").classList.remove("hidden");
}
function closeModals() {
  ["member-report-modal", "member-edit-modal", "pfa-modal"].forEach((id) => $(id).classList.add("hidden"));
  $("modal-backdrop").classList.add("hidden");
}

async function openMemberReport(memberId) {
  reportMemberId = memberId;
  const box = $("member-report");
  box.innerHTML = '<p class="muted">Loading...</p>';
  openModal("member-report-modal");
  const [{ data: m }, { data: logs }, { data: tests }] = await Promise.all([
    supabase.from("profiles").select("id,name,email,role,rank,flight,pfa_due_date,pfa_score").eq("id", memberId).single(),
    supabase.from("pt_logs").select("*").eq("user_id", memberId).order("log_date", { ascending: false }).limit(60),
    supabase.from("pfa_tests").select("*").eq("user_id", memberId).order("test_date", { ascending: false }),
  ]);
  if (!m) {
    box.innerHTML = '<p class="muted">Member not found.</p>';
    return;
  }
  const pfaRows = (tests || []).map((t) => `
    <div class="pfa-row"><span>${prettyDate(t.test_date)}</span><strong>${esc(String(t.score))}</strong><span class="muted">${esc(t.rating || "")}</span></div>`).join("");
  const logRows = (logs || []).map((log) => `
    <div class="log-item">
      <div class="log-date">${prettyDate(log.log_date)}</div>
      ${logDetailHTML(log)}
      <div class="log-actions"><button type="button" class="link-btn danger" data-delog="${log.id}">Delete</button></div>
    </div>`).join("");
  box.innerHTML = `
    <div class="mr-head">
      <div>
        <div class="mr-name">${esc(memberLabel(m))}</div>
        <div class="muted">${esc([m.flight, m.email].filter(Boolean).join(" • "))}</div>
        <div class="mr-badges"><span class="role-badge ${m.role === "admin" ? "is-admin" : ""}">${m.role === "admin" ? "Admin" : "Member"}</span> ${pfaPill(m)}</div>
      </div>
    </div>
    <div class="mr-actions">
      <button class="btn btn-ghost btn-sm" id="mr-log" type="button">Log PT</button>
      <button class="btn btn-ghost btn-sm" id="mr-remind" type="button">Remind</button>
      <button class="btn btn-ghost btn-sm" id="mr-pfa" type="button">Record PFA</button>
      <button class="btn btn-ghost btn-sm" id="mr-edit" type="button">Edit</button>
    </div>
    <h3>Official PFA History</h3>
    <div class="pfa-history">${pfaRows || '<p class="muted">No official PFA tests recorded.</p>'}</div>
    <h3>PT Logs (${(logs || []).length})</h3>
    <div class="history">${logRows || '<p class="muted">No logs yet.</p>'}</div>`;
  $("mr-log").addEventListener("click", () => {
    closeModals();
    openLogFor(m.id, memberLabel(m));
  });
  $("mr-remind").addEventListener("click", () => sendReminder(m, "recent days"));
  $("mr-pfa").addEventListener("click", () => openPfaModal(m));
  $("mr-edit").addEventListener("click", () => openMemberEdit(m));
  box.querySelectorAll("[data-delog]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm("Delete this PT log?")) return;
      const { error } = await supabase.from("pt_logs").delete().eq("id", b.dataset.delog);
      if (error) alert("Could not delete: " + error.message);
      else openMemberReport(memberId);
    });
  });
}

async function sendReminder(m, rangeLabel) {
  if (!confirm(`Send a PT compliance reminder to ${memberLabel(m)}?`)) return;
  const { error } = await supabase.from("notifications").insert({
    user_id: m.id,
    kind: "reminder",
    title: "PT Compliance Notice",
    body: `You have no PT log on file for ${rangeLabel}. Please log your training session.`,
  });
  if (error) alert("Could not send reminder: " + error.message);
  else {
    alert("Reminder sent.");
    if (reportPreset) loadReports();
  }
}

/* ----- Edit member modal ----- */

let editingMemberId = null;

function fillRankSelect(sel, current) {
  sel.innerHTML = '<option value="">Select rank</option>' + RANKS.map((r) =>
    `<option ${r === current ? "selected" : ""}>${r}</option>`).join("");
}

function openMemberEdit(m) {
  editingMemberId = m.id;
  closeModals();
  $("member-edit-title").textContent = "Edit " + memberLabel(m);
  fillRankSelect($("m-rank"), m.rank || "");
  $("m-role").value = m.role || "member";
  $("m-name").value = m.name || "";
  $("m-flight").value = m.flight || "";
  $("m-pfa-due").value = m.pfa_due_date || "";
  clearMsg("member-edit-error");
  openModal("member-edit-modal");
}

function wireMemberEdit() {
  $("form-member-edit").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("member-edit-error");
    const name = $("m-name").value.trim();
    if (name.length < 2) return showError("member-edit-error", "Enter the member's full name.");
    if (editingMemberId === profile.id && $("m-role").value !== "admin") {
      return showError("member-edit-error", "You cannot remove your own admin role.");
    }
    const { error } = await supabase.from("profiles").update({
      rank: $("m-rank").value,
      role: $("m-role").value,
      name,
      flight: $("m-flight").value.trim(),
      pfa_due_date: $("m-pfa-due").value || null,
    }).eq("id", editingMemberId);
    if (error) return showError("member-edit-error", "Could not save: " + error.message);
    closeModals();
    loadRoster();
    if (reportMemberId) openMemberReport(reportMemberId);
  });
  $("btn-member-edit-cancel").addEventListener("click", closeModals);
}

/* ----- Record PFA test modal ----- */

let pfaMember = null;

function openPfaModal(m) {
  pfaMember = m;
  closeModals();
  $("pfa-modal-member").textContent = "For " + memberLabel(m);
  $("pfa-date").value = todayStr();
  $("pfa-score").value = "";
  clearMsg("pfa-error");
  openModal("pfa-modal");
}

function wirePfaModal() {
  $("form-pfa").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("pfa-error");
    const testDate = $("pfa-date").value;
    const score = parseFloat($("pfa-score").value);
    if (!testDate) return showError("pfa-error", "Pick the test date.");
    if (!Number.isFinite(score) || score < 0 || score > 100)
      return showError("pfa-error", "Enter a score from 0 to 100.");
    const rating = $("pfa-rating").value;
    const { error: tErr } = await supabase.from("pfa_tests").upsert(
      { user_id: pfaMember.id, test_date: testDate, score, rating },
      { onConflict: "user_id,test_date" }
    );
    if (tErr) return showError("pfa-error", "Could not save: " + tErr.message);
    const { error: pErr } = await supabase.from("profiles").update({ pfa_score: score }).eq("id", pfaMember.id);
    if (pErr) return showError("pfa-error", "Test saved, but profile score did not update: " + pErr.message);
    const { error: nErr } = await supabase.from("notifications").insert({
      user_id: pfaMember.id,
      kind: "pfa",
      title: "Official PFA Recorded",
      body: `Your PFA test on ${testDate} was recorded: ${score} (${rating}).`,
    });
    if (nErr) console.warn("PFA notification failed:", nErr.message);
    closeModals();
    loadRoster();
    if (reportMemberId) openMemberReport(reportMemberId);
  });
  $("btn-pfa-cancel").addEventListener("click", closeModals);
}

/* ---------- Reports ---------- */

let reportPreset = "today";
let reportTab = "roster";
let reportRows = [];
let reportLogs = [];
let reportMembers = new Map();
let reportRange = { start: "", end: "" };
let reportSort = { key: "sessions", dir: -1 };
let reportFlight = "";
let reportFlights = [];
let remindedIds = new Set();

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function presetRange(preset) {
  const end = todayStr();
  if (preset === "today") return { start: end, end };
  if (preset === "week") {
    const day = new Date(end + "T12:00:00").getDay();
    const back = day === 0 ? -6 : 1 - day;
    return { start: addDaysStr(end, back), end };
  }
  if (preset === "last7") return { start: addDaysStr(end, -6), end };
  if (preset === "month") return { start: end.slice(0, 8) + "01", end };
  if (preset === "last30") return { start: addDaysStr(end, -29), end };
  const s = $("report-start").value || end;
  const e = $("report-end").value || end;
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}

function wireReports() {
  document.querySelectorAll("#report-presets .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#report-presets .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      reportPreset = chip.dataset.preset;
      $("report-custom").classList.toggle("hidden", reportPreset !== "custom");
      if (reportPreset === "custom") {
        if (!$("report-start").value) $("report-start").value = addDaysStr(todayStr(), -29);
        if (!$("report-end").value) $("report-end").value = todayStr();
      }
      loadReports();
    });
  });
  $("report-start").addEventListener("change", () => { if (reportPreset === "custom") loadReports(); });
  $("report-end").addEventListener("change", () => { if (reportPreset === "custom") loadReports(); });
  document.querySelectorAll("[data-rtab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-rtab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      reportTab = btn.dataset.rtab;
      $("report-roster-wrap").classList.toggle("hidden", reportTab !== "roster");
      $("report-activity-wrap").classList.toggle("hidden", reportTab !== "activity");
      renderReport();
    });
  });
  $("report-search").addEventListener("input", renderReport);
  $("report-flight").addEventListener("change", () => {
    reportFlight = $("report-flight").value;
    renderReport();
  });
  $("btn-remind-missing").addEventListener("click", async () => {
    const missing = flightFilteredRows().filter((r) => !r.logged && !remindedIds.has(r.member.id));
    if (!missing.length) return;
    if (!confirm(`Send PT compliance reminders to ${missing.length} member${missing.length === 1 ? "" : "s"}?`)) return;
    const rangeLabel = `${prettyDate(reportRange.start)} to ${prettyDate(reportRange.end)}`;
    let sent = 0;
    for (const r of missing) {
      const { error } = await supabase.from("notifications").insert({
        user_id: r.member.id,
        kind: "reminder",
        title: "PT Compliance Notice",
        body: `You have no PT log on file for ${rangeLabel}. Please log your training session.`,
      });
      if (!error) {
        sent++;
        remindedIds.add(r.member.id);
      }
    }
    alert(`Sent ${sent} reminder${sent === 1 ? "" : "s"}.`);
    renderReport();
  });
  $("report-roster-wrap").addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.sort;
    if (reportSort.key === key) {
      reportSort.dir *= -1;
    } else {
      reportSort = { key, dir: key === "name" ? 1 : -1 };
    }
    renderRosterTab();
  });
  $("btn-export-csv").addEventListener("click", exportReportCSV);
  $("btn-print-report").addEventListener("click", () => window.print());
}

async function loadReports() {
  const { start, end } = presetRange(reportPreset);
  reportRange = { start, end };
  $("report-range-label").textContent = `${prettyDate(start)} to ${prettyDate(end)}`;
  $("report-roster-wrap").innerHTML = '<p class="muted">Loading report...</p>';
  $("report-activity-wrap").innerHTML = "";

  const [mRes, lRes, nRes] = await Promise.all([
    supabase.from("profiles").select("id,name,email,role,rank,flight,pfa_due_date,pfa_score").order("name"),
    supabase.from("pt_logs")
      .select("user_id,log_date,duration_minutes,activities,notes,session_type,intensity,rpe,title,location,distance_miles,reps,ptl_verified")
      .gte("log_date", start).lte("log_date", end)
      .order("log_date", { ascending: false }),
    supabase.from("notifications").select("user_id")
      .eq("kind", "reminder").gte("created_at", addDaysStr(todayStr(), -7) + "T00:00:00"),
  ]);
  if (mRes.error || lRes.error) {
    $("report-roster-wrap").innerHTML = '<p class="muted">Could not load the report. Try again.</p>';
    return;
  }
  reportMembers = new Map(mRes.data.map((m) => [m.id, m]));
  reportLogs = lRes.data || [];
  remindedIds = new Set((nRes.data || []).map((n) => n.user_id));

  reportFlights = [...new Set(mRes.data.map((m) => (m.flight || "").trim()).filter(Boolean))].sort();
  const fSel = $("report-flight");
  const cur = reportFlight;
  fSel.innerHTML = '<option value="">All Flights</option>' + reportFlights.map((f) =>
    `<option value="${esc(f)}">${esc(f)}</option>`).join("");
  reportFlight = reportFlights.includes(cur) ? cur : "";
  fSel.value = reportFlight;

  const agg = new Map();
  mRes.data.forEach((m) =>
    agg.set(m.id, { member: m, sessions: 0, minutes: 0, days: new Set(), last: null })
  );
  reportLogs.forEach((log) => {
    const a = agg.get(log.user_id);
    if (!a) return;
    a.sessions += 1;
    a.minutes += log.duration_minutes || 0;
    a.days.add(log.log_date);
    if (!a.last || log.log_date > a.last) a.last = log.log_date;
  });
  reportRows = [...agg.values()].map((a) => ({
    member: a.member,
    sessions: a.sessions,
    minutes: a.minutes,
    days: a.days.size,
    last: a.last,
    logged: a.sessions > 0,
  }));
  renderReport();
}

function flightFilteredRows() {
  if (!reportFlight) return reportRows;
  return reportRows.filter((r) => (r.member.flight || "").trim() === reportFlight);
}

function renderReport() {
  const rows = flightFilteredRows();
  const total = rows.length;
  const logged = rows.filter((r) => r.logged).length;
  const missing = total - logged;
  const scores = rows.map((r) => r.member.pfa_score).filter((s) => s != null);
  const pfaAvg = scores.length ? (scores.reduce((a, b) => a + Number(b), 0) / scores.length).toFixed(1) : "—";
  $("report-stats").innerHTML = `
    <div class="stat"><div class="stat-num">${total}</div><div class="stat-label">Assigned</div></div>
    <div class="stat"><div class="stat-num">${logged} <span class="stat-pct">(${pct(logged, total)}%)</span></div><div class="stat-label">Submitted</div></div>
    <div class="stat"><div class="stat-num">${missing} <span class="stat-pct">(${pct(missing, total)}%)</span></div><div class="stat-label">Missing</div></div>
    <div class="stat"><div class="stat-num">${pfaAvg}</div><div class="stat-label">PFA Avg</div></div>`;
  const missingNoRemind = rows.filter((r) => !r.logged && !remindedIds.has(r.member.id)).length;
  const btn = $("btn-remind-missing");
  btn.textContent = `Remind Missing (${missingNoRemind})`;
  btn.disabled = missingNoRemind === 0;
  renderRosterTab();
  renderActivityTab();
}

function filteredReportRows() {
  const q = $("report-search").value.trim().toLowerCase();
  let rows = flightFilteredRows();
  if (reportTab === "roster" && q) {
    rows = rows.filter((r) =>
      (memberLabel(r.member) + " " + (r.member.email || "") + " " + (r.member.flight || "")).toLowerCase().includes(q)
    );
  }
  const { key, dir } = reportSort;
  return [...rows].sort((a, b) => {
    let va, vb;
    if (key === "name") { va = a.member.name.toLowerCase(); vb = b.member.name.toLowerCase(); }
    else if (key === "last") { va = a.last || ""; vb = b.last || ""; }
    else { va = a[key]; vb = b[key]; }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

function sortArrow(key) {
  if (reportSort.key !== key) return "";
  return reportSort.dir === 1 ? " &#9650;" : " &#9660;";
}

function renderRosterTab() {
  const box = $("report-roster-wrap");
  const rows = filteredReportRows();
  if (!rows.length) {
    box.innerHTML = '<p class="muted">No members match.</p>';
    return;
  }
  box.innerHTML = `
    <div class="table-scroll">
    <table class="report-table">
      <thead><tr>
        <th class="sortable" data-sort="name">Member${sortArrow("name")}</th>
        <th>Flight</th>
        <th class="sortable num" data-sort="sessions">Logs${sortArrow("sessions")}</th>
        <th class="sortable" data-sort="last">Last PT${sortArrow("last")}</th>
        <th>PFA</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => {
          const m = r.member;
          const reminded = remindedIds.has(m.id);
          return `
          <tr>
            <td><strong>${esc(memberLabel(m))}</strong><div class="sub">${esc(m.email || "")}</div></td>
            <td>${esc(m.flight || "—")}</td>
            <td class="num">${r.sessions}</td>
            <td>${r.last ? prettyDate(r.last) : "<span class='sub'>—</span>"}</td>
            <td>${pfaPill(m)}</td>
            <td class="row-actions">
              <button type="button" class="link-btn" data-ract="report" data-mid="${m.id}">Report</button>
              <button type="button" class="link-btn" data-ract="log" data-mid="${m.id}">Log PT</button>
              ${r.logged
                ? ""
                : reminded
                  ? '<span class="sub">Reminded</span>'
                  : `<button type="button" class="link-btn" data-ract="remind" data-mid="${m.id}">Remind</button>`}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>`;
  box.querySelectorAll("[data-ract]").forEach((b) => {
    b.addEventListener("click", () => {
      const m = reportMembers.get(b.dataset.mid);
      if (!m) return;
      const act = b.dataset.ract;
      if (act === "report") openMemberReport(m.id);
      else if (act === "log") openLogFor(m.id, memberLabel(m));
      else if (act === "remind") sendReminder(m, `${prettyDate(reportRange.start)} to ${prettyDate(reportRange.end)}`);
    });
  });
}

function renderActivityTab() {
  const box = $("report-activity-wrap");
  const q = $("report-search").value.trim().toLowerCase();
  let logs = reportLogs;
  if (reportTab === "activity" && q) {
    logs = logs.filter((log) => {
      const m = reportMembers.get(log.user_id);
      const hay = (
        (m ? m.name : "") + " " +
        (log.title || "") + " " + (log.session_type || "") + " " + (log.location || "") + " " +
        (log.activities || []).map((a) => a.name).join(" ") + " " +
        (log.notes || "")
      ).toLowerCase();
      return hay.includes(q);
    });
  }
  if (!logs.length) {
    box.innerHTML = '<p class="muted">No activity in this period.</p>';
    return;
  }
  box.innerHTML = logs.map((log) => {
    const m = reportMembers.get(log.user_id);
    const what = logWhat(log) + (log.ptl_verified ? " · PTL verified" : "");
    return `
      <div class="activity-row">
        <div class="row-top">
          <span class="who">${esc(m ? m.name : "Unknown member")}</span>
          <span class="when">${prettyDate(log.log_date)} &bull; ${log.duration_minutes || 0} min</span>
        </div>
        <div class="what">${esc(what) || "PT logged"}</div>
        ${log.notes ? `<div class="notes">${esc(log.notes)}</div>` : ""}
      </div>`;
  }).join("");
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportReportCSV() {
  const { start, end } = reportRange;
  let headers, lines;
  if (reportTab === "roster") {
    headers = ["Name", "Rank", "Flight", "Email", "Logs", "Last PT", "PFA due", "PFA score", "Status"];
    lines = filteredReportRows().map((r) => [
      r.member.name, r.member.rank || "", r.member.flight || "", r.member.email || "",
      r.sessions, r.last || "", r.member.pfa_due_date || "",
      r.member.pfa_score != null ? r.member.pfa_score : "",
      r.logged ? "Submitted" : "Missing",
    ]);
  } else {
    headers = ["Date", "Name", "Duration (min)", "Session", "Notes"];
    lines = reportLogs.map((log) => {
      const m = reportMembers.get(log.user_id);
      return [
        log.log_date, m ? m.name : "", log.duration_minutes || 0,
        logWhat(log) + (log.ptl_verified ? " [PTL verified]" : ""),
        log.notes || "",
      ];
    });
  }
  const csv = "\ufeff" + [headers, ...lines].map((row) => row.map(csvCell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `mdts-pt-report-${start}-to-${end}-${reportTab}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- Init ---------- */

async function init() {
  if (!configured) {
    const note = $("auth-note");
    note.textContent = "Setup is not finished yet: the Supabase URL and anon key still need to be added to config.js.";
    note.classList.remove("hidden");
    return;
  }
  wireAuthTabs();
  wireAuthForms();
  wireLogForm();
  wireNav();
  resetLogForm();
  $("admin-date").value = todayStr();
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await enterApp(session.user);
  } else {
    show("view-auth");
  }
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT") location.reload();
  });
}

init();
