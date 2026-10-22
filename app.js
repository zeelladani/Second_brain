import { supabase } from "./supabase.js";
import { notifyErr } from "./js/ui.js";

/* ==========================================================================
   DOM
   ========================================================================== */
const $ = (id) => document.getElementById(id);
const authScreen = $("auth-screen");
const appEl = $("app");
const notesList = $("notes-list");
const dashboardView = $("dashboard-view");
const noteView = $("note-view");
const graphView = $("graph-view");
const canvasView = $("canvas-view");
const noteTitleInput = $("note-title-input");
const noteContentInput = $("note-content-input");
const projectSelect = $("note-project-select");
const graphContainer = $("graph-container");
const canvasArea = $("canvas-area");
const canvasWorld = $("canvas-world");
const canvasSvg = $("canvas-edges");
const searchInput = $("search-input");
const searchClear = $("search-clear");
const tagFilterEl = $("tag-filter");
const sbCount = $("sb-count");
const saveStatus = $("save-status");
const pinBtn = $("pin-btn");
const tagsBox = $("tags-box");
const tagInput = $("tag-input");
const panesEl = $("editor-panes");
const previewEl = $("note-preview");
const wordCountEl = $("word-count");
const metaInfoEl = $("meta-info");
const backlinksEl = $("backlinks");
const suggestEl = $("wiki-suggest");

/* ==========================================================================
   HELPERS
   ========================================================================== */
const DEFAULT_COLOR = "#a8f23d";
const NEUTRAL_COLOR = "#64748b";
const SVGNS = "http://www.w3.org/2000/svg";
const PALETTE = ["#a8f23d", "#3b82f6", "#f97316", "#ec4899", "#a855f7", "#14b8a6", "#eab308", "#ef4444"];
const BARE_TLDS = "com|net|org|edu|gov|mil|int|info|biz|name|pro|co|io|ai|app|dev|me|tv|cc|in|us|uk|ca|au|de|fr|jp|cn|ru|nl|br|es|it|se|no|fi|dk|pl|ch|at|be|nz|ie|sg|hk|kr|mx|xyz|online|site|tech|store|blog|club|cloud";
const BARE_URL_RE = new RegExp(
  `\\b(?:https?:\\/\\/[^\\s<]+|www\\.[^\\s<]+|(?<![@.\\w])[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${BARE_TLDS})(?:\\/[^\\s<]*)?)`,
  "gi"
);

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

const state = {
  uid: null,
  notes: [],
  noteMap: new Map(),
  projects: [],
  notesLoaded: false,
  activeNoteId: null,
  view: "dashboard",
  graphCfg: { repel: 120, link: 80, center: 0.05, size: 1, hideLabels: false },
  search: "",
  tagFilter: null,
  sort: lsGet("sb-sort", "modified"),
  mode: lsGet("ed-mode", "split"),
  collapsed: new Set(lsGet("sb-collapsed", []))
};
let unsubs = [];

const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const ts = (v) => (v ? new Date(v).getTime() : 0);
const trunc = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const fmtDate = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

const isHex = (c) => typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
function hexToRgb(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
function mixColors(list) {
  const rgbs = list.filter(isHex).map(hexToRgb);
  if (!rgbs.length) return DEFAULT_COLOR;
  const sum = rgbs.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]);
  return rgbToHex(sum.map((v) => v / rgbs.length));
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(isHex(hex) ? hex : DEFAULT_COLOR);
  return `rgba(${r},${g},${b},${a})`;
}
function projectColor(note) {
  if (!note || !note.project_id) return null;
  const p = state.projects.find((x) => x.id === note.project_id);
  return p ? (isHex(p.color) ? p.color : DEFAULT_COLOR) : null;
}

function extractWikiLinks(content) {
  const regex = /\[\[([^\[\]\n]{1,200})\]\]/g;
  const out = [];
  let m;
  while ((m = regex.exec(content))) {
    const t = m[1].split("|")[0].split("#")[0].trim();
    if (t) out.push(t);
  }
  return out;
}

function computeLinks(ids) {
  const links = new Map();
  const byTitle = new Map();
  state.notes.forEach((n) => {
    const t = (n.title || "").toLowerCase();
    if (t && !byTitle.has(t)) byTitle.set(t, n.id);
  });
  state.notes.forEach((n) => {
    if (!ids.has(n.id)) return;
    extractWikiLinks(n.content || "").forEach((title) => {
      const tid = byTitle.get(title.toLowerCase());
      if (tid && tid !== n.id && ids.has(tid)) links.set(edgeKey(n.id, tid), { a: n.id, b: tid });
    });
  });
  canvasPairs().forEach(([a, b]) => {
    if (ids.has(a) && ids.has(b)) links.set(edgeKey(a, b), { a, b });
  });
  return links;
}

const findNoteByTitle = (title) => {
  const t = title.trim().toLowerCase();
  return state.notes.find((n) => !n.archived && (n.title || "").toLowerCase() === t) || null;
};
function uniqueTitle(base) {
  const used = new Set(state.notes.map((n) => (n.title || "").toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let i = 2;
  while (used.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}

/* ==========================================================================
   TOASTS + MODALS
   ========================================================================== */
function toast(msg, { type = "", action, onAction, ms = 6000 } = {}) {
  const t = el("div", `toast ${type}`);
  t.append(el("span", "", msg));
  if (action) {
    const b = el("button", "toast-action", action);
    b.addEventListener("click", () => { onAction && onAction(); t.remove(); });
    t.append(b);
  }
  $("toasts").append(t);
  setTimeout(() => t.remove(), ms);
}

function openModal(build) {
  return new Promise((resolve) => {
    const overlay = el("div", "modal-overlay");
    const box = el("div", "modal-box");
    overlay.append(box);
    $("modal-root").append(overlay);
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(null); } };
    const close = (v) => { overlay.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    build(box, close);
  });
}

function confirmDialog(title, message, confirmLabel = "Delete") {
  return openModal((box, close) => {
    box.append(el("h3", "", title), el("p", "modal-text", message));
    const row = el("div", "modal-actions");
    const cancel = el("button", "btn", "Cancel");
    const ok = el("button", "btn btn-danger", confirmLabel);
    cancel.onclick = () => close(false);
    ok.onclick = () => close(true);
    row.append(cancel, ok);
    box.append(row);
    ok.focus();
  }).then((v) => !!v);
}

function projectDialog(initial = {}) {
  return openModal((box, close) => {
    box.append(el("h3", "", initial.name ? "Edit project" : "New project"));
    const input = el("input", "modal-input");
    input.placeholder = "Project name";
    input.value = initial.name || "";
    let color = initial.color || PALETTE[state.projects.length % PALETTE.length];
    const sw = el("div", "swatches");
    const paint = () => sw.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s.dataset.c === color));
    PALETTE.forEach((c) => {
      const s = el("button", "swatch");
      s.dataset.c = c;
      s.style.background = c;
      s.onclick = () => { color = c; paint(); };
      sw.append(s);
    });
    const custom = el("input", "swatch-custom");
    custom.type = "color";
    custom.value = isHex(color) && color.length === 7 ? color : "#a8f23d";
    custom.oninput = () => { color = custom.value; paint(); };
    sw.append(custom);
    const row = el("div", "modal-actions");
    const cancel = el("button", "btn", "Cancel");
    const ok = el("button", "btn btn-primary", initial.name ? "Save" : "Create");
    const submit = () => { const name = input.value.trim(); if (name) close({ name, color }); else input.focus(); };
    cancel.onclick = () => close(null);
    ok.onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    row.append(cancel, ok);
    box.append(input, sw, row);
    paint();
    input.focus();
    input.select();
  });
}

/* ==========================================================================
   AUTH
   ========================================================================== */
let authMode = "signin";

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  
  $("username-input").style.display = isSignup ? "block" : "none";
  $("username-warning").style.display = isSignup ? "block" : "none";
  
  $("signin-btn").style.background = isSignup ? "transparent" : "var(--primary)";
  $("signin-btn").style.color = isSignup ? "var(--text-main)" : "#000";
  $("signup-btn").style.background = isSignup ? "var(--primary)" : "transparent";
  $("signup-btn").style.color = isSignup ? "#000" : "var(--text-main)";
  
  $("auth-error").textContent = "";
}
setAuthMode("signin");

$("toggle-password").addEventListener("click", () => {
  const input = $("password-input");
  if (input.type === "password") {
    input.type = "text";
    $("toggle-password").textContent = "🙈";
  } else {
    input.type = "password";
    $("toggle-password").textContent = "👁️";
  }
});

$("google-signin").addEventListener("click", async () => {
  try {
    const { error } = await supabase.auth.signInWithOAuth({ 
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch (e) { $("auth-error").textContent = e.message; }
});

$("signin-btn").addEventListener("click", async () => {
  if (authMode !== "signin") { setAuthMode("signin"); return; }
  
  const email = $("email-input").value.trim();
  const password = $("password-input").value;
  if (!email || !password) return alert("Please enter email and password");

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (e) {
    $("auth-error").textContent = e.message;
  }
});

$("signup-btn").addEventListener("click", async () => {
  if (authMode !== "signup") { setAuthMode("signup"); return; }

  const username = $("username-input").value.trim();
  const email = $("email-input").value.trim();
  const password = $("password-input").value;
  
  if (!username) return alert("Please choose a username");
  if (!email || !password) return alert("Please enter email and password");

  try {
    const { data, error } = await supabase.auth.signUp({ 
      email, 
      password,
      options: {
        data: { username: username }
      }
    });
    if (error) throw error;
    
    if (data.session) {
      // Logged in immediately
    } else {
      alert("Success! Please check your email for a confirmation link.");
      setAuthMode("signin");
    }
  } catch (e) {
    $("auth-error").textContent = e.message;
  }
});

$("signout-btn").addEventListener("click", async () => {
  flushSave(); 
  flushCanvasSave();
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange((event, session) => {
  const user = session?.user;
  
  // 1. Check if the user is arriving from a password reset link
    // 1. Check if the user is arriving from a password reset link
  if (event === "PASSWORD_RECOVERY") {
    authScreen.hidden = false;
    appEl.hidden = true;
    
    // HIDE the Google button and the "OR" divider
    $("google-signin").style.display = "none";
    $("google-signin").nextElementSibling.style.display = "none";

    // Change the UI to ask for a new password
    $("email-auth-form").innerHTML = `
      <h3 style="text-align:center; margin-bottom: 15px; color: white;">Set New Password</h3>
      <input type="password" id="new-password-input" placeholder="New password (min 6 chars)" style="padding: 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-dark); color: var(--text-main); outline: none;" />
      <button class="btn btn-primary" id="update-password-btn" style="margin-top: 10px;">Update Password</button>
    `;

    $("update-password-btn").addEventListener("click", async () => {
      const newPassword = $("new-password-input").value;
      if (newPassword.length < 6) return alert("Password must be at least 6 characters.");
      
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return alert("Error: " + error.message);
      
      alert("Password updated successfully!");
      window.location.reload(); // Reload to log in normally
    });
    
    return; 
  }

  // 2. Normal Login Flow
  if (!user) {
    teardown();
    authScreen.hidden = false;
    appEl.hidden = true;
    return;
  }
  
  authScreen.hidden = true;
  appEl.hidden = false;
  state.uid = user.id;
  
  const meta = user.user_metadata || {};
  $("user-avatar").src = meta.avatar_url || `https://ui-avatars.com/api/?name=${meta.username || user.email || "User"}&background=random&color=fff`;
  $("user-name").textContent = meta.username || meta.full_name?.split(" ")[0] || meta.name || user.email?.split("@")[0] || "User";
  
  initApp();
});

function teardown() {
  unsubs.forEach((u) => supabase.removeChannel(u));
  unsubs = [];
  state.uid = null;
  state.notes = [];
  state.noteMap = new Map();
  state.projects = [];
  state.notesLoaded = false;
  state.activeNoteId = null;
  resetCanvasState();
  switchView("dashboard");
}

$("forgot-password-btn").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("email-input").value.trim();
  
  if (!email) {
    return alert("Please enter your email address first, then click 'Forgot password?'.");
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin, // Where the user lands after clicking the email link
    });
    if (error) throw error;
    
    alert("If an account exists for that email, a password reset link has been sent.");
    $("auth-error").textContent = "";
  } catch (err) {
    $("auth-error").textContent = err.message;
  }
});

/* ==========================================================================
   SUBSCRIPTIONS
   ========================================================================== */
async function initApp() {
  unsubs.forEach((u) => supabase.removeChannel(u));
  unsubs = [];
  const uid = state.uid;

  const [notesRes, projectsRes] = await Promise.all([
    supabase.from('notes').select('*').eq('user_id', uid),
    supabase.from('projects').select('*').eq('user_id', uid)
  ]);

  if (notesRes.error) notifyErr(notesRes.error.message);
  if (projectsRes.error) notifyErr(projectsRes.error.message);

  state.notes = notesRes.data || [];
  state.noteMap = new Map(state.notes.map((n) => [n.id, n]));
  state.notesLoaded = true;
  state.projects = projectsRes.data || [];

  updateProjectDropdown();
  renderNotesList();
  renderBacklinks();
  if (state.view === "dashboard") renderDashboard();
  syncGraph();
  renderCanvas();
  initCanvases(uid);

  const notesSub = supabase.channel('custom-notes-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${uid}` }, (payload) => {
      if (payload.eventType === 'INSERT') {
        state.notes.push(payload.new);
      } else if (payload.eventType === 'UPDATE') {
        const idx = state.notes.findIndex(n => n.id === payload.new.id);
        if (idx >= 0) state.notes[idx] = payload.new;
      } else if (payload.eventType === 'DELETE') {
        state.notes = state.notes.filter(n => n.id !== payload.old.id);
      }
      state.noteMap = new Map(state.notes.map((n) => [n.id, n]));
      
      if (state.activeNoteId && !state.noteMap.has(state.activeNoteId)) {
        state.activeNoteId = null;
        if (state.view === "notes") switchView("dashboard");
      }
      renderNotesList();
      renderBacklinks();
      if (state.view === "dashboard") renderDashboard();
      syncGraph();
      renderCanvas();
    }).subscribe();
  unsubs.push(notesSub);

  const projSub = supabase.channel('custom-projects-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `user_id=eq.${uid}` }, (payload) => {
      if (payload.eventType === 'INSERT') {
        state.projects.push(payload.new);
      } else if (payload.eventType === 'UPDATE') {
        const idx = state.projects.findIndex(p => p.id === payload.new.id);
        if (idx >= 0) state.projects[idx] = payload.new;
      } else if (payload.eventType === 'DELETE') {
        state.projects = state.projects.filter(p => p.id !== payload.old.id);
      }
      updateProjectDropdown();
      renderNotesList();
      if (state.view === "dashboard") renderDashboard();
      syncGraph();
      renderCanvas();
    }).subscribe();
  unsubs.push(projSub);
}

/* ==========================================================================
   NOTE + PROJECT CRUD
   ========================================================================== */
async function createNoteDoc({ title, projectId = "", content = "", tags = [] }) {
  const now = new Date().toISOString();
  const data = {
    user_id: state.uid,
    title: title || uniqueTitle("Untitled"), 
    content, 
    project_id: projectId || null, 
    tags: tags || [],
    pinned: false, 
    archived: false, 
    created_at: now, 
    updated_at: now
  };
  const { data: res, error } = await supabase.from('notes').insert([data]).select().single();
  if (error) throw error;
  return res;
}

async function newNote(opts = {}) {
  try {
    const note = await createNoteDoc(opts);
    openNote(note);
    return note;
  } catch (e) { notifyErr(e.message); }
}

async function deleteNoteById(id) {
  const note = state.noteMap.get(id);
  if (!note) return;
  if (id === state.activeNoteId && saveTimer) { clearTimeout(saveTimer); saveTimer = null; dirtyId = null; }
  
  try { await supabase.from('notes').delete().eq('id', id); }
  catch (e) { notifyErr(e.message); return; }
  
  if (state.activeNoteId === id) {
    state.activeNoteId = null;
    if (state.view === "notes") switchView("dashboard");
  }
  toast(`Deleted “${trunc(note.title || "Untitled", 30)}”`, {});
}

async function togglePin(id) {
  const n = state.noteMap.get(id);
  if (!n) return;
  try { await supabase.from('notes').update({ pinned: !n.pinned }).eq('id', id); }
  catch (e) { notifyErr(e.message); }
  if (id === state.activeNoteId) updatePinBtn(!n.pinned);
}

async function moveNoteToProject(noteId, projectId) {
  try { await supabase.from('notes').update({ project_id: projectId || null, updated_at: new Date().toISOString() }).eq('id', noteId); }
  catch (e) { notifyErr(e.message); }
  if (noteId === state.activeNoteId) projectSelect.value = projectId;
}

async function createProjectDoc(name, color) {
  const { data, error } = await supabase.from('projects').insert([{ user_id: state.uid, name, color }]).select().single();
  if (error) throw error;
  return data.id;
}
async function newProjectFlow() {
  const res = await projectDialog();
  if (!res) return null;
  try { return await createProjectDoc(res.name, res.color); }
  catch (e) { notifyErr(e.message); return null; }
}
async function editProjectFlow(p) {
  const res = await projectDialog({ name: p.name, color: p.color });
  if (!res) return;
  try { await supabase.from('projects').update(res).eq('id', p.id); }
  catch (e) { notifyErr(e.message); }
}
async function deleteProjectFlow(p) {
  const count = state.notes.filter((n) => n.project_id === p.id).length
    + [...canvasCache.values()].filter((c) => c.project_id === p.id).length;
  const ok = await confirmDialog(
    `Delete project “${p.name}”?`,
    count ? `Its ${count} item${count === 1 ? "" : "s"} will be kept and moved to “No project”.` : "This project is empty.",
    "Delete project"
  );
  if (!ok) return;
  try {
    await supabase.from('projects').delete().eq('id', p.id);
  } catch (e) { notifyErr(e.message); }
}

/* ==========================================================================
   SIDEBAR
   ========================================================================== */
const cmpTitle = (a, b) => (a.title || "").localeCompare(b.title || "");
const sorters = {
  modified: (a, b) => ts(b.updated_at) - ts(a.updated_at) || cmpTitle(a, b),
  name: cmpTitle,
  created: (a, b) => ts(b.created_at) - ts(a.created_at) || cmpTitle(a, b)
};

function itemTitle(it) { return it.title ?? it.name ?? ""; }
const unifiedSort = {
  modified: (a, b) => ts(b.updated_at) - ts(a.updated_at) || itemTitle(a).localeCompare(itemTitle(b)),
  name: (a, b) => itemTitle(a).localeCompare(itemTitle(b)),
  created: (a, b) => ts(b.created_at) - ts(a.created_at) || itemTitle(a).localeCompare(itemTitle(b))
};

function filteredNotes() {
  const q = state.search.trim().toLowerCase();
  return state.notes.filter((n) => !n.archived).filter((n) => {
    if (state.tagFilter && !(n.tags || []).includes(state.tagFilter)) return false;
    if (!q) return true;
    return (n.title || "").toLowerCase().includes(q)
      || (n.content || "").toLowerCase().includes(q)
      || (n.tags || []).some((t) => t.toLowerCase().includes(q));
  });
}

function filteredCanvases() {
  const q = state.search.trim().toLowerCase();
  return [...canvasCache.values()].filter((c) => {
    if (!q) return true;
    return (nameOfCanvas(c) || "").toLowerCase().includes(q);
  });
}

function markText(container, text, q) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) { container.textContent = text; return; }
  container.append(document.createTextNode(text.slice(0, i)));
  container.append(el("mark", "", text.slice(i, i + q.length)));
  container.append(document.createTextNode(text.slice(i + q.length)));
}
function snippetFor(note, q) {
  const content = (note.content || "").replace(/\s+/g, " ");
  const i = content.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return "";
  const start = Math.max(0, i - 30);
  return (start > 0 ? "…" : "") + content.slice(start, i + q.length + 50) + "…";
}

function renderTagFilter() {
  const counts = new Map();
  state.notes.filter((n) => !n.archived).forEach((n) => (n.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  tagFilterEl.innerHTML = "";
  if (state.tagFilter && !counts.has(state.tagFilter)) state.tagFilter = null;
  if (!counts.size) { tagFilterEl.hidden = true; return; }
  tagFilterEl.hidden = false;
  [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16).forEach(([t, c]) => {
    const chip = el("button", "tag-chip" + (state.tagFilter === t ? " on" : ""), `#${t}`);
    chip.title = `${c} note${c === 1 ? "" : "s"}`;
    chip.onclick = () => { state.tagFilter = state.tagFilter === t ? null : t; renderNotesList(); };
    tagFilterEl.append(chip);
  });
}

function noteItem(note, { snippet } = {}) {
  const item = el("div", "note-item" + (state.activeNoteId === note.id ? " active" : ""));
  item.draggable = true;
  item.dataset.noteId = note.id;

  const main = el("div", "ni-main");
  if (note.pinned) main.append(el("span", "ni-pin", "★"));
  
  const tt = el("span", "ni-title");
  markText(tt, note.title || "Untitled", state.search.trim());
  main.append(tt);

  item.append(main);
  
  item.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/note-id", note.id);
    e.dataTransfer.effectAllowed = "copyMove";
  });
  item.addEventListener("click", () => openNote(note));
  return item;
}

