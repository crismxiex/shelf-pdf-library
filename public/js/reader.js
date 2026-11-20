// Reader: PDF.js viewer with automatic, server-side progress saving and bookmarks.
import * as pdfjsLib from '/vendor/pdfjs/build/pdf.mjs';
import { api } from './api.js';
import {
  el, icon, hydrateIcons, applyTheme, toggleTheme, currentTheme, toast, openDialog, promptDialog,
  confirmDialog, relativeTime,
} from './ui.js';
import { loadFocus, remainingMs, formatRemaining, askToEndEarly, sessionMinutes } from './focus.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs';
// pdf_viewer.mjs reads globalThis.pdfjsLib, so it must load after pdf.mjs.
const pdfjsViewer = await import('/vendor/pdfjs/web/pdf_viewer.mjs');

const $ = (id) => document.getElementById(id);
const SAVE_DELAY_MS = 1200;
const PRESET_ZOOMS = ['page-width', 'page-fit', 'auto'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const bookId = Number(new URLSearchParams(location.search).get('id'));
const container = $('viewerContainer');
const eventBus = new pdfjsViewer.EventBus();
const linkService = new pdfjsViewer.PDFLinkService({ eventBus });
const viewer = new pdfjsViewer.PDFViewer({ container, viewer: $('viewer'), eventBus, linkService });
linkService.setViewer(viewer);

let book = null;
let pageCount = 0;
let ready = false;          // true once the saved position has been restored
let userMoved = false;      // the reader has scrolled/zoomed since opening
let dirty = false;          // unsaved progress
let saveTimer = null;
let bookmarks = [];

// ---------- position & saving ----------

function currentPosition() {
  const page = viewer.currentPageNumber || 1;
  const div = viewer.getPageView(page - 1)?.div;
  let ratio = 0;
  if (div?.clientHeight) ratio = (container.scrollTop - div.offsetTop) / div.clientHeight;
  return {
    page,
    scrollRatio: Math.round(clamp(ratio, -1, 2) * 10000) / 10000,
    zoom: String(viewer.currentScaleValue),
    pageCount,
  };
}

function restorePosition(page, ratio = 0) {
  page = clamp(Math.round(page) || 1, 1, pageCount || 1);
  const div = viewer.getPageView(page - 1)?.div;
  if (!div) { viewer.currentPageNumber = page; return; }
  container.scrollTop = div.offsetTop + ratio * div.clientHeight;
}

// Run a layout-changing action (zoom, resize) while keeping the reading position.
function keepPosition(fn) {
  const pos = currentPosition();
  fn();
  restorePosition(pos.page, pos.scrollRatio);
}

function setSaveState(text) { $('saveState').textContent = text; }

function scheduleSave() {
  if (!ready) return;
  userMoved = true;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  try {
    await api.saveProgress(bookId, currentPosition());
    setSaveState(`Progress saved · page ${viewer.currentPageNumber}`);
  } catch {
    dirty = true;
    setSaveState('Not saved yet – retrying…');
    saveTimer = setTimeout(saveNow, 5000);
  }
}

// When the tab is closed or hidden, send the last position with sendBeacon (survives page unload).
function saveOnExit() {
  if (!ready || !dirty) return;
  clearTimeout(saveTimer);
  const body = new Blob([JSON.stringify(currentPosition())], { type: 'application/json' });
  if (navigator.sendBeacon(`/api/books/${bookId}/progress`, body)) dirty = false;
}

window.addEventListener('pagehide', saveOnExit);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveOnExit(); });

// ---------- UI updates ----------

function updatePageUi() {
  const page = viewer.currentPageNumber || 1;
  if (document.activeElement !== $('pageInput')) $('pageInput').value = page;
  $('prevBtn').disabled = page <= 1;
  $('nextBtn').disabled = page >= pageCount;
  const pct = pageCount ? (page >= pageCount ? 100 : ((page - 1) / pageCount) * 100) : 0;
  $('progressLine').firstElementChild.style.width = `${pct}%`;
  $('progressLine').title = `${Math.round(pct)}% read`;
  const marked = bookmarks.some((b) => b.page === page);
  $('bookmarkBtn').classList.toggle('active', marked);
  $('bookmarkBtn').title = marked ? 'This page is bookmarked (B)' : 'Bookmark this page (B)';
  document.querySelectorAll('.bm').forEach((n) => n.classList.toggle('current', Number(n.dataset.page) === page));
}

function updateZoomUi(scale, preset) {
  const select = $('zoomSelect');
  const custom = select.querySelector('option[value="custom"]');
  const value = PRESET_ZOOMS.includes(preset) ? preset : String(Math.round(scale * 100) / 100);
  if ([...select.options].some((o) => o.value === value && o !== custom)) {
    custom.hidden = true;
    select.value = value;
  } else {
    custom.hidden = false;
    custom.textContent = `${Math.round(scale * 100)}%`;
    select.value = 'custom';
  }
}

