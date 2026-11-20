// Library (home screen): book grid, folders sidebar, search/sort, drag & drop uploads.
import { api } from './api.js';
import {
  el, icon, hydrateIcons, applyTheme, toggleTheme, currentTheme, toast, openDialog, promptDialog,
  confirmDialog, showMenu, relativeTime, percentRead, formatSize,
} from './ui.js';
import { requestCover } from './covers.js';
import { loadFocus, showLibraryLock } from './focus.js';

const $ = (id) => document.getElementById(id);
const BOOK_MIME = 'application/x-shelf-book';

const state = {
  books: [],
  folders: [],
  view: parseHash(),          // 'all' | 'unsorted' | <folder id>
  sort: pref('sort', 'recent'),
  search: '',
  selected: new Set(),        // ids of selected book cards
  anchor: null,               // last clicked card, for Shift+click ranges
  visibleIds: [],             // book ids in the order they're shown (for Ctrl+A and ranges)
  clipboard: null,            // { ids } after Ctrl+X / Ctrl+C, pasted with Ctrl+V
  scanning: false,
};

// ---------- small helpers ----------

function pref(key, fallback) {
  try { return localStorage.getItem(`shelf.${key}`) || fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem(`shelf.${key}`, value); } catch { /* storage unavailable */ }
}

function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'unsorted' || h === 'duplicates') return h;
  const m = /^folder\/(\d+)$/.exec(h);
  return m ? Number(m[1]) : 'all';
}

function viewHash(view) {
  if (view === 'unsorted' || view === 'duplicates') return `#${view}`;
  if (typeof view === 'number') return `#folder/${view}`;
  return '#all';
}

const folderById = (id) => state.folders.find((f) => f.id === id);
const folderLabel = (id) => (id == null ? 'Unsorted' : folderById(id)?.name || 'Unsorted');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function pagesRead(book) {
  if (!book.pageCount || !book.page) return 0;
  return book.page >= book.pageCount ? book.pageCount : book.page - 1;
}

function groupProgress(books) {
  let read = 0, total = 0;
  for (const b of books) {
    if (!b.pageCount) continue;
    read += pagesRead(b);
    total += b.pageCount;
  }
  return total ? Math.round((read / total) * 100) : 0;
}

function booksInView(view) {
  if (view === 'all') return state.books;
  if (view === 'unsorted') return state.books.filter((b) => b.folderId == null);
  return state.books.filter((b) => b.folderId === view);
}

const SORTERS = {
  recent: (a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '') || b.addedAt.localeCompare(a.addedAt),
  title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
  progress: (a, b) => percentRead(b) - percentRead(a) || SORTERS.recent(a, b),
  added: (a, b) => b.addedAt.localeCompare(a.addedAt),
};

// ---------- loading ----------

let pollTimer = null;

async function load() {
  try {
    const [{ books, scanning }, folders] = await Promise.all([api.books(), api.folders()]);
    state.books = books;
    state.folders = folders;
    state.scanning = scanning;
  } catch (err) {
    toast(`Couldn't load your library: ${err.message}. Is the Shelf server window still open?`, { type: 'error', timeout: 8000 });
    return;
  }
  if (typeof state.view === 'number' && !folderById(state.view)) {
    state.view = 'all';
    history.replaceState(null, '', '#all');
  }
  render();
  queueMissingCovers();
  clearTimeout(pollTimer);
  if (state.scanning) pollTimer = setTimeout(load, 1500);
}

function queueMissingCovers() {
  for (const book of state.books) {
    if ((book.coverStatus === 0 || !book.metaChecked) && !book.missing) requestCover(book, onCoverReady);
  }
}

function onCoverReady(updated) {
  if (!updated) return;
  replaceBook(updated);
  // Re-render (cover, title and page count are now known), batched so many updates
  // arriving in a row don't redraw the grid each time.
  clearTimeout(coverRenderTimer);
  coverRenderTimer = setTimeout(render, 250);
}
let coverRenderTimer = null;

function replaceBook(book) {
  const i = state.books.findIndex((b) => b.id === book.id);
  if (i >= 0) state.books[i] = book;
  else state.books.push(book);
}

// ---------- rendering ----------

function render() {
  renderNav();
  renderMain();
}

function navItem({ view, label, iconName, count, pct, folder, noDrop = false }) {
  const active = state.view === view;
  const item = el('a', {
    class: `nav-item ${active ? 'active' : ''}`,
    href: viewHash(view),
    'aria-current': active ? 'page' : null,
    dataset: noDrop ? {} : {
      dropFolder: folder ? String(folder.id) : 'none',
      dropName: folder ? folder.name : (view === 'all' ? 'your library' : 'Unsorted'),
    },
  },
  icon(iconName, 17),
  el('span', { class: 'nav-name', title: label }, label),
  el('span', { class: 'nav-count' }, count));
  if (view === 'all') item.dataset.filesOnly = '';
  if (folder) {
    item.append(el('div', { class: 'bar', title: `${pct}% read` }, el('span', { style: { width: `${pct}%` } })));
    const more = el('button', {
      class: 'icon-btn nav-more', type: 'button', 'aria-label': `Options for ${folder.name}`,
      onclick: (e) => {
        e.preventDefault(); e.stopPropagation();
        showMenu(more, [
          { label: 'Rename…', onClick: () => renameFolder(folder) },
          { label: 'Delete folder…', danger: true, onClick: () => deleteFolder(folder) },
        ]);
      },
    }, icon('more', 16));
    item.append(more);
  }
  return item;
}

