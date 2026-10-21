// Authentication: Google sign-in, sign-out, state observation.
import { auth, googleProvider } from "../firebase.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export function observeAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signInGoogle() {
  const res = await signInWithPopup(auth, googleProvider);
  return res.user;
}

export async function signOutUser() {
  await signOut(auth);
}