function canvasSidebarItem(data) {
  const id = data.id;
  const name = nameOfCanvas(data);
  const isActive = C.id === id && state.view === "canvas";
  const item = el("div", "note-item" + (isActive ? " active" : ""));
  item.dataset.canvasId = id;
  item.draggable = true;

  const main = el("div", "ni-main");
  if (data.pinned) main.append(el("span", "ni-pin", "★"));
  
  const tt = el("span", "ni-title");
  markText(tt, name, state.search.trim());
  main.append(tt);

  const badge = el("div", "ni-canvas-badge", "CANVAS");
  
  item.append(main, badge);
  
  item.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/canvas-id", id);
    e.dataTransfer.effectAllowed = "copyMove";
  });
  item.addEventListener("click", () => openCanvasInView(id));
  return item;
}

function groupEl({ id, name, color, notes, canvases, project, droppable, icon }) {
  const collapsed = state.collapsed.has(id);
  const g = el("div", "nl-group" + (collapsed ? " collapsed" : ""));
  const head = el("div", "nl-head");
  head.dataset.groupId = id;
  if (project) head.dataset.projectId = project.id;
  head.append(el("span", "chev", collapsed ? "▸" : "▾"));
  if (icon) head.append(el("span", "nl-icon", icon));
  else { 
    const dot = el("span", "nl-dot"); 
    dot.style.background = color || "var(--text-muted)"; 
    head.append(dot); 
  }
  
  const total = (notes?.length || 0) + (canvases?.length || 0);
  head.append(el("span", "nl-name", name), el("span", "nl-count", String(total)));

  const act = el("div", "nl-actions");
  if (project) {
    const add = el("button", "icon-btn", "+"); add.title = "New note in project";
    add.onclick = (e) => { e.stopPropagation(); newNote({ projectId: project.id }); };
    const edit = el("button", "icon-btn", "✎"); edit.title = "Edit project";
    edit.onclick = (e) => { e.stopPropagation(); editProjectFlow(project); };
    const del = el("button", "icon-btn danger", "🗑"); del.title = "Delete project";
    del.onclick = (e) => { e.stopPropagation(); deleteProjectFlow(project); };
    act.append(add, edit, del);
  }
  head.append(act);
  
  head.addEventListener("click", () => {
    if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
    lsSet("sb-collapsed", [...state.collapsed]);
    renderNotesList();
  });

  if (droppable) {
    head.addEventListener("dragover", (e) => { e.preventDefault(); head.classList.add("drop"); });
    head.addEventListener("dragleave", () => head.classList.remove("drop"));
    head.addEventListener("drop", (e) => {
      e.preventDefault();
      head.classList.remove("drop");
      const nid = e.dataTransfer.getData("text/note-id");
      const cid = e.dataTransfer.getData("text/canvas-id");
      if (nid) moveNoteToProject(nid, project ? project.id : "");
      if (cid) moveCanvasToProject(cid, project ? project.id : "");
    });
  }
  g.append(head);

  if (!collapsed) {
    const body = el("div", "nl-body");
    if (!total) body.append(el("div", "nl-empty", "Empty — drop items here"));
    
    const items = [
      ...notes.map((n) => ({ kind: "note", item: n })),
      ...canvases.map((c) => ({ kind: "canvas", item: c }))
    ].sort((a, b) => unifiedSort[state.sort](a.item, b.item));
    
    items.forEach((it) => body.append(it.kind === "note" ? noteItem(it.item) : canvasSidebarItem(it.item)));
    g.append(body);
  }
  return g;
}

function renderNotesList() {
  paintCollapseBtn();
  renderTagFilter();
  const q = state.search.trim();
  const notes = filteredNotes();
  const canvases = filteredCanvases();

  const totalNotes = state.notes.filter((n) => !n.archived).length;
  const totalCanvases = canvasCache.size;
  notesList.innerHTML = "";
  
  sbCount.textContent =
    `${totalNotes} note${totalNotes === 1 ? "" : "s"} · ` +
    `${state.projects.length} project${state.projects.length === 1 ? "" : "s"} · ` +
    `${totalCanvases} canvas${totalCanvases === 1 ? "" : "es"}`;

  if (!totalNotes && !state.projects.length && !totalCanvases) {
    const e = el("div", "nl-placeholder");
    e.append(el("p", "", "Nothing here yet."));
    const b = el("button", "btn btn-primary btn-sm", "+ Create your first note");
    b.onclick = () => newNote();
    e.append(b);
    notesList.append(e);
    return;
  }

  if (q) {
    if (!notes.length && !canvases.length) {
      notesList.append(el("div", "nl-placeholder", `Nothing matches “${q}”.`));
      return;
    }
    const results = [
      ...notes.map((n) => ({ kind: "note", item: n })),
      ...canvases.map((c) => ({ kind: "canvas", item: c }))
    ].sort((a, b) => unifiedSort[state.sort](a.item, b.item));
    
    results.forEach((it) => {
      if (it.kind === "note") notesList.append(noteItem(it.item, { snippet: snippetFor(it.item, q) }));
      else notesList.append(canvasSidebarItem(it.item));
    });
    return;
  }

  const pinnedNotes = notes.filter((n) => n.pinned);
  const pinnedCanvases = canvases.filter((c) => c.pinned);
  if (pinnedNotes.length || pinnedCanvases.length) {
    notesList.append(groupEl({
      id: "__pinned", name: "Pinned", icon: "★",
      notes: pinnedNotes, canvases: pinnedCanvases
    }));
  }

  const bucket = new Map();
  const push = (key, kind, item) => {
    if (!bucket.has(key)) bucket.set(key, { notes: [], canvases: [] });
    bucket.get(key)[kind === "note" ? "notes" : "canvases"].push(item);
  };
  notes.filter((n) => !n.pinned).forEach((n) => {
    const k = state.projects.some((p) => p.id === n.project_id) ? n.project_id : "";
    push(k, "note", n);
  });
  canvases.filter((c) => !c.pinned).forEach((c) => {
    const k = state.projects.some((p) => p.id === c.project_id) ? c.project_id : "";
    push(k, "canvas", c);
  });

  [...state.projects].sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach((p) => {
    const b = bucket.get(p.id) || { notes: [], canvases: [] };
    if (!b.notes.length && !b.canvases.length && state.tagFilter) return;
    notesList.append(groupEl({
      id: p.id, name: p.name || "Untitled project", color: p.color,
      notes: b.notes, canvases: b.canvases, project: p, droppable: true
    }));
  });

  const loose = bucket.get("") || { notes: [], canvases: [] };
  if (loose.notes.length || loose.canvases.length || state.projects.length) {
    notesList.append(groupEl({
      id: "__none", name: "No project",
      notes: loose.notes, canvases: loose.canvases, droppable: true
    }));
  }
}

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  searchClear.hidden = !state.search;
  renderNotesList();
});
searchClear.addEventListener("click", () => { searchInput.value = ""; state.search = ""; searchClear.hidden = true; renderNotesList(); searchInput.focus(); });
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { searchInput.value = ""; state.search = ""; searchClear.hidden = true; renderNotesList(); searchInput.blur(); }
  if (e.key === "Enter") { const first = filteredNotes().sort(sorters[state.sort])[0]; if (first) openNote(first); }
});
$("new-note-sidebar").addEventListener("click", () => newNote());
$("new-project-btn").addEventListener("click", () => newProjectFlow());
$("new-canvas-sidebar").addEventListener("click", () => newCanvasFlow());

/* ---------- Sidebar toolbar, context menus, rename, reveal (Obsidian-style) ---------- */
const searchWrap = $("search-wrap");
function openSearch() {
  searchWrap.hidden = false;
  $("search-toggle").classList.add("on");
  searchInput.focus();
  searchInput.select();
}
function closeSearch() {
  searchInput.value = ""; state.search = ""; searchClear.hidden = true;
  searchWrap.hidden = true;
  $("search-toggle").classList.remove("on");
  renderNotesList();
}
$("search-toggle").addEventListener("click", () => (searchWrap.hidden ? openSearch() : closeSearch()));
searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { searchWrap.hidden = true; $("search-toggle").classList.remove("on"); } });

/* generic context menu */
let ctxEl = null;
function hideCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
function showCtx(x, y, items) {
  hideCtx();
  const m = el("div", "ctx-menu");
  items.forEach((it) => {
    if (it.sep) { m.append(el("div", "ctx-sep")); return; }
    if (it.heading) { m.append(el("div", "ctx-head", it.heading)); return; }
    const b = el("button", "ctx-item" + (it.danger ? " danger" : ""));
    b.type = "button";
    b.append(el("span", "ctx-chk", it.checked ? "✓" : ""), el("span", "", it.label));
    b.addEventListener("click", (ev) => { ev.stopPropagation(); hideCtx(); it.run(); });
    m.append(b);
  });
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(window.innerWidth - r.width - 4, x)) + "px";
  m.style.top = Math.max(4, Math.min(window.innerHeight - r.height - 4, y)) + "px";
  ctxEl = m;
}
document.addEventListener("pointerdown", (e) => { if (ctxEl && !ctxEl.contains(e.target)) hideCtx(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCtx(); }, true);
window.addEventListener("resize", hideCtx);
notesList.addEventListener("scroll", hideCtx);

/* sort menu */
$("sort-btn").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const set = (v) => () => { state.sort = v; lsSet("sb-sort", v); renderNotesList(); };
  showCtx(r.left, r.bottom + 4, [
    { label: "Last modified", checked: state.sort === "modified", run: set("modified") },
    { label: "Date created (newest first)", checked: state.sort === "created", run: set("created") },
    { label: "Name (A–Z)", checked: state.sort === "name", run: set("name") }
  ]);
});

/* collapse / expand all */
const ICON_COLLAPSE = '<svg viewBox="0 0 24 24"><path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/></svg>';
const ICON_EXPAND = '<svg viewBox="0 0 24 24"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>';
const allGroupIds = () => ["__pinned", "__none", ...state.projects.map((p) => p.id)];
function paintCollapseBtn() {
  const all = allGroupIds().every((id) => state.collapsed.has(id));
  const b = $("collapse-btn");
  b.innerHTML = all ? ICON_EXPAND : ICON_COLLAPSE;
  b.title = all ? "Expand all" : "Collapse all";
}
$("collapse-btn").addEventListener("click", () => {
  const all = allGroupIds().every((id) => state.collapsed.has(id));
  if (all) state.collapsed.clear(); else allGroupIds().forEach((id) => state.collapsed.add(id));
  lsSet("sb-collapsed", [...state.collapsed]);
  renderNotesList();
});

/* auto-reveal current file */
state.autoReveal = lsGet("sb-reveal", false);
$("reveal-btn").classList.toggle("on", state.autoReveal);
function groupIdOf(it) {
  if (it.pinned) return "__pinned";
  return state.projects.some((p) => p.id === it.project_id) ? it.project_id : "__none";
}
function revealActive() {
  let it = null;
  if (state.view === "notes" && state.activeNoteId) it = state.noteMap.get(state.activeNoteId);
  else if (state.view === "canvas" && C.id) it = canvasCache.get(C.id);
  if (!it) return;
  const gid = groupIdOf(it);
  if (state.collapsed.delete(gid)) lsSet("sb-collapsed", [...state.collapsed]);
  renderNotesList();
  requestAnimationFrame(() => { const a = notesList.querySelector(".note-item.active"); if (a) a.scrollIntoView({ block: "nearest" }); });
}
$("reveal-btn").addEventListener("click", () => {
  state.autoReveal = !state.autoReveal;
  lsSet("sb-reveal", state.autoReveal);
  $("reveal-btn").classList.toggle("on", state.autoReveal);
  if (state.autoReveal) revealActive();
});

/* inline rename */
function inlineRename(item, value, commit) {
  const t = item && item.querySelector(".ni-title");
  if (!t) return;
  item.draggable = false;
  const inp = el("input", "ni-rename");
  inp.value = value;
  t.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (ok && v && v !== value) commit(v); else renderNotesList();
  };
  inp.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
  });
  inp.addEventListener("blur", () => finish(true));
  inp.addEventListener("click", (ev) => ev.stopPropagation());
}
async function renameNote(n, title) {
  const old = n.title || "";
  const clash = findNoteByTitle(title);
  if (clash && clash.id !== n.id) { notifyErr("A note with that name already exists."); renderNotesList(); return; }
  try {
    const { error } = await supabase.from('notes').update({ title, updated_at: new Date().toISOString() }).eq('id', n.id);
    if (error) throw error;
    if (state.activeNoteId === n.id) noteTitleInput.value = title;
    if (old) { // keep [[links]] pointing at the renamed note
      const rx = old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const test = new RegExp("\\[\\[" + rx + "(?=[\\]|#])", "i");
      const sub = new RegExp("\\[\\[" + rx + "(?=[\\]|#])", "gi");
      for (const o of state.notes.filter((x) => x.id !== n.id && test.test(x.content || ""))) {
        await supabase.from('notes').update({ content: o.content.replace(sub, "[[" + title) }).eq('id', o.id);
      }
    }
  } catch (e) { notifyErr(e.message); renderNotesList(); }
}
async function renameCanvasById(id, name) {
  const d = canvasCache.get(id);
  if (!d) return;
  try {
    const { error } = await supabase.from('canvases').update({ name, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    canvasCache.set(id, { ...d, name });
    if (C.id === id) C.name = name;
    updateCanvasSelect();
    renderNotesList();
  } catch (e) { notifyErr(e.message); renderNotesList(); }
}
async function duplicateNote(n) {
  try {
    await createNoteDoc({ title: uniqueTitle(`${n.title || "Untitled"} copy`), projectId: n.project_id || "", content: n.content || "", tags: n.tags || [] });
    toast("Note duplicated", { ms: 1500 });
  } catch (e) { notifyErr(e.message); }
}
async function duplicateCanvas(d) {
  const now = new Date().toISOString();
  const row = { user_id: state.uid, name: nameOfCanvas(d) + " copy", project_id: d.project_id || null, pinned: false, cards: d.cards || [], edges: d.edges || [], created_at: now, updated_at: now };
  try {
    const { data, error } = await supabase.from('canvases').insert([row]).select().single();
    if (error) throw error;
    canvasCache.set(data.id, data);
    updateCanvasSelect();
    renderNotesList();
    toast("Canvas duplicated", { ms: 1500 });
  } catch (e) { notifyErr(e.message); }
}
function moveItems(currentProjectId, onPick) {
  return [
    { heading: "Move to" },
    { label: "No project", checked: !currentProjectId, run: () => onPick("") },
    ...[...state.projects].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((p) => ({ label: p.name || "Untitled project", checked: currentProjectId === p.id, run: () => onPick(p.id) }))
  ];
}
function renameActive() {
  revealActive();
  requestAnimationFrame(() => {
    const item = notesList.querySelector(".note-item.active");
    if (!item) return;
    if (item.dataset.noteId) { const n = state.noteMap.get(item.dataset.noteId); if (n) inlineRename(item, n.title || "", (v) => renameNote(n, v)); }
    else if (item.dataset.canvasId) { const d = canvasCache.get(item.dataset.canvasId); if (d) inlineRename(item, nameOfCanvas(d), (v) => renameCanvasById(d.id, v)); }
  });
}
notesList.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const x = e.clientX, y = e.clientY;
  const ni = e.target.closest(".note-item");
  const head = e.target.closest(".nl-head");
  if (ni && ni.dataset.noteId) {
    const n = state.noteMap.get(ni.dataset.noteId);
    if (!n) return;
    showCtx(x, y, [
      { label: "Open", run: () => openNote(n) },
      { label: "Rename", run: () => inlineRename(ni, n.title || "", (v) => renameNote(n, v)) },
      { label: n.pinned ? "Unpin" : "Pin", run: () => togglePin(n.id) },
      { label: "Duplicate", run: () => duplicateNote(n) },
      { sep: true },
      ...moveItems(n.project_id, (pid) => moveNoteToProject(n.id, pid)),
      { sep: true },
      { label: "Delete", danger: true, run: async () => { if (await confirmDialog(`Delete “${n.title || "Untitled"}”?`, "This note will be permanently deleted.")) deleteNoteById(n.id); } }
    ]);
    return;
  }
  if (ni && ni.dataset.canvasId) {
    const d = canvasCache.get(ni.dataset.canvasId);
    if (!d) return;
    showCtx(x, y, [
      { label: "Open", run: () => openCanvasInView(d.id) },
      { label: "Rename", run: () => inlineRename(ni, nameOfCanvas(d), (v) => renameCanvasById(d.id, v)) },
      { label: d.pinned ? "Unpin" : "Pin", run: () => toggleCanvasPin(d.id) },
      { label: "Duplicate", run: () => duplicateCanvas(d) },
      { sep: true },
      ...moveItems(d.project_id, (pid) => moveCanvasToProject(d.id, pid)),
      { sep: true },
      { label: "Delete", danger: true, run: () => deleteCanvasById(d.id) }
    ]);
    return;
  }
  if (head && head.dataset.projectId) {
    const p = state.projects.find((q) => q.id === head.dataset.projectId);
    if (!p) return;
    showCtx(x, y, [
      { label: "New note", run: () => newNote({ projectId: p.id }) },
      { label: "New canvas", run: () => newCanvasFlow(p.id) },
      { sep: true },
      { label: "Edit project", run: () => editProjectFlow(p) },
      { label: "Delete project", danger: true, run: () => deleteProjectFlow(p) }
    ]);
    return;
  }
  showCtx(x, y, [
    { label: "New note", run: () => newNote() },
    { label: "New canvas", run: () => newCanvasFlow() },
    { label: "New project", run: () => newProjectFlow() }
  ]);
});
$("new-note-btn").addEventListener("click", () => newNote());
$("quick-open-btn").addEventListener("click", () => quickSwitcher());

function quickSwitcher() {
  if (!state.uid) return;
  openModal((box, close) => {
    box.classList.add("qs");
    const input = el("input", "qs-input");
    input.placeholder = "Find or create a note…";
    const list = el("div", "qs-list");
    box.append(input, list);
    let items = [], idx = 0;

    const choose = (it) => {
      close(null);
      if (!it) return;
      if (it.note) openNote(it.note);
      else newNote({ title: uniqueTitle(it.create) });
    };
    const paint = () => {
      list.innerHTML = "";
      items.forEach((it, i) => {
        const row = el("div", "qs-row" + (i === idx ? " on" : ""));
        if (it.note) {
          const dot = el("span", "nl-dot");
          dot.style.background = projectColor(it.note) || "var(--text-muted)";
          row.append(dot, el("span", "qs-title", it.note.title || "Untitled"));
          const p = state.projects.find((x) => x.id === it.note.project_id);
          if (p) row.append(el("span", "qs-proj", p.name));
        } else row.append(el("span", "qs-title", `＋ Create “${it.create}”`));
        row.onmousemove = () => { if (idx !== i) { idx = i; paint(); } };
        row.onclick = () => choose(it);
        list.append(row);
      });
      const on = list.querySelector(".on");
      if (on) on.scrollIntoView({ block: "nearest" });
    };
    const build = () => {
      const raw = input.value.trim(), q = raw.toLowerCase();
      items = state.notes.filter((n) => !n.archived)
        .filter((n) => !q || (n.title || "").toLowerCase().includes(q))
        .sort((a, b) => {
          const as = (a.title || "").toLowerCase().startsWith(q) ? 0 : 1;
          const bs = (b.title || "").toLowerCase().startsWith(q) ? 0 : 1;
          return as - bs || sorters.modified(a, b);
        }).slice(0, 50).map((note) => ({ note }));
      if (raw && !items.some((i) => (i.note.title || "").toLowerCase() === q)) items.push({ create: raw });
      idx = 0;
      paint();
    };
    input.addEventListener("input", build);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(0, idx - 1); paint(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(items[idx]); }
    });
    build();
    input.focus();
  });
}

/* ==========================================================================
   NAVIGATION
   ========================================================================== */
document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
document.querySelector(".nav-brand").addEventListener("click", () => switchView("dashboard"));

function switchView(view) {
  if (view === "notes" && !state.activeNoteId) view = "dashboard";
  if (state.view === "notes" && view !== "notes") flushSave();
  if (state.view === "canvas" && view !== "canvas") flushCanvasSave();
  state.view = view;
  dashboardView.hidden = view !== "dashboard";
  noteView.hidden = view !== "notes";
  graphView.hidden = view !== "graph";
  canvasView.hidden = view !== "canvas";
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));

  if (view === "dashboard") renderDashboard();
  if (view === "graph") initGraph();
  else if (G.inited && G.timelapse.active) timelapseExit();
  if (view === "canvas") onCanvasShown();
  renderNotesList();
}