function renderNav() {
  const unsorted = state.books.filter((b) => b.folderId == null);
  const nav = $('nav');
  nav.replaceChildren(
    navItem({ view: 'all', label: 'All books', iconName: 'books', count: state.books.length }),
    navItem({ view: 'unsorted', label: 'Unsorted', iconName: 'inbox', count: unsorted.length }),
    navItem({ view: 'duplicates', label: 'Duplicates', iconName: 'copy', count: extraCopies(findDuplicates()), noDrop: true }),
    el('div', { class: 'nav-section' },
      el('h3', {}, 'Folders'),
      el('button', { class: 'icon-btn', type: 'button', title: 'New folder', 'aria-label': 'New folder', onclick: createFolder },
        icon('plus', 16))),
    ...state.folders.map((folder) => {
      const books = booksInView(folder.id);
      return navItem({ view: folder.id, label: folder.name, iconName: 'folder', count: books.length, pct: groupProgress(books), folder });
    }),
    ...(state.folders.length ? [] : [el('div', { class: 'nav-empty' }, 'No folders yet. Click + to create one, e.g. “Programming”.')]),
  );
}

function hueFor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function placeholder(book) {
  const h = hueFor(book.title);
  return el('span', { class: 'cover-placeholder', style: { '--ph1': `hsl(${h} 32% 40%)`, '--ph2': `hsl(${(h + 30) % 360} 38% 22%)` } },
    el('span', { class: 'ph-title' }, book.title),
    el('span', { class: 'ph-foot' }, 'PDF'));
}

function coverEl(book) {
  const cover = el('span', { class: 'cover', dataset: { coverId: book.id } });
  if (book.coverStatus === 1) {
    const img = el('img', { src: `/api/books/${book.id}/cover`, alt: '', loading: 'lazy', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(placeholder(book)));
    cover.append(img);
  } else {
    cover.append(placeholder(book));
    if (book.coverStatus === 0 && !book.missing) cover.classList.add('loading');
  }
  if (book.missing) cover.append(el('span', { class: 'badge badge-missing', title: book.filePath }, 'File missing'));
  else if (percentRead(book) === 100) cover.append(el('span', { class: 'badge badge-done' }, 'Finished'));
  return cover;
}

function pageText(book) {
  if (book.pageCount) return `Page ${book.page || 1} of ${book.pageCount}`;
  return book.page ? `Page ${book.page}` : '';
}

const readerUrl = (book) => `/reader.html?id=${book.id}`;

function bookCard(book) {
  const pct = percentRead(book);
  const more = el('button', {
    class: 'icon-btn card-more', type: 'button', 'aria-label': `Options for ${book.title}`,
    onclick: (e) => { e.preventDefault(); bookMenu(book, more); },
  }, icon('more', 16));

  const check = el('button', {
    class: 'card-check', type: 'button', 'aria-label': `Select ${book.title}`, title: 'Select (Ctrl+click)',
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); e.shiftKey ? selectRange(book.id) : toggleSelected(book.id); },
  }, icon('check', 14));

  const isCut = state.clipboard?.ids.includes(book.id);
  const card = el('article', {
    class: `card ${state.selected.has(book.id) ? 'selected' : ''} ${isCut ? 'cut' : ''}`,
    draggable: 'true', dataset: { bookId: book.id },
  },
    el('a', {
      class: 'card-link', href: readerUrl(book), draggable: 'false', title: book.title,
      // Ctrl+click toggles, Shift+click selects a range, and while something is selected a plain click
      // adds to the selection instead of opening the book.
      onclick: (e) => {
        if (e.shiftKey) { e.preventDefault(); selectRange(book.id); } else if (e.ctrlKey || e.metaKey || state.selected.size) {
          e.preventDefault();
          toggleSelected(book.id);
        }
      },
    },
      coverEl(book),
      el('h3', { class: 'card-title' }, book.title)),
    check,
    el('div', { class: `bar ${pct === 100 ? 'done' : ''}`, title: `${pct}% read` }, el('span', { style: { width: `${pct}%` } })),
    el('div', { class: 'card-stats' }, el('strong', {}, `${pct}%`), el('span', {}, pageText(book))),
    el('div', { class: 'card-date' }, book.lastOpenedAt ? `Last read ${relativeTime(book.lastOpenedAt)}` : 'Not started yet'),
    more);

  card.addEventListener('dragstart', (e) => {
    // Dragging a selected card drags the whole selection.
    const ids = state.selected.has(book.id) ? [...state.selected] : [book.id];
    e.dataTransfer.setData(BOOK_MIME, ids.join(','));
    e.dataTransfer.setData('text/plain', ids.length > 1 ? plural(ids.length, 'book') : book.title);
    e.dataTransfer.effectAllowed = 'move';
    ids.forEach((id) => document.querySelector(`.card[data-book-id="${id}"]`)?.classList.add('drag-source'));
    document.body.classList.add('dragging', 'dragging-book');
  });
  card.addEventListener('dragend', () => {
    document.querySelectorAll('.card.drag-source').forEach((c) => c.classList.remove('drag-source'));
    document.body.classList.remove('dragging', 'dragging-book');
    setDropHover(null);
  });
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); bookMenu(book, more); });
  return card;
}

