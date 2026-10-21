# Second Brain

A private, responsive, text-only personal knowledge system.

- **Stack:** HTML5, CSS3, vanilla JS ES modules, Firebase Auth (Google) + Cloud Firestore.
- **No build step, no npm, no backend.** Runs directly in a modern browser.
- **Storage:** Firestore documents only. No Google Drive, no Firebase Storage, no uploads.
- **Hosting:** Netlify static hosting at `brain.zeelladani.in`.

---

## 1. Firebase project setup

1. Go to <https://console.firebase.google.com/> → **Add project**.
2. In the project → **Project settings → General → Your apps → Web** → register an app.
3. Copy the generated `firebaseConfig` object.
4. Open `firebase.js` and replace the `firebaseConfig` placeholder with your values.

> The Firebase browser config is **public configuration** — it is safe to commit. Security comes from Firestore rules, not from hiding it.

## 2. Enable Google authentication

1. Firebase Console → **Authentication → Get started**.
2. **Sign-in method → Google → Enable**.
3. Add your production domain (`brain.zeelladani.in`) and `localhost` to **Authorized domains**.
4. If using popups fails in some browsers, ensure third-party cookies are allowed for `firebaseapp.com`.

## 3. Create Firestore + deploy rules

1. Firebase Console → **Firestore Database → Create database** (production mode).
2. Copy the contents of `firestore.rules` into **Firestore → Rules**, then **Publish**.
   Or deploy with the Firebase CLI:
   ```
   firebase deploy --only firestore:rules
   ```
3. Rules isolate every document under `users/{uid}/...` to the signed-in user and validate field shapes/lengths.

**Data layout**
```
users/{uid}/notes/{noteId}
users/{uid}/projects/{id}
users/{uid}/categories/{id}
users/{uid}/tags/{id}
users/{uid}/bookmarks/{id}
users/{uid}/activity/{id}
users/{uid}/settings/prefs
```

## 4. Local development

Because the app uses ES modules, serve over HTTP (not `file://`):

```
# from second-brain/
python3 -m http.server 5173
# or
npx serve .
```

Open <http://localhost:5173> and sign in with Google.

## 5. GitHub upload

```
git init
git add .
git commit -m "Second Brain"
git branch -M main
git remote add origin https://github.com/<you>/second-brain.git
git push -u origin main
```

## 6. Netlify deploy

1. Netlify → **Add new site → Import an existing project → GitHub** → select the repo.
2. Build command: *(leave empty)*. Publish directory: `.` (root).
3. Deploy. Note the generated `*.netlify.app` URL.

## 7. Custom domain `brain.zeelladani.in`

1. Netlify → **Domain settings → Add custom domain** → `brain.zeelladani.in`.
2. In your DNS provider (for `zeelladani.in`) add a **CNAME** record:
   - Name: `brain`
   - Value: `<your-site>.netlify.app`
3. Wait for Netlify to provision HTTPS (Let's Encrypt).
4. In Firebase → **Authentication → Settings → Authorized domains**, add `brain.zeelladani.in`.

## 8. Feature notes

- **Search:** Firestore has no full-text search. Search filters the user's already-loaded notes client-side (titles, content, tags, category, metadata). This is documented and intentional; no external search service is used.
- **Knowledge graph:** built from `[[Note Title]]` references in note content. Edges exist only when a reference resolves to an existing note title.
- **Import/restore:** JSON is validated, duplicates are detected, and the user chooses Skip / Import as copies / Replace. Nothing is overwritten silently. Partial failures are reported.
- **Activity log:** stores short summaries only, never note bodies.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `auth/unauthorized-domain` on sign-in | Domain not in Firebase authorized list | Add domain under Authentication → Settings → Authorized domains |
| `auth/popup-blocked` | Browser blocked popup | Allow popups for the site |
| `Missing or insufficient permissions` | Firestore rules not published or wrong project | Re-publish `firestore.rules`; confirm `projectId` in `firebase.js` |
| Blank page | Serving via `file://` | Serve over HTTP (see step 4) |
| Data not appearing | Offline / listener error | Check console; verify network and rules |
| Netlify 404 on refresh | (Not applicable — single page, no router paths) | — |
| Custom domain not resolving | DNS CNAME missing/wrong | Verify CNAME at DNS provider; wait for propagation |

## 10. Testing

### Verified statically (no Firebase needed)
- HTML/CSS/JS structure, module wiring, syntax.
- Markdown rendering is DOM-safe (no `innerHTML` on user content).
- URL validation restricts to `http`/`https`.
- Firestore rule syntax and per-user scoping.

### Requires your Firebase project (cannot be verified here)
- Google sign-in / sign-out / session restoration.
- Firestore persistence, cross-user isolation (open two browsers with two accounts).
- Real-time sync, imports, graph from live data.
- Netlify + custom-domain deployment.

**Acceptance checklist**
- [ ] App loads; layouts responsive at ≤ 860px.
- [ ] All six themes switch and persist across reloads.
- [ ] Google sign-in, sign-out, session restore.
- [ ] Create/edit/archive/restore/delete notes; persistence survives reload.
- [ ] User B cannot read User A's data (test with two accounts).
- [ ] Categories/tags/projects/bookmarks CRUD; deleting a category/project keeps note content.
- [ ] Search filters notes live; no-results state appears; `/` focuses search.
- [ ] Favourites and pinned filters work.
- [ ] `[[links]]` produce backlinks; related notes suggested; graph pans/zooms and opens nodes.
- [ ] Markdown preview is safe; single-note `.md` export downloads.
- [ ] JSON backup downloads; restore validates, previews duplicates, and honours the chosen strategy.
- [ ] Activity log records actions with timestamps.
- [ ] Keyboard: Tab through controls, visible focus, `Esc` closes modals.
- [ ] Rules block unauthenticated access (test in Rules Playground).

## 11. Honesty note

This README distinguishes what was verified statically from what requires your live Firebase/Netlify environment. No cloud operation or deployment is claimed to have succeeded without access to your project.