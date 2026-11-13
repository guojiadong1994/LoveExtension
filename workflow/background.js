/* LoveExtension workflow V1.3: navigation plus optional legacy uploader handoff. */
'use strict';

const PREFIX = 'loveWorkflowV1:';
const TTL = 2 * 60 * 60 * 1000;
const NEXT = { RENAME_PLAN: ['OPEN_GROUP'], OPEN_GROUP: ['OPEN_AD'], OPEN_AD: ['VERIFY_AD', 'OPEN_EDITOR'], VERIFY_AD: ['OPEN_EDITOR'] };

function key(tabId) { return `${PREFIX}${tabId}`; }
function valid(t) { return t && Date.now() - t.updatedAt < TTL; }

async function get(tabId) {
  const result = await chrome.storage.session.get(key(tabId));
  const t = result[key(tabId)] || null;
  if (t && !valid(t)) {
    await chrome.storage.session.remove(key(tabId));
    return null;
  }
  return t;
}

async function save(tabId, task) {
  task.updatedAt = Date.now();
  await chrome.storage.session.set({ [key(tabId)]: task });
  return task;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !message || !String(message.type).startsWith('LOVE_WORKFLOW_')) {
      return { ok: false, error: '只能从扩展所注入的网页启动任务。' };
    }
    const old = await get(tabId);
    switch (message.type) {
      case 'LOVE_WORKFLOW_GET':
        return { ok: true, task: old };
      case 'LOVE_WORKFLOW_START': {
        // Vivo is an SPA. After client-side navigation, the browser-provided
        // sender.url may still describe the original document URL rather than
        // the *current* route shown in location.pathname. Keep origin/frame
        // checks, but validate the live route reported by our own content script.
        const sourceUrl = sender.url || sender.tab?.url || '';
        let sourceOrigin = '';
        try { sourceOrigin = new URL(sourceUrl).origin; } catch (_) {}
        if (sourceOrigin !== 'https://ad.vivo.com.cn') {
          throw new Error('只能从 vivo 营销平台启动。');
        }
        if (sender.frameId != null && sender.frameId !== 0) {
          throw new Error('请在广告计划主页面启动，不支持内嵌框架。');
        }
        const currentPath = String(message.currentPath || '').replace(/\/+$/, '');
        if (currentPath !== '/marketing/promotion/plan') {
          throw new Error('只能在广告计划列表中启动（当前页面路径不匹配）。');
        }
        // Extra consistency check: the page URL and route must describe the
        // same current page, even if sender.url points to a stale SPA route.
        let currentPage;
        try { currentPage = new URL(String(message.currentPageUrl || '')); } catch (_) {}
        if (!currentPage || currentPage.origin !== sourceOrigin ||
            currentPage.pathname.replace(/\/+$/, '') !== currentPath) {
          throw new Error('当前页面地址发生变化，请在广告计划列表重新右键启动。');
        }
        const name = String(message.name || '').trim();
        const originalName = String(message.originalName || '').trim();
        if (!name || name.length > 200) throw new Error('计划名称为空或超过 200 字。');
        if (!originalName || originalName.length > 200) throw new Error('原计划名称无效，请重新在原始计划标题上右键。');
        if (old?.status === 'running') throw new Error('已有任务正在执行，请先停止。');
        const appName = String(message.appName || '').trim();
        const appSubtitle = String(message.appSubtitle || '').trim();
        const mediaKind = String(message.mediaKind || '');
        const fileCount = Number(message.fileCount || 0);
        if (!Number.isInteger(fileCount) || fileCount < 0 || fileCount > 10) throw new Error('素材数量必须在 0 到 10 之间。');
        if (fileCount && !['image', 'video'].includes(mediaKind)) throw new Error('所选素材类型不正确。');
        if (appName.length > 500 || appSubtitle.length > 500) throw new Error('文案长度超过限制。');
        const task = {
          id: `${Date.now()}-${tabId}-${Math.random().toString(36).slice(2, 9)}`,
          name, originalName,
          appName, appSubtitle, mediaKind, fileCount,
          autoUpload: fileCount > 0 || !!appName || !!appSubtitle,
          status: 'running',
          step: 'RENAME_PLAN',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          planUrl: currentPage.href
        };
        await save(tabId, task);
        return { ok: true, task };
      }
      case 'LOVE_WORKFLOW_ADVANCE': {
        if (!old || old.status !== 'running' || old.id !== message.taskId) throw new Error('任务已结束或编号不匹配。');
        if (old.step !== message.from || !(NEXT[message.from] || []).includes(message.to)) {
          throw new Error('任务步骤不匹配，已拒绝跳步。');
        }
        if (message.to === 'VERIFY_AD' || message.to === 'OPEN_EDITOR') {
          const url = new URL(String(message.href || ''));
          if (url.origin !== 'https://ad.vivo.com.cn' || !/^\/marketing\/ads\/edit\/\d+\/\d+\/?$/.test(url.pathname)) {
            throw new Error('选中广告的编辑地址不符合预期，已停止。');
          }
          if (old.editHref && old.editHref !== url.origin + url.pathname.replace(/\/$/, '')) {
            throw new Error('广告身份与原目标不一致，已停止。');
          }
          old.editHref = url.origin + url.pathname.replace(/\/$/, '');
        }
        old.step = message.to;
        return { ok: true, task: await save(tabId, old) };
      }
      case 'LOVE_WORKFLOW_STOP': {
        if (!old) return { ok: true, task: null };
        if (old.status === 'running') {
          old.status = 'stopped';
          old.error = '用户主动停止';
        }
        return { ok: true, task: await save(tabId, old) };
      }
      case 'LOVE_WORKFLOW_FAIL': {
        if (!old || old.status !== 'running' || old.id !== message.taskId) return { ok: true, task: old };
        old.status = 'failed';
        old.error = String(message.error || '未知错误').slice(0, 500);
        return { ok: true, task: await save(tabId, old) };
      }
      case 'LOVE_WORKFLOW_OPEN_EDITOR': {
        if (!old || old.id !== message.taskId || old.status !== 'running' || old.step !== 'OPEN_EDITOR') {
          throw new Error('任务步骤不正确，无法打开广告编辑页。');
        }
        const url = new URL(String(message.href || ''));
        if (url.origin !== 'https://ad.vivo.com.cn' || !/^\/marketing\/ads\/edit\/\d+\/\d+\/?$/.test(url.pathname)) {
          throw new Error('广告编辑地址不符合预期，已阻止打开。');
        }
        if (old.editHref && old.editHref !== url.origin + url.pathname.replace(/\/$/, '')) {
          throw new Error('打开编辑页时广告身份发生变化，已拒绝打开其他广告。');
        }
        // The real website uses target="_blank" for this link. Open a tab explicitly so
        // Chrome's async popup blocker does not interfere with automation.
        const newTab = await chrome.tabs.create({ url: url.href, active: true, openerTabId: tabId });
        old.status = 'completed';
        old.step = 'DONE';
        old.editorTabId = newTab.id;
        await save(tabId, old);
        const editorTask = old.autoUpload
          ? { ...old, status: 'running', step: 'UPLOAD_READY', editorTabId: newTab.id, noticeOnly: false }
          : { ...old, noticeOnly: true };
        await save(newTab.id, editorTask);
        return { ok: true, task: old };
      }
      case 'LOVE_WORKFLOW_CLAIM_UPLOAD': {
        if (!old || old.id !== message.taskId || old.status !== 'running' || old.step !== 'UPLOAD_READY' || !old.autoUpload) {
          throw new Error('上传任务已启动、停止或状态不正确，拒绝重复执行。');
        }
        if (!sender.url || new URL(sender.url).origin !== 'https://ad.vivo.com.cn' ||
            new URL(sender.url).pathname.replace(/\/$/, '') !== new URL(old.editHref).pathname.replace(/\/$/, '')) {
          throw new Error('当前广告编辑页面与原计划不一致。');
        }
        old.step = 'UPLOADING';
        old.uploadStartedAt = Date.now();
        return { ok: true, task: await save(tabId, old) };
      }
      case 'LOVE_WORKFLOW_FINISH_UPLOAD': {
        if (!old || old.id !== message.taskId || old.step !== 'UPLOADING' || old.status !== 'running') {
          throw new Error('上传任务状态不正确，拒绝重复完成。');
        }
        const success = message.success === true;
        old.step = success ? 'DONE' : 'UPLOAD_FAILED';
        old.status = success ? 'completed' : 'failed';
        old.error = success ? '' : String(message.error || '原有上传流程未确认成功').slice(0, 500);
        return { ok: true, task: await save(tabId, old) };
      }
      default:
        return { ok: false, error: '未知的任务指令。' };
    }
  })().then(sendResponse).catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(key(tabId)).catch(() => {});
});