function resumeCard(book) {
  const pct = percentRead(book);
  return el('a', { class: 'resume', href: readerUrl(book), title: book.title, draggable: 'false' },
    coverEl(book),
    el('div', { class: 'resume-info' },
      el('div', { class: 'resume-title' }, book.title),
      el('div', { class: 'bar' }, el('span', { style: { width: `${pct}%` } })),
      el('div', { class: 'resume-meta' }, el('span', {}, `${pct}% · ${pageText(book)}`), el('span', {}, relativeTime(book.lastOpenedAt))),
      el('span', { class: 'resume-cta' }, 'Continue reading →')));
}

function renderMain() {
  const { view } = state;
  $('scanBanner').hidden = !state.scanning;
  const showDupes = view === 'duplicates';
  $('grid').hidden = showDupes;
  $('dupes').hidden = !showDupes;
  if (showDupes) {
    state.selected.clear();
    renderSelectionBar();
    return renderDuplicates();
  }

  let books = booksInView(view);
  const q = normalize(state.search.trim());
  if (q) books = books.filter((b) => normalize(b.title).includes(q));
  books = [...books].sort(SORTERS[state.sort] || SORTERS.recent);
  state.visibleIds = books.map((b) => b.id);
  // Drop selected books that are no longer shown (e.g. after searching).
  for (const id of state.selected) if (!state.visibleIds.includes(id)) state.selected.delete(id);
  renderSelectionBar();

  // "Continue reading" row: most recently opened, unfinished books (only on the All books view).
  const recent = view === 'all' && !q
    ? state.books.filter((b) => b.lastOpenedAt && percentRead(b) < 100 && !b.missing)
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).slice(0, 8)
    : [];
  $('continue').hidden = recent.length === 0;
  $('continueRow').replaceChildren(...recent.map(resumeCard));

  const title = view === 'all' ? 'All books' : view === 'unsorted' ? 'Unsorted' : folderLabel(view);
  $('viewTitle').textContent = title;
  document.title = view === 'all' ? 'Shelf' : `${title} · Shelf`;
  const all = booksInView(view);
  const pct = groupProgress(all);
  $('viewSub').textContent = q ? `${plural(books.length, 'match')} of ${all.length}` : `${plural(all.length, 'book')}${all.length ? ` · ${pct}% read` : ''}`;
  $('viewBar').hidden = typeof view !== 'number' || !all.length;
  $('viewBar').firstElementChild.style.width = `${pct}%`;

  $('grid').replaceChildren(...books.map(bookCard));
  $('empty').replaceChildren(books.length ? '' : emptyState(q, all.length));
}

function emptyState(q, countInView) {
  if (q) {
    return el('div', { class: 'empty' }, icon('search', 30), el('h3', {}, `No books match “${state.search.trim()}”`),
      el('p', {}, 'Try a shorter search, or check another folder.'));
  }
  if (!state.books.length) {
    return el('div', { class: 'empty' }, icon('upload', 34), el('h3', {}, 'Your library is empty'),
      el('p', {}, 'Drag PDF files from File Explorer and drop them anywhere on this window, or click the button below.'),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => pickFiles() }, icon('plus', 16), 'Add books'),
      el('p', { class: 'hint' }, 'PDFs you put in your books folder are picked up automatically when Shelf starts.'));
  }
  if (!countInView) {
    const inFolder = typeof state.view === 'number';
    return el('div', { class: 'empty' }, icon(inFolder ? 'folder' : 'inbox', 30),
      el('h3', {}, inFolder ? 'This folder is empty' : 'Nothing unsorted'),
      el('p', {}, inFolder
        ? 'Drag book cards onto this folder in the sidebar, or drop PDF files here to add them straight into it.'
        : 'Every book is in a folder.'));
  }
  return '';
}

// ---------- duplicates ----------

// A loose key for titles, so "Python for Data Analysis" and "python-for-data-analysis" match.
const titleKey = (t) => normalize(t).replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Groups of books that look like the same book:
 *  - identical: the files have exactly the same content (same SHA-256 hash)
 *  - title: same title, but different files (e.g. downloaded twice from different places)
 */
