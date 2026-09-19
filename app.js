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
  if (profile.role === "admin") {
    document.querySelectorAll(".admin-only").forEach((el) => el.classList.remove("hidden"));
  }
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
      } else if (target === "reports") {
        show("view-reports");
        loadReports();
      } else {
        show("view-dashboard");
      }
    });
  });
  $("admin-date").addEventListener("change", loadRoster);
  $("btn-back-roster").addEventListener("click", () => {
    $("member-detail-card").classList.add("hidden");
  });
  wireReports();
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

/* ---------- Reports ---------- */

let reportPreset = "today";
let reportTab = "roster";
let reportRows = [];
let reportLogs = [];
let reportMembers = new Map();
let reportRange = { start: "", end: "" };
let reportSort = { key: "sessions", dir: -1 };

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

  const [mRes, lRes] = await Promise.all([
    supabase.from("profiles").select("id,name,email").order("name"),
    supabase.from("pt_logs")
      .select("user_id,log_date,duration_minutes,activities,notes")
      .gte("log_date", start).lte("log_date", end)
      .order("log_date", { ascending: false }),
  ]);
  if (mRes.error || lRes.error) {
    $("report-roster-wrap").innerHTML = '<p class="muted">Could not load the report. Try again.</p>';
    return;
  }
  reportMembers = new Map(mRes.data.map((m) => [m.id, m]));
  reportLogs = lRes.data || [];

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

function renderReport() {
  const total = reportRows.length;
  const logged = reportRows.filter((r) => r.logged).length;
  const sessions = reportRows.reduce((s, r) => s + r.sessions, 0);
  const minutes = reportRows.reduce((s, r) => s + r.minutes, 0);
  const avgDays = total ? (reportRows.reduce((s, r) => s + r.days, 0) / total).toFixed(1) : "0.0";
  $("report-stats").innerHTML = `
    <div class="stat"><div class="stat-num">${total}</div><div class="stat-label">Members</div></div>
    <div class="stat"><div class="stat-num">${logged}</div><div class="stat-label">Logged (${pct(logged, total)}%)</div></div>
    <div class="stat"><div class="stat-num">${total - logged}</div><div class="stat-label">Missing</div></div>
    <div class="stat"><div class="stat-num">${sessions}</div><div class="stat-label">Sessions</div></div>
    <div class="stat"><div class="stat-num">${minutes}</div><div class="stat-label">Minutes</div></div>
    <div class="stat"><div class="stat-num">${avgDays}</div><div class="stat-label">Avg days / member</div></div>`;
  renderRosterTab();
  renderActivityTab();
}

function filteredReportRows() {
  const q = $("report-search").value.trim().toLowerCase();
  let rows = reportRows;
  if (reportTab === "roster" && q) {
    rows = rows.filter((r) =>
      (r.member.name + " " + (r.member.email || "")).toLowerCase().includes(q)
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
        <th class="sortable num" data-sort="sessions">Sessions${sortArrow("sessions")}</th>
        <th class="sortable num" data-sort="minutes">Minutes${sortArrow("minutes")}</th>
        <th class="sortable num" data-sort="days">Days${sortArrow("days")}</th>
        <th class="sortable" data-sort="last">Last logged${sortArrow("last")}</th>
        <th>Status</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td><strong>${esc(r.member.name)}</strong><div class="sub">${esc(r.member.email || "")}</div></td>
            <td class="num">${r.sessions}</td>
            <td class="num">${r.minutes}</td>
            <td class="num">${r.days}</td>
            <td>${r.last ? prettyDate(r.last) : "<span class='sub'>Never</span>"}</td>
            <td><span class="badge ${r.logged ? "badge-logged" : "badge-missing"}">${r.logged ? "Logged" : "Missing"}</span></td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>`;
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
    const acts = (log.activities || []).map((a) => a.name + activitySummary(a)).join(", ");
    return `
      <div class="activity-row">
        <div class="row-top">
          <span class="who">${esc(m ? m.name : "Unknown member")}</span>
          <span class="when">${prettyDate(log.log_date)} &bull; ${log.duration_minutes || 0} min</span>
        </div>
        <div class="what">${esc(acts) || "PT logged"}</div>
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
    headers = ["Name", "Email", "Sessions", "Minutes", "Days active", "Last logged", "Status"];
    lines = filteredReportRows().map((r) => [
      r.member.name, r.member.email || "", r.sessions, r.minutes, r.days,
      r.last || "", r.logged ? "Logged" : "Missing",
    ]);
  } else {
    headers = ["Date", "Name", "Duration (min)", "Activities", "Notes"];
    lines = reportLogs.map((log) => {
      const m = reportMembers.get(log.user_id);
      return [
        log.log_date, m ? m.name : "", log.duration_minutes || 0,
        (log.activities || []).map((a) => a.name + activitySummary(a)).join("; "),
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
