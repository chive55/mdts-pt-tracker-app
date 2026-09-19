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

async function getOrCreateProfile(user, fallbackName) {
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const name = (user.user_metadata && user.user_metadata.name) || fallbackName || "Member";
  const { data: ins, error: insErr } = await supabase
    .from("profiles")
    .insert({ id: user.id, name, email: user.email })
    .select().single();
  if (insErr) throw insErr;
  return ins;
}

async function enterApp(user, fallbackName) {
  try {
    profile = await getOrCreateProfile(user, fallbackName);
  } catch (e) {
    showError("auth-error", "Signed in, but could not load your profile: " + e.message);
    return;
  }
  $("btn-signout").classList.remove("hidden");
  if (profile.role === "admin") $("nav-admin").classList.remove("hidden");
  show("view-dashboard");
  await loadDashboard();
}

function wireAuthForms() {
  $("form-signup").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("auth-error");
    const name = $("signup-name").value.trim();
    const email = $("signup-email").value.trim();
    const password = $("signup-password").value;
    if (name.length < 2) return showError("auth-error", "Please enter your full name.");
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { name } },
      });
      if (error) throw error;
      if (!data.session) {
        const note = $("auth-note");
        note.textContent = "Account created. Email confirmation is on, so check your inbox for the confirmation link, then sign in.";
        note.classList.remove("hidden");
        return;
      }
      await enterApp(data.user, name);
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

function addActivityRow(data = {}) {
  const wrap = document.createElement("div");
  wrap.className = "activity";
  wrap.innerHTML = `
    <div class="activity-head"><strong>Activity</strong>
      <button type="button" class="activity-remove">Remove</button></div>
    <label>Exercise name<input type="text" class="a-name" maxlength="80" placeholder="e.g. Run, Push-ups" value="${(data.name || "").replace(/"/g, "&quot;")}"></label>
    <div class="grid2">
      <label>Sets<input type="number" class="a-sets" min="1" max="999" inputmode="numeric" value="${data.sets || ""}"></label>
      <label>Reps<input type="number" class="a-reps" min="1" max="9999" inputmode="numeric" value="${data.reps || ""}"></label>
    </div>
    <div class="grid2">
      <label>Distance<input type="text" class="a-distance" maxlength="40" placeholder="e.g. 3.1 mi" value="${(data.distance || "").replace(/"/g, "&quot;")}"></label>
      <label>Time<input type="text" class="a-time" maxlength="40" placeholder="e.g. 28:30" value="${(data.time || "").replace(/"/g, "&quot;")}"></label>
    </div>`;
  wrap.querySelector(".activity-remove").addEventListener("click", () => {
    if ($("activities").children.length > 1) wrap.remove();
  });
  $("activities").appendChild(wrap);
}