function findDuplicates() {
  const groups = [];
  const grouped = new Set();
  const byHash = new Map();
  const byTitle = new Map();
  for (const b of state.books) {
    if (b.fileHash) byHash.set(b.fileHash, [...(byHash.get(b.fileHash) || []), b]);
    const key = titleKey(b.title);
    if (key) byTitle.set(key, [...(byTitle.get(key) || []), b]);
  }
  for (const books of byTitle.values()) {
    if (books.length < 2) continue;
    const identical = books.every((b) => b.fileHash === books[0].fileHash);
    groups.push({ kind: identical ? 'identical' : 'title', books });
    books.forEach((b) => grouped.add(b.id));
  }
  // Identical files with different titles (e.g. one was renamed).
  for (const books of byHash.values()) {
    const rest = books.filter((b) => !grouped.has(b.id));
    if (books.length > 1 && rest.length) {
      groups.push({ kind: 'identical', books });
      books.forEach((b) => grouped.add(b.id));
    }
  }
  return groups.sort((a, b) => a.books[0].title.localeCompare(b.books[0].title, undefined, { sensitivity: 'base' }));
}

const copies = (n, prefix = '') => `${n} ${prefix}${n === 1 ? 'copy' : 'copies'}`;
const extraCopies = (groups) => groups.reduce((n, g) => n + g.books.length - 1, 0);

function renderDuplicates() {
  const q = normalize(state.search.trim());
  const all = findDuplicates();
  const groups = q ? all.filter((g) => g.books.some((b) => normalize(b.title).includes(q))) : all;

  $('continue').hidden = true;
  $('viewTitle').textContent = 'Duplicates';
  document.title = 'Duplicates · Shelf';
  $('viewBar').hidden = true;
  $('viewSub').textContent = all.length
    ? `${plural(all.length, 'book')} with more than one copy · ${copies(extraCopies(all), 'extra ')}`
    : `Checked ${plural(state.books.length, 'book')}`;

  $('dupes').replaceChildren(...groups.map(duplicateGroup));
  if (groups.length) $('empty').replaceChildren('');
  else if (q) $('empty').replaceChildren(emptyState(q, 1));
  else {
    $('empty').replaceChildren(el('div', { class: 'empty' }, icon('check', 30), el('h3', {}, 'No duplicates found'),
      el('p', {}, 'None of your books share the same file or the same title.')));
  }
}

function duplicateGroup(group) {
  const furthest = Math.max(...group.books.map((b) => b.page || 0));
  return el('section', { class: 'dupe-group' },
    el('header', { class: 'dupe-head' },
      el('h3', {}, group.books[0].title),
      el('span', { class: `tag ${group.kind === 'identical' ? 'tag-strong' : ''}` },
        group.kind === 'identical' ? 'Identical files' : 'Same title, different files')),
    el('div', { class: 'dupe-list' }, group.books.map((book) => {
      const pct = percentRead(book);
      const facts = [
        folderLabel(book.folderId),
        book.pageCount ? plural(book.pageCount, 'page') : null,
        formatSize(book.fileSize),
        `added ${relativeTime(book.addedAt)}`,
      ].filter(Boolean).join(' · ');
      return el('div', { class: 'dupe-item' },
        el('a', { href: readerUrl(book), class: 'dupe-cover', title: 'Open' }, coverEl(book)),
        el('div', { class: 'dupe-info' },
          el('div', { class: 'dupe-title' }, book.title,
            book.page && book.page === furthest && furthest > 1 ? el('span', { class: 'tag' }, 'Furthest read') : null),
          el('div', { class: 'dupe-meta' }, book.page
            ? `${pct}% read · page ${book.page}${book.pageCount ? ` of ${book.pageCount}` : ''} · last read ${relativeTime(book.lastOpenedAt)}`
            : 'Not started'),
          el('div', { class: 'dupe-meta' }, facts),
          el('div', { class: 'dupe-path', title: book.filePath }, book.filePath)),
        el('div', { class: 'dupe-actions' },
          el('button', { class: 'btn btn-primary', type: 'button', onclick: () => keepOnly(book, group) }, 'Keep this one'),
          el('button', { class: 'btn', type: 'button', onclick: () => removeBook(book) }, 'Remove…')));
    })));
}

async function keepOnly(keep, group) {
  const others = group.books.filter((b) => b.id !== keep.id);
  const further = others.filter((b) => (b.page || 0) > (keep.page || 0));
  const warning = further.length
    ? `\n\nHeads up: another copy is further along (page ${Math.max(...further.map((b) => b.page))}) than the one you're keeping (${keep.page ? `page ${keep.page}` : 'not started'}).`
    : '';
  const { ok, checked } = await confirmDialog({
    title: `Keep this copy of “${keep.title}”?`,
    message: (others.length === 1
      ? 'The other copy will be removed from your library, with its reading progress and bookmarks.'
      : `The other ${copies(others.length)} will be removed from your library, with their reading progress and bookmarks.`)
      + `${warning}\n\n${others.length === 1 ? 'Its PDF file stays' : 'Their PDF files stay'} on your PC unless you tick the box below.`,
    checkbox: { label: 'Also delete the other files from my PC (they go to the Recycle Bin)' },
    confirmLabel: `Remove ${others.length === 1 ? 'the other copy' : `${others.length} copies`}`,
    danger: true,
  });
  if (!ok) return;
  let removed = 0;
  for (const b of others) {
    try {
      await api.removeBook(b.id, checked && !b.missing);
      state.books = state.books.filter((x) => x.id !== b.id);
      removed++;
    } catch (err) { toast(`Couldn't remove “${b.title}”: ${err.message}`, { type: 'error' }); }
  }
  render();
  if (removed) toast(`Kept one copy of “${keep.title}” and removed ${removed === 1 ? 'the other' : `${removed} others`}`);
}