/* ==========================================================================
   DASHBOARD
   ========================================================================== */
function renderDashboard() {
  const notes = state.notes.filter((n) => !n.archived);
  const recent = [...notes].sort(sorters.modified).slice(0, 8);
  const pinned = notes.filter((n) => n.pinned).slice(0, 6);
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const links = state.notesLoaded ? computeLinks(new Set(notes.map((n) => n.id))).size : 0;
  const tags = new Set(); notes.forEach((n) => (n.tags || []).forEach((t) => tags.add(t)));

  const card = (n) => {
    const p = state.projects.find((x) => x.id === n.project_id);
    const snip = trunc((n.content || "").replace(/[#*>`\[\]_-]+/g, " ").replace(/\s+/g, " ").trim(), 90);
    return `<div class="home-card" data-open="${esc(n.id)}" style="border-left-color:${esc(projectColor(n) || "var(--border)")}">
      <div class="hc-title">${n.pinned ? "★ " : ""}${esc(n.title || "Untitled")}</div>
      <div class="hc-snip">${esc(snip) || "<i>Empty note</i>"}</div>
      <div class="hc-meta">${p ? esc(p.name) + " · " : ""}${n.updated_at ? new Date(ts(n.updated_at)).toLocaleDateString() : ""}</div></div>`;
  };

  dashboardView.innerHTML = `
    <div class="home-inner">
      <h1>${greet} 👋</h1>
      <p class="muted">${notes.length ? "Pick up where you left off." : "Your vault is empty — create your first note."}</p>
      <div class="home-actions">
        <button class="btn btn-primary" data-act="new">+ New note</button>
        <button class="btn" data-act="project">+ New project</button>
        <button class="btn" data-act="canvas">+ New canvas</button>
        <button class="btn" data-act="search">🔍 Quick open <kbd>Ctrl K</kbd></button>
        <button class="btn" data-act="graph">Graph</button>
        <button class="btn" data-act="canvasview">Canvas</button>
      </div>
      <div class="home-stats">
        <div><b>${notes.length}</b><span>notes</span></div>
        <div><b>${state.projects.length}</b><span>projects</span></div>
        <div><b>${canvasCache.size}</b><span>canvases</span></div>
        <div><b>${tags.size}</b><span>tags</span></div>
        <div><b>${links}</b><span>links</span></div>
      </div>
      ${pinned.length ? `<h2>Pinned</h2><div class="home-grid">${pinned.map(card).join("")}</div>` : ""}
      ${recent.length ? `<h2>Recently edited</h2><div class="home-grid">${recent.map(card).join("")}</div>` : ""}
      <p class="home-tips muted">Tips: <kbd>Alt N</kbd> new note · <kbd>Ctrl K</kbd> quick open · <kbd>Ctrl E</kbd> edit/preview · type <kbd>[[</kbd> to link notes · drag a note or canvas onto a canvas · hold <kbd>Space</kbd> + drag to pan.</p>
      
      <!-- DELETE ACCOUNT SECTION -->
      <div style="margin-top: 60px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h3 style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 4px;">Danger Zone</h3>
          <p class="muted" style="font-size: 0.75rem;">Once you delete your account, there is no going back. Please be certain.</p>
        </div>
        <button class="btn" id="delete-account-btn" style="color: var(--danger); border-color: rgba(239,68,68,0.3);">Delete Account</button>
      </div>
    </div>`;
}

dashboardView.addEventListener("click", async (e) => {
  if (e.target.closest("#delete-account-btn")) {
    const ok = await confirmDialog(
      "Delete Account?",
      "This will permanently delete your account and all of your notes, projects, and canvases. This action CANNOT be undone.",
      "Yes, delete my account"
    );
    if (!ok) return;
    
    try {
      const { error } = await supabase.rpc('delete_user');
      if (error) throw error;
      
      alert("Your account has been deleted.");
      await supabase.auth.signOut();
    } catch (err) {
      notifyErr("Error deleting account: " + err.message);
    }
    return;
  }

  const open = e.target.closest("[data-open]");
  if (open) { openNote(state.noteMap.get(open.dataset.open)); return; }
  const act = e.target.closest("[data-act]");
  if (!act) return;
  const a = act.dataset.act;
  if (a === "new") newNote();
  else if (a === "project") newProjectFlow();
  else if (a === "canvas") { switchView("canvas"); newCanvasFlow(); }
  else if (a === "canvasview") switchView("canvas");
  else if (a === "search") quickSwitcher();
  else switchView(a);
});

/* ==========================================================================
   MARKDOWN
   ========================================================================== */
function inline(raw) {
  let t = esc(raw);
  const stash = [];
  const put = (h) => { stash.push(h); return `\u0001${stash.length - 1}\u0001`; };

  t = t.replace(/`([^`\n]+)`/g, (_, c) => put(`<code>${c}</code>`));
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, alt, url) => put(`<img src="${url}" alt="${alt}">`));
  t = t.replace(/\[\[([^\[\]\n|]{1,200})(?:\|([^\[\]\n]{1,200}))?\]\]/g, (_, target, alias) => {
    const name = unesc(target).split("#")[0].trim();
    const exists = !!findNoteByTitle(name);
    return put(`<a class="wikilink${exists ? "" : " unresolved"}" data-target="${target}">${alias || target}</a>`);
  });
  t = t.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label, url) =>
    put(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  t = t.replace(BARE_URL_RE, (m) => {
    let text = m, trail = "";
    while (/[.,;:!?)\]'"]$/.test(text)) { trail = text.slice(-1) + trail; text = text.slice(0, -1); }
    if (!text) return m;
    const href = /^https?:\/\//i.test(text) ? text : "https://" + text;
    return put(`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`) + trail;
  });
  t = t.replace(/(^|\s)#([A-Za-z][\w\-\/]*)/g, (_, pre, tag) => pre + put(`<span class="tag" data-tag="${tag}">#${tag}</span>`));

  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  t = t.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
  return t.replace(/\u0001(\d+)\u0001/g, (_, i) => stash[+i]);
}

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const isBlockStart = (l) =>
  /^```/.test(l) || /^#{1,6}\s/.test(l) || /^>\s?/.test(l) || LIST_RE.test(l) ||
  /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) || /^\s*\|.*\|\s*$/.test(l);

function renderMarkdown(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
      continue;
    }

    if (LIST_RE.test(line)) {
      const ordered = /\d/.test(LIST_RE.exec(line)[2]);
      const items = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m) break;
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]);
        const lvl = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
        items.push(
          `<li style="margin-left:${lvl * 20}px"${task ? ' class="task"' : ""}>` +
          (task ? `<input type="checkbox" class="task-box" data-line="${i}"${task[1] !== " " ? " checked" : ""}>` : "") +
          inline(task ? task[2] : m[3]) + "</li>"
        );
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag} class="md-list">${items.join("")}</${tag}>`);
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        "<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>"
      );
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && (buf.length === 0 || !isBlockStart(lines[i]))) buf.push(lines[i++]);
    out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

/* ==========================================================================
   EDITOR
   ========================================================================== */
let saveTimer = null;
let dirtyId = null;
let editTags = [];
let previewTimer = null;

function setStatus(s) { saveStatus.textContent = s; saveStatus.dataset.s = s; }

function openNote(note) {
  if (!note) return;
  const same = state.activeNoteId === note.id;
  if (!same) flushSave();
  state.activeNoteId = note.id;
  if (same && saveTimer) { switchView("notes"); return; }

  const live = state.noteMap.get(note.id) || note;
  switchView("notes");
  noteTitleInput.value = live.title || "";
  noteContentInput.value = live.content || "";
  projectSelect.value = live.project_id || "";
  editTags = [...(live.tags || [])];
  renderTagChips();
  updatePinBtn(!!live.pinned);
  setStatus("Saved");
  setMode(state.mode, true);
  updateWordCount();
  updateMetaInfo(live);
  renderBacklinks();
  renderNotesList();
  if (state.autoReveal) revealActive();
  hideSuggest();
  noteContentInput.scrollTop = 0;
  previewEl.scrollTop = 0;
  if (/^Untitled( \d+)?$/.test(live.title || "") || !live.title) { noteTitleInput.focus(); noteTitleInput.select(); }
  else if (state.mode !== "preview") noteContentInput.focus();
}

function markDirty() {
  if (!state.activeNoteId) return;
  dirtyId = state.activeNoteId;
  setStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(performSave, 500);
}

async function performSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const id = dirtyId;
  if (!id || !state.uid) return;
  dirtyId = null;
  const data = {
    title: noteTitleInput.value.trim() || "Untitled",
    content: noteContentInput.value,
    project_id: projectSelect.value === "__new" ? null : (projectSelect.value || null),
    tags: [...editTags],
    updated_at: new Date().toISOString()
  };
  try {
    const { error } = await supabase.from('notes').update(data).eq('id', id);
    if (error) throw error;
    if (state.activeNoteId === id && !saveTimer) { setStatus("Saved"); updateMetaInfo({ ...state.noteMap.get(id), ...data }); }
  } catch (e) { setStatus("Save failed"); notifyErr(e.message); }
}
function flushSave() { if (saveTimer) performSave(); }
window.addEventListener("beforeunload", flushSave);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });

function updatePinBtn(p) { pinBtn.textContent = p ? "★" : "☆"; pinBtn.title = p ? "Unpin note" : "Pin note"; pinBtn.classList.toggle("on", p); }
function updateWordCount() {
  const t = noteContentInput.value;
  const words = (t.match(/\S+/g) || []).length;
  wordCountEl.textContent = `${words} word${words === 1 ? "" : "s"} · ${t.length} characters`;
}
function updateMetaInfo(n) {
  metaInfoEl.textContent = n ? `Created ${fmtDate(ts(n.created_at))} · Modified ${fmtDate(ts(n.updated_at))}` : "";
}

noteTitleInput.addEventListener("input", () => { markDirty(); renderBacklinks(); });
noteTitleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); noteContentInput.focus(); }
});
projectSelect.addEventListener("change", async () => {
  if (projectSelect.value === "__new") {
    const prev = state.noteMap.get(state.activeNoteId)?.project_id || "";
    const id = await newProjectFlow();
    projectSelect.value = id || prev;
    if (id) { await new Promise((r) => setTimeout(r, 0)); projectSelect.value = id; markDirty(); }
    return;
  }
  markDirty();
});
function updateProjectDropdown() {
  const cur = projectSelect.value;
  projectSelect.innerHTML = "";
  projectSelect.append(new Option("No project", ""));
  [...state.projects].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .forEach((p) => projectSelect.append(new Option(p.name || "Untitled project", p.id)));
  projectSelect.append(new Option("＋ New project…", "__new"));
  projectSelect.value = [...projectSelect.options].some((o) => o.value === cur) ? cur : "";
}

function renderTagChips() {
  tagsBox.querySelectorAll(".tag-pill").forEach((e) => e.remove());
  editTags.forEach((t) => {
    const pill = el("span", "tag-pill", `#${t}`);
    const x = el("button", "", "×");
    x.onclick = () => { editTags = editTags.filter((v) => v !== t); renderTagChips(); markDirty(); };
    pill.append(x);
    tagsBox.insertBefore(pill, tagInput);
  });
}
function addTag(raw) {
  const t = raw.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\w\-\/]/g, "");
  if (!t || editTags.includes(t)) return;
  editTags.push(t);
  renderTagChips();
  markDirty();
}
tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "," || e.key === " ") {
    if (tagInput.value.trim()) { e.preventDefault(); addTag(tagInput.value); tagInput.value = ""; }
    else if (e.key === "Enter") e.preventDefault();
  } else if (e.key === "Backspace" && !tagInput.value && editTags.length) {
    editTags.pop(); renderTagChips(); markDirty();
  }
});
tagInput.addEventListener("blur", () => { if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ""; } });
tagsBox.addEventListener("click", () => tagInput.focus());

pinBtn.addEventListener("click", () => state.activeNoteId && togglePin(state.activeNoteId));
$("delete-note-btn").addEventListener("click", () => state.activeNoteId && deleteNoteById(state.activeNoteId));

function setMode(mode, silent) {
  state.mode = mode;
  if (!silent) lsSet("ed-mode", mode);
  panesEl.dataset.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((b) => { if (b.tagName === "BUTTON") b.classList.toggle("active", b.dataset.mode === mode); });
  if (mode !== "edit") renderPreview();
  if (!silent) (mode === "preview" ? previewEl : noteContentInput).focus();
}
document.querySelectorAll("button[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
function renderPreview() {
  if (state.mode === "edit") return;
  previewEl.innerHTML = renderMarkdown(noteContentInput.value) || '<p class="muted">Nothing to preview yet.</p>';
}

async function openByTitle(title) {
  const name = title.split("#")[0].trim();
  const existing = findNoteByTitle(name);
  if (existing) openNote(existing);
  else await newNote({ title: name });
}
previewEl.addEventListener("click", (e) => {
  const wl = e.target.closest(".wikilink");
  if (wl) { e.preventDefault(); openByTitle(wl.dataset.target); return; }
  const tg = e.target.closest(".tag");
  if (tg) { state.tagFilter = tg.dataset.tag; renderNotesList(); return; }
  const box = e.target.closest(".task-box");
  if (box) {
    const lines = noteContentInput.value.split("\n");
    const idx = +box.dataset.line;
    lines[idx] = lines[idx].replace(/\[( |x|X)\]/, (m, c) => (c === " " ? "[x]" : "[ ]"));
    noteContentInput.value = lines.join("\n");
    markDirty();
    renderPreview();
  }
});

function insertText(ta, text) {
  ta.focus();
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
function wrapSelection(ta, mark) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e);
  insertText(ta, `${mark}${sel}${mark}`);
  if (s === e) ta.setSelectionRange(s + mark.length, s + mark.length);
}

noteContentInput.addEventListener("input", (e) => {
  const ta = noteContentInput;
  if (e.inputType === "insertText" && e.data === "[") {
    const p = ta.selectionStart;
    if (ta.value.slice(p - 2, p) === "[[" && ta.value.slice(p, p + 2) !== "]]") {
      insertText(ta, "]]");
      ta.setSelectionRange(p, p);
    }
  }
  markDirty();
  updateWordCount();
  if (state.mode !== "edit") { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }
  updateSuggest();
  clearTimeout(noteContentInput._bl);
  noteContentInput._bl = setTimeout(renderBacklinks, 400);
});
noteContentInput.addEventListener("click", updateSuggest);
noteContentInput.addEventListener("blur", () => setTimeout(hideSuggest, 120));
noteContentInput.addEventListener("scroll", hideSuggest);

noteContentInput.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("text/note-id")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    noteContentInput.classList.add("drag-over");
  }
});
noteContentInput.addEventListener("dragleave", () => noteContentInput.classList.remove("drag-over"));
noteContentInput.addEventListener("drop", (e) => {
  const id = e.dataTransfer.getData("text/note-id");
  noteContentInput.classList.remove("drag-over");
  if (!id) return;
  e.preventDefault();
  const n = state.noteMap.get(id);
  if (!n) return;
  const title = n.title || "Untitled";
  const ta = noteContentInput;
  insertText(ta, `[[${title}]]`);
  markDirty();
  updateWordCount();
  clearTimeout(noteContentInput._bl);
  noteContentInput._bl = setTimeout(renderBacklinks, 200);
  if (state.mode !== "edit") { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }
});

noteContentInput.addEventListener("keydown", (e) => {
  const ta = noteContentInput;

  if (sg.items.length) {
    if (e.key === "ArrowDown") { e.preventDefault(); sg.index = (sg.index + 1) % sg.items.length; paintSuggest(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); sg.index = (sg.index - 1 + sg.items.length) % sg.items.length; paintSuggest(); return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptSuggest(sg.items[sg.index]); return; }
    if (e.key === "Escape") { e.preventDefault(); hideSuggest(); return; }
  }

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); wrapSelection(ta, "**"); return; }
  if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); wrapSelection(ta, "*"); return; }

  if (e.key === "Tab") {
    e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd;
    if (s === en && !e.shiftKey) { insertText(ta, "  "); return; }
    const v = ta.value;
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    const block = v.slice(ls, en);
    const next = e.shiftKey ? block.replace(/^( {1,2}|\t)/gm, "") : block.replace(/^/gm, "  ");
    ta.setSelectionRange(ls, en);
    insertText(ta, next);
    ta.setSelectionRange(ls, ls + next.length);
    return;
  }

  if (e.key === "Enter" && !e.shiftKey && !mod && ta.selectionStart === ta.selectionEnd) {
    const pos = ta.selectionStart;
    const ls = ta.value.lastIndexOf("\n", pos - 1) + 1;
    const line = ta.value.slice(ls, pos);
    const m = /^(\s*)([-*+]|(\d+)\.)\s(\[[ xX]\]\s)?/.exec(line);
    if (m) {
      e.preventDefault();
      if (line.trim() === m[0].trim()) { ta.setSelectionRange(ls, pos); insertText(ta, ""); return; }
      const marker = m[3] ? `${+m[3] + 1}.` : m[2];
      insertText(ta, `\n${m[1]}${marker} ${m[4] ? "[ ] " : ""}`);
    }
  }
});

let sg = { items: [], index: 0, start: 0 };
function hideSuggest() { sg = { items: [], index: 0, start: 0 }; suggestEl.hidden = true; }

function caretCoords(ta, pos) {
  const cs = getComputedStyle(ta);
  const d = document.createElement("div");
  ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "tabSize"]
    .forEach((p) => (d.style[p] = cs[p]));
  d.style.cssText += ";position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;top:0;left:-9999px;";
  d.style.width = ta.clientWidth + "px";
  d.textContent = ta.value.slice(0, pos);
  const span = document.createElement("span");
  span.textContent = ta.value.slice(pos) || ".";
  d.append(span);
  document.body.append(d);
  const r = { top: span.offsetTop - ta.scrollTop, left: span.offsetLeft, lh: parseFloat(cs.lineHeight) || 20 };
  d.remove();
  return r;
}

