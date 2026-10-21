// Notes CRUD + real-time listeners + activity writes.
import { db } from "../firebase.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, query, serverTimestamp, getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { logActivity } from "./activity.js";

const notesCol = (uid) => collection(db, "users", uid, "notes");
const noteDoc = (uid, id) => doc(db, "users", uid, "notes", id);

export function listenNotes(uid, cb, onErr) {
  const q = query(notesCol(uid));
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(list);
  }, (err) => onErr?.(err));
}

export function validateNote({ title, content }) {
  const errs = [];
  const t = (title || "").trim();
  if (!t) errs.push("Title is required.");
  if (t.length > 200) errs.push("Title must be ≤ 200 characters.");
  if ((content || "").length > 100000) errs.push("Content must be ≤ 100,000 characters.");
  return errs;
}

export async function createNote(uid, data) {
  const now = serverTimestamp();
  const payload = normalizeNote(data, now, now);
  const ref = await addDoc(notesCol(uid), payload);
  await logActivity(uid, "create", "note", ref.id, `Created note “${payload.title}”`);
  return ref.id;
}

export async function updateNote(uid, id, data) {
  const payload = normalizeNote(data, null, serverTimestamp());
  await updateDoc(noteDoc(uid, id), payload);
  await logActivity(uid, "edit", "note", id, `Edited note “${payload.title}”`);
}

export async function deleteNote(uid, id, title) {
  await deleteDoc(noteDoc(uid, id));
  await logActivity(uid, "delete", "note", id, `Deleted note “${title || id}”`);
}

export async function toggleFlag(uid, id, field, value) {
  await updateDoc(noteDoc(uid, id), { [field]: value, updatedAt: serverTimestamp() });
  const label = field === "pinned" ? (value ? "Pinned" : "Unpinned")
              : field === "favourite" ? (value ? "Favourited" : "Unfavourited")
              : field === "archived" ? (value ? "Archived" : "Restored") : field;
  await logActivity(uid, field === "archived" && !value ? "restore" : "edit", "note", id, `${label} note`);
}

function normalizeNote(data, createdAt, updatedAt) {
  return {
    title: String(data.title || "").trim().slice(0, 200),
    content: String(data.content || "").slice(0, 100000),
    description: String(data.description || "").slice(0, 2000),
    category: String(data.category || "").slice(0, 100),
    tags: Array.isArray(data.tags) ? data.tags.map((t) => String(t).slice(0, 50)).slice(0, 50) : [],
    projectId: String(data.projectId || "").slice(0, 100),
    pinned: !!data.pinned,
    favourite: !!data.favourite,
    archived: !!data.archived,
    eventDate: /^\d{4}-\d{2}-\d{2}$/.test(data.eventDate || "") ? data.eventDate : "",
    ...(createdAt ? { createdAt } : {}),
    updatedAt,
  };
}

export { getDoc, noteDoc };

export async function updateNotePosition(uid, id, x, y) {
  await updateDoc(doc(db, "users", uid, "notes", id), { 
    canvasX: x, 
    canvasY: y,
    updatedAt: serverTimestamp() 
  });
}