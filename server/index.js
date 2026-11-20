'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const express = require('express');
const multer = require('multer');

const config = require('./config');
config.load();
const { db, now } = require('./db');
const scanner = require('./scanner');

const { COVERS_DIR, TMP_DIR, ROOT } = config;
fs.mkdirSync(COVERS_DIR, { recursive: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/vendor/pdfjs', express.static(path.dirname(require.resolve('pdfjs-dist/package.json')), { maxAge: '7d' }));

// ---------- helpers ----------

const BOOK_SELECT = `
  SELECT b.id, b.title, b.file_path AS filePath, b.file_size AS fileSize, b.page_count AS pageCount,
         b.folder_id AS folderId, b.cover_status AS coverStatus, b.added_at AS addedAt,
         b.last_opened_at AS lastOpenedAt, b.missing, b.meta_checked AS metaChecked,
         p.page, p.scroll_ratio AS scrollRatio, p.zoom, p.updated_at AS progressUpdatedAt,
         (SELECT COUNT(*) FROM bookmarks bm WHERE bm.book_id = b.id) AS bookmarkCount
  FROM books b LEFT JOIN progress p ON p.book_id = b.id`;

const getBook = (id) => db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(id);
const rawBook = (id) => db.prepare('SELECT * FROM books WHERE id = ?').get(id);
const coverPath = (id) => path.join(COVERS_DIR, `${id}.jpg`);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function intParam(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `Invalid ${name}.`);
  return n;
}

function requireBook(req) {
  const id = intParam(req.params.id);
  const book = rawBook(id);
  if (!book) throw new HttpError(404, 'Book not found.');
  return book;
}

function parseFolderId(value) {
  if (value === undefined || value === null || value === '' || value === 'none' || value === 'null') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(id)) {
    throw new HttpError(400, 'That folder no longer exists.');
  }
  return id;
}

function cleanFileName(name) {
  let base = path.basename(String(name || 'book.pdf'))
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!/\.pdf$/i.test(base)) base += '.pdf';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base)) base = '_' + base;
  if (base.length > 180) base = base.slice(0, 176) + '.pdf';
  return base;
}

// Many PDFs carry junk titles ("Microsoft Word - draft.docx", "Untitled", an ISBN). Reject those.
function cleanPdfTitle(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim().replace(/^Microsoft (Word|PowerPoint|Excel) - /i, '');
  // A file name ("draft.docx", "ch01 final.indd") is not a real title.
  if (/\.(pdf|docx?|indd|tex|dvi|pptx?|odt|rtf|qxd|fm|txt|xlsx?)$/i.test(t)) return null;
  if (t.length < 3 || t.length > 250) return null;
  if (/^(untitled|title|unknown|document|book|none|null|cover|layout \d*)$/i.test(t)) return null;
  if (/^[\d\s\-_.:]+$/.test(t)) return null;              // only digits (e.g. an ISBN)
  if (!/\p{L}/u.test(t)) return null;                     // must contain letters
  return t;
}

function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, -ext.length);
  let candidate = path.join(dir, fileName);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

async function moveFile(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(from, to);
    await fsp.unlink(from);
  }
}

const safeUnlink = (p) => fsp.unlink(p).catch(() => {});

// Sends a file to the Windows Recycle Bin (falls back to a normal delete on other systems).
function moveToRecycleBin(file) {
  if (process.platform !== 'win32') return fsp.unlink(file);
  const script = "Add-Type -AssemblyName Microsoft.VisualBasic; " +
    "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:SHELF_DELETE_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')";
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, SHELF_DELETE_PATH: file }, windowsHide: true },
      (err, _out, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve()));
  });
}

// ---------- status & settings ----------

app.get('/api/health', (_req, res) => res.json({ app: 'shelf', ok: true }));

app.get('/api/settings', (_req, res) => {
  res.json({
    booksDir: config.booksDir(),
    defaultBooksDir: config.defaultBooksDir(),
    usingDefault: !config.get().booksDir,
    port: config.get().port,
    lastScan: scanner.state.lastResult,
  });
});

