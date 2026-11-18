/* User music stays in this browser. No server or built-in recording. */
window.createMusicLibrary = function ({ level, enabled, isPlaying, status, saveStatus, removeButton }) {
  let track = null;
  let wanted = false;
  let revision = 0;
  let playRevision = 0;
  let playPending = false;
  let cancelDecode = null;
  let database = null;
  let writes = Promise.resolve();
  let persistenceRevision = 0;
  const databaseName = 'eye-exercise-public-music:' + location.pathname;

  function openDatabase() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail(new Error('Storage timeout')), 5000);
      function fail(error) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(error);
      }
      try {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('music');
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new Error('Storage blocked'));
        request.onsuccess = () => {
          if (settled) { request.result.close(); return; }
          settled = true; clearTimeout(timer);
          request.result.onversionchange = () => { request.result.close(); database = null; };
          resolve(request.result);
        };
      } catch (error) { fail(error); }
    });
    database.catch(() => { database = null; });
    return database;
  }

  async function storage(action, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('music', action === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('music');
      const request = action === 'get' ? store.get('selected') : action === 'put' ? store.put(value, 'selected') : store.delete('selected');
      const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error('Storage timeout')); }, 5000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(request.result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error || request.error || new Error('Storage failed')); };
    });
  }

  function persist(action, value) {
    const token = ++persistenceRevision;
    saveStatus.textContent = action === 'put' ? '正在保存到此浏览器…' : '正在移除已保存音乐…';
    // Serialize writes so a slow save cannot resurrect a removed recording.
    writes = writes.catch(() => {}).then(() => storage(action, value));
    return writes.then(() => {
      if (token === persistenceRevision) saveStatus.textContent = action === 'put' ? '已保存在此浏览器' : '已移除保存的音乐';
    }, () => {
      if (token === persistenceRevision) saveStatus.textContent = action === 'put'
        ? '浏览器无法保存，本次音乐仅在当前页面有效。'
        : '浏览器未能清除保存记录，请清除此网站的数据后重试。';
    });
  }

  function dispose(item) {
    if (!item) return;
    item.audio.onerror = null;
    item.audio.pause();
    item.audio.removeAttribute('src');
    item.audio.load();
    URL.revokeObjectURL(item.url);
  }

  function updateVolume() { if (track) track.audio.volume = enabled() ? level() : 0; }
  function sync() {
    if (!track) return;
    updateVolume();
    if (wanted && isPlaying() && enabled()) {
      if (track.audio.paused && !playPending) {
        const current = track;
        const token = ++playRevision;
        playPending = true;
        if (current.audio.error) current.audio.load();
        current.audio.play().then(() => {
          if (token === playRevision) status.textContent = current.name;
        }).catch(() => {
          if (token === playRevision) status.textContent = '音乐播放失败，请重新选择文件。';
        }).finally(() => { if (token === playRevision) playPending = false; });
      }
    } else {
      playRevision++; playPending = false; track.audio.pause();
    }
  }

  async function adopt(file, token, shouldSave) {
    if (!(file instanceof Blob) || file.size === 0 || file.size > 100 * 1024 * 1024) {
      if (token === revision) status.textContent = '请选择不超过 100 MB 的有效音频。';
      return;
    }
    const audio = document.createElement('audio');
    const item = { audio, url: URL.createObjectURL(file), name: file.name || '本地音乐' };
    audio.preload = 'auto'; audio.loop = true;
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          audio.oncanplay = audio.onerror = null;
          if (cancelDecode === cancel) cancelDecode = null;
          error ? reject(error) : resolve();
        };
        const cancel = () => finish(new Error('Selection superseded'));
        const timer = setTimeout(() => finish(new Error('Decode timeout')), 15000);
        cancelDecode = cancel;
        audio.oncanplay = () => finish();
        audio.onerror = () => finish(new Error('Invalid audio'));
        audio.src = item.url; audio.load();
      });
      if (token !== revision) { dispose(item); return; }
      playRevision++; playPending = false;
      dispose(track); track = item;
      audio.onerror = () => {
        if (track !== item) return;
        playRevision++; playPending = false; audio.pause();
        status.textContent = '音乐读取失败，请重新选择文件。';
      };
      removeButton.disabled = false;
      status.textContent = item.name;
      sync();
      if (shouldSave) await persist('put', file);
      else if (token === revision) saveStatus.textContent = '已恢复此浏览器保存的音乐';
    } catch {
      dispose(item);
      if (token === revision) status.textContent = track ? '新文件无法播放，已保留原音乐。' : '音频无法读取，请重新选择文件。';
    }
  }

  status.textContent = '未选择背景音乐';
  const restoredAt = revision;
  storage('get').then(async file => {
    if (restoredAt !== revision) return;
    if (file) await adopt(file, restoredAt, false);
    if (restoredAt === revision) removeButton.disabled = !track;
  }).catch(() => {
    if (restoredAt === revision) {
      removeButton.disabled = !track;
      saveStatus.textContent = '浏览器无法读取音乐存储，仍可导入后在当前页面播放。';
    }
  });

  return {
    updateVolume, sync,
    start() { wanted = true; sync(); },
    pause() { wanted = false; sync(); },
    reset() { wanted = false; sync(); if (track) track.audio.currentTime = 0; },
    select(file) {
      if (!file) return Promise.resolve();
      const token = ++revision; cancelDecode?.();
      return adopt(file, token, true);
    },
    remove() {
      const token = ++revision; cancelDecode?.();
      playRevision++; playPending = false;
      dispose(track); track = null;
      removeButton.disabled = true;
      status.textContent = '未选择背景音乐';
      return persist('delete', null);
    }
  };
};
