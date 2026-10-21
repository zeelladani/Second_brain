// Local search / filtering / sorting over the loaded notes.
// Firestore has no native full-text search; we filter client-side.
export function filterAndSort(notes, {
  query = "", category = "", tag = "", projectId = "",
  favourite = null, pinned = null, archived = false,
  sortBy = "updatedAt", sortDir = "desc",
} = {}) {
  const q = query.trim().toLowerCase();
  let out = notes.filter((n) => {
    if (archived !== !!n.archived) return false;
    if (category && n.category !== category) return false;
    if (tag && !(n.tags || []).includes(tag)) return false;
    if (projectId && n.projectId !== projectId) return false;
    if (favourite != null && !!n.favourite !== favourite) return false;
    if (pinned != null && !!n.pinned !== pinned) return false;
    if (!q) return true;
    const hay = [n.title, n.content, n.description, n.category, (n.tags || []).join(" ")]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  const dir = sortDir === "asc" ? 1 : -1;
  out.sort((a, b) => {
    if (sortBy === "title") return a.title.localeCompare(b.title) * dir;
    const av = tsVal(a[sortBy]); const bv = tsVal(b[sortBy]);
    return (av - bv) * dir;
  });
  return out;
}

function tsVal(v) {
  if (!v) return 0;
  if (v.toMillis) return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  return new Date(v).getTime() || 0;
}

export function highlight(text, q) {
  if (!q) return document.createTextNode(text || "");
  const frag = document.createDocumentFragment();
  const lower = (text || "").toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) { frag.append(document.createTextNode(text.slice(i))); break; }
    if (at > i) frag.append(document.createTextNode(text.slice(i, at)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + needle.length);
    frag.append(mark);
    i = at + needle.length;
  }
  return frag;
}