function renderToggleIcons() {
  $('darkBtn').replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
  $('fullBtn').replaceChildren(icon(document.fullscreenElement ? 'shrink' : 'expand'));
}

function showError(title, detail) {
  $('loadError').hidden = false;
  $('loadError').replaceChildren(
    el('h2', {}, title),
    detail ? el('p', {}, detail) : null,
    el('a', { class: 'btn btn-primary', href: '/' }, 'Back to library'));
  $('bookTitle').textContent = title;
}

// ---------- navigation ----------

function goToPage(n) {
  if (!pageCount) return;
  viewer.currentPageNumber = clamp(Math.round(n) || 1, 1, pageCount);
  container.focus({ preventScroll: true });
}

function setZoom(value) {
  keepPosition(() => {
    if (PRESET_ZOOMS.includes(value)) viewer.currentScaleValue = value;
    else viewer.currentScale = clamp(Number(value) || 1, 0.25, 5);
  });
  scheduleSave();
}

function zoomBy(factor) {
  setZoom(String(Math.round(clamp(viewer.currentScale * factor, 0.25, 5) * 100) / 100));
}

// Re-fit "Fit width"/"Fit page" when the window or the panel changes size.
let refitTimer = null;
function refit() {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(() => {
    const value = String(viewer.currentScaleValue);
    if (PRESET_ZOOMS.includes(value)) keepPosition(() => { viewer.currentScaleValue = value; });
  }, 80);
}
window.addEventListener('resize', refit);

// ---------- bookmarks ----------

async function loadBookmarks() {
  try { bookmarks = await api.bookmarks(bookId); } catch { bookmarks = []; }
  renderBookmarks();
}

function renderBookmarks() {
  const list = $('bookmarkList');
  if (!bookmarks.length) {
    list.replaceChildren(el('div', { class: 'bm-empty' }, 'No bookmarks yet. Press B or click the bookmark button to mark the current page.'));
  } else {
    list.replaceChildren(...bookmarks.map((bm) => el('div', {
      class: 'bm', tabindex: '0', dataset: { page: bm.page },
      onclick: () => goToPage(bm.page),
      onkeydown: (e) => { if (e.key === 'Enter') goToPage(bm.page); },
    },
    el('span', { class: 'bm-page' }, `Page ${bm.page}`),
    el('span', { class: `bm-note ${bm.note ? '' : 'empty'}` }, bm.note || 'No note'),
    el('span', { class: 'bm-date' }, relativeTime(bm.createdAt)),
    el('div', { class: 'bm-actions' },
      el('button', { class: 'icon-btn', type: 'button', title: 'Edit note', 'aria-label': 'Edit note',
        onclick: (e) => { e.stopPropagation(); editBookmark(bm); } }, icon('edit', 15)),
      el('button', { class: 'icon-btn', type: 'button', title: 'Delete bookmark', 'aria-label': 'Delete bookmark',
        onclick: (e) => { e.stopPropagation(); deleteBookmark(bm); } }, icon('trash', 15))))));
  }
  updatePageUi();
}

async function addBookmark() {
  if (!pageCount) return;
  const page = viewer.currentPageNumber;
  if (bookmarks.some((b) => b.page === page)) {
    setPanel(true);
    toast(`Page ${page} is already bookmarked. You can edit or delete it in the list.`);
    return;
  }
  const r = await openDialog({
    title: `Bookmark page ${page}`,
    input: { label: 'Note (optional)', placeholder: 'e.g. Great explanation of closures', maxlength: 500 },
    actions: [{ label: 'Cancel', value: false }, { label: 'Add bookmark', value: true, primary: true }],
  });
  if (!r.value) return;
  try {
    await api.addBookmark(bookId, page, r.input.trim());
    await loadBookmarks();
    toast(`Bookmarked page ${page}`);
  } catch (err) { toast(err.message, { type: 'error' }); }
}

async function editBookmark(bm) {
  const note = await promptDialog({ title: `Note for page ${bm.page}`, label: 'Note', value: bm.note, placeholder: 'Optional note' });
  if (note === null) return;
  try { await api.updateBookmark(bm.id, note); await loadBookmarks(); } catch (err) { toast(err.message, { type: 'error' }); }
}

