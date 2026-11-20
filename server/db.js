'use strict';
// SQLite database using Node's built-in node:sqlite module (no native build tools needed).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'library.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS books (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    file_path       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    file_hash       TEXT NOT NULL,
    file_size       INTEGER NOT NULL,
    page_count      INTEGER,
    folder_id       INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    cover_status    INTEGER NOT NULL DEFAULT 0,  -- 0 = not generated yet, 1 = ready, -1 = failed
    added_at        TEXT NOT NULL,
    last_opened_at  TEXT,
    missing         INTEGER NOT NULL DEFAULT 0   -- 1 = file no longer found on disk
  );
  CREATE INDEX IF NOT EXISTS idx_books_hash ON books(file_hash);
  CREATE INDEX IF NOT EXISTS idx_books_folder ON books(folder_id);

  CREATE TABLE IF NOT EXISTS progress (
    book_id       INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    page          INTEGER NOT NULL DEFAULT 1,
    scroll_ratio  REAL NOT NULL DEFAULT 0,      -- position inside the page (0 = top, 1 = bottom)
    zoom          TEXT,                         -- 'page-width', 'page-fit', 'auto' or a number like '1.25'
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page        INTEGER NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);

  -- Files you removed from the library (but kept on disk), so the startup scan doesn't re-add them.
  CREATE TABLE IF NOT EXISTS ignored_files (
    file_hash   TEXT PRIMARY KEY,
    file_path   TEXT,
    removed_at  TEXT NOT NULL
  );
`);

// Upgrades for libraries created by earlier versions.
const bookColumns = db.prepare('PRAGMA table_info(books)').all().map((c) => c.name);
if (!bookColumns.includes('title_custom')) {
  // 1 = you renamed the book yourself, so its title is never replaced automatically.
  db.exec('ALTER TABLE books ADD COLUMN title_custom INTEGER NOT NULL DEFAULT 0');
}
if (!bookColumns.includes('meta_checked')) {
  // 1 = the title stored inside the PDF has already been looked up.
  db.exec('ALTER TABLE books ADD COLUMN meta_checked INTEGER NOT NULL DEFAULT 0');
}

const now = () => new Date().toISOString();

module.exports = { db, now };
