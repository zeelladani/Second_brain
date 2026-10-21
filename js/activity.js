// Per-user activity log. We store short summaries only (no note bodies).
import { db } from "../firebase.js";
import {
  collection, addDoc, onSnapshot, query, orderBy, limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const actCol = (uid) => collection(db, "users", uid, "activity");

export async function logActivity(uid, type, entity, entityId, summary) {
  try {
    await addDoc(actCol(uid), {
      type: String(type).slice(0, 50),
      entity: String(entity).slice(0, 50),
      entityId: String(entityId || "").slice(0, 200),
      summary: String(summary || "").slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    // Non-fatal.
    console.warn("activity log failed:", e?.message || e);
  }
}

export function listenActivity(uid, cb, onErr) {
  const q = query(actCol(uid), orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => onErr?.(e));
}