async function deleteBookmark(bm) {
  const { ok } = await confirmDialog({ title: 'Delete bookmark?', message: `Page ${bm.page}${bm.note ? ` – “${bm.note}”` : ''}`, confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  try { await api.deleteBookmark(bm.id); await loadBookmarks(); } catch (err) { toast(err.message, { type: 'error' }); }
}

function setPanel(open) {
  $('panel').hidden = !open;
  document.body.classList.toggle('panel-open', open);
  $('panelBtn').classList.toggle('active', open);
  try { localStorage.setItem('shelf.bookmarksPanel', open ? '1' : '0'); } catch { /* ignore */ }
  refit();
}

// ---------- focus mode ----------

let focus = null;          // { session, phrase, offset } while a session runs
let focusTimer = null;

const leaveGuard = (e) => { e.preventDefault(); e.returnValue = ''; };

function enterFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
}

function updateFsBanner() {
  $('fsBanner').hidden = !(focus && !document.fullscreenElement);
}

function enterFocusUi() {
  document.body.classList.add('focus-mode');
  $('focusPill').hidden = false;
  window.addEventListener('beforeunload', leaveGuard);
  const tick = () => {
    const ms = remainingMs(focus);
    $('focusTime').textContent = `${formatRemaining(ms)} left`;
    if (ms <= 0) completeFocus();
  };
  tick();
  focusTimer = setInterval(tick, 1000);
  updateFsBanner();
}

function exitFocusUi() {
  clearInterval(focusTimer);
  focus = null;
  document.body.classList.remove('focus-mode');
  $('focusPill').hidden = true;
  window.removeEventListener('beforeunload', leaveGuard);
  updateFsBanner();
}

async function completeFocus() {
  const { session } = focus;
  exitFocusUi();
  api.endFocus('').catch(() => {});
  await saveNow();
  const pages = session.startPage ? viewer.currentPageNumber - session.startPage : 0;
  openDialog({
    title: 'Focus session complete',
    message: `Nice work: ${sessionMinutes(session)} ${sessionMinutes(session) === 1 ? 'minute' : 'minutes'} on “${session.title || book.title}”` +
      (pages > 0 ? `, ${pages} ${pages === 1 ? 'page' : 'pages'} further.` : '.') + '\n\nShelf is unlocked.',
    actions: [{ label: 'Done', value: true, primary: true }],
  });
}

async function startFocus() {
  if (focus || !pageCount) return;
  const chips = el('div', { class: 'chips' }, [15, 25, 45, 60, 90].map((m) => el('button', {
    class: 'chip', type: 'button',
    onclick: (e) => { const input = e.target.closest('form').querySelector('input'); input.value = m; input.focus(); },
  }, `${m} min`)));
  let phrase = 'IWANTTOENDSESSION';
  try { phrase = (await loadFocus()).phrase; } catch { /* use the default text */ }
  const r = await openDialog({
    title: 'Start a focus session',
    message: `Shelf goes full screen and stays locked to this book until the timer runs out. ` +
      `Leaving the page asks for confirmation, and the library stays locked even if you close the tab.\n\n` +
      `To stop early you'll have to type ${phrase}.`,
    body: chips,
    input: { label: 'Minutes', value: '25', maxlength: 3 },
    actions: [{ label: 'Cancel', value: false }, { label: 'Start focus', value: true, primary: true }],
  });
  if (!r.value) return;
  const minutes = Number(String(r.input).replace(',', '.'));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
    toast('Enter a number of minutes between 1 and 600.', { type: 'error' });
    return;
  }
  enterFullscreen();   // must happen right after the click, before any waiting
  try {
    await api.startFocus(bookId, minutes, viewer.currentPageNumber);
    focus = await loadFocus();
    enterFocusUi();
    toast(`Focus session started: ${minutes} minutes. Happy reading.`);
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

/** Returns false if this page is redirecting to the book a running session is locked to. */
async function resumeFocusIfRunning() {
  let f;
  try { f = await loadFocus(); } catch { return true; }
  if (!f.session) return true;
  if (f.session.bookId !== bookId) {
    location.replace(`/reader.html?id=${f.session.bookId}`);
    return false;
  }
  focus = f;
  enterFocusUi();
  return true;
}

$('focusBtn').addEventListener('click', startFocus);
$('focusEnd').addEventListener('click', async () => {
  if (focus && await askToEndEarly(focus.phrase)) {
    exitFocusUi();
    toast('Focus session ended early. Shelf is unlocked.');
  }
});
$('fsReturn').addEventListener('click', enterFullscreen);

// ---------- events ----------

eventBus.on('pagechanging', () => { updatePageUi(); scheduleSave(); });
eventBus.on('scalechanging', (e) => updateZoomUi(e.scale, e.presetValue));
container.addEventListener('scroll', scheduleSave, { passive: true });

$('prevBtn').addEventListener('click', () => goToPage(viewer.currentPageNumber - 1));
$('nextBtn').addEventListener('click', () => goToPage(viewer.currentPageNumber + 1));
$('pageForm').addEventListener('submit', (e) => {
  e.preventDefault();
  goToPage(parseInt($('pageInput').value, 10));
  $('pageInput').blur();
});
$('pageInput').addEventListener('focus', () => $('pageInput').select());
$('pageInput').addEventListener('blur', updatePageUi);
$('zoomSelect').addEventListener('change', (e) => { if (e.target.value !== 'custom') setZoom(e.target.value); });
$('zoomIn').addEventListener('click', () => zoomBy(1.15));
$('zoomOut').addEventListener('click', () => zoomBy(1 / 1.15));
$('fitWidth').addEventListener('click', () => setZoom('page-width'));
$('bookmarkBtn').addEventListener('click', addBookmark);
$('panelAdd').addEventListener('click', addBookmark);
$('panelBtn').addEventListener('click', () => setPanel($('panel').hidden));
$('panelClose').addEventListener('click', () => setPanel(false));
$('darkBtn').addEventListener('click', () => { toggleTheme(); renderToggleIcons(); });
$('fullBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => toast('Full screen is not available here.'));
});
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
  renderToggleIcons();
  updateFsBanner();
  refit();
});
document.addEventListener('mousemove', (e) => {
  if (document.fullscreenElement) document.body.classList.toggle('show-bar', e.clientY < 64);
});

