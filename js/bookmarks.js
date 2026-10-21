// Saved website resources (URLs as text records).
import { db } from "../firebase.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { logActivity } from "./activity.js";

const col = (uid) => collection(db, "users", uid, "bookmarks");

export function listenBookmarks(uid, cb, onErr) {
  return onSnapshot(query(col(uid)), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => onErr?.(e));
}

export function validateUrl(raw) {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return "Only http and https URLs are allowed.";
    return "";
  } catch { return "Please enter a valid URL."; }
}

export async function createBookmark(uid, data) {
  const urlErr = validateUrl(data.url);
  if (urlErr) throw new Error(urlErr);
  const ref = await addDoc(col(uid), normalize(data, true));
  await logActivity(uid, "create", "bookmark", ref.id, `Saved bookmark “${data.title}”`);
  return ref.id;
}
export async function updateBookmark(uid, id, data) {
  const urlErr = validateUrl(data.url);
  if (urlErr) throw new Error(urlErr);
  await updateDoc(doc(db, "users", uid, "bookmarks", id), normalize(data, false));
  await logActivity(uid, "edit", "bookmark", id, `Edited bookmark “${data.title}”`);
}
export async function deleteBookmark(uid, id, title) {
  await deleteDoc(doc(db, "users", uid, "bookmarks", id));
  await logActivity(uid, "delete", "bookmark", id, `Deleted bookmark “${title || id}”`);
}

function normalize(d, isNew) {
  return {
    title: String(d.title || "").trim().slice(0, 200),
    url: String(d.url || "").slice(0, 2000),
    description: String(d.description || "").slice(0, 2000),
    category: String(d.category || "").slice(0, 100),
    tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t).slice(0, 50)).slice(0, 50) : [],
    projectId: String(d.projectId || "").slice(0, 100),
    ...(isNew ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  };
}