function updateSuggest() {
  const ta = noteContentInput;
  if (ta.selectionStart !== ta.selectionEnd) { hideSuggest(); return; }
  const pos = ta.selectionStart;
  const m = /\[\[([^\[\]\n|]*)$/.exec(ta.value.slice(0, pos));
  if (!m) { hideSuggest(); return; }
  const q = m[1].toLowerCase();
  const items = state.notes
    .filter((n) => !n.archived && n.id !== state.activeNoteId && (n.title || "").toLowerCase().includes(q))
    .sort((a, b) => ((a.title || "").toLowerCase().startsWith(q) ? 0 : 1) - ((b.title || "").toLowerCase().startsWith(q) ? 0 : 1) || sorters.modified(a, b))
    .slice(0, 7).map((n) => ({ label: n.title || "Untitled", value: n.title || "Untitled" }));
  if (m[1].trim() && !items.some((i) => i.value.toLowerCase() === q))
    items.push({ label: `Link to new note “${m[1].trim()}”`, value: m[1].trim(), create: true });
  if (!items.length) { hideSuggest(); return; }
  sg = { items, index: 0, start: pos - m[1].length };
  const rect = ta.getBoundingClientRect();
  const c = caretCoords(ta, pos);
  suggestEl.style.top = Math.min(window.innerHeight - 260, rect.top + c.top + c.lh + 6) + "px";
  suggestEl.style.left = Math.min(window.innerWidth - 300, rect.left + c.left) + "px";
  suggestEl.hidden = false;
  paintSuggest();
}
function paintSuggest() {
  suggestEl.innerHTML = "";
  sg.items.forEach((it, i) => {
    const row = el("div", "ws-row" + (i === sg.index ? " on" : "") + (it.create ? " create" : ""), it.label);
    row.addEventListener("mousedown", (e) => { e.preventDefault(); acceptSuggest(it); });
    suggestEl.append(row);
  });
}
function acceptSuggest(it) {
  const ta = noteContentInput;
  const pos = ta.selectionStart;
  const after = ta.value.slice(pos);
  ta.setSelectionRange(sg.start, pos);
  const closed = after.startsWith("]]");
  hideSuggest();
  insertText(ta, closed ? it.value : it.value + "]]");
  if (closed) { const p = ta.selectionStart + 2; ta.setSelectionRange(p, p); }
}

let blCollapsed = lsGet("bl-collapsed", false);
function renderBacklinks() {
  const id = state.activeNoteId;
  const note = id && state.noteMap.get(id);
  if (!note) { backlinksEl.innerHTML = ""; return; }
  const title = (noteTitleInput.value || note.title || "").trim().toLowerCase();
  const back = state.notes.filter((n) => !n.archived && n.id !== id &&
    extractWikiLinks(n.content || "").some((l) => l.toLowerCase() === title));
  const outNames = [...new Set(extractWikiLinks(noteContentInput.value))];

  backlinksEl.innerHTML = "";
  const head = el("div", "bl-head");
  head.append(el("span", "chev", blCollapsed ? "▸" : "▾"), el("span", "", `Backlinks (${back.length})  ·  Outgoing links (${outNames.length})`));
  head.onclick = () => { blCollapsed = !blCollapsed; lsSet("bl-collapsed", blCollapsed); renderBacklinks(); };
  backlinksEl.append(head);
  if (blCollapsed) return;

  const cols = el("div", "bl-cols");
  const mk = (heading) => { const c = el("div", "bl-col"); c.append(el("div", "bl-sub", heading)); cols.append(c); return c; };

  const bcol = mk("Linked mentions");
  if (!back.length) bcol.append(el("div", "bl-empty", "No notes link here yet."));
  back.forEach((n) => {
    const row = el("div", "bl-item");
    row.append(el("div", "bl-title", n.title || "Untitled"));
    const c = n.content || "";
    const i = c.toLowerCase().indexOf("[[" + title);
    if (i >= 0) row.append(el("div", "bl-snip", "…" + c.slice(Math.max(0, i - 30), i + title.length + 40).replace(/\s+/g, " ") + "…"));
    row.onclick = () => openNote(n);
    bcol.append(row);
  });

  const ocol = mk("Outgoing links");
  if (!outNames.length) ocol.append(el("div", "bl-empty", "No [[links]] in this note."));
  outNames.forEach((name) => {
    const target = findNoteByTitle(name);
    const row = el("div", "bl-item" + (target ? "" : " unresolved"));
    row.append(el("div", "bl-title", name + (target ? "" : "  (not created)")));
    row.onclick = () => openByTitle(name);
    ocol.append(row);
  });
  backlinksEl.append(cols);
}

/* ==========================================================================
   MOBILE
   ========================================================================== */
const sidebarEl = $("sidebar");
const sidebarScrim = $("sidebar-scrim");
const isMobile = () => window.matchMedia("(max-width: 860px)").matches;

function openSidebar() { sidebarEl.classList.add("open"); sidebarScrim.classList.add("show"); }
function closeSidebar() { sidebarEl.classList.remove("open"); sidebarScrim.classList.remove("show"); }
$("sidebar-toggle").addEventListener("click", () => {
  sidebarEl.classList.contains("open") ? closeSidebar() : openSidebar();
});
sidebarScrim.addEventListener("click", closeSidebar);
notesList.addEventListener("click", (e) => {
  if (isMobile() && e.target.closest(".note-item")) closeSidebar();
});
$("note-back-btn").addEventListener("click", () => {
  flushSave();
  state.activeNoteId = null;
  switchView("dashboard");
});
window.addEventListener("resize", () => { if (!isMobile()) closeSidebar(); });

/* ==========================================================================
   GLOBAL SHORTCUTS
   ========================================================================== */
document.addEventListener("keydown", (e) => {
  if (!state.uid || document.querySelector(".modal-overlay")) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "k") { e.preventDefault(); quickSwitcher(); }
  else if (e.altKey && k === "n") { e.preventDefault(); newNote(); }
  else if (mod && k === "e" && state.view === "notes") { e.preventDefault(); setMode(state.mode === "preview" ? "edit" : "preview"); }
  else if (k === "f2") { e.preventDefault(); renameActive(); }
  else if (mod && k === "s") { e.preventDefault(); if (state.view === "notes") { performSave(); toast("Saved", { type: "ok", ms: 1200 }); } }
  else if (mod && e.shiftKey && k === "f") { e.preventDefault(); openSearch(); }
});

/* ==========================================================================
   GRAPH
   ========================================================================== */
const G = { inited: false };
const ALPHA_MIN = 0.001;
const IDLE_ALPHA = 0.035;

function initGraph() {
  if (G.inited) {
    resizeGraph();
    syncGraph();
    G.alpha = Math.max(G.alpha, 0.2);
    wake();
    return;
  }
  G.inited = true;
  Object.assign(G, {
    nodes: new Map(), edges: new Map(), list: [], edgeList: [], adj: new Map(),
    alpha: 1, alphaTarget: 0, raf: 0, hover: null, drag: null, down: null,
    w: 800, h: 600, sig: "", labelsOn: true,
    cur: { x: 0, y: 0, s: 1 }, tgt: { x: 0, y: 0, s: 1 },
    timelapse: { active: false, playing: false, order: [], rank: new Map(), count: 0, raf: 0, lastT: 0, remaining: 0 }
  });

  graphContainer.innerHTML = "";
  G.svg = svgEl("svg");
  G.svg.style.cssText = "width:100%;height:100%;touch-action:none;user-select:none;";
  G.root = svgEl("g");
  G.gEdges = svgEl("g");
  G.gNodes = svgEl("g");
  G.root.append(G.gEdges, G.gNodes);
  G.svg.append(G.root);
  graphContainer.append(G.svg);

  resizeGraph();
  new ResizeObserver(() => { resizeGraph(); wake(); }).observe(graphContainer);

  G.svg.addEventListener("pointerdown", (e) => {
    const g = e.target.closest("g.node");
    G.down = {
      x: e.clientX, y: e.clientY, moved: false,
      id: g ? g.dataset.id : null,
      tx: G.tgt.x, ty: G.tgt.y
    };
    G.svg.setPointerCapture(e.pointerId);
  });

  G.svg.addEventListener("pointermove", (e) => {
    const d = G.down;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) {
      d.moved = true;
      if (d.id && G.nodes.has(d.id)) {
        G.drag = G.nodes.get(d.id);
        G.alphaTarget = 0.3;
        G.svg.classList.add("dragging");
        setHover(G.drag.id);
      } else {
        G.svg.classList.add("panning");
      }
    }
    if (!d.moved) return;
    if (G.drag) {
      const p = graphToWorld(e);
      G.drag.fx = p.x;
      G.drag.fy = p.y;
    } else {
      G.tgt.x = G.cur.x = d.tx + (e.clientX - d.x);
      G.tgt.y = G.cur.y = d.ty + (e.clientY - d.y);
    }
    wake();
  });

  const endPointer = (e) => {
    const d = G.down;
    if (!d) return;
    if (!d.moved && d.id) {
      const n = G.nodes.get(d.id);
      if (n && n.note) openNote(n.note);
    }
    if (G.drag) {
      G.drag.fx = G.drag.fy = null;
      G.drag = null;
      G.alphaTarget = 0;
      G.alpha = Math.max(G.alpha, 0.3);
    }
    G.down = null;
    G.svg.classList.remove("dragging", "panning");
    try { G.svg.releasePointerCapture(e.pointerId); } catch (_) {}
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest("g.node");
    setHover(under ? under.dataset.id : null);
    wake();
  };
  G.svg.addEventListener("pointerup", endPointer);
  G.svg.addEventListener("pointercancel", endPointer);

  G.svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = G.svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const ns = Math.max(0.2, Math.min(4, G.tgt.s * factor));
    G.tgt.x = mx - (mx - G.tgt.x) * (ns / G.tgt.s);
    G.tgt.y = my - (my - G.tgt.y) * (ns / G.tgt.s);
    G.tgt.s = ns;
    wake();
  }, { passive: false });

  syncGraph();
}

function resizeGraph() {
  if (!G.svg) return;
  const w = graphContainer.clientWidth, h = graphContainer.clientHeight;
  if (!w || !h) return;
  G.w = w; G.h = h;
  G.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
}

function graphToWorld(e) {
  const r = G.svg.getBoundingClientRect();
  return {
    x: (e.clientX - r.left - G.cur.x) / G.cur.s,
    y: (e.clientY - r.top - G.cur.y) / G.cur.s
  };
}

function makeNode(note, x, y) {
  const g = svgEl("g", { class: "node" });
  g.dataset.id = note.id;
  const hit = svgEl("circle", { class: "hit", r: 16, fill: "transparent" });
  const dot = svgEl("circle", { class: "dot", r: 6 });
  const label = svgEl("text", { class: "label" });
  g.append(hit, dot, label);
  G.gNodes.append(g);

  g.addEventListener("pointerenter", () => { if (!G.drag) setHover(note.id); });
  g.addEventListener("pointerleave", () => { if (!G.drag && G.hover === note.id) setHover(null); });

  return { id: note.id, x, y, vx: 0, vy: 0, fx: null, fy: null, el: g, hit, dot, label, deg: 0, r: 6, color: DEFAULT_COLOR, hasProj: false, note };
}

function syncGraph() {
  if (!G.inited) return;
  const notes = state.notes.filter((n) => !n.archived);
  const ids = new Set(notes.map((n) => n.id));
  const links = computeLinks(ids);

  const adj = new Map(notes.map((n) => [n.id, new Set()]));
  links.forEach((l) => { adj.get(l.a).add(l.b); adj.get(l.b).add(l.a); });

  G.nodes.forEach((n, id) => { if (!ids.has(id)) { n.el.remove(); G.nodes.delete(id); } });

  notes.forEach((note) => {
    if (!G.nodes.has(note.id)) {
      let x = G.w / 2 + (Math.random() - 0.5) * Math.sqrt(notes.length) * 40;
      let y = G.h / 2 + (Math.random() - 0.5) * Math.sqrt(notes.length) * 40;
      for (const nid of adj.get(note.id)) {
        const nb = G.nodes.get(nid);
        if (nb) { x = nb.x + (Math.random() - 0.5) * 30; y = nb.y + (Math.random() - 0.5) * 30; break; }
      }
      G.nodes.set(note.id, makeNode(note, x, y));
    }
    const n = G.nodes.get(note.id);
    n.note = note;
    n.deg = adj.get(note.id).size;
    const pc = projectColor(note);
    n.hasProj = !!pc;
    n.color = pc || DEFAULT_COLOR;
    n.label.textContent = trunc(note.title || "Untitled", 24);
  });
  G.list = [...G.nodes.values()];
  G.adj = adj;

  G.edges.forEach((e, k) => { if (!links.has(k)) { e.el.remove(); G.edges.delete(k); } });
  links.forEach((l, k) => {
    if (!G.edges.has(k)) {
      const el = svgEl("line", { class: "edge" });
      G.gEdges.append(el);
      G.edges.set(k, { a: l.a, b: l.b, el });
    }
  });
  G.edgeList = [...G.edges.values()];

  const sig = [...ids].sort().join(",") + "#" + [...links.keys()].sort().join(",");
  const changed = sig !== G.sig;
  G.sig = sig;

  styleGraph();
  if (changed) G.alpha = Math.max(G.alpha, 0.5);
  wake();
}

function setHover(id) {
  if (G.hover === id) return;
  G.hover = id;
  styleGraph();
}

function styleGraph() {
  if (!G.inited) return;
  const cfg = state.graphCfg;
  const hid = G.hover;
  const nb = hid ? G.adj.get(hid) || new Set() : null;
  G.labelsOn = G.cur.s >= 0.6;

  const tl = G.timelapse;
  const notBornYet = (id) => !!(tl && tl.active && tl.rank.has(id) && tl.rank.get(id) >= tl.count);

  G.nodes.forEach((n) => {
    const isHover = n.id === hid;
    const focus = !hid || isHover || nb.has(n.id);
    const bornAfter = notBornYet(n.id);
    n.r = (4 + Math.sqrt(n.deg) * 2.3) * cfg.size;
    n.dot.setAttribute("r", n.r);
    n.hit.setAttribute("r", Math.max(n.r + 8, 14));
    n.dot.setAttribute("fill", isHover ? "#ffffff" : n.color);
    n.dot.style.transform = isHover ? "scale(1.45)" : bornAfter ? "scale(0.2)" : "scale(1)";
    n.dot.style.filter = isHover
      ? `drop-shadow(0 0 12px ${n.color})`
      : hid && focus ? `drop-shadow(0 0 5px ${n.color})` : "none";
    n.el.style.transition = tl && tl.active ? "opacity .35s ease" : "";
    n.el.style.opacity = bornAfter ? 0 : focus ? 1 : 0.15;
    n.el.style.pointerEvents = bornAfter ? "none" : "";
    n.label.setAttribute("x", n.r + 6);
    n.label.setAttribute("y", 4);
    n.label.style.opacity = cfg.hideLabels ? 0 : bornAfter ? 0 : hid ? (focus ? 1 : 0) : G.labelsOn ? 0.85 : 0;
    n.label.style.fill = isHover ? "#ffffff" : "#94a3b8";
  });

  G.edgeList.forEach((e) => {
    const a = G.nodes.get(e.a), b = G.nodes.get(e.b);
    if (!a || !b) return;
    if (tl && tl.active) {
      const hideEdge = notBornYet(e.a) || notBornYet(e.b);
      e.el.style.transition = "opacity .35s ease";
      e.el.style.opacity = hideEdge ? 0 : 0.5;
      if (hideEdge) return;
    }
    const color = a.hasProj || b.hasProj
      ? mixColors([a.hasProj ? a.color : null, b.hasProj ? b.color : null])
      : "#6b7280";
    e.el.setAttribute("stroke", color);
    const linked = hid && (e.a === hid || e.b === hid);
    e.el.style.opacity = !hid ? 0.5 : linked ? 0.95 : 0.05;
    e.el.setAttribute("stroke-width", linked ? 2 : 1.2);
  });
}

function wake() {
  if (!G.raf) G.raf = requestAnimationFrame(graphFrame);
}

function graphFrame() {
  G.raf = 0;
  const simActive = G.alpha >= ALPHA_MIN || G.alphaTarget > 0;
  if (simActive) stepSim();
  const viewMoving = easeGraphView();
  renderGraph();
  if ((G.cur.s >= 0.6) !== G.labelsOn) styleGraph();
  if (simActive || viewMoving) wake();
}

/* Timelapse-only physics: a calm, fully-damped fluid relaxation (Obsidian-like) —
   each new node eases its neighborhood into place and then the layout goes nearly
   still, with only a faint idle wobble, rather than staying in constant motion.
   Never bounces, overshoots or snaps. Only runs while the timelapse is active;
   the normal graph simulation (stepSim) is untouched. */
function stepSimElastic() {
  const cfg = state.graphCfg;
  const tl = G.timelapse;
  const born = (n) => !tl.rank.has(n.id) || tl.rank.get(n.id) < tl.count;
  const list = G.list.filter(born);
  const a = 0.32;

  const cx = G.w / 2, cy = G.h / 2;
  const t = (G._wt = (G._wt || 0) + 16);

  // Magnet-like repulsion: push apart, soft falloff, no snapping
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const q = list[j];
      let dx = p.x - q.x, dy = p.y - q.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 250000) continue;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy + 1; }
      const d = Math.sqrt(d2);
      const mag = (cfg.repel * a) / Math.max(d, 14) * Math.exp(-d / 260);
      const fx = (dx / d) * mag, fy = (dy / d) * mag;
      p.vx += fx; p.vy += fy;
      q.vx -= fx; q.vy -= fy;
    }
  }

  // Elastic but critically damped links: they pull toward link-distance without
  // any overshoot — the "rubber" is in how loosely they hold their shape, not in bounce.
  for (const e of G.edgeList) {
    const p = G.nodes.get(e.a), q = G.nodes.get(e.b);
    if (!p || !q || !born(p) || !born(q)) continue;
    const dx = q.x - p.x, dy = q.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = 0.22 / Math.sqrt(Math.max(1, Math.min(p.deg, q.deg)));
    const f = (d - cfg.link) * k * a;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    p.vx += fx; p.vy += fy;
    q.vx -= fx; q.vy -= fy;
  }

  // Barely-there shared current: just enough that the whole connected shape
  // isn't a dead-still photograph, without reading as ongoing motion.
  const driftAng = t * 0.00012;
  const driftX = Math.cos(driftAng) * 0.02;
  const driftY = Math.sin(driftAng * 0.8) * 0.02;

  for (const n of list) {
    if (n.fx != null) {
      n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0;
      continue;
    }
    if (n._wph == null) n._wph = Math.random() * Math.PI * 2;
    // Per-node idle wobble: faint and slow — the layout settles close to still
    // after each birth instead of continuously re-flowing into new shapes.
    n.vx += Math.sin(t * 0.00035 + n._wph) * 0.045 + driftX;
    n.vy += Math.cos(t * 0.0003 + n._wph * 1.37) * 0.045 + driftY;
    // A soft, weak pull to center keeps the whole thing roughly on screen
    // without fighting the drift.
    n.vx += (cx - n.x) * cfg.center * a * 0.12;
    n.vy += (cy - n.y) * cfg.center * a * 0.12;
    // Heavy damping: momentum fades out quickly, nothing bounces, nothing lingers.
    n.vx *= 0.68; n.vy *= 0.68;
    const sp = Math.hypot(n.vx, n.vy);
    if (sp > 2.2) { n.vx *= 2.2 / sp; n.vy *= 2.2 / sp; }
    n.x += n.vx; n.y += n.vy;
    // A slow-following "settled" position, filtered to ignore the moment-to-moment
    // wander/drift. New nodes spawn relative to this, not the live, jittering spot,
    // so births track the graph's real shape instead of trailing the drift.
    if (n._sx == null) { n._sx = n.x; n._sy = n.y; }
    n._sx += (n.x - n._sx) * 0.03;
    n._sy += (n.y - n._sy) * 0.03;
  }
}

function stepSim() {
  if (G.timelapse && G.timelapse.active) { stepSimElastic(); return; }
  const cfg = state.graphCfg;
  const list = G.list;
  const a = G.alpha;
  G.alpha += (Math.max(G.alphaTarget, IDLE_ALPHA) - G.alpha) * 0.0228;

  const cx = G.w / 2, cy = G.h / 2;

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const q = list[j];
      let dx = p.x - q.x, dy = p.y - q.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 160000) continue;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy + 1; }
      const d = Math.sqrt(d2);
      const mag = (cfg.repel * a) / Math.max(d, 12);
      const fx = (dx / d) * mag, fy = (dy / d) * mag;
      p.vx += fx; p.vy += fy;
      q.vx -= fx; q.vy -= fy;
    }
  }

  for (const e of G.edgeList) {
    const p = G.nodes.get(e.a), q = G.nodes.get(e.b);
    if (!p || !q) continue;
    const dx = q.x - p.x, dy = q.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = 0.4 / Math.sqrt(Math.max(1, Math.min(p.deg, q.deg)));
    const f = (d - cfg.link) * k * a;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    p.vx += fx; p.vy += fy;
    q.vx -= fx; q.vy -= fy;
  }

  for (const n of list) {
    if (n.fx != null) {
      n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0;
      continue;
    }
    n.vx += (cx - n.x) * cfg.center * a;
    n.vy += (cy - n.y) * cfg.center * a;
    n.vx *= 0.6; n.vy *= 0.6;
    n.x += n.vx; n.y += n.vy;
  }
}

function easeGraphView() {
  const c = G.cur, t = G.tgt;
  const dx = t.x - c.x, dy = t.y - c.y, ds = t.s - c.s;
  if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 && Math.abs(ds) < 0.0005) {
    c.x = t.x; c.y = t.y; c.s = t.s;
    return false;
  }
  c.x += dx * 0.2; c.y += dy * 0.2; c.s += ds * 0.2;
  return true;
}

function renderGraph() {
  G.root.setAttribute("transform", `translate(${G.cur.x},${G.cur.y}) scale(${G.cur.s})`);
  for (const n of G.list) n.el.setAttribute("transform", `translate(${n.x},${n.y})`);
  for (const e of G.edgeList) {
    const a = G.nodes.get(e.a), b = G.nodes.get(e.b);
    if (!a || !b) continue;
    e.el.setAttribute("x1", a.x); e.el.setAttribute("y1", a.y);
    e.el.setAttribute("x2", b.x); e.el.setAttribute("y2", b.y);
  }
}

[["cfg-repel", "repel"], ["cfg-link", "link"], ["cfg-center", "center"], ["cfg-size", "size"]].forEach(([id, key]) => {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = state.graphCfg[key];
  input.addEventListener("input", () => {
    state.graphCfg[key] = parseFloat(input.value);
    if (G.inited) { styleGraph(); G.alpha = Math.max(G.alpha, 0.5); wake(); }
  });
});
const cfgHideLabels = document.getElementById("cfg-hide-labels");
if (cfgHideLabels) {
  cfgHideLabels.checked = state.graphCfg.hideLabels;
  cfgHideLabels.addEventListener("change", () => {
    state.graphCfg.hideLabels = cfgHideLabels.checked;
    if (G.inited) styleGraph();
  });
}
const cfgToggle = document.getElementById("cfg-toggle");
const cfgPanel = document.getElementById("graph-settings");
if (cfgToggle && cfgPanel) cfgToggle.addEventListener("click", () => cfgPanel.classList.toggle("open"));