// Save before going back so the library shows up-to-date progress immediately.
document.querySelector('.rbar-left a').addEventListener('click', async (e) => {
  if (!dirty) return;
  e.preventDefault();
  await saveNow();
  location.href = '/';
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const page = viewer.currentPageNumber;
  switch (e.key) {
    case 'ArrowRight': goToPage(page + 1); break;
    case 'ArrowLeft': goToPage(page - 1); break;
    case 'Home': goToPage(1); break;
    case 'End': goToPage(pageCount); break;
    case '+': case '=': zoomBy(1.15); break;
    case '-': case '_': zoomBy(1 / 1.15); break;
    case 'w': case 'W': setZoom('page-width'); break;
    case 'b': case 'B': addBookmark(); break;
    case 'd': case 'D': toggleTheme(); renderToggleIcons(); break;
    case 'f': case 'F': $('fullBtn').click(); break;
    default: return;
  }
  e.preventDefault();
});

// ---------- startup ----------

async function init() {
  applyTheme();
  hydrateIcons();
  renderToggleIcons();

  if (!Number.isInteger(bookId) || bookId < 1) return showError('No book selected');
  // A running focus session locks Shelf to its book.
  if (!(await resumeFocusIfRunning())) return;
  try {
    book = await api.book(bookId);
  } catch (err) {
    return showError('Book not found', err.message);
  }
  $('bookTitle').textContent = book.title;
  $('bookTitle').title = book.title;
  document.title = `${book.title} · Shelf`;
  api.openBook(bookId).catch(() => {});

  let doc;
  try {
    const task = pdfjsLib.getDocument({
      url: `/api/books/${bookId}/file`,
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
    });
    task.onPassword = async (updatePassword, reason) => {
      const pw = await promptDialog({
        title: reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? 'Wrong password, try again' : 'This PDF is password-protected',
        label: 'Password', confirmLabel: 'Open',
      });
      if (pw === null) task.destroy(); else updatePassword(pw);
    };
    doc = await task.promise;
  } catch (err) {
    return showError("Couldn't open this PDF", book.missing ? `The file was not found at: ${book.filePath}` : err.message);
  }

  pageCount = doc.numPages;
  $('pageCount').textContent = pageCount;
  $('pageInput').setAttribute('aria-label', `Page number, 1 to ${pageCount}`);

  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = book.zoom || 'page-width';
    restorePosition(book.page || 1, book.scrollRatio || 0);
    updatePageUi();
    if (book.page > 1) setSaveState(`Resumed at page ${book.page}`);
    // Ignore the scroll events caused by restoring, then start tracking.
    setTimeout(() => { ready = true; }, 300);
    container.focus({ preventScroll: true });
  }, { once: true });

  // Pages of different sizes are measured after the first render; re-apply the position once.
  eventBus.on('pagesloaded', () => {
    if (!userMoved) restorePosition(book.page || 1, book.scrollRatio || 0);
  }, { once: true });

  viewer.setDocument(doc);
  linkService.setDocument(doc, null);

  let panelPref = '0';
  try { panelPref = localStorage.getItem('shelf.bookmarksPanel') || '0'; } catch { /* ignore */ }
  if (panelPref === '1' && innerWidth > 900) setPanel(true);
  await loadBookmarks();
}

init();
