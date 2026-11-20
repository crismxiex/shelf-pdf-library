# Shelf: a PDF library that remembers where you left off

Shelf runs on your Windows PC and opens in your browser at **http://localhost:8765**.
It shows your PDF books as a grid of covers, tracks your reading progress page by page,
and lets you sort books into folders such as "Programming", "Philosophy" or "Finance".

Everything stays on your computer. The server only accepts connections from this PC.

---

## 1. Install Node.js (one time)

1. Go to <https://nodejs.org> and download the **LTS** version for Windows (22.13 or newer; 24 LTS is recommended).
2. Run the installer and keep the default options.
3. To check that it worked, open **PowerShell** and run:

   ```powershell
   node --version
   ```

   You should see something like `v24.11.0`.

That is the only thing you need to install. Shelf uses Node's built-in SQLite, so you don't
need Python, Visual Studio or any build tools.

## 2. Put Shelf somewhere permanent

Copy the whole `pdf-library` folder somewhere it can stay, for example
`C:\Users\<you>\Apps\pdf-library`. Your library database is kept inside it, in the `data` folder.

## 3. Start it

Double-click **`start.bat`**.

- The first time, it downloads its dependencies (about a minute, needs internet).
- Then it starts the server and opens **http://localhost:8765** in your default browser.
- **Keep the black console window open while you read.** Close it (or press `Ctrl+C` in it) to stop Shelf.
- If you double-click `start.bat` while Shelf is already running, it just opens the browser again.

Tip: right-click `start.bat` → *Show more options* → *Send to* → *Desktop (create shortcut)* to get a desktop icon.

To start it from PowerShell instead:

```powershell
npm start
```

## 4. Your books folder

By default Shelf uses **`C:\Users\<you>\Documents\Books`** and creates it if needed.

- Books you add (drag & drop or **Add book**) are **copied** into this folder, so they keep working
  even if you delete the original file.
- When Shelf starts, it scans this folder **and all its subfolders** and adds any PDFs you put there yourself.
  PDFs inside a subfolder (e.g. `Books\Philosophy\...`) go into a library folder with that name.
- If you move or rename a PDF inside the books folder, Shelf recognises it by its content on the next
  start and keeps your progress and bookmarks.

**To change the folder**, use either:

