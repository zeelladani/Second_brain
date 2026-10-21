// Preferences + theme management.
import { db } from "../firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const THEMES = ["daylight", "midnight", "ocean", "forest", "lavender", "warm-sand"];
const LS_THEME = "sb-theme";
const LS_PREFS = "sb-prefs";

export function applyTheme(name) {
  const theme = THEMES.includes(name) ? name : "daylight";
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS_THEME, theme);
}

export function currentTheme() {
  return localStorage.getItem(LS_THEME) || "daylight";
}
export function nextTheme() {
  const cur = currentTheme();
  const idx = THEMES.indexOf(cur);
  return THEMES[(idx + 1) % THEMES.length];
}

export function loadLocalPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_PREFS) || "{}"); }
  catch { return {}; }
}
export function saveLocalPrefs(prefs) {
  localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
}

export async function loadCloudPrefs(uid) {
  const ref = doc(db, "users", uid, "settings", "prefs");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}
export async function saveCloudPrefs(uid, prefs) {
  const ref = doc(db, "users", uid, "settings", "prefs");
  await setDoc(ref, { ...prefs, updatedAt: serverTimestamp() }, { merge: true });
}