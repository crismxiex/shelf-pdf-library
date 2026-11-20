// Small wrapper around fetch for the Shelf API. All reading state lives on the server.

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  books: () => request('GET', '/api/books'),
  book: (id) => request('GET', `/api/books/${id}`),
  updateBook: (id, patch) => request('PATCH', `/api/books/${id}`, patch),
  moveBooks: (ids, folderId) => request('POST', '/api/books/move', { ids, folderId }),
  removeBook: (id, deleteFile) => request('DELETE', `/api/books/${id}${deleteFile ? '?deleteFile=1' : ''}`),
  openBook: (id) => request('POST', `/api/books/${id}/open`),
  saveProgress: (id, progress) => request('POST', `/api/books/${id}/progress`, progress),

  bookmarks: (id) => request('GET', `/api/books/${id}/bookmarks`),
  addBookmark: (id, page, note) => request('POST', `/api/books/${id}/bookmarks`, { page, note }),
  updateBookmark: (id, note) => request('PATCH', `/api/bookmarks/${id}`, { note }),
  deleteBookmark: (id) => request('DELETE', `/api/bookmarks/${id}`),

  folders: () => request('GET', '/api/folders'),
  createFolder: (name) => request('POST', '/api/folders', { name }),
  renameFolder: (id, name) => request('PATCH', `/api/folders/${id}`, { name }),
  deleteFolder: (id) => request('DELETE', `/api/folders/${id}`),

  focus: () => request('GET', '/api/focus'),
  startFocus: (bookId, minutes, startPage) => request('POST', '/api/focus', { bookId, minutes, startPage }),
  endFocus: (phrase) => request('POST', '/api/focus/end', { phrase }),

  settings: () => request('GET', '/api/settings'),
  saveSettings: (s) => request('PUT', '/api/settings', s),
  rescan: () => request('POST', '/api/rescan'),

  confirmUpload: (pendingId, folderId) => request('POST', `/api/upload/${pendingId}/confirm`, { folderId }),
  cancelUpload: (pendingId) => request('DELETE', `/api/upload/${pendingId}`),

  async uploadCover(id, blob, pages) {
    const res = await fetch(`/api/books/${id}/cover?pages=${pages}`, {
      method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob,
    });
    if (!res.ok) throw new Error('Cover upload failed');
    return res.json();
  },

  // Uses XMLHttpRequest because fetch() can't report upload progress.
  uploadFile(file, folderId, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('name', file.name);
      form.append('folderId', folderId == null ? '' : String(folderId));
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        const data = xhr.response || {};
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Upload failed: the server could not be reached.'));
      xhr.send(form);
    });
  },
};
