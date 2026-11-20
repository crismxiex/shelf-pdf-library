'use strict';
// App configuration, stored in config.json next to package.json.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_DIR = path.join(ROOT, 'data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');
const TMP_DIR = path.join(DATA_DIR, 'tmp');

const DEFAULTS = {
  port: 8765,
  // Only listen on this computer. (Phone access over Wi-Fi is a planned feature.)
  host: '127.0.0.1',
  // Leave empty to use the default: <your user folder>\Documents\Books
  booksDir: '',
};

let current = null;

function defaultBooksDir() {
  return path.join(os.homedir(), 'Documents', 'Books');
}

function load() {
  let fromFile = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const text = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
      fromFile = JSON.parse(text);
    } catch (err) {
      console.error(`\n[config] Could not read config.json: ${err.message}`);
      console.error('[config] Tip: in JSON, write Windows paths with double backslashes (C:\\\\Books) or forward slashes (C:/Books).\n');
      process.exit(1);
    }
  }
  current = { ...DEFAULTS, ...fromFile };
  if (!fs.existsSync(CONFIG_PATH)) save(current);
  return current;
}

function save(cfg) {
  current = { ...DEFAULTS, ...cfg };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return current;
}

function get() {
  return current || load();
}

function booksDir() {
  const dir = get().booksDir && String(get().booksDir).trim();
  return path.resolve(dir || defaultBooksDir());
}

module.exports = { ROOT, CONFIG_PATH, DATA_DIR, COVERS_DIR, TMP_DIR, load, save, get, booksDir, defaultBooksDir };