/* ==========================================================================
   TIMELAPSE
   ========================================================================== */
const tlPlay = $("tl-play");
const tlSlider = $("tl-slider");
const tlClose = $("tl-close");
const tlSpeedEl = $("tl-speed");
const tlBar = $("timelapse-bar");

function timelapseOrder() {
  return state.notes
    .filter((n) => !n.archived && ts(n.created_at) > 0)
    .sort((a, b) => ts(a.created_at) - ts(b.created_at))
    .map((n) => n.id);
}
function timelapseEnsureOrder() {
  if (!G.timelapse.order.length) {
    const order = timelapseOrder();
    G.timelapse.order = order;
    G.timelapse.rank = new Map(order.map((id, i) => [id, i]));
  }
  return G.timelapse.order;
}

function timelapseBaseDelay(count) {
  if (count <= 1) return 700;
  const totalMs = Math.min(45000, Math.max(2200, 900 * Math.sqrt(count)));
  return totalMs / count;
}
function timelapseNextDelay(count, speed) {
  const base = timelapseBaseDelay(count);
  const jitter = base > 60 ? 0.8 + Math.random() * 0.4 : 1;
  return (base * jitter) / speed;
}

let tlSpeed = lsGet("tl-speed", 1);
function paintTlSpeed() {
  tlSpeedEl.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === tlSpeed));
}
paintTlSpeed();
tlSpeedEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-speed]");
  if (!b) return;
  tlSpeed = Number(b.dataset.speed);
  lsSet("tl-speed", tlSpeed);
  paintTlSpeed();
});

function timelapseResetPositions() {
  const cx = G.w / 2, cy = G.h / 2;
  G.nodes.forEach((n) => {
    n.x = cx + (Math.random() - 0.5) * 24;
    n.y = cy + (Math.random() - 0.5) * 24;
    n.vx = n.vy = 0;
    n.fx = n.fy = null;
  });
}
function timelapseRevealNode(id) {
  const n = G.nodes.get(id);
  if (!n) return;
  const tl = G.timelapse;
  let anchor = null;
  for (const nb of G.adj.get(id) || []) {
    const r = tl.rank.get(nb);
    if (r != null && r < tl.count) { anchor = G.nodes.get(nb); break; }
  }
  // Spawn at a random point inside a disc whose radius follows the "Link distance" force setting,
  // so new dots don't all appear from one spot.
  const R = state.graphCfg.link;
  const disc = (r) => {
    const t = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    return [Math.cos(t) * d, Math.sin(t) * d];
  };
  const pos = (node) => (node._sx != null ? [node._sx, node._sy] : [node.x, node.y]);
  if (anchor) {
    const [ax, ay] = pos(anchor);
    const [ox, oy] = disc(R);
    n.x = ax + ox;
    n.y = ay + oy;
  } else {
    // No linked note yet: land near a random already-visible node, or spread around the centre
    const shown = tl.order.slice(0, tl.count).map((id2) => G.nodes.get(id2)).filter(Boolean);
    const base = shown.length && Math.random() < 0.7 ? shown[Math.floor(Math.random() * shown.length)] : null;
    const [bx, by] = base ? pos(base) : [G.w / 2, G.h / 2];
    const [ox, oy] = disc(base ? R : R * (1 + Math.sqrt(tl.count) * 0.6));
    n.x = bx + ox;
    n.y = by + oy;
  }
  // Ease in, don't pop: a small amount of settling velocity, no snap or bounce.
  n.vx = (Math.random() - 0.5) * 0.6;
  n.vy = (Math.random() - 0.5) * 0.6;
  n._sx = n.x; n._sy = n.y;
  G.alpha = Math.max(G.alpha, 0.45);
}

function timelapseFrame(now) {
  const tl = G.timelapse;
  if (!tl.active || !tl.playing) { tl.raf = 0; return; }
  const dt = Math.min(250, now - (tl.lastT || now));
  tl.lastT = now;
  tl.remaining -= dt;
  let revealed = 0;
  while (tl.remaining <= 0 && tl.count < tl.order.length && revealed < 400) {
    timelapseRevealNode(tl.order[tl.count]);
    tl.count++;
    revealed++;
    tl.remaining += timelapseNextDelay(tl.order.length, tlSpeed);
  }
  if (revealed) {
    tlSlider.value = String(Math.round((tl.count / tl.order.length) * 1000));
    styleGraph();
    wake();
  }
  
  if (tl.count >= tl.order.length) {
    tl.playing = false;
    tl.raf = 0;
    tlPlay.textContent = "▶ Replay";
    
    clearTimeout(tl._closeTimer);
    tl._closeTimer = setTimeout(() => {
      if (!G.timelapse.playing && G.timelapse.active) {
        timelapseExit();
      }
    }, 2000);
    
    return;
  }
  tl.raf = requestAnimationFrame(timelapseFrame);
}

function timelapseStart() {
  const order = timelapseEnsureOrder();
  if (order.length < 2) { toast("Not enough dated notes for a timelapse.", { type: "err", ms: 1800 }); return; }
  const tl = G.timelapse;
  
  clearTimeout(tl._closeTimer);
  const replayFromEnd = Number(tlSlider.value) >= 1000;
  const fresh = tl.count === 0 || replayFromEnd;
  
  tl.active = true;
  tlSlider.disabled = false;
  tlClose.hidden = false;
  tlSpeedEl.hidden = false;
  tlBar.classList.add("active");
  tlPlay.textContent = "⏸ Pause";

  if (replayFromEnd) { tlSlider.value = "0"; tl.count = 0; }
  if (fresh) timelapseResetPositions();
  styleGraph();

  tl.playing = true;
  tl.lastT = performance.now();
  tl.remaining = timelapseNextDelay(order.length, tlSpeed);
  if (!tl.raf) tl.raf = requestAnimationFrame(timelapseFrame);
  wake();
}

function timelapsePause() {
  const tl = G.timelapse;
  tl.playing = false;
  if (tl.raf) cancelAnimationFrame(tl.raf);
  tl.raf = 0;
  tlPlay.textContent = "▶ Resume";
}

function timelapseExit() {
  const tl = G.timelapse;
  clearTimeout(tl._closeTimer);
  tl.playing = false;
  if (tl.raf) cancelAnimationFrame(tl.raf);
  tl.raf = 0;
  tl.active = false;
  tl.order = [];
  tl.rank = new Map();
  tl.count = 0;
  tlSlider.disabled = true;
  tlSlider.value = "1000";
  tlClose.hidden = true;
  tlSpeedEl.hidden = true;
  tlPlay.textContent = "▶ Timelapse";
  tlBar.classList.remove("active");
  styleGraph();
}

tlPlay.addEventListener("click", (e) => {
  e.preventDefault();
  if (!G.timelapse.active || !G.timelapse.playing) { 
    timelapseStart(); 
    return; 
  }
  timelapsePause();
});

tlSlider.addEventListener("input", () => {
  const tl = G.timelapse;
  clearTimeout(tl._closeTimer);
  if (!tl.active) { tl.active = true; tlClose.hidden = false; tlSpeedEl.hidden = false; tlBar.classList.add("active"); }
  timelapsePause();
  const order = timelapseEnsureOrder();
  if (!order.length) return;
  tl.count = Math.round((Number(tlSlider.value) / 1000) * order.length);
  styleGraph();
});
tlClose.addEventListener("click", timelapseExit);

/* ==========================================================================
   CANVAS
   ========================================================================== */
const GRID = 20;
const CARD_COLORS = [
  { id: "1", name: "Red", hex: "#fb464c" },
  { id: "2", name: "Orange", hex: "#e9973f" },
  { id: "3", name: "Yellow", hex: "#e0de71" },
  { id: "4", name: "Green", hex: "#44cf6e" },
  { id: "5", name: "Cyan", hex: "#53dfdd" },
  { id: "6", name: "Purple", hex: "#a882ff" }
];
const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { top: "bottom", bottom: "top", left: "right", right: "left" };
const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

const C = {
  id: null, name: "", loaded: false, busy: false,
  cards: new Map(),
  edges: [],
  edgeEls: new Map(),
  view: { x: 0, y: 0, s: 1 },
  viewTarget: null,
  zoomAnim: 0,
  mode: null, editing: null,
  selected: new Set(), selEdge: null,
  undo: [], redo: [],
  z: 1, raf: 0, moved: false, needFit: false, viewT: null,
  opt: Object.assign({ grid: false, objects: true, physics: false, readonly: false }, lsGet("cv-opt", {}))
};
const canvasCache = new Map();

const defs = svgEl("defs");
canvasSvg.append(defs);
const guideSvg = svgEl("svg", { class: "canvas-guides" });
canvasWorld.append(guideSvg);
const marqueeEl = el("div", "canvas-marquee");
marqueeEl.hidden = true;
canvasArea.append(marqueeEl);
const toolbarEl = $("card-toolbar");
const ro = () => !!C.opt.readonly;

let spaceHeld = false;

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable='true'], .cc-edit, .modal-overlay")) return;
  if (state.view !== "canvas") return;
  if (spaceHeld) { e.preventDefault(); return; }
  spaceHeld = true;
  canvasArea.classList.add("space-pan");
  e.preventDefault();
}, true);

window.addEventListener("keyup", (e) => {
  if (e.code !== "Space") return;
  spaceHeld = false;
  canvasArea.classList.remove("space-pan");
  if (C.mode && C.mode.type === "pan") {
    C.mode = null;
    canvasArea.classList.remove("panning");
  }
}, true);

window.addEventListener("blur", () => {
  spaceHeld = false;
  canvasArea.classList.remove("space-pan");
});

function colorHex(v) {
  if (!v) return null;
  const p = CARD_COLORS.find((x) => x.id === v);
  return p ? p.hex : isHex(v) ? v : null;
}
const canvasDegree = (id) => C.edges.reduce((n, e) => n + (e.from === id || e.to === id ? 1 : 0), 0);
const canvasNeighbors = (id) => C.edges.filter((e) => e.from === id || e.to === id).map((e) => (e.from === id ? e.to : e.from));
const nameOfCanvas = (d) => d.name || (d.id === "main" ? "Main canvas" : "Untitled canvas");

function normCard(c) {
  const type = c.type || "note";
  return {
    id: c.id || genId(), type,
    noteId: type === "note" ? (c.noteId || (c.type ? "" : c.id)) : "",
    canvasId: type === "canvas" ? (c.canvasId || "") : "",
    text: c.text || "",
    x: +c.x || 0, y: +c.y || 0, w: +c.w || 260, h: +c.h || 120,
    color: c.color || "", manual: !!c.manual,
    vx: 0, vy: 0, el: null, col: NEUTRAL_COLOR, _src: null
  };
}
const EDGE_DIRS = ["none", "uni", "bi"];
function normEdge(e) {
  let dir = e.dir;
  if (!EDGE_DIRS.includes(dir)) dir = e.arrow ? "uni" : "none";
  return {
    id: e.id || genId(), from: e.from, to: e.to,
    fromSide: e.fromSide || null, toSide: e.toSide || null,
    color: e.color || "", dir,
    label: e.label || "", style: e.style === "straight" ? "straight" : "curve",
    pulse: 0
  };
}
const serCard = (c) => ({
  id: c.id, type: c.type, noteId: c.noteId, canvasId: c.canvasId, text: c.text,
  x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h),
  color: c.color || "", manual: c.manual
});
const serEdge = (e) => ({
  id: e.id, from: e.from, to: e.to, fromSide: e.fromSide, toSide: e.toSide, color: e.color || "", dir: e.dir || "none",
  label: e.label || "", style: e.style || "curve"
});

function deriveLinks(d) {
  const noteOf = new Map();
  (d.cards || []).forEach((c) => {
    const nid = c.type === "text" ? "" : c.noteId || (c.type ? "" : c.id);
    if (nid) noteOf.set(c.id, nid);
  });
  const out = [];
  (d.edges || []).forEach((e) => {
    const a = noteOf.get(e.from), b = noteOf.get(e.to);
    if (a && b && a !== b) out.push([a, b]);
  });
  return out;
}
function canvasPairs() {
  const out = [];
  canvasCache.forEach((d, id) => {
    if (id === C.id && C.loaded) {
      C.edges.forEach((e) => {
        const a = C.cards.get(e.from), b = C.cards.get(e.to);
        if (a && b && a.type === "note" && b.type === "note" && a.noteId && b.noteId && a.noteId !== b.noteId)
          out.push([a.noteId, b.noteId]);
      });
    } else deriveLinks(d).forEach((p) => out.push(p));
  });
  return out;
}

function resetCanvasState() {
  clearCanvasDom();
  C.selected.clear(); C.selEdge = null; C.loaded = false; C.id = null; C.name = "";
  C.undo = []; C.redo = []; C.busy = false;
  clearTimeout(cvSaveTimer); cvSaveTimer = null;
  canvasCache.clear();
  updateCanvasSelect();
  buildToolbar();
  if (state.uid) renderNotesList();
}
function clearCanvasDom() {
  C.cards.forEach((c) => c.el && c.el.remove());
  C.cards.clear();
  C.edgeEls.forEach((o) => { o.path.remove(); o.hit.remove(); o.arrow.remove(); o.arrow2.remove(); o.grad.remove(); o.lbl.remove(); o.lblBg.remove(); });
  C.edgeEls.clear();
  C.edges = [];
  C.editing = null;
}

const blankCanvas = (name, projectId = null) => ({
  name, project_id: projectId, pinned: false, cards: [], edges: [],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString()
});
const sortedCanvasIds = () => [...canvasCache.values()]
  .sort((a, b) => nameOfCanvas(a).localeCompare(nameOfCanvas(b))).map((d) => d.id);

function updateCanvasSelect() {
  const sel = $("canvas-select");
  if (!sel) return;
  sel.innerHTML = "";
  sortedCanvasIds().forEach((id) => sel.append(new Option(nameOfCanvas(canvasCache.get(id)), id)));
  if (C.id && canvasCache.has(C.id)) sel.value = C.id;
}

async function initCanvases(uid) {
  const { data, error } = await supabase.from('canvases').select('*').eq('user_id', uid);
  if (error) { notifyErr("Canvas load: " + error.message); return; }
  
  canvasCache.clear();
  data.forEach((d) => canvasCache.set(d.id, d));
  updateCanvasSelect();
  renderNotesList();

  if (!canvasCache.size) {
    const newDoc = blankCanvas("Untitled canvas");
    newDoc.user_id = uid;
    const { data: res, error: err } = await supabase.from('canvases').insert([newDoc]).select().single();
    if (err) notifyErr("Canvas create: " + err.message);
    else {
      canvasCache.set(res.id, res);
      loadCanvasData(res.id);
    }
    return;
  }

  if (!C.loaded || !canvasCache.has(C.id)) {
    const want = lsGet("cv-active", null);
    loadCanvasData(canvasCache.has(want) ? want : sortedCanvasIds()[0]);
  }
  syncGraph();
  renderNotesList();

  const canvasSub = supabase.channel('custom-canvases-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'canvases', filter: `user_id=eq.${uid}` }, (payload) => {
      if (payload.eventType === 'INSERT') {
        canvasCache.set(payload.new.id, payload.new);
      } else if (payload.eventType === 'UPDATE') {
        canvasCache.set(payload.new.id, payload.new);
      } else if (payload.eventType === 'DELETE') {
        canvasCache.delete(payload.old.id);
      }
      
      updateCanvasSelect();
      renderNotesList();
      if (C.busy) return;
      
      if (C.loaded && payload.new && C.id === payload.new.id) {
        // Optional: Update current canvas if remote changes occur
      } else if (!C.loaded || !canvasCache.has(C.id)) {
        const want = lsGet("cv-active", null);
        loadCanvasData(canvasCache.has(want) ? want : sortedCanvasIds()[0]);
      }
      syncGraph();
    }).subscribe();
  unsubs.push(canvasSub);
}

function loadCanvasData(id) {
  clearCanvasDom();
  const d = canvasCache.get(id) || {};
  C.id = id;
  C.name = nameOfCanvas({ ...d, id });
  (d.cards || []).forEach((c) => { const n = normCard(c); C.cards.set(n.id, n); });
  C.edges = (d.edges || []).map(normEdge).filter((e) => C.cards.has(e.from) && C.cards.has(e.to));
  C.selected.clear(); C.selEdge = null; C.undo = []; C.redo = [];
  const savedView = lsGet("cv-view-" + id, null);
  C.view = savedView || { x: 0, y: 0, s: 1 };
  C.viewTarget = null;
  C.needFit = !savedView && C.cards.size > 0;
  C.loaded = true;
  lsSet("cv-active", id);
  updateCanvasSelect();
  renderCanvas();
  applyCanvasView();
  buildToolbar();
  if (state.view === "canvas") onCanvasShown();
  syncGraph();
  renderNotesList();
}

let cvSaveTimer = null;
let cvWarned = false;
function saveCanvas() {
  if (!C.loaded) return;
  clearTimeout(cvSaveTimer);
  cvSaveTimer = setTimeout(performCanvasSave, 600);
}
async function performCanvasSave() {
  clearTimeout(cvSaveTimer);
  cvSaveTimer = null;
  if (!state.uid || !C.loaded || !C.id) return;
  const prev = canvasCache.get(C.id) || {};
  const data = {
    name: C.name,
    cards: [...C.cards.values()].map(serCard),
    edges: C.edges.map(serEdge),
    project_id: prev.project_id || null,
    pinned: !!prev.pinned,
    updated_at: new Date().toISOString()
  };
  canvasCache.set(C.id, { ...prev, id: C.id, ...data });
  try {
    const { error } = await supabase.from('canvases').update(data).eq('id', C.id);
    if (error) throw error;
  }
  catch (e) { if (!cvWarned) { cvWarned = true; notifyErr("Canvas save failed: " + e.message); } }
}
function flushCanvasSave() { if (cvSaveTimer) performCanvasSave(); }
window.addEventListener("beforeunload", flushCanvasSave);

function touch() { renderCanvas(); saveCanvas(); syncGraph(); }

function promptDialog(title, value = "", placeholder = "") {
  return openModal((box, close) => {
    box.append(el("h3", "", title));
    const input = el("input", "modal-input");
    input.value = value;
    input.placeholder = placeholder;
    const row = el("div", "modal-actions");
    const cancel = el("button", "btn", "Cancel");
    const ok = el("button", "btn btn-primary", "OK");
    const submit = () => close(input.value.trim());
    cancel.onclick = () => close(null);
    ok.onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    row.append(cancel, ok);
    box.append(input, row);
    input.focus();
    input.select();
  });
}

async function newCanvasFlow(projectId = null) {
  const name = await promptDialog("New canvas", "", "Canvas name");
  if (name === null) return;
  flushCanvasSave();
  const data = blankCanvas(name || "Untitled canvas", projectId);
  data.user_id = state.uid;
  try {
    const { data: res, error } = await supabase.from('canvases').insert([data]).select().single();
    if (error) throw error;
    canvasCache.set(res.id, res);
    loadCanvasData(res.id);
    switchView("canvas");
  } catch (e) { notifyErr(e.message); }
}
async function renameCanvasFlow() {
  if (!C.loaded) return;
  const name = await promptDialog("Rename canvas", C.name);
  if (!name) return;
  C.name = name;
  saveCanvas();
  performCanvasSave();
  updateCanvasSelect();
  renderNotesList();
}
async function deleteCanvasFlow() {
  if (!C.loaded) return;
  await deleteCanvasById(C.id);
}
async function deleteCanvasById(id) {
  const data = canvasCache.get(id);
  if (!data) return;
  const ok = await confirmDialog(`Delete canvas “${nameOfCanvas(data)}”?`, "The cards on it are removed. Your notes are not deleted.", "Delete canvas");
  if (!ok) return;
  C.busy = true;
  clearTimeout(cvSaveTimer); cvSaveTimer = null;
  if (C.id === id) C.loaded = false;
  try { await supabase.from('canvases').delete().eq('id', id); }
  catch (e) { notifyErr(e.message); C.loaded = true; C.busy = false; return; }
  canvasCache.delete(id);
  try { localStorage.removeItem("cv-view-" + id); } catch (_) {}
  const next = sortedCanvasIds()[0];
  if (next && (C.id === id || !C.loaded)) loadCanvasData(next);
  else if (!next) {
    const blank = blankCanvas("Untitled canvas");
    blank.user_id = state.uid;
    try {
      const { data: res, error } = await supabase.from('canvases').insert([blank]).select().single();
      if (error) throw error;
      canvasCache.set(res.id, res);
      loadCanvasData(res.id);
    } catch (e) { notifyErr(e.message); }
  }
  C.busy = false;
  syncGraph();
  renderNotesList();
}
function switchToCanvas(id) {
  if (!id || id === C.id) return;
  endEdit(true);
  flushCanvasSave();
  loadCanvasData(id);
  const sel = $("canvas-select");
  if (sel) sel.value = id;
}
function openCanvasInView(id) {
  if (!canvasCache.has(id)) return;
  if (C.id !== id || !C.loaded) loadCanvasData(id);
  switchView("canvas");
  if (state.autoReveal) revealActive();
  closeSidebar();
}