app.put('/api/settings', async (req, res) => {
  const requested = String(req.body.booksDir ?? '').trim().replace(/^"(.*)"$/, '$1');
  const target = requested ? path.resolve(requested) : config.defaultBooksDir();
  if (requested && !path.isAbsolute(requested)) {
    throw new HttpError(400, 'Please enter a full folder path, for example C:\\Users\\you\\Documents\\Books');
  }
  try {
    await fsp.mkdir(target, { recursive: true });
  } catch (err) {
    throw new HttpError(400, `Can't use that folder: ${err.message}`);
  }
  config.save({ ...config.get(), booksDir: requested ? target : '' });
  scanner.scan();
  res.json({ booksDir: config.booksDir(), scanning: true });
});

app.post('/api/rescan', (_req, res) => {
  scanner.scan();
  res.json({ scanning: true });
});

// ---------- books ----------

app.get('/api/books', (_req, res) => {
  res.json({
    books: db.prepare(`${BOOK_SELECT} ORDER BY b.title COLLATE NOCASE`).all(),
    scanning: Boolean(scanner.state.running),
  });
});

app.get('/api/books/:id', (req, res) => {
  const book = requireBook(req);
  res.json(getBook(book.id));
});

app.patch('/api/books/:id', (req, res) => {
  const book = requireBook(req);
  const body = req.body || {};
  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, 300);
    if (!title) throw new HttpError(400, 'Title cannot be empty.');
    db.prepare('UPDATE books SET title = ?, title_custom = 1 WHERE id = ?').run(title, book.id);
  }
  if (Array.isArray(body.pdfTitles)) {
    // Titles found inside the PDF (XMP dc:title, then the Info dictionary). Use the first sensible
    // one, unless you have renamed the book yourself.
    const pdfTitle = body.pdfTitles.map(cleanPdfTitle).find(Boolean);
    const current = rawBook(book.id);
    if (pdfTitle && !current.title_custom) db.prepare('UPDATE books SET title = ? WHERE id = ?').run(pdfTitle, book.id);
    db.prepare('UPDATE books SET meta_checked = 1 WHERE id = ?').run(book.id);
  }
  if (body.folderId !== undefined) {
    db.prepare('UPDATE books SET folder_id = ? WHERE id = ?').run(parseFolderId(body.folderId), book.id);
  }
  if (body.pageCount !== undefined) {
    const n = Number(body.pageCount);
    if (Number.isInteger(n) && n > 0) db.prepare('UPDATE books SET page_count = ? WHERE id = ?').run(n, book.id);
  }
  if (body.coverFailed) db.prepare('UPDATE books SET cover_status = -1 WHERE id = ?').run(book.id);
  res.json(getBook(book.id));
});

app.delete('/api/books/:id', async (req, res) => {
  const book = requireBook(req);
  const deleteFile = req.query.deleteFile === '1';
  if (deleteFile && fs.existsSync(book.file_path)) {
    try {
      await moveToRecycleBin(book.file_path);
    } catch (err) {
      throw new HttpError(500, `Couldn't delete the file: ${err.message}`);
    }
  } else if (!deleteFile) {
    // Remember it so the startup scan doesn't add it straight back.
    db.prepare('INSERT OR REPLACE INTO ignored_files (file_hash, file_path, removed_at) VALUES (?, ?, ?)')
      .run(book.file_hash, book.file_path, now());
  }
  db.prepare('DELETE FROM books WHERE id = ?').run(book.id);
  await safeUnlink(coverPath(book.id));
  res.json({ ok: true, fileDeleted: deleteFile });
});

// The PDF itself. sendFile supports HTTP range requests, so PDF.js can load big books page by page.
app.get('/api/books/:id/file', (req, res) => {
  const book = requireBook(req);
  if (!fs.existsSync(book.file_path)) {
    db.prepare('UPDATE books SET missing = 1 WHERE id = ?').run(book.id);
    throw new HttpError(404, `The file is missing: ${book.file_path}`);
  }
  res.sendFile(book.file_path, {
    dotfiles: 'allow',
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-cache' },
  });
});

app.get('/api/books/:id/cover', (req, res) => {
  const id = intParam(req.params.id);
  const file = coverPath(id);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } });
});

// Covers are rendered in the browser with PDF.js (no native image libraries needed on Windows)
// and cached here on the server.
app.post('/api/books/:id/cover', express.raw({ type: ['image/jpeg', 'image/png'], limit: '10mb' }), async (req, res) => {
  const book = requireBook(req);
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw new HttpError(400, 'No image received.');
  await fsp.writeFile(coverPath(book.id), req.body);
  const pages = Number(req.query.pages);
  db.prepare('UPDATE books SET cover_status = 1, page_count = COALESCE(?, page_count) WHERE id = ?')
    .run(Number.isInteger(pages) && pages > 0 ? pages : null, book.id);
  res.json(getBook(book.id));
});