// ---------- book actions ----------

function bookMenu(book, anchor) {
  showMenu(anchor, [
    { label: 'Open', onClick: () => { location.href = readerUrl(book); } },
    { label: 'Rename…', onClick: () => renameBook(book) },
    { heading: 'Move to folder' },
    { label: 'Unsorted', checked: book.folderId == null, onClick: () => moveBook(book.id, null) },
    ...state.folders.map((f) => ({ label: f.name, checked: book.folderId === f.id, onClick: () => moveBook(book.id, f.id) })),
    { separator: true },
    { label: 'Remove from library…', danger: true, onClick: () => removeBook(book) },
  ]);
}

const moveBook = (id, folderId) => moveBooks([id], folderId);

async function moveBooks(ids, folderId) {
  const books = ids.map((id) => state.books.find((b) => b.id === id)).filter((b) => b && b.folderId !== folderId);
  if (!books.length) {
    toast(ids.length > 1 ? `Those books are already in ${folderLabel(folderId)}` : `Already in ${folderLabel(folderId)}`);
    return;
  }
  try {
    await api.moveBooks(books.map((b) => b.id), folderId);
    books.forEach((b) => { b.folderId = folderId; });
    state.selected.clear();
    render();
    toast(books.length === 1 ? `Moved “${books[0].title}” to ${folderLabel(folderId)}` : `Moved ${plural(books.length, 'book')} to ${folderLabel(folderId)}`);
  } catch (err) { toast(err.message, { type: 'error' }); }
}

// ---------- selection (Ctrl+click, Shift+click, Ctrl+A) ----------

function syncSelectionUi() {
  document.querySelectorAll('#grid .card').forEach((c) => c.classList.toggle('selected', state.selected.has(Number(c.dataset.bookId))));
  renderSelectionBar();
}

function toggleSelected(id) {
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  state.anchor = id;
  syncSelectionUi();
}

function selectRange(id) {
  const from = state.visibleIds.indexOf(state.anchor ?? id);
  const to = state.visibleIds.indexOf(id);
  if (from < 0 || to < 0) return toggleSelected(id);
  const [a, b] = from < to ? [from, to] : [to, from];
  state.visibleIds.slice(a, b + 1).forEach((x) => state.selected.add(x));
  syncSelectionUi();
}

function selectAll() {
  state.visibleIds.forEach((id) => state.selected.add(id));
  syncSelectionUi();
}

function clearSelection() {
  if (!state.selected.size) return false;
  state.selected.clear();
  state.anchor = null;
  syncSelectionUi();
  return true;
}

function moveMenu(anchor, ids) {
  showMenu(anchor, [
    { heading: `Move ${plural(ids.length, 'book')} to` },
    { label: 'Unsorted', onClick: () => moveBooks(ids, null) },
    ...state.folders.map((f) => ({ label: f.name, onClick: () => moveBooks(ids, f.id) })),
    { separator: true },
    { label: 'New folder…', onClick: async () => { const f = await createFolder(); if (f) moveBooks(ids, f.id); } },
  ]);
}

function renderSelectionBar() {
  const n = state.selected.size;
  const bar = $('selectionBar');
  bar.hidden = n === 0;
  document.body.classList.toggle('has-selection', n > 0);
  if (!n) return;
  const ids = [...state.selected];
  const moveBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => moveMenu(moveBtn, ids) }, icon('folder', 16), 'Move to…');
  bar.replaceChildren(
    el('span', { class: 'sel-count' }, `${n} selected`),
    moveBtn,
    el('button', { class: 'btn', type: 'button', title: 'Ctrl+X, then open a folder and press Ctrl+V', onclick: () => cutSelection() }, 'Cut'),
    el('button', { class: 'btn', type: 'button', title: 'Ctrl+A', onclick: selectAll, disabled: n === state.visibleIds.length }, 'Select all'),
    el('button', { class: 'btn btn-quiet-danger', type: 'button', title: 'Delete', onclick: removeSelected }, 'Remove…'),
    el('button', { class: 'icon-btn', type: 'button', title: 'Clear selection (Esc)', 'aria-label': 'Clear selection', onclick: clearSelection }, icon('x', 16)));
}

function cutSelection() {
  if (!state.selected.size) return;
  state.clipboard = { ids: [...state.selected] };
  state.selected.clear();
  renderMain();
  toast(`${plural(state.clipboard.ids.length, 'book')} ready to move. Open a folder (or Unsorted) and press Ctrl+V.`, { timeout: 6000 });
}

function paste() {
  if (!state.clipboard) return;
  const { view } = state;
  if (view !== 'unsorted' && typeof view !== 'number') {
    toast('Open a folder (or Unsorted) in the sidebar first, then press Ctrl+V to move the books there.', { type: 'warn', timeout: 6000 });
    return;
  }
  const ids = state.clipboard.ids.filter((id) => state.books.some((b) => b.id === id));
  state.clipboard = null;
  moveBooks(ids, view === 'unsorted' ? null : view);
}