function resetLogForm() {
  editingDate = null;
  $("log-form-title").textContent = "Log PT";
  $("log-date").value = todayStr();
  $("activities").innerHTML = "";
  addActivityRow();
  $("log-duration").value = "";
  $("log-notes").value = "";
  $("btn-cancel-edit").classList.add("hidden");
  clearMsg("log-error");
  $("log-saved").classList.add("hidden");
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

  const list = $("history-list");
  list.innerHTML = "";
  if (!logs.length) {
    list.innerHTML = '<p class="muted">No logs yet. Your first entry will show up here.</p>';
    return;
  }
  logs.forEach((log) => {
    const div = document.createElement("div");
    div.className = "log-item";
    const acts = (log.activities || []).map((a) => `<li>${a.name}${activitySummary(a)}</li>`).join("");
    div.innerHTML = `
      <div class="log-date">${prettyDate(log.log_date)}</div>
      <div class="log-meta">${log.duration_minutes} minutes</div>
      <ul>${acts}</ul>
      ${log.notes ? `<div class="log-notes">${log.notes.replace(/</g, "&lt;")}</div>` : ""}
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
  $("activities").innerHTML = "";
  (log.activities || []).forEach((a) => addActivityRow(a));
  if (!$("activities").children.length) addActivityRow();
  $("log-duration").value = log.duration_minutes || "";
  $("log-notes").value = log.notes || "";
  $("btn-cancel-edit").classList.remove("hidden");
  clearMsg("log-error");
  $("log-saved").classList.add("hidden");
  window.scrollTo(0, 0);
}

function wireLogForm() {
  $("btn-add-activity").addEventListener("click", () => {
    if ($("activities").children.length < 12) addActivityRow();
  });
  $("btn-cancel-edit").addEventListener("click", () => {
    $("log-date").disabled = false;
    resetLogForm();
  });
  $("form-log").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("log-error");
    $("log-saved").classList.add("hidden");
    const logDate = editingDate || $("log-date").value;
    const activities = [];
    $("activities").querySelectorAll(".activity").forEach((row) => {
      const name = row.querySelector(".a-name").value.trim();
      if (!name) return;
      const sets = parseInt(row.querySelector(".a-sets").value, 10);
      const reps = parseInt(row.querySelector(".a-reps").value, 10);
      activities.push({
        name,
        sets: Number.isFinite(sets) && sets > 0 ? sets : null,
        reps: Number.isFinite(reps) && reps > 0 ? reps : null,
        distance: row.querySelector(".a-distance").value.trim(),
        time: row.querySelector(".a-time").value.trim(),
      });
    });
    if (!activities.length) return showError("log-error", "Add at least one activity with a name.");
    const duration = parseInt($("log-duration").value, 10);
    if (!Number.isFinite(duration) || duration < 1) return showError("log-error", "Enter the total duration in minutes.");
    const notes = $("log-notes").value.trim();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("pt_logs").upsert(
        { user_id: user.id, log_date: logDate, activities, duration_minutes: duration, notes },
        { onConflict: "user_id,log_date" }
      );
      if (error) throw error;
      $("log-saved").classList.remove("hidden");
      $("log-date").disabled = false;
      resetLogForm();
      await loadDashboard();
    } catch (err) {
      showError("log-error", "Could not save: " + err.message);
    }
  });
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
      } else {
        show("view-dashboard");
      }
    });
  });
  $("admin-date").addEventListener("change", loadRoster);
  $("btn-back-roster").addEventListener("click", () => {
    $("member-detail-card").classList.add("hidden");
  });
}

async function loadRoster() {
  const date = $("admin-date").value || todayStr();
  $("admin-date").value = date;
  const [{ data: members, error: mErr }, { data: logs, error: lErr }] = await Promise.all([
    supabase.from("profiles").select("id,name,email,role,created_at").order("name"),
    supabase.from("pt_logs").select("user_id,duration_minutes").eq("log_date", date),
  ]);
  if (mErr || lErr) {
    $("admin-summary").textContent = "Could not load the roster.";
    return;
  }
  const loggedBy = new Map(logs.map((l) => [l.user_id, l.duration_minutes]));
  const loggedCount = members.filter((m) => loggedBy.has(m.id)).length;
  $("admin-summary").textContent = `${loggedCount} of ${members.length} members logged PT on ${prettyDate(date)}.`;

  const list = $("roster-list");
  list.innerHTML = "";
  $("member-detail-card").classList.add("hidden");
  members.forEach((m) => {
    const logged = loggedBy.has(m.id);
    const row = document.createElement("div");
    row.className = "roster-row";
    row.innerHTML = `
      <div class="roster-main">
        <div class="roster-name">${m.name.replace(/</g, "&lt;")}${m.role === "admin" ? " (admin)" : ""}</div>
        <div class="roster-sub">${m.email.replace(/</g, "&lt;")}${logged ? ` &bull; ${loggedBy.get(m.id)} min` : ""}</div>
      </div>
      <span class="badge ${logged ? "on" : "off"}">${logged ? "Logged" : "Missing"}</span>
      ${m.id !== profile.id ? `<button type="button" class="btn btn-danger">Remove</button>` : ""}`;
    row.querySelector(".roster-main").parentElement;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".btn-danger")) return;
      showMemberDetail(m);
    });
    const rmBtn = row.querySelector(".btn-danger");
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
    list.appendChild(row);
  });
}

async function showMemberDetail(m) {
  $("member-detail-name").textContent = m.name;
  const { data: logs, error } = await supabase
    .from("pt_logs").select("*").eq("user_id", m.id).order("log_date", { ascending: false });
  const box = $("member-detail-logs");
  box.innerHTML = "";
  if (error || !logs.length) {
    box.innerHTML = '<p class="muted">No logs yet.</p>';
  } else {
    logs.forEach((log) => {
      const acts = (log.activities || []).map((a) => `<li>${a.name}${activitySummary(a)}</li>`).join("");
      const div = document.createElement("div");
      div.className = "log-item";
      div.innerHTML = `
        <div class="log-date">${prettyDate(log.log_date)}</div>
        <div class="log-meta">${log.duration_minutes} minutes</div>
        <ul>${acts}</ul>
        ${log.notes ? `<div class="log-notes">${log.notes.replace(/</g, "&lt;")}</div>` : ""}`;
      box.appendChild(div);
    });
  }
  $("member-detail-card").classList.remove("hidden");
  $("member-detail-card").scrollIntoView({ behavior: "smooth" });
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