app.post('/api/books/:id/open', (req, res) => {
  const book = requireBook(req);
  db.prepare('UPDATE books SET last_opened_at = ? WHERE id = ?').run(now(), book.id);
  res.json({ ok: true });
});

// Called by the reader (debounced) and via navigator.sendBeacon when the tab closes.
app.post('/api/books/:id/progress', (req, res) => {
  const book = requireBook(req);
  const body = req.body || {};
  const page = intParam(body.page, 'page');
  let ratio = Number(body.scrollRatio);
  if (!Number.isFinite(ratio)) ratio = 0;
  ratio = Math.min(2, Math.max(-1, ratio));
  const zoom = body.zoom == null ? null : String(body.zoom).slice(0, 20);
  const ts = now();
  db.prepare(`INSERT INTO progress (book_id, page, scroll_ratio, zoom, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(book_id) DO UPDATE SET page = excluded.page, scroll_ratio = excluded.scroll_ratio,
                zoom = excluded.zoom, updated_at = excluded.updated_at`)
    .run(book.id, page, ratio, zoom, ts);
  const pageCount = Number(body.pageCount);
  db.prepare('UPDATE books SET last_opened_at = ?, page_count = COALESCE(?, page_count) WHERE id = ?')
    .run(ts, Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null, book.id);
  res.json({ ok: true, savedAt: ts });
});

// ---------- bookmarks ----------

app.get('/api/books/:id/bookmarks', (req, res) => {
  const book = requireBook(req);
  res.json(db.prepare(`SELECT id, page, note, created_at AS createdAt FROM bookmarks
                       WHERE book_id = ? ORDER BY page, id`).all(book.id));
});

app.post('/api/books/:id/bookmarks', (req, res) => {
  const book = requireBook(req);
  const page = intParam(req.body?.page, 'page');
  const note = String(req.body?.note ?? '').trim().slice(0, 500);
  const id = Number(db.prepare('INSERT INTO bookmarks (book_id, page, note, created_at) VALUES (?, ?, ?, ?)')
    .run(book.id, page, note, now()).lastInsertRowid);
  res.status(201).json(db.prepare('SELECT id, page, note, created_at AS createdAt FROM bookmarks WHERE id = ?').get(id));
});

app.patch('/api/bookmarks/:id', (req, res) => {
  const id = intParam(req.params.id);
  const note = String(req.body?.note ?? '').trim().slice(0, 500);
  const r = db.prepare('UPDATE bookmarks SET note = ? WHERE id = ?').run(note, id);
  if (!r.changes) throw new HttpError(404, 'Bookmark not found.');
  res.json({ ok: true });
});

app.delete('/api/bookmarks/:id', (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(intParam(req.params.id));
  res.json({ ok: true });
});

// ---------- folders ----------

function folderName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new HttpError(400, 'Folder name cannot be empty.');
  return name;
}

function uniqueFolderError(err) {
  if (/UNIQUE/i.test(err.message)) return new HttpError(409, 'A folder with that name already exists.');
  return err;
}

app.get('/api/folders', (_req, res) => {
  res.json(db.prepare('SELECT id, name, created_at AS createdAt FROM folders ORDER BY name COLLATE NOCASE').all());
});

app.post('/api/folders', (req, res) => {
  try {
    const name = folderName(req.body?.name);
    const id = Number(db.prepare('INSERT INTO folders (name, created_at) VALUES (?, ?)').run(name, now()).lastInsertRowid);
    res.status(201).json({ id, name });
  } catch (err) { throw uniqueFolderError(err); }
});

app.patch('/api/folders/:id', (req, res) => {
  const id = intParam(req.params.id);
  try {
    const r = db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(folderName(req.body?.name), id);
    if (!r.changes) throw new HttpError(404, 'Folder not found.');
    res.json({ ok: true });
  } catch (err) { throw uniqueFolderError(err); }
});