async function removeSelected() {
  const books = [...state.selected].map((id) => state.books.find((b) => b.id === id)).filter(Boolean);
  if (!books.length) return;
  if (books.length === 1) return removeBook(books[0]);
  const { ok, checked } = await confirmDialog({
    title: `Remove ${plural(books.length, 'book')} from your library?`,
    message: 'Their reading progress and bookmarks will be removed too.\n\nThe PDF files stay on your PC unless you tick the box below.',
    checkbox: { label: 'Also delete these PDF files from my PC (they go to the Recycle Bin)' },
    confirmLabel: `Remove ${plural(books.length, 'book')}`,
    danger: true,
  });
  if (!ok) return;
  let removed = 0;
  for (const b of books) {
    try {
      await api.removeBook(b.id, checked && !b.missing);
      state.books = state.books.filter((x) => x.id !== b.id);
      removed++;
    } catch (err) { toast(`Couldn't remove “${b.title}”: ${err.message}`, { type: 'error' }); }
  }
  state.selected.clear();
  render();
  toast(`Removed ${plural(removed, 'book')}${checked ? ' and moved the files to the Recycle Bin' : ' (files kept)'}`);
}

async function renameBook(book) {
  const title = await promptDialog({ title: 'Rename book', label: 'Title', value: book.title, confirmLabel: 'Rename' });
  if (!title || title === book.title) return;
  try {
    replaceBook(await api.updateBook(book.id, { title }));
    render();
  } catch (err) { toast(err.message, { type: 'error' }); }
}

