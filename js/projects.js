// Projects, categories, tags registry.
import { db } from "../firebase.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { logActivity } from "./activity.js";

const col = (uid, name) => collection(db, "users", uid, name);

// Array of vibrant colors for projects
const PROJECT_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Green
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#14b8a6", // Teal
  "#6366f1"  // Indigo
];

export function listenCollection(uid, name, cb, onErr) {
  return onSnapshot(query(col(uid, name)), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => onErr?.(e));
}

// ---- Projects ----
export async function createProject(uid, { name, description }) {
  // Pick a random color
  const color = PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
  
  const ref = await addDoc(col(uid, "projects"), {
    name: String(name).trim().slice(0, 100),
    description: String(description || "").slice(0, 2000),
    color: color, // Save color to DB
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(uid, "create", "project", ref.id, `Created project “${name}”`);
  return ref.id;
}
export async function updateProject(uid, id, { name, description }) {
  await updateDoc(doc(db, "users", uid, "projects", id), {
    name: String(name).trim().slice(0, 100),
    description: String(description || "").slice(0, 2000),
    updatedAt: serverTimestamp(),
  });
  await logActivity(uid, "edit", "project", id, `Edited project “${name}”`);
}
export async function deleteProject(uid, id, name) {
  await unassignProjectFromNotes(uid, id);
  await deleteDoc(doc(db, "users", uid, "projects", id));
  await logActivity(uid, "delete", "project", id, `Deleted project “${name}”`);
}

async function unassignProjectFromNotes(uid, projectId) {
  const { getDocs, where } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const notesRef = col(uid, "notes");
  const snap = await getDocs(query(notesRef, where("projectId", "==", projectId)));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((d) => batch.update(d.ref, { projectId: "", updatedAt: serverTimestamp() }));
  await batch.commit();
}

// ---- Categories ----
export async function createCategory(uid, name) {
  const ref = await addDoc(col(uid, "categories"), {
    name: String(name).trim().slice(0, 100),
    createdAt: serverTimestamp(),
  });
  await logActivity(uid, "create", "category", ref.id, `Created category “${name}”`);
  return ref.id;
}
export async function renameCategory(uid, id, newName, oldName) {
  const name = String(newName).trim().slice(0, 100);
  await updateDoc(doc(db, "users", uid, "categories", id), { name });
  await renameCategoryOnNotes(uid, oldName, name);
  await logActivity(uid, "edit", "category", id, `Renamed category “${oldName}” → “${name}”`);
}
export async function deleteCategory(uid, id, name) {
  await clearCategoryOnNotes(uid, name);
  await deleteDoc(doc(db, "users", uid, "categories", id));
  await logActivity(uid, "delete", "category", id, `Deleted category “${name}”`);
}

async function renameCategoryOnNotes(uid, oldName, newName) {
  const { getDocs, where } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const notesRef = col(uid, "notes");
  const snap = await getDocs(query(notesRef, where("category", "==", oldName)));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((d) => batch.update(d.ref, { category: newName, updatedAt: serverTimestamp() }));
  await batch.commit();
}
async function clearCategoryOnNotes(uid, name) {
  const { getDocs, where } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const notesRef = col(uid, "notes");
  const snap = await getDocs(query(notesRef, where("category", "==", name)));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((d) => batch.update(d.ref, { category: "", updatedAt: serverTimestamp() }));
  await batch.commit();
}
// Add this to the bottom of js/projects.js

export async function updateProjectColor(uid, id, newColor) {
  await updateDoc(doc(db, "users", uid, "projects", id), {
    color: newColor,
    updatedAt: serverTimestamp()
  });
}