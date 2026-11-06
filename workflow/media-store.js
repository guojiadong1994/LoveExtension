/*
 * LoveExtension workflow: File System Access handles only, NO File/Blob data.
 * This IndexedDB lives in the vivo page origin so restored File objects can be
 * handed directly to the original page uploader in the isolated content script.
 * File handles and metadata are removed at task completion/failure/stop.
 */
(() => {
  'use strict';
  if (globalThis.LoveWorkflowMediaStore) return;
  const DB_NAME = 'love-extension-workflow-handles-v135';
  const OLD_BLOB_DB = 'love-extension-workflow-media-v125';
  const STORE = 'tasks';
  const TTL_MS = 2 * 60 * 60 * 1000;

  function open() {
    if (location.origin !== 'https://ad.vivo.com.cn') {
      return Promise.reject(new Error('仅允许在 vivo 营销平台保存文件访问句柄'));
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开句柄存储'));
      request.onblocked = () => reject(new Error('句柄数据库被其他页面占用'));
    });
  }

  async function transaction(mode, executor) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        let result;
        const tx = db.transaction(STORE, mode);
        try {
          const request = executor(tx.objectStore(STORE));
          if (request) request.onsuccess = () => { result = request.result; };
        } catch (error) {
          tx.abort();
          reject(error);
          return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('句柄存储操作失败'));
        tx.onabort = () => reject(tx.error || new Error('句柄存储事务中止'));
      });
    } finally { db.close(); }
  }

  function isHandle(h) {
    return h && h.kind === 'file' && typeof h.getFile === 'function' && typeof h.name === 'string';
  }

  function fileKind(file) {
    const ext = file.name || '';
    if ((file.type || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(ext)) return 'image';
    if ((file.type || '').startsWith('video/') || /\.(mp4|mov|m4v|avi|webm|mkv)$/i.test(ext)) return 'video';
    return '';
  }

  function permissionError() {
    const err = new Error('文件读取权限已失效，需要点击「重新授权文件」才能继续；不会复制素材内容。');
    err.code = 'LOVE_HANDLE_PERMISSION';
    return err;
  }

  async function put(taskId, handles, descriptions, expectedKind) {
    if (!taskId || !Array.isArray(handles) || !handles.length || handles.length > 10 ||
        handles.some(h => !isHandle(h)) || !Array.isArray(descriptions) || descriptions.length !== handles.length) {
      throw new Error('句柄或任务编号无效，请重新选择图片/视频');
    }
    if (!['image', 'video'].includes(expectedKind) || descriptions.some(d =>
      !d || !d.name || !Number.isFinite(d.size) || !Number.isFinite(d.lastModified) || fileKind(d) !== expectedKind)) {
      throw new Error('文件类型或者文件信息有误，请重新选择');
    }
    // Store ONLY structured-cloneable FileSystemFileHandles and small metadata.
    // Never store File, Blob, ArrayBuffer, data URL, or file contents.
    try {
      await transaction('readwrite', store => store.put({
        id: taskId,
        format: 'file-handles-v1',
        handles,
        descriptions: descriptions.map(d => ({
          name: d.name, type: d.type || '', size: d.size, lastModified: d.lastModified
        })),
        expectedKind,
        savedAt: Date.now()
      }));
      const restored = await record(taskId);
      if (!restored || restored.handles.length !== handles.length ||
          restored.handles.some((h, i) => h.name !== handles[i].name)) {
        throw new Error('文件句柄保存校验失败，请重新选择文件');
      }
    } catch (err) {
      await remove(taskId).catch(() => {});
      throw new Error(`保存文件句柄失败（不会保存文件内容）：${err?.message || err}`);
    }
  }

  async function record(taskId) {
    if (!taskId) return null;
    const item = await transaction('readonly', store => store.get(taskId));
    if (!item || item.format !== 'file-handles-v1' || Date.now() - item.savedAt > TTL_MS ||
        !Array.isArray(item.handles) || !Array.isArray(item.descriptions) ||
        item.handles.length !== item.descriptions.length || item.handles.some(h => !isHandle(h))) return null;
    return item;
  }

  async function get(taskId) {
    const item = await record(taskId);
    if (!item) return null;
    // No user gesture is available during automatic editor navigation: never
    // silently issue requestPermission(). The editor offers a click to re-grant.
    for (const handle of item.handles) {
      if (typeof handle.queryPermission === 'function' &&
          await handle.queryPermission({ mode: 'read' }) !== 'granted') {
        throw permissionError();
      }
    }
    let files;
    try {
      // getFile returns a lazy File pointing at the ORIGINAL disk file.
      // It does not read the entire file into memory or IndexedDB.
      files = await Promise.all(item.handles.map(h => h.getFile()));
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw permissionError();
      throw new Error(`读取原始图片/视频失败，可能已移动或删除：${err?.message || err}`);
    }
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const previous = item.descriptions[i];
      if (file.name !== previous.name || file.size !== previous.size ||
          file.lastModified !== previous.lastModified || fileKind(file) !== item.expectedKind) {
        throw new Error(`文件「${previous.name}」已被修改或替换，请返回广告计划页面重新选择（不会自动上传变化后的文件）`);
      }
    }
    return files;
  }

  function requestAccess(handles) {
    // handles MUST be loaded before the user clicks the authorization button.
    // Do not await IndexedDB or any other asynchronous work before invoking
    // requestPermission: doing so may lose the transient user activation.
    if (!Array.isArray(handles) || !handles.length || handles.some(h => !isHandle(h))) {
      return Promise.reject(new Error('文件句柄无效，无法重新授权'));
    }
    const requests = handles.map(h => {
      if (typeof h.requestPermission !== 'function') {
        return Promise.reject(new Error('当前 Chrome 不支持重新授权文件句柄'));
      }
      try { return h.requestPermission({ mode: 'read' }); }
      catch (err) { return Promise.reject(err); }
    });
    return Promise.all(requests).then(results => {
      if (results.some(r => r !== 'granted')) throw permissionError();
      return true;
    });
  }

  async function remove(taskId) {
    if (taskId) await transaction('readwrite', store => store.delete(taskId));
  }

  async function cleanupExpired() {
    const db = await open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          if (Date.now() - (cursor.value.savedAt || 0) > TTL_MS) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }

  function deleteOldBlobDatabase() {
    // Cleanup of previously persisted File/Blob copies created by V1.3.0-V1.3.4.
    // Do not open or read that database's content, and do not create a new copy.
    if (location.origin !== 'https://ad.vivo.com.cn') return;
    try {
      const req = indexedDB.deleteDatabase(OLD_BLOB_DB);
      req.onerror = () => console.warn('[LoveWorkflow] 旧版素材副本清理失败，可在 Chrome 网站数据中手动清理');
      req.onblocked = () => console.warn('[LoveWorkflow] 旧版素材副本清理被其他打开的标签页阻止');
    } catch (_) {}
  }

  globalThis.LoveWorkflowMediaStore = Object.freeze({
    put, get, record, requestAccess, remove, cleanupExpired, deleteOldBlobDatabase
  });
})();