async function removeBook(book) {
  const { ok, checked } = await confirmDialog({
    title: 'Remove from library?',
    message: `“${book.title}” will be removed from your library, along with its reading progress and bookmarks.\n\nThe PDF file stays on your PC unless you tick the box below.`,
    checkbox: book.missing ? null : { label: 'Also delete the PDF file from my PC (it goes to the Recycle Bin)' },
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.removeBook(book.id, checked);
    state.books = state.books.filter((b) => b.id !== book.id);
    render();
    toast(checked ? `Removed “${book.title}” and moved the file to the Recycle Bin` : `Removed “${book.title}” from your library (file kept)`);
  } catch (err) { toast(err.message, { type: 'error' }); }
}

// ---------- folder actions ----------

async function createFolder() {
  const name = await promptDialog({ title: 'New folder', label: 'Folder name', placeholder: 'e.g. Programming, Philosophy, Finance', confirmLabel: 'Create' });
  if (!name) return null;
  try {
    const folder = await api.createFolder(name);
    state.folders = await api.folders();
    render();
    return folder;
  } catch (err) {
    toast(err.message, { type: 'error' });
    return null;
  }
}

async function renameFolder(folder) {
  const name = await promptDialog({ title: 'Rename folder', label: 'Folder name', value: folder.name, confirmLabel: 'Rename' });
  if (!name || name === folder.name) return;
  try {
    await api.renameFolder(folder.id, name);
    state.folders = await api.folders();
    render();
  } catch (err) { toast(err.message, { type: 'error' }); }
}

async function deleteFolder(folder) {
  const n = booksInView(folder.id).length;
  const { ok } = await confirmDialog({
    title: `Delete “${folder.name}”?`,
    message: n ? `The ${plural(n, 'book')} in this folder will move to Unsorted. No books or files are deleted.` : 'This folder is empty.',
    confirmLabel: 'Delete folder', danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteFolder(folder.id);
    if (state.view === folder.id) location.hash = '#all';
    await load();
  } catch (err) { toast(err.message, { type: 'error' }); }
}

// ---------- adding books (drag & drop + file picker) ----------

const isPdfFile = (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

function uploadItem(file) {
  const status = el('span', { class: 'upload-status' }, 'Waiting');
  const fill = el('span', { style: { width: '0%' } });
  const node = el('div', { class: 'upload-item' },
    el('div', { class: 'upload-row' }, el('span', { class: 'upload-name', title: file.name }, file.name), status),
    el('div', { class: 'bar' }, fill));
  $('uploadsList').append(node);
  return {
    progress(p) { fill.style.width = `${Math.round(p * 100)}%`; status.textContent = `${Math.round(p * 100)}%`; },
    status(text) { status.textContent = text; },
    ok(text) { node.className = 'upload-item ok'; fill.style.width = '100%'; status.textContent = text; },
    skip(text) { node.className = 'upload-item skipped'; status.textContent = text; },
    error(text) { node.className = 'upload-item error'; fill.style.width = '100%'; status.textContent = 'Failed'; node.title = text; },
  };
}

let uploading = false;
const uploadQueue = [];

async function addFiles(files, folderId = null) {
  const pdfs = files.filter(isPdfFile);
  const skipped = files.filter((f) => !isPdfFile(f)).map((f) => f.name);
  if (skipped.length) {
    const list = skipped.slice(0, 3).map((n) => `“${n}”`).join(', ') + (skipped.length > 3 ? ` and ${skipped.length - 3} more` : '');
    toast(skipped.length === 1
      ? `${list} isn't a PDF, so it was skipped. Only PDF files can be added.`
      : `${skipped.length} files aren't PDFs and were skipped: ${list}.`, { type: 'warn', timeout: 7000 });
  }
  if (!pdfs.length) return;

  $('uploads').hidden = false;
  clearTimeout(hidePanelTimer);
  for (const file of pdfs) uploadQueue.push({ file, folderId, item: uploadItem(file) });
  updateUploadTitle();
  if (!uploading) runUploads();
}

let hidePanelTimer = null;

function updateUploadTitle() {
  const n = uploadQueue.length;
  $('uploadsTitle').textContent = uploading || n ? `Adding ${plural(n + (uploading ? 1 : 0), 'book')}…` : 'Done';
}

async function runUploads() {
  uploading = true;
  let duplicateChoice = null; // remembered "do this for all" answer for this batch
  let errors = 0;
  while (uploadQueue.length) {
    const { file, folderId, item } = uploadQueue.shift();
    updateUploadTitle();
    try {
      item.status('Uploading…');
      let result = await api.uploadFile(file, folderId, (p) => item.progress(p * 0.97));
      if (result.status === 'duplicate') {
        item.status('Already in library');
        let choice = duplicateChoice;
        if (!choice) {
          const r = await openDialog({
            title: 'This book is already in your library',
            message: `“${file.name}” is the same file as “${result.existing.title}”.\n\nAdd another copy anyway?`,
            checkbox: uploadQueue.length ? { label: 'Do the same for other duplicates in this batch' } : null,
            actions: [{ label: 'Add anyway', value: 'add' }, { label: 'Skip', value: 'skip', primary: true }],
          });
          choice = r.value || 'skip';
          if (r.checked) duplicateChoice = choice;
        }
        if (choice !== 'add') {
          await api.cancelUpload(result.pendingId).catch(() => {});
          item.skip('Skipped (duplicate)');
          continue;
        }
        result = await api.confirmUpload(result.pendingId, folderId);
      }
      item.ok(result.status === 'relinked' ? 'Re-linked' : folderId != null ? `Added to ${folderLabel(folderId)}` : 'Added');
      replaceBook(result.book);
      render();
      requestCover(result.book, onCoverReady);
    } catch (err) {
      errors++;
      item.error(err.message);
      toast(`Couldn't add “${file.name}”: ${err.message}`, { type: 'error', timeout: 7000 });
    }
  }
  uploading = false;
  updateUploadTitle();
  if (!errors) hidePanelTimer = setTimeout(closeUploads, 5000);
}

function closeUploads() {
  if (uploading) return;
  $('uploads').hidden = true;
  $('uploadsList').replaceChildren();
}

function pickFiles() {
  $('filePicker').value = '';
  $('filePicker').click();
}

// Collect files from a drop, including PDFs inside dropped folders.
function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const plain = [...dt.files];
  if (!entries.some((e) => e.isDirectory)) return Promise.resolve(plain);
  const out = [];
  const readAll = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));
  async function walk(entry) {
    if (entry.isFile) out.push(await new Promise((res, rej) => entry.file(res, rej)));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (let batch = await readAll(reader); batch.length; batch = await readAll(reader)) {
        for (const child of batch) await walk(child);
      }
    }
  }
  return Promise.all(entries.map(walk)).then(() => out);
}

// ---------- drag & drop wiring ----------

let hoverTarget = null;
let dragEndTimer = null;

function dragKind(e) {
  const types = [...(e.dataTransfer?.types || [])];
  if (types.includes(BOOK_MIME)) return 'book';
  if (types.includes('Files')) return 'files';
  return null;
}

function dropTarget(node, kind) {
  const target = node?.closest?.('[data-drop-folder]');
  if (!target) return null;
  if (kind === 'book' && target.hasAttribute('data-files-only')) return null;
  return target;
}

const targetFolderId = (t) => (t.dataset.dropFolder === 'none' ? null : Number(t.dataset.dropFolder));

function setDropHover(target) {
  if (hoverTarget === target) return;
  hoverTarget?.classList.remove('drop-hover');
  hoverTarget = target;
  hoverTarget?.classList.add('drop-hover');
}

function endFileDrag() {
  $('dropOverlay').classList.remove('show');
  if (!document.body.classList.contains('dragging-book')) document.body.classList.remove('dragging');
  setDropHover(null);
}

document.addEventListener('dragover', (e) => {
  const kind = dragKind(e);
  if (!kind) return;
  e.preventDefault();
  const target = dropTarget(e.target, kind);
  setDropHover(target);
  if (kind === 'files') {
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('dragging');
    $('dropOverlay').classList.add('show');
    const name = target ? target.dataset.dropName
      : typeof state.view === 'number' ? folderLabel(state.view) : 'your library';
    $('dropLabel').textContent = name === 'your library' ? 'Drop PDFs to add them to your library' : `Drop PDFs to add them to “${name}”`;
    // dragover fires continuously while a drag is over the window; when it stops, the drag has left.
    clearTimeout(dragEndTimer);
    dragEndTimer = setTimeout(endFileDrag, 220);
  } else {
    e.dataTransfer.dropEffect = target ? 'move' : 'none';
  }
});