async function toggleCanvasPin(id) {
  const d = canvasCache.get(id);
  if (!d) return;
  try { await supabase.from('canvases').update({ pinned: !d.pinned }).eq('id', id); }
  catch (e) { notifyErr(e.message); }
}
async function moveCanvasToProject(canvasId, projectId) {
  try { await supabase.from('canvases').update({ project_id: projectId || null, updated_at: new Date().toISOString() }).eq('id', canvasId); }
  catch (e) { notifyErr(e.message); }
}

$("canvas-select").addEventListener("change", (e) => switchToCanvas(e.target.value));
$("canvas-new").addEventListener("click", newCanvasFlow);
$("canvas-rename").addEventListener("click", renameCanvasFlow);
$("canvas-delete").addEventListener("click", deleteCanvasFlow);

$("canvas-import").addEventListener("click", async () => {
  if (ro()) return;
  const options = sortedCanvasIds().filter((id) => id !== C.id);
  if (!options.length) { toast("No other canvases to import.", { type: "err", ms: 1800 }); return; }
  const pickedId = await openModal((box, close) => {
    box.append(el("h3", "", "Import a canvas"));
    const list = el("div", "qs-list");
    options.forEach((id) => {
      const row = el("div", "qs-row", "🗂 " + nameOfCanvas(canvasCache.get(id)));
      row.onclick = () => close(id);
      list.append(row);
    });
    const row = el("div", "modal-actions");
    const cancel = el("button", "btn btn-sm", "Cancel");
    cancel.onclick = () => close(null);
    row.append(cancel);
    box.append(list, row);
  });
  if (!pickedId) return;
  pushHistory();
  const p = viewCenter();
  const c = newCardObj({ type: "canvas", canvasId: pickedId, x: snapG(p.x - 140), y: snapG(p.y - 70), w: 280, h: 140 });
  C.cards.set(c.id, c);
  touch();
  selectCards([c.id]);
  c.el.style.zIndex = ++C.z;
});

const snapshotCanvas = () => JSON.stringify({ cards: [...C.cards.values()].map(serCard), edges: C.edges.map(serEdge) });
function pushHistory() {
  C.undo.push(snapshotCanvas());
  if (C.undo.length > 60) C.undo.shift();
  C.redo = [];
}
function restoreSnapshot(s) {
  const d = JSON.parse(s);
  clearCanvasDom();
  d.cards.forEach((c) => { const n = normCard(c); C.cards.set(n.id, n); });
  C.edges = d.edges.map(normEdge);
  C.selected.clear(); C.selEdge = null;
  touch();
  applySelection();
}
function undo() { if (!C.undo.length) return; C.redo.push(snapshotCanvas()); restoreSnapshot(C.undo.pop()); }
function redo() { if (!C.redo.length) return; C.undo.push(snapshotCanvas()); restoreSnapshot(C.redo.pop()); }
$("tool-undo").addEventListener("click", () => !ro() && undo());
$("tool-redo").addEventListener("click", () => !ro() && redo());

function zoomLerpTo(target) {
  C.viewTarget = target;
  if (!C.zoomAnim) C.zoomAnim = requestAnimationFrame(zoomAnimFrame);
}
function zoomAnimFrame() {
  C.zoomAnim = 0;
  if (!C.viewTarget) return;
  const v = C.view, t = C.viewTarget;
  const dx = t.x - v.x, dy = t.y - v.y, ds = t.s - v.s;
  if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3 && Math.abs(ds) < 0.001) {
    C.view.x = t.x; C.view.y = t.y; C.view.s = t.s;
    C.viewTarget = null;
    applyCanvasView();
    return;
  }
  v.x += dx * 0.18;
  v.y += dy * 0.18;
  v.s += ds * 0.18;
  applyCanvasView();
  C.zoomAnim = requestAnimationFrame(zoomAnimFrame);
}
function applyCanvasView() {
  const v = C.view;
  canvasWorld.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.s})`;
  let size = GRID * v.s;
  while (size < 14) size *= 2;
  canvasArea.style.backgroundSize = `${size}px ${size}px`;
  canvasArea.style.backgroundPosition = `${v.x}px ${v.y}px`;
  positionToolbar();
  clearTimeout(C.viewT);
  C.viewT = setTimeout(() => C.id && lsSet("cv-view-" + C.id, { x: v.x, y: v.y, s: v.s }), 400);
}
function canvasToWorld(e) {
  const r = canvasArea.getBoundingClientRect();
  return { x: (e.clientX - r.left - C.view.x) / C.view.s, y: (e.clientY - r.top - C.view.y) / C.view.s };
}
function viewCenter() {
  const r = canvasArea.getBoundingClientRect();
  return { x: (r.width / 2 - C.view.x) / C.view.s, y: (r.height / 2 - C.view.y) / C.view.s };
}
function zoomBy(f) {
  const r = canvasArea.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2;
  const base = C.viewTarget || C.view;
  const ns = Math.max(0.2, Math.min(3, base.s * f));
  const nx = mx - (mx - base.x) * (ns / base.s);
  const ny = my - (my - base.y) * (ns / base.s);
  zoomLerpTo({ x: nx, y: ny, s: ns });
}
function fitView(list) {
  const cs = Array.isArray(list) ? list : [...C.cards.values()];
  if (!cs.length) {
    zoomLerpTo({ x: canvasArea.clientWidth / 2, y: canvasArea.clientHeight / 2, s: 1 });
    return;
  }
  const r = canvasArea.getBoundingClientRect();
  if (!r.width) return;
  const x1 = Math.min(...cs.map((c) => c.x)), y1 = Math.min(...cs.map((c) => c.y));
  const x2 = Math.max(...cs.map((c) => c.x + c.w)), y2 = Math.max(...cs.map((c) => c.y + c.h));
  const s = Math.max(0.2, Math.min(1.5, (r.width - 120) / Math.max(1, x2 - x1), (r.height - 120) / Math.max(1, y2 - y1)));
  zoomLerpTo({ s, x: r.width / 2 - ((x1 + x2) / 2) * s, y: r.height / 2 - ((y1 + y2) / 2) * s });
}
function onCanvasShown() {
  applyOpts();
  applyCanvasView();
  if (C.needFit && C.loaded) { fitView(); C.needFit = false; }
  wakeCanvas();
}
$("tool-zoom-in").addEventListener("click", () => zoomBy(1.2));
$("tool-zoom-out").addEventListener("click", () => zoomBy(1 / 1.2));
$("tool-fit").addEventListener("click", () => fitView());
$("canvas-reset-view").addEventListener("click", () => fitView());

function zoomToSelection() {
  const cs = [...C.selected].map((id) => C.cards.get(id)).filter(Boolean);
  if (!cs.length) { fitView(); return; }
  fitView(cs);
}

// Obsidian-style wheel: mouse wheel zooms, trackpad two-finger scroll pans,
// pinch (ctrlKey wheel) zooms.
canvasArea.addEventListener("wheel", (e) => {
  if (e.target.closest(".canvas-ui") || e.target.closest(".cc-edit")) return;
  const noteBody = !e.ctrlKey && e.target.closest(".canvas-card.is-note.selected:not(.editing) .cc-body");
  if (noteBody && noteBody.scrollHeight > noteBody.clientHeight + 1) return; // let a selected note card scroll
  e.preventDefault();
  const r = canvasArea.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const base = C.viewTarget || C.view;
  const isPinch = e.ctrlKey;
  const looksLikeTrackpad = e.deltaMode === 0 && !isPinch &&
    (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 50);
  if (looksLikeTrackpad) {
    C.viewTarget = null;
    C.view.x -= e.deltaX;
    C.view.y -= e.deltaY;
    applyCanvasView();
    return;
  }
  // Ctrl+wheel (and pinch): proportional steps, eased toward the target
  const step = Math.max(-40, Math.min(40, e.deltaY));
  const factor = isPinch ? Math.exp(-step * 0.005) : (e.deltaY < 0 ? 1.1 : 0.9);
  const ns = Math.max(0.2, Math.min(3, base.s * factor));
  const nx = mx - (mx - base.x) * (ns / base.s);
  const ny = my - (my - base.y) * (ns / base.s);
  zoomLerpTo({ x: nx, y: ny, s: ns });
}, { passive: false });

function applyOpts() {
  canvasArea.classList.toggle("readonly", ro());
  [["opt-grid", "grid"], ["opt-objects", "objects"], ["opt-physics", "physics"], ["opt-readonly", "readonly"]]
    .forEach(([id, k]) => { $(id).checked = !!C.opt[k]; });
  ["tool-card", "tool-note", "tool-group", "tool-undo", "tool-redo"].forEach((id) => { $(id).disabled = ro(); });
  $("tool-card").draggable = !ro();
  if (ro()) endEdit(true);
  buildToolbar();
  wakeCanvas();
}
[["opt-grid", "grid"], ["opt-objects", "objects"], ["opt-physics", "physics"], ["opt-readonly", "readonly"]].forEach(([id, k]) => {
  $(id).addEventListener("change", (e) => {
    C.opt[k] = e.target.checked;
    lsSet("cv-opt", C.opt);
    applyOpts();
  });
});

const canvasOptsToggle = $("canvas-opts-toggle");
const canvasOptsPanel = $("canvas-opts-panel");
if (canvasOptsToggle && canvasOptsPanel) {
  canvasOptsToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    canvasOptsPanel.hidden = !canvasOptsPanel.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!canvasOptsPanel.hidden && !canvasOptsPanel.contains(e.target) && e.target !== canvasOptsToggle) {
      canvasOptsPanel.hidden = true;
    }
  });
}

function createCardEl(c) {
  const e = el("div", "canvas-card");
  e.dataset.id = c.id;
  e.innerHTML =
    '<div class="cc-head"></div><div class="cc-body"><div class="cc-md"></div></div>' +
    '<div class="cc-handle" data-side="top"></div><div class="cc-handle" data-side="right"></div>' +
    '<div class="cc-handle" data-side="bottom"></div><div class="cc-handle" data-side="left"></div>' +
    ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => `<div class="cc-rs" data-dir="${d}"></div>`).join("");
  c.el = e;
  c._src = null;
  canvasWorld.append(e);
}

function fillCard(c) {
  const e = c.el;
  e.classList.toggle("is-text", c.type === "text");
  e.classList.toggle("is-embed", c.type === "canvas");
  e.classList.toggle("is-group", c.type === "group");
  e.classList.toggle("is-note", c.type === "note");
  if (c.type === "group") e.style.zIndex = -1;
  let src, head = "", body;
  if (c.type === "note") {
    const n = state.noteMap.get(c.noteId);
    if (n) { head = n.title || "Untitled"; src = head + "\u0000" + (n.content || ""); }
    else { head = state.notesLoaded ? "Deleted note" : "…"; src = "missing:" + state.notesLoaded; }
    if (c._src === src) return;
    body = n ? renderMarkdown(trunc(n.content || "", 20000)) || '<p class="muted">Empty note</p>' : '<p class="muted">This note no longer exists.</p>';
  } else if (c.type === "canvas") {
    const d = canvasCache.get(c.canvasId);
    head = d ? "🗂 " + nameOfCanvas(d) : "🗂 Missing canvas";
    src = head + "#" + (d ? (d.cards || []).length : 0);
    if (c._src === src) return;
    const count = d ? (d.cards || []).length : 0;
    body = d
      ? `<p class="muted">${count} card${count === 1 ? "" : "s"} · double-click to open</p>`
      : '<p class="muted">This canvas was deleted.</p>';
  } else if (c.type === "group") {
    head = c.text || "Group";
    src = "group:" + head;
    if (c._src === src) return;
    body = "";
  } else {
    src = c.text;
    if (c._src === src) return;
    body = c.text.trim() ? renderMarkdown(c.text) : '<p class="muted">Double-click to edit</p>';
  }
  c._src = src;
  e.querySelector(".cc-head").textContent = head;
  e.querySelector(".cc-md").innerHTML = body;
}

function cardBase(c) {
  const ex = colorHex(c.color);
  if (ex) return ex;
  return c.type === "note" ? projectColor(state.noteMap.get(c.noteId)) : null;
}
function refreshCanvasColors() {
  C.cards.forEach((c) => {
    const deg = canvasDegree(c.id);
    let col = cardBase(c);
    if (!col) {
      const nb = canvasNeighbors(c.id).map((id) => { const o = C.cards.get(id); return o && cardBase(o); }).filter(Boolean);
      col = nb.length ? mixColors(nb) : deg > 0 ? DEFAULT_COLOR : NEUTRAL_COLOR;
    }
    c.col = col;
    if (!c.el) return;
    c.el.style.borderColor = col;
    c.el.style.background = `linear-gradient(135deg, ${rgba(col, 0.2)}, ${rgba(col, 0.05)}), #181b21`;
    c.el.style.boxShadow = `0 0 ${6 + Math.min(deg, 6) * 3}px ${rgba(col, 0.22)}`;
    if (c.type === "group") {
      c.el.style.background = rgba(col, 0.06);
      c.el.style.boxShadow = "none";
    }
    c.el.style.fontSize = (14 * (C.opt.physics ? 1 + Math.min(deg, 6) * 0.05 : 1)) + "px";
  });
}

function renderCanvas() {
  if (!C.loaded) return;
  C.cards.forEach((c) => { if (!c.el) createCardEl(c); fillCard(c); });
  syncEdgeEls();
  refreshCanvasColors();
  wakeCanvas();
}

function syncEdgeEls() {
  const ids = new Set(C.edges.map((e) => e.id));
  C.edges.forEach((e) => {
    if (C.edgeEls.has(e.id)) return;
    const gid = "grad-" + e.id;
    const grad = svgEl("linearGradient", { id: gid, gradientUnits: "userSpaceOnUse" });
    const s1 = svgEl("stop", { offset: "0" }), s2 = svgEl("stop", { offset: "1" });
    grad.append(s1, s2);
    defs.append(grad);
    const path = svgEl("path", { class: "cedge", fill: "none", "stroke-linecap": "round" });
    const hit = svgEl("path", { class: "cedge-hit", fill: "none", stroke: "transparent", "stroke-width": 14 });
    hit.dataset.id = e.id;
    const arrow = svgEl("path", { class: "cedge-arrow" });
    const arrow2 = svgEl("path", { class: "cedge-arrow" });
    const lblBg = svgEl("rect", { class: "cedge-lbl-bg", rx: 4 });
    const lbl = svgEl("text", { class: "cedge-lbl", "text-anchor": "middle", "dominant-baseline": "middle" });
    lbl.dataset.id = e.id;
    lblBg.dataset.id = e.id;
    canvasSvg.append(path, arrow, arrow2, hit, lblBg, lbl);
    C.edgeEls.set(e.id, { path, hit, arrow, arrow2, grad, s1, s2, gid, lbl, lblBg });
  });
  C.edgeEls.forEach((o, id) => {
    if (!ids.has(id)) { o.path.remove(); o.hit.remove(); o.arrow.remove(); o.arrow2.remove(); o.grad.remove(); o.lbl.remove(); o.lblBg.remove(); C.edgeEls.delete(id); }
  });
}

function sidePoint(c, side) {
  if (side === "top") return { x: c.x + c.w / 2, y: c.y };
  if (side === "bottom") return { x: c.x + c.w / 2, y: c.y + c.h };
  if (side === "left") return { x: c.x, y: c.y + c.h / 2 };
  return { x: c.x + c.w, y: c.y + c.h / 2 };
}
function autoSides(A, B) {
  const dx = B.x + B.w / 2 - (A.x + A.w / 2), dy = B.y + B.h / 2 - (A.y + A.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}
function edgePath(p1, s1, p2, s2, style) {
  if (style === "straight") return `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
  const off = Math.max(30, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.4);
  const n1 = SIDE_N[s1], n2 = SIDE_N[s2];
  return `M${p1.x},${p1.y} C${p1.x + n1[0] * off},${p1.y + n1[1] * off} ${p2.x + n2[0] * off},${p2.y + n2[1] * off} ${p2.x},${p2.y}`;
}
function arrowPath(p, s) {
  const n = SIDE_N[s], px = -n[1], py = n[0];
  const bx = p.x + n[0] * 12, by = p.y + n[1] * 12;
  return `M${p.x},${p.y} L${bx + px * 6},${by + py * 6} L${bx - px * 6},${by - py * 6} Z`;
}
function updateCanvasEdges() {
  C.edges.forEach((e) => {
    const A = C.cards.get(e.from), B = C.cards.get(e.to), o = C.edgeEls.get(e.id);
    if (!A || !B || !o) return;
    const [s1, s2] = e.fromSide && e.toSide ? [e.fromSide, e.toSide] : autoSides(A, B);
    const p1 = sidePoint(A, s1), p2 = sidePoint(B, s2);
    const d = edgePath(p1, s1, p2, s2, e.style);
    o.path.setAttribute("d", d);
    o.hit.setAttribute("d", d);
    o.grad.setAttribute("x1", p1.x); o.grad.setAttribute("y1", p1.y);
    o.grad.setAttribute("x2", p2.x + 0.01); o.grad.setAttribute("y2", p2.y + 0.01);
    o.s1.setAttribute("stop-color", A.col);
    o.s2.setAttribute("stop-color", B.col);
    const ec = colorHex(e.color);
    o.path.setAttribute("stroke", ec || `url(#${o.gid})`);
    const sel = C.selEdge === e.id;
    o.path.setAttribute("stroke-width", sel ? 4 : 2.5);
    o.path.style.opacity = sel ? 1 : 0.85;
    const showHead2 = e.dir === "uni" || e.dir === "bi";
    const showHead1 = e.dir === "bi";
    o.arrow.style.display = showHead2 ? "" : "none";
    o.arrow2.style.display = showHead1 ? "" : "none";
    if (showHead2) { o.arrow.setAttribute("d", arrowPath(p2, s2)); o.arrow.setAttribute("fill", ec || B.col); }
    if (showHead1) { o.arrow2.setAttribute("d", arrowPath(p1, s1)); o.arrow2.setAttribute("fill", ec || A.col); }
    e._mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    e._p1 = p1; e._p2 = p2; e._s1 = s1; e._s2 = s2;
    if (e.label) {
      o.lbl.textContent = e.label;
      o.lbl.setAttribute("x", e._mid.x); o.lbl.setAttribute("y", e._mid.y);
      o.lbl.style.display = "";
      try {
        const bb = o.lbl.getBBox();
        o.lblBg.setAttribute("x", bb.x - 6); o.lblBg.setAttribute("y", bb.y - 2);
        o.lblBg.setAttribute("width", bb.width + 12); o.lblBg.setAttribute("height", bb.height + 4);
        o.lblBg.style.display = "";
      } catch (_) { o.lblBg.style.display = "none"; }
    } else { o.lbl.style.display = "none"; o.lblBg.style.display = "none"; }
  });
  drawEdgeEnds();
}

// Reconnect handles at both ends of the selected edge
let endHandles = [];
function drawEdgeEnds() {
  endHandles.forEach((h) => h.remove());
  endHandles = [];
  if (!C.selEdge || ro()) return;
  const e = C.edges.find((x) => x.id === C.selEdge);
  if (!e || !e._p1) return;
  [["from", e._p1], ["to", e._p2]].forEach(([end, p]) => {
    const h = svgEl("circle", { class: "cedge-end", cx: p.x, cy: p.y, r: 7 });
    h.dataset.end = end;
    h.dataset.id = e.id;
    canvasSvg.append(h);
    endHandles.push(h);
  });
}

function updateCanvasDom() {
  C.cards.forEach((c) => {
    if (!c.el) return;
    c.el.style.transform = `translate(${c.x}px,${c.y}px)`;
    c.el.style.width = c.w + "px";
    c.el.style.height = c.h + "px";
  });
  updateCanvasEdges();
  positionToolbar();
}

