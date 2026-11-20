// Shared UI helpers: element builder, toasts, dialogs, popup menus, theme, dates.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// ---------- icons (inline SVG, stroke = currentColor) ----------

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  books: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  minus: '<path d="M5 12h14"/>',
  width: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  bookmark: '<path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  shrink: '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

// Replace every <span data-icon="name"> in the page with its SVG.
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => {
    n.replaceWith(icon(n.dataset.icon, Number(n.dataset.size) || 18));
  });
}

// ---------- theme (a per-device display preference, so it lives in localStorage) ----------

const THEME_KEY = 'shelf.theme';

export function currentTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* storage unavailable */ }
  if (saved === 'light' || saved === 'dark') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme = currentTheme()) {
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
  return applyTheme(next);
}

// ---------- toasts ----------

export function toast(message, { type = 'info', timeout = 4500 } = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const node = el('div', { class: `toast toast-${type}` }, message);
  host.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, timeout);
}

// ---------- dialogs ----------

/**
 * Generic modal. Resolves with { value, input, checked } where value is the clicked action's value
 * (or null if cancelled with Esc / backdrop).
 */
export function openDialog({ title, message, body, input, checkbox, actions }) {
  return new Promise((resolve) => {
    const inputEl = input ? el('input', {
      class: 'input', type: 'text', value: input.value || '', placeholder: input.placeholder || '',
      maxlength: input.maxlength || 300, 'aria-label': input.label || title,
    }) : null;
    const checkEl = checkbox ? el('input', { type: 'checkbox', checked: checkbox.checked || false }) : null;

    const buttons = (actions || [{ label: 'OK', value: true, primary: true }]).map((a) =>
      el('button', {
        class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
        type: a.primary ? 'submit' : 'button',
        onclick: a.primary ? null : () => close(a.value),
      }, a.label));

    const form = el('form', { method: 'dialog', class: 'dialog-form' },
      el('h2', { class: 'dialog-title' }, title),
      message ? el('p', { class: 'dialog-message' }, message) : null,
      body || null,
      input?.label ? el('label', { class: 'field-label' }, input.label, inputEl) : inputEl,
      checkEl ? el('label', { class: 'check' }, checkEl, el('span', {}, checkbox.label)) : null,
      el('div', { class: 'dialog-actions' }, buttons));

    const dialog = el('dialog', { class: 'dialog' }, form);
    const primary = (actions || []).find((a) => a.primary) || { value: true };
    form.addEventListener('submit', (e) => { e.preventDefault(); close(primary.value); });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) close(null); });

    function close(value) {
      dialog.close();
      dialog.remove();
      resolve({ value, input: inputEl?.value ?? null, checked: checkEl?.checked ?? false });
    }

    document.body.append(dialog);
    dialog.showModal();
    if (inputEl) { inputEl.focus(); inputEl.select(); }
  });
}

export async function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save' }) {
  const r = await openDialog({
    title, input: { label, value, placeholder },
    actions: [{ label: 'Cancel', value: false }, { label: confirmLabel, value: true, primary: true }],
  });
  return r.value ? r.input.trim() : null;
}

export async function confirmDialog({ title, message, confirmLabel = 'OK', danger = false, checkbox }) {
  const r = await openDialog({
    title, message, checkbox,
    actions: [{ label: 'Cancel', value: false }, { label: confirmLabel, value: true, primary: true, danger }],
  });
  return { ok: Boolean(r.value), checked: r.checked };
}

// ---------- popup menus ----------

let openMenu = null;

export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

/** items: { label, onClick, danger, disabled, checked } | { heading } | { separator: true } */
export function showMenu(anchor, items) {
  closeMenu();
  const menu = el('div', { class: 'menu', role: 'menu' });
  for (const item of items) {
    if (item.separator) menu.append(el('div', { class: 'menu-sep' }));
    else if (item.heading) menu.append(el('div', { class: 'menu-heading' }, item.heading));
    else {
      menu.append(el('button', {
        class: `menu-item ${item.danger ? 'danger' : ''} ${item.checked ? 'checked' : ''}`,
        role: 'menuitem', type: 'button', disabled: item.disabled,
        onclick: (e) => { e.stopPropagation(); closeMenu(); item.onClick?.(); },
      }, item.checked ? icon('check', 15) : el('span', { class: 'menu-check-space' }), item.label));
    }
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = Math.min(r.left, innerWidth - mw - 8);
  let top = r.bottom + 4;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  openMenu = menu;
  menu.querySelector('.menu-item:not([disabled])')?.focus();
}

document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu);

// ---------- formatting ----------

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(iso) {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/** Reading progress for a book, 0–100. */
export function percentRead(book) {
  if (!book.page || !book.pageCount) return 0;
  if (book.page >= book.pageCount) return 100;
  return Math.max(0, Math.min(100, Math.round(((book.page - 1) / book.pageCount) * 100)));
}