document.addEventListener('drop', (e) => {
  const kind = dragKind(e);
  if (!kind) return;
  e.preventDefault();
  const target = dropTarget(e.target, kind);
  clearTimeout(dragEndTimer);
  endFileDrag();
  if (kind === 'book') {
    const ids = e.dataTransfer.getData(BOOK_MIME).split(',').map(Number).filter(Boolean);
    if (target && ids.length) moveBooks(ids, targetFolderId(target));
    return;
  }
  const folderId = target ? targetFolderId(target) : typeof state.view === 'number' ? state.view : null;
  filesFromDrop(e.dataTransfer)
    .then((files) => addFiles(files, folderId))
    .catch((err) => toast(`Couldn't read the dropped files: ${err.message}`, { type: 'error' }));
});

// ---------- settings ----------

async function openSettings() {
  let s;
  try { s = await api.settings(); } catch (err) { return toast(err.message, { type: 'error' }); }
  const scan = s.lastScan && !s.lastScan.error
    ? `Last scan ${relativeTime(s.lastScan.finishedAt)}: ${s.lastScan.added} added, ${s.lastScan.missing} missing.` : '';
  const r = await openDialog({
    title: 'Settings',
    message: 'Books you add are copied into this folder. Any PDFs you put in it yourself (including in subfolders) are picked up when Shelf starts.',
    body: el('div', { class: 'field-label' }, el('p', { class: 'hint' }, `Default: ${s.defaultBooksDir}`), scan ? el('p', { class: 'hint' }, scan) : null),
    input: { label: 'Books folder', value: s.booksDir, placeholder: s.defaultBooksDir, maxlength: 400 },
    actions: [
      { label: 'Rescan folder now', value: 'rescan' },
      { label: 'Cancel', value: null },
      { label: 'Save', value: 'save', primary: true },
    ],
  });
  try {
    if (r.value === 'rescan') {
      await api.rescan();
      toast('Scanning your books folder…');
      setTimeout(load, 300);
    } else if (r.value === 'save' && r.input.trim() !== s.booksDir) {
      const res = await api.saveSettings({ booksDir: r.input.trim() });
      toast(`Books folder set to ${res.booksDir}`);
      setTimeout(load, 300);
    }
  } catch (err) { toast(err.message, { type: 'error', timeout: 8000 }); }
}

// ---------- startup ----------

function renderThemeButton() {
  $('themeBtn').replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
}

applyTheme();
hydrateIcons();
renderThemeButton();
$('sort').value = state.sort;

$('themeBtn').addEventListener('click', () => { toggleTheme(); renderThemeButton(); });
$('settingsBtn').addEventListener('click', openSettings);
$('addBtn').addEventListener('click', pickFiles);
$('filePicker').addEventListener('change', (e) => {
  addFiles([...e.target.files], typeof state.view === 'number' ? state.view : null);
});
$('uploadsClose').addEventListener('click', closeUploads);
$('search').addEventListener('input', (e) => { state.search = e.target.value; renderMain(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; setPref('sort', state.sort); renderMain(); });
window.addEventListener('hashchange', () => {
  state.view = parseHash();
  state.selected.clear();   // the cut "clipboard" survives, so you can paste in the folder you just opened
  state.anchor = null;
  render();
  $('main').scrollTop = 0;
});

// Clicking empty space in the library clears the selection.
$('main').addEventListener('click', (e) => {
  if (!e.target.closest('.card, .resume, button, a, .dupe-group')) clearSelection();
});

document.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('focus-locked')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (document.querySelector('dialog[open], .menu')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const inGrid = state.view !== 'duplicates';
  if (key === '/' && !ctrl) { e.preventDefault(); $('search').focus(); }
  else if (ctrl && key === 'a' && inGrid) { e.preventDefault(); selectAll(); }
  else if (ctrl && (key === 'x' || key === 'c') && state.selected.size) { e.preventDefault(); cutSelection(); }
  else if (ctrl && key === 'v' && state.clipboard) { e.preventDefault(); paste(); }
  else if (key === 'escape') {
    if (!clearSelection() && state.clipboard) { state.clipboard = null; renderMain(); }
  } else if (key === 'delete' && state.selected.size) { e.preventDefault(); removeSelected(); }
});

// While a focus session runs, the library is covered by a lock screen.
async function checkFocusLock() {
  if (document.body.classList.contains('focus-locked')) return;
  try {
    const focus = await loadFocus();
    if (focus.session) showLibraryLock(focus, load);
  } catch { /* server unreachable: load() already reports it */ }
}

// Refresh progress (and the focus lock) when coming back from the reader or another tab.
window.addEventListener('pageshow', (e) => { if (e.persisted) { load(); checkFocusLock(); } });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { load(); checkFocusLock(); }
});

checkFocusLock();
load();