- the ⚙ **Settings** button in the top-right corner of the app (type the full path and click *Save*), or
- edit `config.json` in the app folder (it's created on first start). In JSON, write paths with forward
  slashes or double backslashes:

  ```json
  {
    "port": 8765,
    "host": "127.0.0.1",
    "booksDir": "D:/Library/Books"
  }
  ```

  Leave `booksDir` empty (`""`) to use the default. Restart Shelf after editing the file.

If your Documents folder is synced by OneDrive, the default folder may actually be
`C:\Users\<you>\OneDrive\Documents\Books`. Either is fine; just set the one you want in Settings.

## Using Shelf

### Library

- **Continue reading** at the top shows the books you opened most recently. Click one to jump right back in.
- Each book shows its cover (page 1), progress bar, percentage read, "Page X of Y" and when you last read it.
- **Sort** by recently read, title, progress or date added. **Search** by title (press `/` to jump to the search box).
- Click **⋯** on a book (or right-click it) to rename it, move it to a folder, or remove it.

### Adding books

- **Drag PDFs from File Explorer** and drop them anywhere on the window. The window gets a highlighted
  border while you drag, and a panel in the corner shows upload progress.
- **Drop onto a folder** in the sidebar to add straight into that folder. If a folder is open,
  dropping anywhere adds to that folder.
- You can also drop a whole Windows folder: Shelf adds every PDF inside it.
- Files that aren't PDFs are skipped with a message.
- If you add a file that's already in the library (same content, even if renamed), Shelf asks
  whether to add another copy or skip it.
- The **Add book** button opens a normal file picker.

### Finding duplicates

Click **Duplicates** in the sidebar (the number next to it is how many extra copies there are). It lists:

- **Identical files**: copies with exactly the same content, even if renamed.
- **Same title, different files**: e.g. the same book downloaded twice from different places.

For each copy you see its folder, size, page count, reading progress and file location. Copies that are
further along are marked **Furthest read**. Click **Keep this one** to remove the other copies in one go, or
**Remove…** on a single copy. As everywhere in Shelf, files are only deleted (to the Recycle Bin) if you tick the box.

### Folders

- Click **+** next to *Folders* in the sidebar to create one. Use **⋯** on a folder to rename or delete it.
- **Drag a book card onto a folder** to move it there, or onto *Unsorted* to take it out of its folder.
- **Move many books at once** by selecting them first:

  | Action | How |
  | --- | --- |
  | Select / unselect a book | `Ctrl`+click it, or click the round check on its cover |
  | Select a range | click one book, then `Shift`+click another |
  | Select everything shown | `Ctrl`+`A` (respects the current folder and search) |
  | Move the selection | drag any selected book onto a folder, or use **Move to…** in the bar at the bottom |
  | Cut and paste | `Ctrl`+`X` (or `Ctrl`+`C`), open a folder or *Unsorted* in the sidebar, then `Ctrl`+`V` |
  | Remove the selection | `Delete`, or **Remove…** in the bar |
  | Clear the selection | `Esc`, or click empty space |

  A book lives in one folder at a time, so `Ctrl`+`C` / `Ctrl`+`V` moves books just like cut and paste.
  While something is selected, a plain click adds to the selection instead of opening the book.
- Each folder shows how many books it has and a progress bar for all of its books together.
- Deleting a folder never deletes books; they go back to *Unsorted*.

### Removing books

*Remove from library* keeps the PDF file on your disk unless you tick
"Also delete the PDF file". In that case the file goes to the **Recycle Bin**, so you can still get it back.
Removed books are not re-added by the startup scan. If you drop the same file again later, it comes back.

### Reader

Your page and scroll position are saved to the server about a second after you stop scrolling,
and again when you close the tab. Reopening a book jumps straight back to where you were.

| Action | How |
| --- | --- |
| Next / previous page | `→` / `←`, or the arrow buttons |
| Scroll | mouse wheel, `↑` `↓`, `Page Up` / `Page Down` |
| First / last page | `Home` / `End` |
| Jump to page | type a number in the page box and press `Enter` |
| Zoom in / out | `+` / `-`, or the zoom menu |
| Fit to width | `W`, or the ↔ button |
| Bookmark this page (with optional note) | `B`, or the bookmark button |
| Show bookmarks | the list button (click a bookmark to jump to it) |
| Dark mode | `D`, or the moon button |
| Full screen | `F`, or the full-screen button (move the mouse to the top to see the toolbar) |

### Focus mode

Click the **target** button in the reader toolbar, pick a duration (15–90 minutes, or type any number), and start.

- Shelf goes full screen and locks to that book: the *Back to library* button is hidden, opening another book
  redirects you back, and the library shows a lock screen with the countdown.
- Closing or reloading the tab asks for confirmation. If you leave anyway, the session keeps running on the
  server, so Shelf is still locked when you come back, even after restarting the browser.
- If you leave full screen (`Esc`), a banner offers to go back.
- To stop early, click **End early…** and type the unlock phrase **`IWANTTOENDSESSION`** exactly.
  Pasting is turned off. You can change the phrase with `focusUnlockPhrase` in `config.json`.
- When the timer runs out, Shelf unlocks and shows how many pages you read.

What a web page can't do: it can't stop you from switching to another program, closing the whole browser
or stopping the Shelf server. Focus mode locks *Shelf*, not your PC.

## Troubleshooting

- **"Port 8765 is already used by another program"**: open `config.json`, change `"port"` to e.g. `8766`, and start again.
  The app will then be at `http://localhost:8766`.
- **A book shows "File missing"**: the PDF was moved or deleted outside Shelf. Put it back in the books folder
  (any subfolder) and restart Shelf, or drop the file onto the window again. Your progress is kept either way.
- **A cover stays as a coloured placeholder**: that PDF couldn't be rendered (it may be damaged or encrypted).
  It can still be opened if your browser can read it.
- **Windows Defender SmartScreen warns about `start.bat`**: that happens with downloaded scripts. Choose
  *More info* → *Run anyway*, or right-click the file → *Properties* → tick *Unblock*.
- **Start over completely**: stop Shelf and delete the `data` folder. Your PDF files are not touched.

## How it works

```
pdf-library/
├─ start.bat              double-click to install (first time), start and open the app
├─ package.json
├─ config.json            created on first start: port, host, booksDir
├─ server/
│  ├─ index.js            Express server + REST API (books, progress, bookmarks, folders, uploads)
│  ├─ db.js               SQLite schema (Node's built-in node:sqlite)
│  ├─ scanner.js          scans the books folder, detects duplicates/moved files by SHA-256
│  └─ config.js           loads/saves config.json
├─ public/                the web app (plain HTML, CSS and JavaScript modules)
│  ├─ index.html          library
│  ├─ reader.html         reader
│  ├─ css/                base.css, library.css, reader.css
│  └─ js/                 api.js, ui.js, library.js, covers.js, reader.js
└─ data/                  created at runtime
   ├─ library.db          your library: books, folders, progress, bookmarks
   └─ covers/             cached cover thumbnails
```

- **Database tables:** `books`, `folders`, `progress`, `bookmarks`, and `ignored_files` (books you removed but kept on disk).
- **PDF rendering:** [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`), served locally. No internet is needed after the first install.
- **Covers:** page 1 is rendered in the browser with PDF.js the first time a book appears, then uploaded and cached in
  `data/covers`. This avoids native image libraries, which are often painful to install on Windows.
- **Progress lives on the server** (SQLite), not in the browser. Only display preferences (dark mode, sort order,
  bookmarks panel open/closed) are remembered per browser.
- **Large books** load quickly because the server supports HTTP range requests, so PDF.js only downloads the pages it needs.

### Ready for later

The code is set up so these can be added without restructuring:

- **Reading on your phone over Wi-Fi.** All state is already server-side behind a JSON API. This will need
  `host` changed to `0.0.0.0`, a PIN login, a Windows Firewall rule and a PWA manifest. Don't change `host`
  before PIN login exists, because anyone on your network could then reach the library.
- **Reading stats** (pages per day, streaks, time per book). Progress saves already go through one endpoint
  (`POST /api/books/:id/progress`), where a reading-sessions log can be added.
- **Status per book** (Want to read / Reading / Finished). This needs one new column on `books`.
