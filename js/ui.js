// Reusable UI components: toasts, modals, safe DOM, helpers.
const toastsEl = () => document.getElementById("toasts");
const modalRoot = () => document.getElementById("modal-root");

/** Escape text for safe innerHTML use. Prefer textContent. */
export function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Create an element safely. props: {class, text, html(trusted only), attrs, on} */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text != null) node.textContent = props.text;
  if (props.style) node.style.cssText = props.style;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) {
    if (v === false || v == null) continue;
    node.setAttribute(k, v === true ? "" : String(v));
  }
  if (props.on) for (const [ev, fn] of Object.entries(props.on)) node.addEventListener(ev, fn);
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

export function toast(msg, type = "", ms = 3200) {
  const t = el("div", { class: `toast ${type}`, text: msg });
  toastsEl().append(t);
  setTimeout(() => t.remove(), ms);
}

export function notifyOk(msg) { toast(msg, "ok"); }
export function notifyErr(msg) { toast(msg, "err", 5000); }

/** Generic confirm dialog -> Promise<boolean> */
export function confirmDialog({ title = "Confirm", message = "", confirmText = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = el("div", { class: "modal-backdrop", attrs: { role: "dialog", "aria-modal": "true" } });
    const modal = el("div", { class: "glass modal" });
    modal.append(
      el("div", { class: "modal-header" }, [el("h2", { text: title })]),
      el("p", { text: message })
    );
    const actions = el("div", { class: "modal-actions" });
    const cancel = el("button", { class: "btn", text: "Cancel", on: { click: () => close(false) } });
    const ok = el("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, text: confirmText, on: { click: () => close(true) } });
    actions.append(cancel, ok);
    modal.append(actions);
    backdrop.append(modal);
    modalRoot().append(backdrop);
    ok.focus();
    function close(v) { backdrop.remove(); document.removeEventListener("keydown", onKey); resolve(v); }
    function onKey(e) { if (e.key === "Escape") close(false); }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(false); });
  });
}

/** Build a modal. Returns {close}. content: (close) => HTMLElement */
export function openModal(title, contentBuilder, { width } = {}) {
  const backdrop = el("div", { class: "modal-backdrop", attrs: { role: "dialog", "aria-modal": "true" } });
  const modal = el("div", { class: "glass modal" });
  if (width) modal.style.width = width;
  const header = el("div", { class: "modal-header" });
  header.append(el("h2", { text: title }), el("span", { class: "spacer" }));
  const closeBtn = el("button", { class: "btn btn-ghost btn-sm", text: "✕", attrs: { "aria-label": "Close" }, on: { click: () => close() } });
  header.append(closeBtn);
  modal.append(header);
  function close() { backdrop.remove(); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  const body = contentBuilder(close);
  if (body) modal.append(body);
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  modalRoot().append(backdrop);
  const firstInput = modal.querySelector("input,textarea,select,button:not([aria-label='Close'])");
  firstInput?.focus();
  return { close };
}

export function emptyState(title, hint) {
  return el("div", { class: "glass card", attrs: { style: "text-align:center;padding:36px;" } }, [
    el("h3", { text: title }),
    el("p", { class: "muted", text: hint || "" }),
  ]);
}

export function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export function fmtRel(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  if (s < 604800) return `${Math.floor(s/86400)}d ago`;
  return d.toLocaleDateString();
}