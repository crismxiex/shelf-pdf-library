// Focus mode: a timed reading session that locks Shelf to one book.
// The session is stored on the server, so it survives closing the tab or restarting the browser.
import { api } from './api.js';
import { el, icon, openDialog, toast } from './ui.js';

const pad = (n) => String(n).padStart(2, '0');

export function formatRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Returns { session | null, phrase, offset } where offset corrects for clock differences with the server. */
export async function loadFocus() {
  const r = await api.focus();
  return { session: r.session, phrase: r.phrase, offset: Date.parse(r.serverTime) - Date.now() };
}

export const remainingMs = (focus) => Date.parse(focus.session.endsAt) - (Date.now() + focus.offset);
export const sessionMinutes = (s) => Math.round((Date.parse(s.endsAt) - Date.parse(s.startedAt)) / 60000);

/** Asks for the unlock phrase. Resolves true if the session was ended. */
export async function askToEndEarly(phrase) {
  const pending = openDialog({
    title: 'End the focus session early?',
    message: `To unlock Shelf before the timer runs out, type ${phrase} exactly. Pasting is turned off.`,
    input: { label: 'Unlock phrase', placeholder: 'Type the phrase', maxlength: 100 },
    actions: [{ label: 'Keep reading', value: false }, { label: 'End session', value: true, primary: true, danger: true }],
  });
  const input = document.querySelector('dialog[open] input');
  if (input) {
    input.autocomplete = 'off';
    input.spellcheck = false;
    for (const type of ['paste', 'drop']) {
      input.addEventListener(type, (e) => { e.preventDefault(); toast('Pasting is turned off here. Type the phrase.'); });
    }
  }
  const r = await pending;
  if (!r.value) return false;
  try {
    await api.endFocus(r.input);
    return true;
  } catch (err) {
    toast(err.message, { type: 'error' });
    return false;
  }
}

/** Full-screen lock over the library while a session runs. */
export function showLibraryLock(focus, onUnlocked) {
  const { session } = focus;
  const time = el('div', { class: 'focus-lock-time' }, formatRemaining(remainingMs(focus)));
  const overlay = el('div', { class: 'focus-lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Focus session in progress' },
    el('div', { class: 'focus-lock-card' },
      el('span', { class: 'focus-lock-icon' }, icon('lock', 28)),
      el('h2', {}, 'Focus session in progress'),
      el('p', {}, 'You’re reading ', el('strong', {}, `“${session.title}”`), '. The library unlocks when the timer runs out.'),
      time,
      el('a', { class: 'btn btn-primary', href: `/reader.html?id=${session.bookId}` }, 'Back to reading'),
      el('button', {
        class: 'btn btn-link', type: 'button',
        onclick: async () => { if (await askToEndEarly(focus.phrase)) unlock('Focus session ended early.'); },
      }, 'End early…')));

  document.body.append(overlay);
  document.body.classList.add('focus-locked');
  const timer = setInterval(() => {
    const ms = remainingMs(focus);
    time.textContent = formatRemaining(ms);
    if (ms <= 0) {
      api.endFocus('').catch(() => {});
      unlock('Focus session complete. Nice work!');
    }
  }, 1000);

  function unlock(message) {
    clearInterval(timer);
    overlay.remove();
    document.body.classList.remove('focus-locked');
    toast(message);
    onUnlocked?.();
  }
}