// Deleting a folder never deletes books: they move back to "Unsorted".
app.delete('/api/folders/:id', (req, res) => {
  const id = intParam(req.params.id);
  db.prepare('UPDATE books SET folder_id = NULL WHERE folder_id = ?').run(id);
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- uploads (drag & drop / file picker) ----------

const upload = multer({ dest: TMP_DIR });
const pending = new Map(); // duplicate uploads waiting for the user's decision

function discardPending(id) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  safeUnlink(p.tmp);
}

async function finalizeUpload({ tmp, name, hash, size }, folderId) {
  const dir = config.booksDir();
  await fsp.mkdir(dir, { recursive: true });

  // Same content as a book whose file went missing? Re-attach it and keep its progress.
  const missing = db.prepare('SELECT id FROM books WHERE file_hash = ? AND missing = 1 LIMIT 1').get(hash);
  const dest = uniquePath(dir, cleanFileName(name));
  await moveFile(tmp, dest);
  db.prepare('DELETE FROM ignored_files WHERE file_hash = ?').run(hash);

  if (missing) {
    db.prepare('UPDATE books SET file_path = ?, missing = 0, folder_id = COALESCE(?, folder_id) WHERE id = ?')
      .run(dest, folderId, missing.id);
    return { status: 'relinked', book: getBook(missing.id) };
  }
  const id = Number(db.prepare(`INSERT INTO books (title, file_path, file_hash, file_size, folder_id, added_at)
                                VALUES (?, ?, ?, ?, ?, ?)`)
    .run(scanner.titleFromFile(name), dest, hash, size, folderId, now()).lastInsertRowid);
  return { status: 'added', book: getBook(id) };
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file received.');
  const tmp = req.file.path;
  // The file name is sent as a separate field so non-English characters survive intact.
  const name = String(req.body?.name || req.file.originalname || 'book.pdf');
  try {
    const folderId = parseFolderId(req.body?.folderId);
    if (!(await scanner.isPdf(tmp))) {
      await safeUnlink(tmp);
      return res.status(415).json({ error: `"${name}" isn't a PDF file.` });
    }
    const hash = await scanner.hashFile(tmp);
    const item = { tmp, name, hash, size: req.file.size };
    const existing = db.prepare('SELECT id, title FROM books WHERE file_hash = ? AND missing = 0 LIMIT 1').get(hash);
    if (existing && req.body?.force !== '1') {
      const pendingId = crypto.randomUUID();
      pending.set(pendingId, { ...item, timer: setTimeout(() => discardPending(pendingId), 15 * 60 * 1000) });
      return res.json({ status: 'duplicate', pendingId, existing });
    }
    res.json(await finalizeUpload(item, folderId));
  } catch (err) {
    await safeUnlink(tmp);
    throw err;
  }
});

app.post('/api/upload/:pendingId/confirm', async (req, res) => {
  const p = pending.get(req.params.pendingId);
  if (!p) throw new HttpError(410, 'This upload expired. Please drop the file again.');
  clearTimeout(p.timer);
  pending.delete(req.params.pendingId);
  try {
    res.json(await finalizeUpload(p, parseFolderId(req.body?.folderId)));
  } catch (err) {
    await safeUnlink(p.tmp);
    throw err;
  }
});

app.delete('/api/upload/:pendingId', (req, res) => {
  discardPending(req.params.pendingId);
  res.json({ ok: true });
});

// ---------- errors ----------

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return;
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

// ---------- start ----------

const { port, host } = config.get();
const url = `http://localhost:${port}`;
const shouldOpen = process.argv.includes('--open');
const openBrowser = () => {
  if (process.platform === 'win32') exec(`start "" "${url}"`);
};

const server = app.listen(port, host, () => {
  console.log('');
  console.log('  Shelf is running.');
  console.log(`  Open ${url} in your browser.`);
  console.log(`  Books folder: ${config.booksDir()}`);
  console.log('  Keep this window open while reading. Press Ctrl+C to stop.');
  console.log('');
  if (shouldOpen) openBrowser();
  scanner.scan();
});

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if ((await r.json()).app === 'shelf') {
        console.log(`Shelf is already running at ${url}. Opening it in your browser.`);
        if (shouldOpen) openBrowser();
        process.exit(0);
      }
    } catch { /* something else is using the port */ }
    console.error(`\nPort ${port} is already used by another program.`);
    console.error(`Change "port" in ${config.CONFIG_PATH} to another number (e.g. 8766) and start again.\n`);
    process.exit(1);
  }
  throw err;
});

function shutdown() {
  server.close();
  try { db.close(); } catch { /* already closed */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
