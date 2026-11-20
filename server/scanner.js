'use strict';
// Scans the books folder (including subfolders) and keeps the library in sync with the disk.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { db, now } = require('./db');

const samePath = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function isPdf(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(1024);
    const { bytesRead } = await fh.read(buf, 0, 1024, 0);
    return buf.subarray(0, bytesRead).includes('%PDF-');
  } finally {
    await fh.close();
  }
}

function titleFromFile(file) {
  const t = path.basename(file, path.extname(file)).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || 'Untitled';
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[scan] Skipping ${dir}: ${err.code || err.message}`);
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('$') || e.name.startsWith('~$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile() && /\.pdf$/i.test(e.name)) out.push(full);
  }
  return out;
}

function folderIdForName(name) {
  const found = db.prepare('SELECT id FROM folders WHERE name = ?').get(name);
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO folders (name, created_at) VALUES (?, ?)').run(name, now()).lastInsertRowid);
}

const state = { running: null, lastResult: null };

async function scanOnce() {
  const root = config.booksDir();
  await fsp.mkdir(root, { recursive: true });
  const result = { added: 0, relinked: 0, missing: 0, skippedDuplicates: 0, errors: 0 };

  // 1. Mark books whose files have disappeared (and un-mark ones that came back).
  const books = db.prepare('SELECT id, file_path, missing FROM books').all();
  const known = new Set();
  const setMissing = db.prepare('UPDATE books SET missing = ? WHERE id = ?');
  for (const b of books) {
    const exists = fs.existsSync(b.file_path);
    if (exists) known.add(samePath(b.file_path));
    else result.missing++;
    if (Number(!exists) !== b.missing) setMissing.run(Number(!exists), b.id);
  }

  // 2. Pick up PDFs that are on disk but not in the library yet.
  const files = await walk(root);
  const ignored = db.prepare('SELECT 1 FROM ignored_files WHERE file_hash = ?');
  const byHash = db.prepare('SELECT id, missing FROM books WHERE file_hash = ? ORDER BY missing DESC');
  const relink = db.prepare('UPDATE books SET file_path = ?, missing = 0 WHERE id = ?');
  const insert = db.prepare(`INSERT INTO books (title, file_path, file_hash, file_size, folder_id, added_at)
                             VALUES (?, ?, ?, ?, ?, ?)`);

  for (const file of files) {
    if (known.has(samePath(file))) continue;
    try {
      const hash = await hashFile(file);
      if (ignored.get(hash)) continue;
      const match = byHash.get(hash);
      if (match && match.missing) {
        // Same book, but it was moved or renamed: keep its progress and bookmarks.
        relink.run(file, match.id);
        result.relinked++;
        result.missing--;
        continue;
      }
      if (match) {
        result.skippedDuplicates++;
        continue;
      }
      // PDFs inside a subfolder go into a library folder with the same name (first level only).
      const rel = path.relative(root, path.dirname(file));
      const folderId = rel && !rel.startsWith('..') ? folderIdForName(rel.split(path.sep)[0]) : null;
      const { size } = await fsp.stat(file);
      insert.run(titleFromFile(file), file, hash, size, folderId, now());
      known.add(samePath(file));
      result.added++;
    } catch (err) {
      result.errors++;
      console.warn(`[scan] Could not add ${file}: ${err.message}`);
    }
  }
  return result;
}

function scan() {
  if (state.running) return state.running;
  const started = Date.now();
  state.running = scanOnce()
    .then((r) => {
      state.lastResult = { ...r, finishedAt: now(), ms: Date.now() - started };
      console.log(`[scan] ${config.booksDir()} -> ${r.added} added, ${r.relinked} relinked, ${r.missing} missing` +
        (r.skippedDuplicates ? `, ${r.skippedDuplicates} duplicate copies ignored` : ''));
      return state.lastResult;
    })
    .catch((err) => {
      console.error(`[scan] Failed: ${err.message}`);
      state.lastResult = { error: err.message, finishedAt: now() };
      return state.lastResult;
    })
    .finally(() => { state.running = null; });
  return state.running;
}

module.exports = { scan, state, hashFile, isPdf, titleFromFile };
