// Renders page 1 of a PDF into a JPEG thumbnail with PDF.js and caches it on the server.
// Doing this in the browser means the Windows setup needs no native image libraries.
// While the PDF is open, it also reads the book's real title from the file's metadata.
import * as pdfjsLib from '/vendor/pdfjs/build/pdf.mjs';
import { api } from './api.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs';

const COVER_WIDTH = 360;
const queue = [];
const queued = new Set();
let busy = false;

const needsCover = (book) => book.coverStatus === 0;
const needsTitle = (book) => !book.metaChecked;

/**
 * Queue a book whose cover and/or embedded title haven't been processed yet.
 * onDone(updatedBook | null) is called when finished.
 */
export function requestCover(book, onDone) {
  if (queued.has(book.id) || book.missing || !(needsCover(book) || needsTitle(book))) return;
  queued.add(book.id);
  // Covers first: they're what you see. Title-only lookups are quick and can wait.
  const job = { book, onDone };
  if (needsCover(book)) queue.unshift(job); else queue.push(job);
  pump();
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const { book, onDone } = queue.shift();
    let updated = null;
    try {
      updated = await processBook(book);
    } catch (err) {
      console.warn(`Processing book ${book.id} failed:`, err);
      // Record the failure so it isn't retried on every visit.
      updated = await api.updateBook(book.id, { coverFailed: needsCover(book), pdfTitles: [] }).catch(() => null);
    }
    queued.delete(book.id);
    onDone?.(updated);
  }
  busy = false;
}

async function readTitles(doc) {
  try {
    const { info, metadata } = await doc.getMetadata();
    return [metadata?.get?.('dc:title'), info?.Title].filter((t) => typeof t === 'string');
  } catch {
    return [];
  }
}

async function processBook(book) {
  const task = pdfjsLib.getDocument({
    url: `/api/books/${book.id}/file`,
    disableAutoFetch: true,   // only download the parts that are needed
    cMapUrl: '/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
  });
  const doc = await task.promise;
  try {
    let updated = null;
    if (needsCover(book)) updated = await uploadCover(book.id, doc);
    if (needsTitle(book)) updated = await api.updateBook(book.id, { pdfTitles: await readTitles(doc), pageCount: doc.numPages });
    return updated;
  } finally {
    doc.destroy();
  }
}

async function uploadCover(id, doc) {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  return api.uploadCover(id, blob, doc.numPages);
}