function wakeCanvas() { if (!C.raf) C.raf = requestAnimationFrame(canvasFrame); }
function canvasFrame() {
  C.raf = 0;
  let active = false;
  if (C.opt.physics && !ro()) active = physicsStep(C.mode && C.mode.type === "card" ? C.mode.idset : new Set());
  updateCanvasDom();
  if (active) wakeCanvas();
  else if (C.moved && !C.mode) { C.moved = false; saveCanvas(); }
}
function physicsStep(pinned) {
  const cards = [...C.cards.values()];
  let active = false;
  const pad = 24;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      if (a.type === "group" || b.type === "group") continue; // groups are containers, not obstacles
      const dxc = a.x + a.w / 2 - (b.x + b.w / 2), dyc = a.y + a.h / 2 - (b.y + b.h / 2);
      const ox = (a.w + b.w) / 2 + pad - Math.abs(dxc), oy = (a.h + b.h) / 2 + pad - Math.abs(dyc);
      if (ox <= 0 || oy <= 0) continue;
      const ap = pinned.has(a.id), bp = pinned.has(b.id);
      let fx = 0, fy = 0;
      if (ox < oy) fx = (dxc < 0 ? -1 : 1) * ox * 0.1; else fy = (dyc < 0 ? -1 : 1) * oy * 0.1;
      if (!ap) { a.vx += fx * (bp ? 2 : 1); a.vy += fy * (bp ? 2 : 1); }
      if (!bp) { b.vx -= fx * (ap ? 2 : 1); b.vy -= fy * (ap ? 2 : 1); }
    }
  }
  C.edges.forEach((e) => {
    if (!e.pulse || e.pulse < 0.02) { e.pulse = 0; return; }
    const a = C.cards.get(e.from), b = C.cards.get(e.to);
    if (!a || !b || a.type === "group" || b.type === "group") return;
    const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
    const d = Math.hypot(dx, dy) || 1;
    const ideal = (a.w + b.w) / 2 + 140;
    if (d > ideal) {
      const f = (d - ideal) * 0.012 * e.pulse;
      if (!pinned.has(a.id)) { a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
      if (!pinned.has(b.id)) { b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
    }
    e.pulse *= 0.96;
    active = true;
  });
  cards.forEach((c) => {
    if (pinned.has(c.id)) { c.vx = c.vy = 0; return; }
    c.vx *= 0.75; c.vy *= 0.75;
    if (Math.abs(c.vx) > 0.04 || Math.abs(c.vy) > 0.04) { c.x += c.vx; c.y += c.vy; active = true; C.moved = true; }
    else c.vx = c.vy = 0;
  });
  return active;
}

function drawGuides(list) {
  guideSvg.innerHTML = "";
  list.forEach((g) => {
    const l = svgEl("line", { class: "guide", "vector-effect": "non-scaling-stroke" });
    if (g.v) { l.setAttribute("x1", g.at); l.setAttribute("x2", g.at); l.setAttribute("y1", g.a - 12); l.setAttribute("y2", g.b + 12); }
    else { l.setAttribute("y1", g.at); l.setAttribute("y2", g.at); l.setAttribute("x1", g.a - 12); l.setAttribute("x2", g.b + 12); }
    guideSvg.append(l);
  });
}
function selBBox(ids) {
  const cs = ids.map((id) => C.cards.get(id)).filter(Boolean);
  if (!cs.length) return null;
  const x1 = Math.min(...cs.map((c) => c.x)), y1 = Math.min(...cs.map((c) => c.y));
  const x2 = Math.max(...cs.map((c) => c.x + c.w)), y2 = Math.max(...cs.map((c) => c.y + c.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function snapMove(m, rawDx, rawDy, alt) {
  let nx = m.bbox.x + rawDx, ny = m.bbox.y + rawDy;
  const bw = m.bbox.w, bh = m.bbox.h;
  const guides = [];
  if (!alt) {
    const thr = 8 / C.view.s;
    let sx = null, sy = null;
    if (C.opt.objects) {
      const xs = [nx, nx + bw / 2, nx + bw], ys = [ny, ny + bh / 2, ny + bh];
      C.cards.forEach((o) => {
        if (m.idset.has(o.id)) return;
        const oxs = [o.x, o.x + o.w / 2, o.x + o.w], oys = [o.y, o.y + o.h / 2, o.y + o.h];
        xs.forEach((a) => oxs.forEach((b) => { const d = b - a; if (Math.abs(d) <= thr && (!sx || Math.abs(d) < Math.abs(sx.d))) sx = { d, at: b, o }; }));
        ys.forEach((a) => oys.forEach((b) => { const d = b - a; if (Math.abs(d) <= thr && (!sy || Math.abs(d) < Math.abs(sy.d))) sy = { d, at: b, o }; }));
      });
    }
    if (sx) nx += sx.d; else if (C.opt.grid) nx = Math.round(nx / GRID) * GRID;
    if (sy) ny += sy.d; else if (C.opt.grid) ny = Math.round(ny / GRID) * GRID;
    if (sx) guides.push({ v: true, at: sx.at, a: Math.min(ny, sx.o.y), b: Math.max(ny + bh, sx.o.y + sx.o.h) });
    if (sy) guides.push({ v: false, at: sy.at, a: Math.min(nx, sy.o.x), b: Math.max(nx + bw, sy.o.x + sy.o.w) });
  }
  drawGuides(guides);
  return { dx: nx - m.bbox.x, dy: ny - m.bbox.y };
}
function snapResize(c, m, p, alt) {
  // Resize from any edge/corner; the opposite edge stays fixed (Obsidian).
  const dir = m.dir || "se";
  let L = m.x, T = m.y, R = m.x + m.w, B = m.y + m.h;
  const dx = p.x - m.sx, dy = p.y - m.sy;
  if (dir.includes("e")) R += dx;
  if (dir.includes("w")) L += dx;
  if (dir.includes("s")) B += dy;
  if (dir.includes("n")) T += dy;
  const guides = [];
  if (!alt) {
    const thr = 8 / C.view.s;
    let sx = null, sy = null;
    const movX = dir.includes("e") ? R : dir.includes("w") ? L : null;
    const movY = dir.includes("s") ? B : dir.includes("n") ? T : null;
    if (C.opt.objects) {
      C.cards.forEach((o) => {
        if (o.id === c.id) return;
        if (movX != null) [o.x, o.x + o.w / 2, o.x + o.w].forEach((b) => { const d = b - movX; if (Math.abs(d) <= thr && (!sx || Math.abs(d) < Math.abs(sx.d))) sx = { d, at: b, o }; });
        if (movY != null) [o.y, o.y + o.h / 2, o.y + o.h].forEach((b) => { const d = b - movY; if (Math.abs(d) <= thr && (!sy || Math.abs(d) < Math.abs(sy.d))) sy = { d, at: b, o }; });
      });
    }
    const gr = (v) => Math.round(v / GRID) * GRID;
    if (movX != null) {
      const target = sx ? movX + sx.d : C.opt.grid ? gr(movX) : movX;
      if (dir.includes("e")) R = target; else L = target;
    }
    if (movY != null) {
      const target = sy ? movY + sy.d : C.opt.grid ? gr(movY) : movY;
      if (dir.includes("s")) B = target; else T = target;
    }
    if (sx) guides.push({ v: true, at: sx.at, a: Math.min(T, sx.o.y), b: Math.max(B, sx.o.y + sx.o.h) });
    if (sy) guides.push({ v: false, at: sy.at, a: Math.min(L, sy.o.x), b: Math.max(R, sy.o.x + sy.o.w) });
  }
  drawGuides(guides);
  const MINW = 40, MINH = 30;
  if (R - L < MINW) { if (dir.includes("w")) L = R - MINW; else R = L + MINW; }
  if (B - T < MINH) { if (dir.includes("n")) T = B - MINH; else B = T + MINH; }
  return { x: L, y: T, w: R - L, h: B - T };
}
const snapG = (v) => (C.opt.grid ? Math.round(v / GRID) * GRID : v);

function selectCards(ids, additive) {
  if (!additive) C.selected.clear();
  ids.forEach((id) => C.selected.add(id));
  C.selEdge = null;
  applySelection();
}
function applySelection() {
  C.cards.forEach((c) => c.el && c.el.classList.toggle("selected", C.selected.has(c.id)));
  updateCanvasEdges();
  buildToolbar();
}
function currentColorValue() {
  if (C.selEdge) { const e = C.edges.find((x) => x.id === C.selEdge); return e ? e.color || "" : ""; }
  const vals = [...C.selected].map((id) => (C.cards.get(id) || {}).color || "");
  return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
}
function markToolbar() {
  const cur = currentColorValue();
  toolbarEl.querySelectorAll("[data-color]").forEach((b) => {
    b.classList.toggle("on", cur !== null && b.dataset.color === cur);
  });
  if (C.selEdge) {
    const e = C.edges.find((x) => x.id === C.selEdge);
    const d = e ? (e.dir || "none") : "none";
    toolbarEl.querySelectorAll("[data-dir]").forEach((b) => {
      b.classList.toggle("on", b.dataset.dir === d);
    });
    toolbarEl.querySelectorAll("[data-style]").forEach((b) => {
      b.classList.toggle("on", b.dataset.style === (e ? e.style : "curve"));
    });
  }
}

function buildToolbar() {
  toolbarEl.innerHTML = "";
  if (ro() || (!C.selected.size && !C.selEdge)) { toolbarEl.hidden = true; return; }
  toolbarEl.hidden = false;

  if (C.selEdge) {
    const seg = el("div", "tb-seg");
    seg.title = "Line type";
    const types = [
      ["none", "—", "Nondirectional (plain line)"],
      ["uni", "→", "Unidirectional (arrow at end)"],
      ["bi", "↔", "Bidirectional (arrows both ends)"]
    ];
    types.forEach(([d, glyph, tip]) => {
      const b = el("button", "", glyph);
      b.type = "button";
      b.dataset.dir = d;
      b.title = tip;
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const edge = C.edges.find((x) => x.id === C.selEdge);
        if (!edge) return;
        pushHistory();
        edge.dir = d;
        updateCanvasEdges();
        markToolbar();
        saveCanvas();
        syncGraph();
      });
      seg.append(b);
    });
    toolbarEl.append(seg, el("span", "tb-sep"));
    const sty = el("div", "tb-seg");
    sty.title = "Line shape";
    [["curve", "⌒", "Curved line"], ["straight", "╱", "Straight line"]].forEach(([v, glyph, tip]) => {
      const b = el("button", "", glyph);
      b.type = "button"; b.dataset.style = v; b.title = tip;
      b.addEventListener("click", (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const edge = C.edges.find((x) => x.id === C.selEdge);
        if (!edge) return;
        pushHistory();
        edge.style = v;
        updateCanvasEdges(); markToolbar(); saveCanvas();
      });
      sty.append(b);
    });
    const lb = el("button", "tb-btn", "Aa");
    lb.type = "button"; lb.title = "Edit label (double-click line)";
    lb.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); editEdgeLabel(C.selEdge); });
    toolbarEl.append(sty, lb, el("span", "tb-sep"));
  }

  CARD_COLORS.forEach((p) => {
    const b = el("button", "tb-swatch");
    b.type = "button";
    b.dataset.color = p.id;
    b.title = p.name;
    b.style.background = p.hex;
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setColor(p.id);
    });
    toolbarEl.append(b);
  });

  const none = el("button", "tb-swatch none", "⦸");
  none.type = "button";
  none.dataset.color = "";
  none.title = "Default color";
  none.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setColor("");
  });

  const custom = el("input", "tb-custom");
  custom.type = "color";
  custom.title = "Custom color";
  const cur = colorHex(currentColorValue());
  custom.value = cur && cur.length === 7 ? cur : "#a8f23d";
  custom.addEventListener("input", (ev) => {
    ev.stopPropagation();
    setColor(ev.target.value, true);
  });
  custom.addEventListener("change", (ev) => {
    ev.stopPropagation();
    setColor(ev.target.value);
  });

  toolbarEl.append(none, custom, el("span", "tb-sep"));

  const add = (label, act, title, cls = "") => {
    const b = el("button", "tb-btn " + cls, label);
    b.type = "button";
    b.dataset.act = act;
    b.title = title;
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (act === "delete") deleteSelection();
      else if (act === "dup") duplicateSelection();
      else if (act === "edit") {
        const c = C.cards.get([...C.selected][0]);
        if (!c) return;
        if (c.type === "note") { const n = state.noteMap.get(c.noteId); if (n) openNote(n); }
        else startEdit(c);
      }
    });
    toolbarEl.append(b);
  };
  if (C.selected.size === 1 && !C.selEdge) {
    const c = C.cards.get([...C.selected][0]);
    add(c && c.type === "note" ? "↗ Open" : "✎ Edit", "edit", c && c.type === "note" ? "Open note" : "Edit text (Enter)");
  }
  if (!C.selEdge) add("⧉", "dup", "Duplicate (Ctrl+D)");
  add("🗑", "delete", "Delete (Del)", "danger");
  markToolbar();
  positionToolbar();
}

function positionToolbar() {
  if (toolbarEl.hidden) return;
  let cx, top;
  if (C.selEdge) {
    const e = C.edges.find((x) => x.id === C.selEdge);
    if (!e || !e._mid) return;
    cx = e._mid.x; top = e._mid.y - 6;
  } else {
    const b = selBBox([...C.selected]);
    if (!b) return;
    cx = b.x + b.w / 2; top = b.y;
  }
  const r = canvasArea.getBoundingClientRect();
  let sx = C.view.x + cx * C.view.s;
  let sy = C.view.y + top * C.view.s - 54;
  sx = Math.max(150, Math.min(r.width - 150, sx));
  sy = Math.max(8, Math.min(r.height - 50, sy));
  toolbarEl.style.left = sx + "px";
  toolbarEl.style.top = sy + "px";
}

function setColor(val, live) {
  if (!live) pushHistory();
  if (C.selEdge) { const e = C.edges.find((x) => x.id === C.selEdge); if (e) e.color = val; }
  else C.selected.forEach((id) => { const c = C.cards.get(id); if (c) c.color = val; });
  refreshCanvasColors();
  updateCanvasEdges();
  markToolbar();
  saveCanvas();
}

function newCardObj(props) {
  return normCard({ id: genId(), type: "text", x: 0, y: 0, w: 260, h: 120, ...props });
}
function addTextCard(wx, wy, opts = {}) {
  if (ro() || !C.loaded) return null;
  pushHistory();
  const w = 260, h = 120;
  let x = wx - w / 2, y = wy - h / 2;
  if (opts.from) {
    const s = opts.from.side;
    if (s === "right") { x = wx; y = wy - h / 2; }
    else if (s === "left") { x = wx - w; y = wy - h / 2; }
    else if (s === "bottom") { x = wx - w / 2; y = wy; }
    else { x = wx - w / 2; y = wy - h; }
  }
  const c = newCardObj({ type: "text", text: opts.text || "", x: snapG(x), y: snapG(y), w, h });
  C.cards.set(c.id, c);
  if (opts.from && C.cards.has(opts.from.id)) {
    C.edges.push(normEdge({ id: genId(), from: opts.from.id, to: c.id, fromSide: opts.from.side, toSide: OPP[opts.from.side], color: "", dir: "uni" }));
  }
  touch();
  selectCards([c.id]);
  c.el.style.zIndex = ++C.z;
  if (opts.edit !== false && !opts.text) startEdit(c);
  return c;
}
function linkFrom(opts, c) {
  if (opts && opts.from && C.cards.has(opts.from.id))
    C.edges.push(normEdge({ id: genId(), from: opts.from.id, to: c.id, fromSide: opts.from.side, toSide: OPP[opts.from.side], color: "", dir: "uni" }));
}
function addNoteCard(noteId, wx, wy, opts) {
  if (ro() || !C.loaded || !state.noteMap.has(noteId)) return;
  pushHistory();
  const w = 260, h = 140;
  const c = newCardObj({ type: "note", noteId, x: snapG(wx - w / 2), y: snapG(wy - h / 2), w, h });
  C.cards.set(c.id, c);
  linkFrom(opts, c);
  touch();
  selectCards([c.id]);
  c.el.style.zIndex = ++C.z;
}
function addCanvasCard(canvasId, wx, wy, opts) {
  if (ro() || !C.loaded || !canvasCache.has(canvasId)) return;
  pushHistory();
  const w = 280, h = 140;
  const c = newCardObj({ type: "canvas", canvasId, x: snapG(wx - w / 2), y: snapG(wy - h / 2), w, h });
  C.cards.set(c.id, c);
  linkFrom(opts, c);
  touch();
  selectCards([c.id]);
  c.el.style.zIndex = ++C.z;
}
let canvasClip = null;
const CLIP_TOKEN = "[canvas-cards]";
function copySelection(cut) {
  const ids = new Set(C.selected);
  const cards = [...ids].map((id) => C.cards.get(id)).filter(Boolean).map(serCard);
  const edges = C.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map(serEdge);
  canvasClip = { cards, edges };
  try { navigator.clipboard && navigator.clipboard.writeText(CLIP_TOKEN); } catch (_) {}
  toast(`Copied ${cards.length} card${cards.length === 1 ? "" : "s"}`, { ms: 1200 });
  if (cut) deleteSelection();
}
function pasteCards(clip, wx, wy) {
  if (ro() || !C.loaded || !clip || !clip.cards.length) return;
  pushHistory();
  const x1 = Math.min(...clip.cards.map((c) => c.x)), y1 = Math.min(...clip.cards.map((c) => c.y));
  const x2 = Math.max(...clip.cards.map((c) => c.x + c.w)), y2 = Math.max(...clip.cards.map((c) => c.y + c.h));
  const dx = wx - (x1 + x2) / 2, dy = wy - (y1 + y2) / 2;
  const map = new Map();
  clip.cards.forEach((c) => {
    const n = normCard({ ...c, id: genId(), x: c.x + dx, y: c.y + dy });
    C.cards.set(n.id, n);
    map.set(c.id, n.id);
  });
  clip.edges.forEach((e) => {
    if (map.has(e.from) && map.has(e.to)) C.edges.push(normEdge({ ...e, id: genId(), from: map.get(e.from), to: map.get(e.to) }));
  });
  C.selected = new Set(map.values());
  C.selEdge = null;
  touch();
  applySelection();
}
let lastPtrWorld = null;
canvasArea.addEventListener("pointermove", (e) => { lastPtrWorld = canvasToWorld(e); });
document.addEventListener("paste", (e) => {
  if (state.view !== "canvas" || ro() || document.querySelector(".modal-overlay")) return;
  if (e.target.closest && e.target.closest("input,textarea,select")) return;
  const txt = (e.clipboardData && e.clipboardData.getData("text/plain") || "").trim();
  const p = lastPtrWorld || viewCenter();
  if (txt === CLIP_TOKEN && canvasClip) { e.preventDefault(); pasteCards(canvasClip, p.x, p.y); return; }
  if (!txt) return;
  e.preventDefault();
  addTextCard(p.x, p.y, { text: /^https?:\/\/\S+$/.test(txt) ? `[${txt}](${txt})` : txt, edit: false });
});

function addGroupCard(wx, wy) {
  if (ro() || !C.loaded) return null;
  pushHistory();
  let x = wx - 200, y = wy - 150, w = 400, h = 300;
  const b = C.selected.size ? selBBox([...C.selected]) : null;
  if (b) { const pad = 30; x = b.x - pad; y = b.y - pad - 20; w = b.w + pad * 2; h = b.h + pad * 2 + 20; }
  const c = newCardObj({ type: "group", text: "Group", x: snapG(x), y: snapG(y), w, h });
  C.cards.set(c.id, c);
  touch();
  selectCards([c.id]);
  return c;
}
function addEdge(from, fromSide, to, toSide) {
  if (from === to || ro()) return;
  if (C.edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return;
  pushHistory();
  C.edges.push(normEdge({ id: genId(), from, to, fromSide, toSide, color: "", dir: "uni", pulse: C.opt.physics ? 1 : 0 }));
  touch();
}
function deleteSelection() {
  if (ro()) return;
  if (C.selEdge) {
    pushHistory();
    C.edges = C.edges.filter((e) => e.id !== C.selEdge);
    C.selEdge = null;
  } else if (C.selected.size) {
    pushHistory();
    C.selected.forEach((id) => { const c = C.cards.get(id); if (c && c.el) c.el.remove(); C.cards.delete(id); });
    C.edges = C.edges.filter((e) => C.cards.has(e.from) && C.cards.has(e.to));
    C.selected.clear();
  } else return;
  touch();
  applySelection();
}
function duplicateSelection() {
  if (ro() || !C.selected.size) return;
  pushHistory();
  const map = new Map();
  C.selected.forEach((id) => {
    const c = C.cards.get(id);
    if (!c) return;
    const n = normCard({ ...serCard(c), id: genId(), x: c.x + GRID * 2, y: c.y + GRID * 2 });
    C.cards.set(n.id, n);
    map.set(id, n.id);
  });
  C.edges.filter((e) => map.has(e.from) && map.has(e.to))
    .forEach((e) => C.edges.push(normEdge({ ...serEdge(e), id: genId(), from: map.get(e.from), to: map.get(e.to) })));
  C.selected = new Set(map.values());
  C.selEdge = null;
  touch();
  applySelection();
}

async function editEdgeLabel(id) {
  const ed = C.edges.find((x) => x.id === id);
  if (!ed || ro()) return;
  const v = await promptDialog("Edge label", ed.label || "", "Label (leave empty to remove)");
  if (v === null) return;
  pushHistory();
  ed.label = v;
  updateCanvasEdges();
  saveCanvas();
}

let noteSaveTimer = null;
async function saveNoteFromCard(c, value) {
  const n = state.noteMap.get(c.noteId);
  if (!n || n.content === value) return;
  n.content = value;
  n.updated_at = new Date().toISOString();
  try {
    const { error } = await supabase.from('notes').update({ content: value, updated_at: n.updated_at }).eq('id', n.id);
    if (error) throw error;
  } catch (err) { notifyErr("Note save failed: " + err.message); }
}

function startEdit(c) {
  if (ro() || !c || C.editing) return;
  if (c.type === "group") {
    promptDialog("Group label", c.text, "Label").then((v) => {
      if (v === null) return;
      pushHistory();
      c.text = v; c._src = null; fillCard(c); saveCanvas();
    });
    return;
  }
  if (c.type !== "text" && c.type !== "note") return;
  const noteRef = c.type === "note" ? state.noteMap.get(c.noteId) : null;
  if (c.type === "note" && !noteRef) return;
  if (c.type === "text") pushHistory();
  C.editing = c.id;
  const ta = document.createElement("textarea");
  ta.className = "cc-edit";
  ta.value = c.type === "note" ? (noteRef.content || "") : c.text;
  if (c.type === "note") {
    ta.addEventListener("input", () => {
      clearTimeout(noteSaveTimer);
      noteSaveTimer = setTimeout(() => saveNoteFromCard(c, ta.value), 700);
    });
  }
  ta.placeholder = "Write markdown…";
  c.el.classList.add("editing");
  c.el.querySelector(".cc-body").append(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" || (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); endEdit(true); }
    ev.stopPropagation();
  });
  ta.addEventListener("blur", () => endEdit(true));
}
function endEdit(commit) {
  const id = C.editing;
  if (!id) return;
  C.editing = null;
  const c = C.cards.get(id);
  if (!c || !c.el) return;
  const ta = c.el.querySelector(".cc-edit");
  if (ta) {
    if (commit) {
      if (c.type === "note") { clearTimeout(noteSaveTimer); saveNoteFromCard(c, ta.value); }
      else c.text = ta.value;
    }
    ta.remove();
  }
  c.el.classList.remove("editing");
  c._src = null;
  fillCard(c);
  saveCanvas();
}

