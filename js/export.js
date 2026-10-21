// Markdown export + JSON backup + validated restore with duplicate detection.
import { db } from "../firebase.js";
import {
  collection, doc, addDoc, getDocs, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { logActivity } from "./activity.js";

// ---- Markdown single-note export ----
export function noteToMarkdown(note) {
  const lines = [`# ${note.title}`, ""];
  if (note.description) lines.push(`> ${note.description}`, "");
  const meta = [];
  if (note.category) meta.push(`Category: ${note.category}`);
  if (note.eventDate) meta.push(`Event date: ${note.eventDate}`);
  if (note.tags?.length) meta.push(`Tags: ${note.tags.join(", ")}`);
  if (meta.length) lines.push(meta.join("  "), "");
  lines.push(note.content || "");
  return lines.join("\n");
}

export function downloadFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---- Full JSON backup ----
export async function buildBackup(uid, settings) {
  const [notes, projects, categories, tags, bookmarks, activity] = await Promise.all([
    dump(uid, "notes"), dump(uid, "projects"), dump(uid, "categories"),
    dump(uid, "tags"), dump(uid, "bookmarks"), dump(uid, "activity"),
  ]);
  return {
    app: "second-brain", version: 1,
    exportedAt: new Date().toISOString(),
    uid, settings, notes, projects, categories, tags, bookmarks, activity,
  };
}
async function dump(uid, name) {
  const snap = await getDocs(collection(db, "users", uid, name));
  return snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) }));
}
function serialize(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v.toMillis === "function") out[k] = { __ts: v.toMillis() };
    else if (v && typeof v === "object" && v.seconds != null) out[k] = { __ts: v.seconds * 1000 };
    else out[k] = v;
  }
  return out;
}
function reviveTs(v) {
  if (v && typeof v === "object" && v.__ts != null) return new Date(v.__ts).toISOString();
  return v;
}

// ---- Validation of import ----
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") { return { ok: false, errors: ["Not a JSON object."] }; }
  if (obj.app !== "second-brain") errors.push("Unrecognised backup (missing app marker).");
  if (!Array.isArray(obj.notes)) errors.push("Missing `notes` array.");
  const collections = ["notes", "projects", "categories", "tags", "bookmarks"];
  for (const c of collections) if (obj[c] && !Array.isArray(obj[c])) errors.push(`\`${c}\` must be an array.`);
  return { ok: errors.length === 0, errors };
}

// ---- Import plan (detect duplicates) ----
export async function buildImportPlan(uid, backup) {
  const plan = {};
  for (const name of ["notes", "projects", "categories", "tags", "bookmarks"]) {
    const incoming = backup[name] || [];
    const existing = await getDocs(collection(db, "users", uid, name));
    const existingTitles = new Set(existing.docs.map((d) => (d.data().title || d.data().name || "").toLowerCase()));
    plan[name] = incoming.map((rec) => {
      const key = (rec.title || rec.name || "").toLowerCase();
      return { record: rec, duplicate: existingTitles.has(key) };
    });
  }
  return plan;
}

// ---- Execute import with strategy: "skip" | "duplicate" | "overwrite" ----
export async function executeImport(uid, plan, strategy) {
  const report = { created: 0, skipped: 0, replaced: 0, failed: [] };
  for (const [name, items] of Object.entries(plan)) {
    if (name === "activity") continue;
    for (const { record, duplicate } of items) {
      try {
        if (duplicate && strategy === "skip") { report.skipped++; continue; }
        // overwrite = replace existing (delete then add). duplicate = add a copy with suffix.
        if (duplicate && strategy === "overwrite") await deleteExistingByName(uid, name, record);
        const payload = reviveRecord(name, record, duplicate && strategy === "duplicate");
        await addDoc(collection(db, "users", uid, name), payload);
        duplicate && strategy === "overwrite" ? report.replaced++ : report.created++;
      } catch (e) {
        report.failed.push({ name, record, error: e?.message || String(e) });
      }
    }
  }
  await logActivity(uid, "import", "backup", "", `Imported backup (${report.created} created, ${report.replaced} replaced, ${report.skipped} skipped)`);
  return report;
}

async function deleteExistingByName(uid, name, record) {
  const snap = await getDocs(collection(db, "users", uid, name));
  const key = (record.title || record.name || "").toLowerCase();
  const batch = writeBatch(db);
  snap.forEach((d) => {
    const v = (d.data().title || d.data().name || "").toLowerCase();
    if (v === key) batch.delete(d.ref);
  });
  await batch.commit();
}

function reviveRecord(name, r, makeUnique) {
  const base = { ...r };
  delete base.id;
  for (const k of Object.keys(base)) base[k] = reviveTs(base[k]);
  if (makeUnique && (base.title || base.name)) {
    const key = base.title ? "title" : "name";
    base[key] = `${base[key]} (imported copy)`;
  }
  return { ...base, updatedAt: serverTimestamp(), ...(base.createdAt ? {} : { createdAt: serverTimestamp() }) };
}