function pickNoteDialog() {
  return openModal((box, close) => {
    box.classList.add("qs");
    const input = el("input", "qs-input");
    input.placeholder = "Add a note or canvas to this canvas…";
    const list = el("div", "qs-list");
    box.append(input, list);
    let items = [], idx = 0;
    const paint = () => {
      list.innerHTML = "";
      if (!items.length) list.append(el("div", "nl-empty", "No matches."));
      items.forEach((it, i) => {
        const row = el("div", "qs-row" + (i === idx ? " on" : ""));
        const dot = el("span", "nl-dot");
        if (it.kind === "canvas") { dot.textContent = "🗂"; dot.style.background = "transparent"; }
        else dot.style.background = projectColor(it.note) || "var(--text-muted)";
        row.append(dot, el("span", "qs-title", it.label));
        row.onmousemove = () => { if (idx !== i) { idx = i; paint(); } };
        row.onclick = () => close(it);
        list.append(row);
      });
      const on = list.querySelector(".on");
      if (on) on.scrollIntoView({ block: "nearest" });
    };
    const build = () => {
      const q = input.value.trim().toLowerCase();
      const notes = state.notes.filter((n) => !n.archived && (!q || (n.title || "").toLowerCase().includes(q)))
        .sort(sorters.modified).slice(0, 40)
        .map((n) => ({ kind: "note", note: n, label: n.title || "Untitled" }));
      const canvases = [...canvasCache.values()]
        .filter((d) => d.id !== C.id && (!q || nameOfCanvas(d).toLowerCase().includes(q)))
        .slice(0, 20)
        .map((d) => ({ kind: "canvas", canvas: d, label: "🗂 " + nameOfCanvas(d) }));
      items = [...notes, ...canvases];
      idx = 0;
      paint();
    };
    input.addEventListener("input", build);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(0, idx - 1); paint(); }
      else if (e.key === "Enter") { e.preventDefault(); if (items[idx]) close(items[idx]); }
    });
    build();
    input.focus();
  });
}
$("tool-note").addEventListener("click", async () => {
  if (ro()) return;
  const it = await pickNoteDialog();
  if (!it) return;
  const p = viewCenter();
  if (it.kind === "canvas") addCanvasCard(it.canvas.id, p.x, p.y);
  else addNoteCard(it.note.id, p.x, p.y);
});
$("tool-group").addEventListener("click", () => { if (ro()) return; const p = viewCenter(); addGroupCard(p.x, p.y); });
$("tool-card").addEventListener("click", () => { if (ro()) return; const p = viewCenter(); addTextCard(p.x, p.y); });
$("tool-card").addEventListener("dragstart", (e) => {
  if (ro()) { e.preventDefault(); return; }
  e.dataTransfer.setData("text/canvas-new", "text");
  e.dataTransfer.effectAllowed = "copy";
});

canvasArea.addEventListener("dragover", (e) => {
  if (ro()) return;
  const t = [...e.dataTransfer.types];
  if (t.includes("text/note-id") || t.includes("text/canvas-id") || t.includes("text/canvas-new") || t.includes("text/plain")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    canvasArea.classList.add("drag-over");
  }
});
canvasArea.addEventListener("dragleave", (e) => { if (!canvasArea.contains(e.relatedTarget)) canvasArea.classList.remove("drag-over"); });
canvasArea.addEventListener("drop", (e) => {
  canvasArea.classList.remove("drag-over");
  if (ro()) return;
  e.preventDefault();
  const p = canvasToWorld(e);
  const cid = e.dataTransfer.getData("text/canvas-id");
  if (cid) { addCanvasCard(cid, p.x, p.y); return; }
  const nid = e.dataTransfer.getData("text/note-id");
  if (nid) { addNoteCard(nid, p.x, p.y); return; }
  if (e.dataTransfer.getData("text/canvas-new")) { addTextCard(p.x, p.y); return; }
  const txt = e.dataTransfer.getData("text/plain").trim();
  if (txt) addTextCard(p.x, p.y, { text: /^https?:\/\/\S+$/.test(txt) ? `[${txt}](${txt})` : txt, edit: false });
});

let tempPath = null;
function startPan(e) {
  C.mode = { type: "pan", sx: e.clientX, sy: e.clientY, vx: C.view.x, vy: C.view.y };
  canvasArea.classList.add("panning");
}
function clearDropTargets() {
  C.cards.forEach((c) => { if (c.el) { c.el.classList.remove("drop-target"); c.el.removeAttribute("data-drop-side"); } });
}
function markDropTarget(over, e, exceptId) {
  C.cards.forEach((c) => {
    if (!c.el) return;
    const on = !!over && c.el === over && c.id !== exceptId;
    c.el.classList.toggle("drop-target", on);
    if (on) c.el.dataset.dropSide = nearestSide(e, c.el.getBoundingClientRect());
    else c.el.removeAttribute("data-drop-side");
  });
}

// Small popup menu (used when a connection is dropped on empty canvas)
let canvasMenuEl = null;
function hideCanvasMenu() { if (canvasMenuEl) { canvasMenuEl.remove(); canvasMenuEl = null; } }
function showCanvasMenu(cx, cy, items) {
  hideCanvasMenu();
  const m = el("div", "canvas-menu canvas-ui");
  items.forEach((it) => {
    const b = el("button", "canvas-menu-item", it.label);
    b.type = "button";
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.addEventListener("click", (ev) => { ev.stopPropagation(); hideCanvasMenu(); it.run(); });
    m.append(b);
  });
  const r = canvasArea.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(r.width - 190, cx - r.left)) + "px";
  m.style.top = Math.max(4, Math.min(r.height - 40 * items.length - 8, cy - r.top)) + "px";
  canvasArea.append(m);
  canvasMenuEl = m;
  const onKey = (ev) => { if (ev.key === "Escape") { hideCanvasMenu(); document.removeEventListener("keydown", onKey, true); } };
  document.addEventListener("keydown", onKey, true);
}

function nearestSide(e, r) {
  const d = { left: e.clientX - r.left, right: r.right - e.clientX, top: e.clientY - r.top, bottom: r.bottom - e.clientY };
  return Object.keys(d).sort((a, b) => d[a] - d[b])[0];
}

canvasArea.addEventListener("pointerdown", (e) => {
  hideCanvasMenu();
  if (e.button === 1) { // middle mouse pans (Obsidian)
    if (C.editing) endEdit(true);
    startPan(e);
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;

  if (spaceHeld) {
    if (C.editing) endEdit(true);
    startPan(e);
    e.preventDefault();
    return;
  }

  if (e.target.closest(".canvas-ui") || e.target.closest(".cc-edit")) return;
  if (C.editing) endEdit(true);
  if (ro()) { startPan(e); e.preventDefault(); return; }

  const world = canvasToWorld(e);
  const hitEdge = e.target.closest(".cedge-hit");
  const handle = e.target.closest(".cc-handle");
  const resizeH = e.target.closest(".cc-rs");
  const cardEl = e.target.closest(".canvas-card");
  const card = cardEl ? C.cards.get(cardEl.dataset.id) : null;

  const endH = e.target.closest(".cedge-end");
  if (endH) {
    const ed = C.edges.find((x) => x.id === endH.dataset.id);
    if (ed) {
      C.mode = { type: "reconnect", id: ed.id, end: endH.dataset.end };
      tempPath = svgEl("path", { class: "cedge temp", fill: "none", stroke: colorHex(ed.color) || DEFAULT_COLOR });
      canvasSvg.append(tempPath);
    }
    e.preventDefault();
    return;
  }
  if (hitEdge) {
    C.selected.clear();
    C.selEdge = hitEdge.dataset.id;
    applySelection();
    e.preventDefault();
    return;
  }
  if (handle && card) {
    C.mode = { type: "connect", from: card.id, side: handle.dataset.side };
    tempPath = svgEl("path", { class: "cedge temp", fill: "none", stroke: card.col });
    canvasSvg.append(tempPath);
    e.preventDefault();
    return;
  }
  if (resizeH && card) {
    if (!C.selected.has(card.id)) selectCards([card.id]);
    C.mode = {
      type: "resize", id: card.id, dir: resizeH.dataset.dir, sx: world.x, sy: world.y,
      x: card.x, y: card.y, w: card.w, h: card.h, hist: false
    };
    e.preventDefault();
    return;
  }
  if (card) {
    if (e.shiftKey) {
      if (C.selected.has(card.id)) C.selected.delete(card.id); else C.selected.add(card.id);
      C.selEdge = null;
      applySelection();
      if (!C.selected.has(card.id)) { e.preventDefault(); return; }
    } else if (!C.selected.has(card.id)) selectCards([card.id]);
    C.selEdge = null;
    const dragSet = new Set(C.selected);
    C.selected.forEach((gid) => {
      const g = C.cards.get(gid);
      if (!g || g.type !== "group") return;
      C.cards.forEach((o) => {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        if (o.id !== g.id && cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) dragSet.add(o.id);
      });
    });
    const ids = [...dragSet];
    const starts = new Map(ids.map((id) => { const c = C.cards.get(id); return [id, { x: c.x, y: c.y }]; }));
    ids.forEach((id) => { const c = C.cards.get(id); if (c && c.el && c.type !== "group") c.el.style.zIndex = ++C.z; });
    C.mode = {
      type: "card", id: card.id, ids, idset: new Set(ids), starts, bbox: selBBox(ids),
      wx: world.x, wy: world.y, sx: e.clientX, sy: e.clientY, moved: false, shift: e.shiftKey
    };
    e.preventDefault();
    return;
  }
  // Obsidian: drag on empty space pans; Shift+drag draws a selection box
  if (e.shiftKey) {
    C.mode = { type: "marquee", x0: e.clientX, y0: e.clientY, base: new Set(C.selected) };
  } else {
    C.selected.clear(); C.selEdge = null; applySelection();
    startPan(e);
  }
  e.preventDefault();
});

window.addEventListener("pointermove", (e) => {
  const m = C.mode;
  if (!m) return;
  if (m.type === "pan") {
    C.view.x = m.vx + (e.clientX - m.sx);
    C.view.y = m.vy + (e.clientY - m.sy);
    C.viewTarget = null;
    applyCanvasView();
  } else if (m.type === "card") {
    if (!m.moved) {
      if (Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 3) return;
      m.moved = true;
      pushHistory();
    }
    const w = canvasToWorld(e);
    const { dx, dy } = snapMove(m, w.x - m.wx, w.y - m.wy, e.altKey);
    m.ids.forEach((id) => { const c = C.cards.get(id); const s = m.starts.get(id); if (c && s) { c.x = s.x + dx; c.y = s.y + dy; } });
    C.moved = true;
    wakeCanvas();
  } else if (m.type === "resize") {
    const c = C.cards.get(m.id);
    if (!c) return;
    if (!m.hist) { m.hist = true; pushHistory(); }
    const r = snapResize(c, m, canvasToWorld(e), e.altKey);
    c.x = r.x; c.y = r.y; c.w = r.w; c.h = r.h; c.manual = true;
    C.moved = true;
    wakeCanvas();
  } else if (m.type === "connect") {
    const A = C.cards.get(m.from);
    if (!A || !tempPath) return;
    const p = canvasToWorld(e);
    const p1 = sidePoint(A, m.side), n = SIDE_N[m.side];
    const off = Math.max(30, Math.hypot(p.x - p1.x, p.y - p1.y) * 0.4);
    tempPath.setAttribute("d", `M${p1.x},${p1.y} C${p1.x + n[0] * off},${p1.y + n[1] * off} ${p.x},${p.y} ${p.x},${p.y}`);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".canvas-card");
    markDropTarget(over, e, m.from);
  } else if (m.type === "reconnect") {
    const ed = C.edges.find((x) => x.id === m.id);
    if (!ed || !tempPath) return;
    const fixedId = m.end === "from" ? ed.to : ed.from;
    const F = C.cards.get(fixedId);
    if (!F) return;
    const fs = m.end === "from" ? (ed._s2 || "left") : (ed._s1 || "right");
    const p1 = sidePoint(F, fs), n = SIDE_N[fs], p = canvasToWorld(e);
    const off = Math.max(30, Math.hypot(p.x - p1.x, p.y - p1.y) * 0.4);
    tempPath.setAttribute("d", ed.style === "straight"
      ? `M${p1.x},${p1.y} L${p.x},${p.y}`
      : `M${p1.x},${p1.y} C${p1.x + n[0] * off},${p1.y + n[1] * off} ${p.x},${p.y} ${p.x},${p.y}`);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".canvas-card");
    markDropTarget(over, e, fixedId);
  } else if (m.type === "marquee") {
    const r = canvasArea.getBoundingClientRect();
    const x1 = Math.min(m.x0, e.clientX) - r.left, x2 = Math.max(m.x0, e.clientX) - r.left;
    const y1 = Math.min(m.y0, e.clientY) - r.top, y2 = Math.max(m.y0, e.clientY) - r.top;
    marqueeEl.hidden = false;
    Object.assign(marqueeEl.style, { left: x1 + "px", top: y1 + "px", width: x2 - x1 + "px", height: y2 - y1 + "px" });
    const wx1 = (x1 - C.view.x) / C.view.s, wx2 = (x2 - C.view.x) / C.view.s;
    const wy1 = (y1 - C.view.y) / C.view.s, wy2 = (y2 - C.view.y) / C.view.s;
    const hits = new Set(m.base);
    C.cards.forEach((c) => { if (c.x < wx2 && c.x + c.w > wx1 && c.y < wy2 && c.y + c.h > wy1) hits.add(c.id); });
    C.selected = hits;
    C.selEdge = null;
    applySelection();
  }
});

window.addEventListener("pointerup", (e) => {
  const m = C.mode;
  if (!m) return;
  C.mode = null;
  if (m.type === "pan") canvasArea.classList.remove("panning");
  else if (m.type === "card") {
    drawGuides([]);
    if (!m.moved && !m.shift && C.selected.size > 1) selectCards([m.id]);
    if (m.moved) { saveCanvas(); syncGraph(); }
  } else if (m.type === "resize") { drawGuides([]); saveCanvas(); }
  else if (m.type === "marquee") marqueeEl.hidden = true;
  else if (m.type === "connect") {
    if (tempPath) { tempPath.remove(); tempPath = null; }
    clearDropTargets();
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".canvas-card");
    if (over && over.dataset.id !== m.from) addEdge(m.from, m.side, over.dataset.id, nearestSide(e, over.getBoundingClientRect()));
    else if (!over && !e.target.closest?.(".canvas-ui")) {
      const p = canvasToWorld(e);
      showCanvasMenu(e.clientX, e.clientY, [
        { label: "Add card", run: () => addTextCard(p.x, p.y, { from: { id: m.from, side: m.side } }) },
        { label: "Add note from vault", run: async () => {
          const it = await pickNoteDialog();
          if (it && it.kind === "note") addNoteCard(it.note.id, p.x, p.y, { from: { id: m.from, side: m.side } });
          else if (it && it.kind === "canvas") addCanvasCard(it.canvas.id, p.x, p.y, { from: { id: m.from, side: m.side } });
        } },
        { label: "Add group", run: () => addGroupCard(p.x, p.y) }
      ]);
    }
  } else if (m.type === "reconnect") {
    if (tempPath) { tempPath.remove(); tempPath = null; }
    clearDropTargets();
    const ed = C.edges.find((x) => x.id === m.id);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".canvas-card");
    if (ed && over) {
      const otherId = m.end === "from" ? ed.to : ed.from;
      const newId = over.dataset.id;
      const dup = C.edges.some((x) => x.id !== ed.id && ((x.from === newId && x.to === otherId) || (x.from === otherId && x.to === newId)));
      if (newId !== otherId && !dup) {
        pushHistory();
        const side = nearestSide(e, over.getBoundingClientRect());
        if (m.end === "from") { ed.from = newId; ed.fromSide = side; if (!ed.toSide) ed.toSide = ed._s2 || null; }
        else { ed.to = newId; ed.toSide = side; if (!ed.fromSide) ed.fromSide = ed._s1 || null; }
        touch();
        applySelection();
      }
    }
  }
  wakeCanvas();
});

canvasArea.addEventListener("dblclick", (e) => {
  if (e.target.closest(".canvas-ui") || e.target.closest(".cc-edit")) return;
  const cardEl = e.target.closest(".canvas-card");
  if (cardEl) {
    const c = C.cards.get(cardEl.dataset.id);
    if (!c) return;
    if (c.type === "canvas") { if (c.canvasId && canvasCache.has(c.canvasId)) switchToCanvas(c.canvasId); }
    else startEdit(c);
    return;
  }
  const he = e.target.closest(".cedge-hit, .cedge-lbl, .cedge-lbl-bg");
  if (he) { editEdgeLabel(he.dataset.id); return; }
  if (ro()) return;
  const p = canvasToWorld(e);
  addTextCard(p.x, p.y);
});

document.addEventListener("keydown", (e) => {
  if (state.view !== "canvas" || document.querySelector(".modal-overlay")) return;
  if (e.target.closest && e.target.closest("input,textarea,select")) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (k === "escape") { hideCanvasMenu(); C.selected.clear(); C.selEdge = null; applySelection(); return; }
  if (e.shiftKey && !mod && e.code === "Digit1") { e.preventDefault(); fitView(); return; }
  if (e.shiftKey && !mod && e.code === "Digit2") { e.preventDefault(); zoomToSelection(); return; }
  if (mod && (k === "c" || k === "x") && C.selected.size) { e.preventDefault(); copySelection(k === "x"); return; }
  if (mod && k === "a") { e.preventDefault(); selectCards([...C.cards.keys()]); return; }
  if (ro()) return;
  if ((k === "delete" || k === "backspace") && (C.selected.size || C.selEdge)) { e.preventDefault(); deleteSelection(); }
  else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === "y") { e.preventDefault(); redo(); }
  else if (mod && k === "d") { e.preventDefault(); duplicateSelection(); }
  else if (k === "enter" && C.selected.size === 1) {
    e.preventDefault();
    const c = C.cards.get([...C.selected][0]);
    if (c && (c.type === "text" || c.type === "note" || c.type === "group")) startEdit(c);
  } else if (k.startsWith("arrow") && C.selected.size) {
    e.preventDefault();
    const st = (e.shiftKey ? 5 : 1) * (C.opt.grid ? GRID : 5);
    pushHistory();
    C.selected.forEach((id) => {
      const c = C.cards.get(id);
      if (!c) return;
      if (k === "arrowleft") c.x -= st; else if (k === "arrowright") c.x += st;
      else if (k === "arrowup") c.y -= st; else c.y += st;
    });
    C.moved = true;
    saveCanvas();
    syncGraph();
    wakeCanvas();
  }
});

applyOpts();
applyCanvasView();

/* ==========================================================================
   INIT
   ========================================================================== */
switchView("dashboard");
