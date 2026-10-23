
// === 视频批量上传配置：只影响视频，不影响图片 ===
const LOVE_VIDEO_CONFIG = {
    maxFiles: 10,
    requestCooldownMs: 0,         // 默认不主动等待；遇到接口/限流错误时再 0.5 秒重试
    rateLimitStopMs: 15000,
    useLocalPreviewFirst: true,   // 直接从本地视频首帧生成预览图，避免页面“自动生成”频繁报错
    clearExistingBeforeUpload: true, // 视频批量上传前，先清理当前创意已有的视频和预览图
    majorToastDuration: 5200,
    debug: false,
    uploadRetryDelayMs: 500,      // 接口返回错误后暂停 0.5 秒重试
    uploadMaxRetries: 3
};

const LoveRuntime = {
    guardInstalled: false,
    lastNetworkActionAt: 0,
    lastRateLimitAt: 0,
    lastRateLimitMessage: ''
};

function installLoveRuntimeGuards() {
    if (LoveRuntime.guardInstalled) return;
    LoveRuntime.guardInstalled = true;

    window.addEventListener('unhandledrejection', (event) => {
        const msg = extractPlatformMessage(event.reason);
        if (isRateLimitMessage(msg)) {
            recordRateLimit(msg);
        }
    }, true);

    window.addEventListener('error', (event) => {
        const msg = extractPlatformMessage(event.error || event.message);
        if (isRateLimitMessage(msg)) {
            recordRateLimit(msg);
        }
    }, true);
}

function extractPlatformMessage(value, depth = 0) {
    if (depth > 3 || value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    try {
        if (value.message) return String(value.message);
        if (value.msg) return String(value.msg);
        if (value.retcode || value.code) return JSON.stringify(value);
        if (Array.isArray(value)) return value.map(v => extractPlatformMessage(v, depth + 1)).join(' ');
        if (typeof value === 'object') {
            return Object.keys(value).slice(0, 8).map(k => `${k}:${extractPlatformMessage(value[k], depth + 1)}`).join(' ');
        }
    } catch (e) {}
    return '';
}

function isRateLimitMessage(msg) {
    return !!msg && (
        msg.includes('请求频繁') ||
        msg.includes('稍后重试') ||
        msg.includes('509115') ||
        msg.includes('too frequent') ||
        msg.includes('Too Many')
    );
}

function recordRateLimit(msg) {
    LoveRuntime.lastRateLimitAt = Date.now();
    LoveRuntime.lastRateLimitMessage = msg || '请求频繁，请稍后重试';
}

function getRecentRateLimitMessage(windowMs = LOVE_VIDEO_CONFIG.rateLimitStopMs) {
    if (Date.now() - LoveRuntime.lastRateLimitAt <= windowMs) {
        return LoveRuntime.lastRateLimitMessage || '请求频繁，请稍后重试';
    }
    return '';
}

function resetRecentRateLimitRecord() {
    LoveRuntime.lastRateLimitAt = 0;
    LoveRuntime.lastRateLimitMessage = '';
}

async function waitForRequestCooldown(label = '请求', index = '') {
    const elapsed = Date.now() - LoveRuntime.lastNetworkActionAt;
    const waitMs = Math.max(0, LOVE_VIDEO_CONFIG.requestCooldownMs - elapsed);
    if (waitMs > 0) {
        await sleep(waitMs);
    }
}

function noteNetworkAction() {
    LoveRuntime.lastNetworkActionAt = Date.now();
}


// === 0.5 一键素材+文案任务控制：只服务新增功能，不影响原有图片/视频/文案/链接检测 ===
const LoveCombinedTask = {
    active: false,
    cancelled: false,
    reason: '',
    cancelHandlers: new Set(),
    escInstalled: false
};

function installLoveCombinedEscStop() {
    if (LoveCombinedTask.escInstalled) return;
    LoveCombinedTask.escInstalled = true;

    window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' && event.code !== 'Escape' && event.keyCode !== 27) return;
        if (!LoveCombinedTask.active) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        cancelLoveCombinedTask('用户按下 ESC，任务已停止');
    }, true);
}

function beginLoveCombinedTask() {
    installLoveCombinedEscStop();
    LoveCombinedTask.active = true;
    LoveCombinedTask.cancelled = false;
    LoveCombinedTask.reason = '';
}

function finishLoveCombinedTask() {
    resetRecentRateLimitRecord();
    LoveRuntime.lastNetworkActionAt = 0;
    LoveCombinedTask.active = false;
    LoveCombinedTask.cancelled = false;
    LoveCombinedTask.reason = '';
    LoveCombinedTask.cancelHandlers.clear();
}

function cancelLoveCombinedTask(reason = '任务已停止') {
    if (!LoveCombinedTask.active || LoveCombinedTask.cancelled) return;

    LoveCombinedTask.cancelled = true;
    LoveCombinedTask.reason = reason;

    for (const handler of Array.from(LoveCombinedTask.cancelHandlers)) {
        try { handler(); } catch (e) {}
    }

    showToast('已停止', 1800, '🛑');
}

function assertLoveCombinedNotCancelled() {
    if (!LoveCombinedTask.cancelled) return;
    const err = new Error(LoveCombinedTask.reason || '任务已停止');
    err.name = 'LoveCombinedCancelled';
    throw err;
}

function isLoveCombinedCancelError(err) {
    return err && err.name === 'LoveCombinedCancelled';
}

function combinedSleep(ms) {
    return new Promise((resolve, reject) => {
        if (LoveCombinedTask.cancelled) {
            const err = new Error(LoveCombinedTask.reason || '任务已停止');
            err.name = 'LoveCombinedCancelled';
            reject(err);
            return;
        }

        const timer = setTimeout(() => {
            LoveCombinedTask.cancelHandlers.delete(cancelHandler);
            resolve();
        }, ms);

        const cancelHandler = () => {
            clearTimeout(timer);
            LoveCombinedTask.cancelHandlers.delete(cancelHandler);
            const err = new Error(LoveCombinedTask.reason || '任务已停止');
            err.name = 'LoveCombinedCancelled';
            reject(err);
        };

        LoveCombinedTask.cancelHandlers.add(cancelHandler);
    });
}

function raceLoveCombinedCancel(promise) {
    return new Promise((resolve, reject) => {
        if (LoveCombinedTask.cancelled) {
            const err = new Error(LoveCombinedTask.reason || '任务已停止');
            err.name = 'LoveCombinedCancelled';
            reject(err);
            return;
        }

        const cancelHandler = () => {
            LoveCombinedTask.cancelHandlers.delete(cancelHandler);
            const err = new Error(LoveCombinedTask.reason || '任务已停止');
            err.name = 'LoveCombinedCancelled';
            reject(err);
        };

        LoveCombinedTask.cancelHandlers.add(cancelHandler);

        Promise.resolve(promise)
            .then(value => {
                LoveCombinedTask.cancelHandlers.delete(cancelHandler);
                resolve(value);
            })
            .catch(err => {
                LoveCombinedTask.cancelHandlers.delete(cancelHandler);
                reject(err);
            });
    });
}

// === 1. 初始化 UI (🍀 幸运草通知版) ===
function initFloatBall() {
    installLoveRuntimeGuards();
    installLoveCombinedEscStop();
    if (document.getElementById('love-float-ball')) return;

    const ball = document.createElement('div');
    ball.id = 'love-float-ball';
    ball.removeAttribute('style');

    // 注入样式
    const style = document.createElement('style');
    style.innerHTML = `
        #love-toast-container {
            position: fixed; top: 20px; right: 20px; z-index: 2147483647;
            display: flex; flex-direction: column; gap: 10px; pointer-events: none;
        }
        .love-toast-slide {
            background: rgba(255, 255, 255, 0.98); color: #333; padding: 12px 20px;
            border-radius: 8px; font-size: 14px; font-family: sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-left: 4px solid #4CAF50;
            min-width: 200px; transform: translateX(120%); transition: transform 0.3s ease, opacity 0.3s;
            opacity: 0; display: flex; align-items: center; gap: 8px;
        }
        .love-toast-slide.show { transform: translateX(0); opacity: 1; }
        .love-toast-icon { font-size: 18px; }
    `;
    document.head.appendChild(style);

    const toastContainer = document.createElement('div');
    toastContainer.id = 'love-toast-container';
    document.body.appendChild(toastContainer);

    ball.innerHTML = `
        <style>
            #love-float-ball {
                position: fixed !important; bottom: 10px !important; left: 24px !important;
                width: 40px !important; height: 40px !important;
                background: rgba(255, 255, 255, 0.68) !important;
                backdrop-filter: blur(10px) !important;
                -webkit-backdrop-filter: blur(10px) !important;
                border: 1px solid rgba(255,255,255,0.42) !important;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08) !important;
                border-radius: 50px !important; z-index: 2147483647 !important;
                display: flex !important; align-items: center !important; justify-content: center !important;
                overflow: hidden !important; user-select: none !important;
                transition: width 0.25s ease, height 0.25s ease, border-radius 0.25s ease, background 0.2s ease !important;
            }
            #love-float-ball:hover {
                width: 114px !important;
                height: 60px !important;
                border-radius: 18px !important;
                background: rgba(255, 255, 255, 0.92) !important;
            }
            .center-icon { font-size: 22px !important; position: absolute !important; pointer-events: none !important; transition: opacity 0.18s !important; }
            #love-float-ball:hover .center-icon { opacity: 0 !important; }
            .btn-group {
                display: grid !important;
                grid-template-columns: repeat(2, 38px) !important;
                grid-template-rows: 38px !important;
                gap: 8px 10px !important;
                opacity: 0 !important;
                transform: translateY(8px) !important;
                transition: opacity 0.2s 0.06s ease, transform 0.2s 0.06s ease !important;
                pointer-events: none !important;
                align-items: center !important;
                justify-content: center !important;
            }
            #love-float-ball:hover .btn-group { opacity: 1 !important; transform: translateY(0) !important; pointer-events: auto !important; }
            .action-btn {
                font-size: 19px !important; cursor: pointer !important; width: 38px !important; height: 38px !important;
                display: flex !important; align-items: center !important; justify-content: center !important;
                border-radius: 12px !important; background: rgba(65, 95, 255, 0.08) !important;
                border: 1px solid rgba(65, 95, 255, 0.12) !important;
                transition: transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease !important;
            }
            .action-btn:hover { background: rgba(65, 95, 255, 0.16) !important; transform: translateY(-1px) scale(1.05) !important; box-shadow: 0 6px 14px rgba(65,95,255,0.16) !important; }
            #btn-combo { grid-column: 1 !important; grid-row: 1 !important; }
            #btn-link-check { grid-column: 2 !important; grid-row: 1 !important; }
        </style>
        <div class="center-icon">🍀</div>
        <div class="btn-group">
            <div class="action-btn" id="btn-combo" title="一键素材+文案">🧩</div>
            <div class="action-btn" id="btn-link-check" title="检查地址">🔎</div>
        </div>
    `;
    document.body.appendChild(ball);

    const btnCombo = document.getElementById('btn-combo');
    const btnLinkCheck = document.getElementById('btn-link-check');

    btnCombo.onclick = () => {
        openCombinedCreativeDialog();
    };

    btnLinkCheck.onclick = () => {
        runLoveLinkCheck();
    };
}



// === 1.2 vivo DP 链接一键检测：只读页面内容，不提交、不保存、不自动拦截 ===
const LOVE_LINK_CHECK_CONFIG = {
    // 仅用于定位 vivo 广告编辑页面的三个链接输入框，不写死账户和业务编号。
    fields: {
        expose: '曝光监测地址',
        click: '点击监测地址',
        deeplink: 'DeepLink'
    }
};

// 历史基准按 taskId 独立存储；平时仅在用户点击检查地址时按键读取。
// 只有 90 天集中清理或容量已满才读取全部任务；不设置后台定时器。
const LOVE_LINK_LIBRARY = Object.freeze({
    prefix: 'love-link-v1:task:',
    metaKey: 'love-link-v1:meta',
    maxCount: 200,
    ttlMs: 90 * 24 * 60 * 60 * 1000,
    cleanupMs: 90 * 24 * 60 * 60 * 1000
});
let loveLinkCheckRunning = false;

async function runLoveLinkCheck() {
    if (loveLinkCheckRunning) return;
    loveLinkCheckRunning = true;
    try {
        const values = collectLoveLinkFieldValues();
        const errors = validateLoveVivoDpLinks(values);
        if (errors.length) {
            showLoveLinkCheckModal(errors);
            return;
        }
        const links = loveLibrarySnapshot(values);
        const taskId = loveLibraryTaskId(links);
        if (!taskId) {
            showLoveLinkCheckModal(['【业务一致性】未能提取唯一 taskId，请重新检查链接。']);
            return;
        }
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            showLoveLinkCheckModal(['扩展本地存储不可用，请重新加载扩展并检查 storage 权限。']);
            return;
        }
        let state = await loveLibraryLoad(taskId);
        const now = Date.now();
        if (state.meta.lastCleanupAt && now - state.meta.lastCleanupAt >= LOVE_LINK_LIBRARY.cleanupMs) {
            // 先读取并保护本次任务，避免刚好过期时被删掉而失去比对基准。
            state.meta = await loveLibraryCleanup(taskId, now);
        }
        loveLibraryShowState(taskId, links, state.record);
    } catch (err) {
        console.error('[LoveExtension] 链接检查或历史基准读取失败:', err);
        showLoveLinkCheckModal(['链接检测或本地存储操作失败，未保存任何新基准。请重试。']);
    } finally {
        loveLinkCheckRunning = false;
    }
}

function loveLibrarySnapshot(values) {
    // 绝不 trim、解码或排序：用于历史比对的是页面输入框里的完整原始字符串。
    return {
        expose: String(values.expose.value),
        click: String(values.click.value),
        deeplink: String(values.deeplink.value)
    };
}

function loveLibraryTaskId(links) {
    const ids = ['expose', 'click', 'deeplink'].map(key => loveSimpleTaskIds(parseLoveLinkTree(links[key])));
    if (ids.some(values => values.length !== 1)) return '';
    return ids.every(values => values[0] === ids[0][0]) ? ids[0][0] : '';
}

function loveLibraryRecordKey(taskId) {
    return LOVE_LINK_LIBRARY.prefix + taskId;
}

function loveLibraryMeta(raw) {
    const meta = raw && typeof raw === 'object' ? raw : {};
    return {
        count: Number.isInteger(meta.count) && meta.count >= 0 ? meta.count : 0,
        lastCleanupAt: Number.isFinite(meta.lastCleanupAt) ? meta.lastCleanupAt : 0
    };
}

async function loveLibraryLoad(taskId) {
    const key = loveLibraryRecordKey(taskId);
    const data = await chrome.storage.local.get([key, LOVE_LINK_LIBRARY.metaKey]);
    return { record: data[key] || null, meta: loveLibraryMeta(data[LOVE_LINK_LIBRARY.metaKey]) };
}

function loveLibraryMatches(record, links) {
    return Boolean(record && ['expose', 'click', 'deeplink']
        .every(key => typeof record[key] === 'string' && record[key] === links[key]));
}

function loveLibraryValidRecord(record, taskId) {
    return Boolean(record && record.taskId === taskId &&
        ['expose', 'click', 'deeplink'].every(key => typeof record[key] === 'string'));
}

// O(N) 仅在清理周期到了或容量已满时发生，N 上限为 200。
// 使用 task: 前缀过滤，避免碰触扩展的其他存储项。
async function loveLibraryCleanup(protectedTaskId = '', now = Date.now()) {
    const data = await chrome.storage.local.get(null);
    const entries = Object.entries(data).filter(([key]) => key.startsWith(LOVE_LINK_LIBRARY.prefix));
    const expiredKeys = entries.filter(([key, record]) =>
        key !== loveLibraryRecordKey(protectedTaskId) &&
        (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= now)
    ).map(([key]) => key);
    if (expiredKeys.length) await chrome.storage.local.remove(expiredKeys);
    const meta = { count: entries.length - expiredKeys.length, lastCleanupAt: now };
    await chrome.storage.local.set({ [LOVE_LINK_LIBRARY.metaKey]: meta });
    return meta;
}

function loveLibraryDifference(oldText, newText) {
    const a = String(oldText), b = String(newText);
    if (a === b) return null;
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let suffix = 0;
    while (suffix < a.length - start && suffix < b.length - start &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    const oldChanged = a.slice(start, a.length - suffix);
    const newChanged = b.slice(start, b.length - suffix);
    const contextStart = Math.max(0, start - 36);
    const oldEnd = Math.min(a.length, start + Math.max(oldChanged.length, 1) + 36);
    const newEnd = Math.min(b.length, start + Math.max(newChanged.length, 1) + 36);
    const make = (raw, end) => {
        const snippet = raw.slice(contextStart, Math.min(end, contextStart + 140));
        return `${contextStart ? '…' : ''}${snippet}${end < raw.length || end - contextStart > 140 ? '…' : ''}`;
    };
    return {
        position: start + 1,
        oldText: make(a, oldEnd),
        newText: make(b, newEnd),
        oldLength: a.length, newLength: b.length
    };
}

function loveLibraryChangesHtml(record, links) {
    const names = { expose: '曝光', click: '点击', deeplink: 'DP' };
    return ['expose', 'click', 'deeplink'].map(key => {
        const d = loveLibraryDifference(record[key], links[key]);
        if (!d) return `<div class="love-history-line"><b>${names[key]}</b><span class="love-history-match">完全一致</span></div>`;
        return `<div class="love-history-diff">
            <b>${names[key]}链接不一致</b><span>第 ${d.position} 个字符开始不同（长度 ${d.oldLength} → ${d.newLength}）</span>
            <div class="love-history-url">历史：${escapeLoveHtml(d.oldText)}</div>
            <div class="love-history-url">当前：${escapeLoveHtml(d.newText)}</div>
        </div>`;
    }).join('');
}

function loveLibraryShowState(taskId, links, record) {
    const safeTask = escapeLoveHtml(taskId);
    if (!record) {
        showLoveLinkCheckModal([], {
            body: `<div class="love-history-hint">四项基础检测已通过。</div>
                <div class="love-history-title">首次发现任务 <code>${safeTask}</code></div>
                <p>本机没有对应的历史基准，请人工确认这三条链接属于正确业务，再点击「确认添加」。</p>`,
            action: '确认添加基准',
            onAction: () => loveLibraryCommit('add', taskId, links)
        });
        return;
    }
    if (!loveLibraryValidRecord(record, taskId)) {
        showLoveLinkCheckModal(['当前 taskId 的本地基准数据不完整，已停止历史比对和写入，请检查扩展本地存储。']);
        return;
    }
    const expired = !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now();
    const equal = loveLibraryMatches(record, links);
    if (equal && !expired) {
        showLoveLinkCheckModal([], { body: `<div class="love-link-ok">四项基础检测及历史基准严格比对全部通过。</div>
            <p class="love-history-muted">taskId：<code>${safeTask}</code> · 三条链接逐字符完全相同</p>` });
        return;
    }
    if (equal && expired) {
        showLoveLinkCheckModal([], {
            body: `<div class="love-history-hint">三条链接与历史基准完全一致，但该基准已满 90 天。</div>
                <div class="love-history-title">任务 <code>${safeTask}</code> 已过期</div>
                <p>请确认目前链接仍然有效。只有确认后才续期 90 天；取消则不改变记录。</p>`,
            action: '确认续期 90 天',
            onAction: () => loveLibraryCommit('renew', taskId, links)
        });
        return;
    }
    const expiredText = expired ? '<p class="love-history-muted">历史基准已过期，本次仍保留旧值供核对。</p>' : '';
    showLoveLinkCheckModal([], {
        body: `<div class="love-history-alert">发现与历史基准不一致的链接，请先核对是否误操作。</div>
            <p class="love-history-muted">taskId：<code>${safeTask}</code></p>
            ${loveLibraryChangesHtml(record, links)}${expiredText}
            <p>如果业务确实已更换链接，可以人工确认，将当前三条链接整体更新为新的基准。</p>`,
        action: '确认更换并更新基准',
        onAction: () => loveLibraryCommit('update', taskId, links)
    });
}

async function loveLibraryCommit(mode, taskId, originalLinks) {
    // 弹窗打开期间页面可能被修改；提交前必须重检页面数据和基础规则。
    const values = collectLoveLinkFieldValues();
    const errors = validateLoveVivoDpLinks(values);
    const current = errors.length ? null : loveLibrarySnapshot(values);
    if (errors.length || !current || !loveLibraryMatches(originalLinks, current) ||
        loveLibraryTaskId(current) !== taskId) {
        showLoveLinkCheckModal(['页面链接在确认期间发生变化，或基础检测不再通过。未保存，请重新点击「检查地址」。']);
        return;
    }
    const now = Date.now();
    let state = await loveLibraryLoad(taskId);
    const key = loveLibraryRecordKey(taskId);
    if (mode === 'add') {
        if (state.record) {
            showLoveLinkCheckModal(['此 taskId 已有基准记录，不能重复添加。请重新检测。']);
            return;
        }
        if (state.meta.count >= LOVE_LINK_LIBRARY.maxCount) {
            state.meta = await loveLibraryCleanup('', now);
        }
        let victimKey = '';
        if (state.meta.count >= LOVE_LINK_LIBRARY.maxCount) {
            // 没有过期数据可删：只查找 FIFO 最老任务，不按检测次数改变顺序。
            const all = await chrome.storage.local.get(null);
            const records = Object.entries(all).filter(([k]) => k.startsWith(LOVE_LINK_LIBRARY.prefix));
            records.sort((x, y) => (Number(x[1]?.createdAt) || 0) - (Number(y[1]?.createdAt) || 0) || x[0].localeCompare(y[0]));
            if (records.length) victimKey = records[0][0];
        }
        const record = { taskId, ...current, createdAt: now, updatedAt: now, expiresAt: now + LOVE_LINK_LIBRARY.ttlMs };
        if (victimKey) {
            // 先确认新基准已写入成功，再删除 FIFO 旧记录，避免写入失败时先丢失旧基准。
            await chrome.storage.local.set({ [key]: record });
            await chrome.storage.local.remove(victimKey);
            await chrome.storage.local.set({ [LOVE_LINK_LIBRARY.metaKey]: {
                ...state.meta, count: state.meta.count, lastCleanupAt: state.meta.lastCleanupAt || now
            } });
        } else {
            await chrome.storage.local.set({ [key]: record,
                [LOVE_LINK_LIBRARY.metaKey]: { ...state.meta, count: state.meta.count + 1,
                    lastCleanupAt: state.meta.lastCleanupAt || now } });
        }
        showLoveLinkCheckModal([], { body: `<div class="love-link-ok">已确认添加历史基准，三条链接已保存。</div><p>taskId：<code>${escapeLoveHtml(taskId)}</code></p>` });
        return;
    }
    if (!loveLibraryValidRecord(state.record, taskId)) {
        showLoveLinkCheckModal(['原有基准不存在或数据损坏，未执行更新。请重新检测。']);
        return;
    }
    if (mode === 'renew' && !loveLibraryMatches(state.record, current)) {
        showLoveLinkCheckModal(['链接与基准已发生变化，不能直接续期，请重新检测。']);
        return;
    }
    const record = { ...state.record, ...current,
        updatedAt: now, expiresAt: now + LOVE_LINK_LIBRARY.ttlMs };
    await chrome.storage.local.set({ [key]: record });
    showLoveLinkCheckModal([], { body: `<div class="love-link-ok">${mode === 'renew' ? '已确认续期 90 天。' : '已确认更新历史基准，三条链接整体替换成功。'}</div>
        <p>taskId：<code>${escapeLoveHtml(taskId)}</code></p>` });
}

function collectLoveLinkFieldValues() {
    return {
        expose: readLoveFieldByLabel(LOVE_LINK_CHECK_CONFIG.fields.expose),
        click: readLoveFieldByLabel(LOVE_LINK_CHECK_CONFIG.fields.click),
        deeplink: readLoveFieldByLabel(LOVE_LINK_CHECK_CONFIG.fields.deeplink)
    };
}

function readLoveFieldByLabel(labelText) {
    const field = findLoveInputNearLabel(labelText);
    if (!field) {
        return { label: labelText, value: '', found: false, element: null };
    }
    return {
        label: labelText,
        value: getLoveControlValue(field),
        found: true,
        element: field
    };
}

function findLoveInputNearLabel(labelText) {
    const labels = findLoveLabelElements(labelText);
    const controls = getVisibleLoveFormControls();

    for (const label of labels) {
        // 不写死 ep-id-xxxx。只把 label.for 当作“页面当前生成的临时桥梁”使用。
        // 只要 label 文本仍是“曝光监测地址 / 点击监测地址 / DeepLink”，即使 id 变化也能重新定位。
        const byFor = findControlByLabelFor(label, controls);
        if (byFor) return byFor;

        // 当前页面的主结构：.ep-form-item 里左侧 label，右侧 textarea。
        // 这一层比纯坐标查找稳，也能避开右侧“管理xxx”按钮。
        const byFormItem = findControlInSameFormItem(label, controls);
        if (byFormItem) return byFormItem;

        // 如果以后组件库小改，label.for 不存在，但输入框仍在 label 后面的兄弟节点里，用这一层兜底。
        const bySibling = findControlBySiblingAfterLabel(label, controls);
        if (bySibling) return bySibling;

        // 再向上找祖先容器，兼容外层包裹结构变化。
        const byAncestor = findControlByAncestor(label, controls);
        if (byAncestor) return byAncestor;

        // 最后才用视觉位置兜底：找同一行右侧最近的输入框。
        const byGeometry = findControlByGeometry(label, controls);
        if (byGeometry) return byGeometry;
    }

    return null;
}

function findLoveLabelElements(labelText) {
    const wanted = normalizeLoveText(labelText);
    const exact = [];
    const loose = [];

    // 当前页面三项都是 label 标签；span/div 只作为兜底。
    // 注意：页面右侧有“管理曝光监测地址 / 管理DeepLink”按钮，所以必须优先精确匹配。
    const nodes = Array.from(document.querySelectorAll('label, span, div, p, td, th'));

    for (const el of nodes) {
        if (!isElementVisible(el)) continue;
        if (el.closest('#love-float-ball, #love-link-check-modal, #love-text-fill-modal')) continue;

        const text = normalizeLoveText(el.innerText || el.textContent || '');
        if (!text) continue;

        if (text === wanted) {
            exact.push(el);
            continue;
        }

        // 兜底匹配只接受非常短的文本，避免匹配到“管理xxx”按钮或大容器。
        const maybeLabel = text.length <= wanted.length + 2 && text.includes(wanted);
        const notManagementButton = !text.startsWith('管理') && !el.closest('button, .ep-button, .el-button');
        if (maybeLabel && notManagementButton) {
            loose.push(el);
        }
    }

    // 如果存在精确标签，就只用精确标签；不要再把“管理DeepLink”这类按钮混进来。
    const result = exact.length > 0 ? exact : loose;

    // 排序原则：label 标签优先；有 for 属性优先；面积小的优先。
    return result.sort((a, b) => {
        const aScore = (a.tagName === 'LABEL' ? -1000 : 0) + (a.getAttribute('for') ? -500 : 0);
        const bScore = (b.tagName === 'LABEL' ? -1000 : 0) + (b.getAttribute('for') ? -500 : 0);
        if (aScore !== bScore) return aScore - bScore;
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
    });
}

function findControlByLabelFor(labelEl, controls) {
    const targetId = labelEl.getAttribute && labelEl.getAttribute('for');
    if (!targetId) return null;

    let target = null;
    try {
        target = document.getElementById(targetId) || document.querySelector(`#${CSS.escape(targetId)}`);
    } catch (e) {
        target = document.getElementById(targetId);
    }

    if (target && controls.includes(target)) return target;

    // 有些组件会把 id 挂在内部 textarea/input，label.for 指向外层或反过来，这里做一次近邻兜底。
    const formItem = labelEl.closest('.ep-form-item, .el-form-item, [role="group"]');
    if (formItem) {
        const local = controls.filter(control => formItem.contains(control));
        if (local.length === 1) return local[0];
        if (local.length > 1) return preferTextareaControl(local) || findControlByGeometry(labelEl, local);
    }

    return null;
}

function findControlInSameFormItem(labelEl, controls) {
    const formItem = labelEl.closest('.ep-form-item, .el-form-item, [role="group"]');
    if (!formItem) return null;

    const local = controls.filter(control => formItem.contains(control));
    if (local.length === 1) return local[0];
    if (local.length > 1) {
        return preferTextareaControl(local) || findControlByGeometry(labelEl, local);
    }
    return null;
}

function findControlBySiblingAfterLabel(labelEl, controls) {
    const visited = new Set();

    function collectFrom(node) {
        if (!node || visited.has(node)) return [];
        visited.add(node);
        return controls.filter(control => node.contains(control));
    }

    // 先看 label 后面的兄弟节点。
    let sibling = labelEl.nextElementSibling;
    for (let i = 0; i < 5 && sibling; i += 1) {
        const local = collectFrom(sibling);
        if (local.length === 1) return local[0];
        if (local.length > 1) return preferTextareaControl(local) || findControlByGeometry(labelEl, local);
        sibling = sibling.nextElementSibling;
    }

    // 再看 label 父节点后面的兄弟节点，兼容 label 和 content 分开包裹的结构。
    let parentSibling = labelEl.parentElement?.nextElementSibling || null;
    for (let i = 0; i < 5 && parentSibling; i += 1) {
        const local = collectFrom(parentSibling);
        if (local.length === 1) return local[0];
        if (local.length > 1) return preferTextareaControl(local) || findControlByGeometry(labelEl, local);
        parentSibling = parentSibling.nextElementSibling;
    }

    return null;
}

function preferTextareaControl(controls) {
    return controls.find(el => el.tagName === 'TEXTAREA') || controls.find(el => el.tagName === 'INPUT') || controls[0] || null;
}

function getVisibleLoveFormControls() {
    return Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
        .filter(el => {
            if (!isElementVisible(el)) return false;
            if (el.closest('#love-float-ball, #love-link-check-modal, #love-text-fill-modal')) return false;
            if (el.tagName === 'INPUT') {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                if (['hidden', 'file', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(type)) return false;
            }
            return true;
        });
}

function findControlByAncestor(labelEl, controls) {
    let node = labelEl;
    for (let depth = 0; depth < 7 && node; depth += 1) {
        const localControls = controls.filter(control => node.contains(control));
        if (localControls.length === 1) return localControls[0];
        if (localControls.length > 1) {
            const byGeometry = findControlByGeometry(labelEl, localControls);
            if (byGeometry) return byGeometry;
        }
        node = node.parentElement;
    }
    return null;
}

function findControlByGeometry(labelEl, controls) {
    const lr = labelEl.getBoundingClientRect();
    const labelMidY = lr.top + lr.height / 2;

    const candidates = controls
        .map(control => {
            const cr = control.getBoundingClientRect();
            const controlMidY = cr.top + cr.height / 2;
            const yDistance = Math.abs(controlMidY - labelMidY);
            const xDistance = Math.abs(cr.left - lr.right);
            const isRightSide = cr.left >= lr.left - 10;
            const verticalOverlap = !(cr.bottom < lr.top - 12 || cr.top > lr.bottom + 12);
            return { control, yDistance, xDistance, isRightSide, verticalOverlap };
        })
        .filter(item => item.isRightSide && (item.verticalOverlap || item.yDistance <= 36))
        .sort((a, b) => (a.yDistance - b.yDistance) || (a.xDistance - b.xDistance));

    return candidates[0]?.control || null;
}

function getLoveControlValue(control) {
    if (!control) return '';
    // 保留输入的空格以便基础格式检查发现复制/粘贴错误。
    if ('value' in control) return String(control.value || '');
    return String(control.innerText || control.textContent || '');
}

// === 精简版「检查地址」：只检验四项，不需要获取乘风原始链接。 ===
// 1. partnerId 删除是否完整、是否误删分隔符
// 2. 曝光/点击/DP 类型与基础 URL 格式
// 3. 三条链接是否均为 vivo 且渠道标识一致
// 4. 三条链接的 ugParams.taskId 是否一致
function validateLoveVivoDpLinks(values) {
    const errors = [];
    const entries = [
        { type: 'expose', item: values.expose },
        { type: 'click', item: values.click },
        { type: 'deeplink', item: values.deeplink }
    ];
    const checked = {};

    for (const { type, item } of entries) {
        const label = item && item.label || LOVE_LINK_CHECK_CONFIG.fields[type];
        if (!item || !item.found) {
            errors.push(`【${label}】未找到输入框，请进入包含广告链接的编辑页面。`);
            continue;
        }
        const value = String(item.value || '');
        if (!value.trim()) {
            errors.push(`【${label}】链接不能为空。`);
            continue;
        }
        const tree = parseLoveLinkTree(value);
        const validType = loveSimpleCheckType(type, label, tree, errors);
        const validSyntax = loveSimpleCheckSyntax(label, value, tree, errors);
        if (type !== 'deeplink') loveSimpleCheckPartnerId(label, tree, errors);
        checked[type] = { label, tree, validType, validSyntax };
    }

    // 一条链接已经丢失/格式损坏时，不再围绕它制造渠道、taskId 等衍生警告。
    if (entries.every(({ type }) => checked[type] && checked[type].validType && checked[type].validSyntax)) {
        loveSimpleCheckChannels(checked, errors);
        loveSimpleCheckTaskIds(checked, errors);
    }
    return dedupeLoveErrors(errors);
}

function loveSimpleCheckType(type, label, tree, errors) {
    const root = tree.root;
    const protocol = (root.protocol || '').toLowerCase();
    const host = (root.host || '').toLowerCase();
    const path = (root.path || '').replace(/\/+$/, '').toLowerCase();
    if (type === 'deeplink') {
        if (protocol !== 'alipays:' || host !== 'platformapi' || path !== '/startapp') {
            errors.push(`【${label}】链接类型错误：这里应填写 alipays://platformapi/startapp 的 DP 链接。`);
            return false;
        }
        return true;
    }
    if (!['http:', 'https:'].includes(protocol) || host !== 'ugapi.alipay.com' || path !== '/monitor') {
        errors.push(`【${label}】链接类型错误：应填写支付宝 ugapi.alipay.com/monitor 监测链接。`);
        return false;
    }
    const actions = loveSimpleRootValues(root, 'action');
    if (actions.length !== 1 || actions[0] !== type) {
        errors.push(`【${label}】链接类型错误：action 应为 ${type === 'expose' ? 'expose（曝光）' : 'click（点击）'}，当前是 ${actions.join('、') || '缺失'}。`);
        return false;
    }
    return true;
}

function loveSimpleRootValues(root, key) {
    return (root && root.params || [])
        .filter(param => param.key.toLowerCase() === key.toLowerCase())
        .map(param => normalizeLoveParamValue(param.valueDecoded || param.valueRaw));
}

function loveSimpleCheckSyntax(label, raw, tree, errors) {
    const issues = [];
    const add = value => { if (!issues.includes(value)) issues.push(value); };
    if (/\s/.test(raw)) add('存在空格或换行');
    if (/[＆？＝％＃]/.test(raw)) add('包含中文全角连接符');
    if (/%(?![\da-fA-F]{2})/.test(raw)) add('百分号编码格式不正确');
    if (/&&|\?&/.test(raw)) add('出现多余的 & 连接符');
    if (/[?&]$/.test(raw)) add('链接末尾残留 ? 或 &');

    const root = tree.root;
    const query = root && root.queryPart || '';
    // 只针对外层查询字符串检查：不能把编码后的 ugParams 内的 & 误当作分隔符。
    for (const part of query.split('&')) {
        if (!part) continue; // 已由多余连接符规则统一处理。
        const equalIndex = part.indexOf('=');
        if (equalIndex < 0) {
            add(`字段缺少 =：${shortLoveText(part, 65)}`);
            continue;
        }
        const key = part.slice(0, equalIndex);
        const value = part.slice(equalIndex + 1);
        if (!key || /[\s?#/]/.test(key)) add(`参数名称异常：${shortLoveText(key, 50) || '空字段名'}`);

        // 常见误删：&pid=123&partnerId=***&ugParams=... 被删成 pid=123ugParams=...
        // 只识别清楚出现的「另一个字段名=」，不把正常 Base64 / URL 嵌套参数误报为断链。
        const isNested = isLoveNestedParamKey(key) || key.toLowerCase() === 'page';
        if (!isNested) {
            const glued = value.match(/(?:partnerId|partnerld|ugParams|requestFrom|taskId|campaignid|clickid|accountid|adid|cid|timestamp|pid|action)=/i);
            if (glued) add(`疑似少了 &，${key} 与 ${glued[0].slice(0, -1)} 字段粘连（${shortLoveText(part, 95)}）`);
        }
    }
    if (issues.length) {
        // 一个链接的格式问题合成一条提醒，不因解析失败派生十几条关联错误。
        errors.push(`【${label}】链接格式异常：${issues.join('；')}。请检查删除 partnerId 时是否误删连接符。`);
        return false;
    }
    return true;
}

function loveSimpleCheckPartnerId(label, tree, errors) {
    // 只检查监测链接的外层 partnerId 字段；DeepLink 不需要删除。
    const root = tree.root;
    const remaining = (root && root.params || []).some(param => /^partner(?:id|ld)$/i.test(param.key));
    if (remaining) errors.push(`【${label}】partnerId 未完整删除：请把整个参数（含正确一侧的 &）删除，保留相邻字段之间的一个 &。`);
}

function loveSimpleExtractChannels(tree) {
    const records = [];
    // 监测链接的 requestFrom 在外层，media 在 ugParams 嵌套层。
    for (const value of loveSimpleRootValues(tree.root, 'requestFrom')) {
        if (value) records.push({ field: 'requestFrom', value });
    }
    for (const layer of tree.layers || []) {
        if ((layer.sourceKey || '').toLowerCase() !== 'ugparams') continue;
        for (const param of layer.params || []) {
            if (param.key.toLowerCase() !== 'media') continue;
            const value = normalizeLoveParamValue(param.valueDecoded || param.valueRaw);
            if (value) records.push({ field: 'ugParams.media', value });
        }
    }
    return records;
}

function loveSimpleCheckChannels(checked, errors) {
    const labels = ['expose', 'click', 'deeplink'];
    const entries = labels.flatMap(type => loveSimpleExtractChannels(checked[type].tree)
        .map(item => ({ label: checked[type].label, ...item })));
    const missing = labels.filter(type => !entries.some(entry => entry.label === checked[type].label))
        .map(type => checked[type].label);
    const distinct = [...new Set(entries.map(entry => entry.value.toLowerCase()))];
    const shortLabel = label => label === checked.expose.label ? '曝光'
        : label === checked.click.label ? '点击' : 'DP';
    const summary = distinct.map(value => {
        const fields = entries.filter(entry => entry.value.toLowerCase() === value)
            .map(entry => `${shortLabel(entry.label)}.${entry.field}`);
        return `${value}（${[...new Set(fields)].join('、')}）`;
    }).join('；');
    const issues = [];
    if (missing.length) issues.push(`${missing.map(shortLabel).join('、')}缺少可识别的渠道字段`);
    if (distinct.some(value => !value.startsWith('vivo'))) issues.push(`存在非 vivo 渠道：${summary}`);
    else if (distinct.length > 1) issues.push(`渠道标识不一致：${summary}`);
    // 所有渠道问题只输出一条，避免一个字母不同引发多次错误。
    if (issues.length) errors.push(`【vivo 渠道】${issues.join('；')}。`);
}

function loveSimpleTaskIds(tree) {
    const result = [];
    for (const layer of tree.layers || []) {
        if ((layer.sourceKey || '').toLowerCase() !== 'ugparams') continue;
        for (const param of layer.params || []) {
            if (param.key.toLowerCase() !== 'taskid') continue;
            const value = normalizeLoveParamValue(param.valueDecoded || param.valueRaw);
            if (value) result.push(value);
        }
    }
    return [...new Set(result)];
}

function loveSimpleCheckTaskIds(checked, errors) {
    const entries = ['expose', 'click', 'deeplink'].map(type => ({
        label: checked[type].label,
        values: loveSimpleTaskIds(checked[type].tree)
    }));
    if (entries.some(entry => entry.values.length !== 1)) {
        const details = entries.map(entry => `${entry.label}=${entry.values.join('、') || '未找到'}`).join('；');
        errors.push(`【业务一致性】无法确认三条链接属于同一业务：${details}。请检查 ugParams.taskId。`);
        return;
    }
    if (new Set(entries.map(entry => entry.values[0])).size !== 1) {
        errors.push(`【业务一致性】三条链接的 taskId 不一致：${entries.map(entry => `${entry.label}=${entry.values[0]}`).join('；')}。`);
    }
}

function isLoveDeepLink(link) {
    const root = parseLoveLinkTree(link).root;
    if (!root) return false;
    const hostPath = `${root.host || ''}${root.path || ''}`.replace(/^\/+/, '').toLowerCase();
    return /^alipays:$/i.test(root.protocol) && hostPath === 'platformapi/startapp';
}

function getLoveMeaningfulParamValues(link, keys) {
    const tree = parseLoveLinkTree(link);
    return getLoveMeaningfulParamValuesFromTree(tree, keys);
}

function getLoveMeaningfulParamValuesFromTree(tree, keys) {
    const values = getLoveParamValuesFromTree(tree, keys)
        .map(v => normalizeLoveParamValue(v))
        .filter(v => !isLovePlaceholderValue(v));
    return Array.from(new Set(values));
}

function getLoveParamValues(link, keys) {
    return getLoveParamValuesFromTree(parseLoveLinkTree(link), keys);
}

function getLoveParamValuesFromTree(tree, keys) {
    const wantedKeys = keys.map(k => k.toLowerCase());
    const values = [];
    for (const param of tree.params) {
        if (wantedKeys.includes(param.key.toLowerCase())) {
            values.push(param.valueDecoded || param.valueRaw);
        }
    }
    return values;
}

function getLoveLayerMeaningfulParamValues(layer, keys) {
    if (!layer) return [];
    return getLoveParamValuesFromLayers([layer], keys).filter(v => !isLovePlaceholderValue(v));
}

function getLoveParamValuesFromLayers(layers, keys) {
    const wantedKeys = keys.map(k => k.toLowerCase());
    const values = [];
    for (const layer of layers || []) {
        for (const param of layer.params || []) {
            if (wantedKeys.includes(param.key.toLowerCase())) {
                values.push(normalizeLoveParamValue(param.valueDecoded || param.valueRaw));
            }
        }
    }
    return Array.from(new Set(values));
}

function parseLoveLinkTree(link) {
    const raw = normalizeLoveUrlText(String(link || '').trim());
    const tree = { raw, root: null, layers: [], params: [] };
    const root = parseLoveLayer(raw, 'outer', '', 0);
    tree.root = root;
    addLoveLayerToTree(tree, root);
    collectLoveNestedLayers(tree, root, 0);
    return tree;
}

function addLoveLayerToTree(tree, layer) {
    if (!layer) return;
    tree.layers.push(layer);
    for (const param of layer.params) {
        tree.params.push({
            ...param,
            layerName: layer.name,
            layerDisplayName: layer.displayName
        });
    }
}

function collectLoveNestedLayers(tree, layer, depth) {
    if (!layer || depth >= 4) return;

    for (const param of layer.params) {
        const keyLower = param.key.toLowerCase();
        if (!isLoveNestedParamKey(keyLower)) continue;

        const candidates = loveDecodeLayers(param.valueRaw, 4)
            .map(text => normalizeLoveUrlText(text))
            .filter(Boolean);

        for (const candidate of candidates) {
            if (!looksLikeNestedLoveContent(candidate)) continue;
            const nested = parseLoveLayer(candidate, param.key, param.key, depth + 1);
            if (!nested || loveLayerAlreadyExists(tree, nested)) continue;
            addLoveLayerToTree(tree, nested);
            collectLoveNestedLayers(tree, nested, depth + 1);
        }
    }
}

function loveLayerAlreadyExists(tree, layer) {
    return tree.layers.some(item => item.name === layer.name && item.raw === layer.raw && item.sourceKey === layer.sourceKey);
}

function parseLoveLayer(text, name, sourceKey = '', depth = 0) {
    const raw = normalizeLoveUrlText(String(text || '').trim());
    const info = getLoveUrlInfo(raw);
    const queryPart = getLoveRawQueryPart(raw);
    const displayName = getLoveLayerDisplayName(name, depth);
    const { params, issues } = parseLoveParamSegments(queryPart, displayName);
    return {
        raw,
        name,
        sourceKey,
        depth,
        displayName,
        protocol: info.protocol,
        host: info.host,
        path: info.path,
        queryPart,
        params,
        issues
    };
}

function getLoveUrlInfo(text) {
    const result = { protocol: '', host: '', path: '' };
    const raw = String(text || '').trim();

    try {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
            const u = new URL(raw);
            result.protocol = u.protocol;
            result.host = u.hostname;
            result.path = u.pathname || '';
            return result;
        }
    } catch (e) {
        // URL 解析失败时继续走手动解析兜底。
    }

    const match = raw.match(/^([A-Za-z][A-Za-z0-9+.-]*:)?\/\/([^/?#]+)([^?#]*)?/);
    if (match) {
        result.protocol = match[1] || '';
        result.host = match[2] || '';
        result.path = match[3] || '';
    }
    return result;
}

function getLoveRawQueryPart(text) {
    const raw = String(text || '');
    const qIndex = raw.indexOf('?');
    if (qIndex >= 0) {
        return raw.slice(qIndex + 1).split('#')[0];
    }

    // 已经被解码出来的参数串，例如 targetId=xxx&media=vivoxxl。
    if (looksLikeParamString(raw)) {
        return raw.split('#')[0];
    }

    return '';
}

function parseLoveParamSegments(queryPart, layerDisplayName = '') {
    const params = [];
    const issues = [];
    if (!queryPart) return { params, issues };

    const segments = String(queryPart).split('&');
    segments.forEach((segment, index) => {
        const position = index + 1;
        if (segment === '') {
            issues.push(`${layerDisplayName}第 ${position} 个字段为空，请检查是否多写了 &。`);
            return;
        }

        const eqIndex = segment.indexOf('=');
        if (eqIndex < 0) {
            issues.push(`${layerDisplayName}第 ${position} 个字段缺少等号：${shortLoveText(segment)}。`);
            return;
        }

        const key = segment.slice(0, eqIndex).trim();
        const valueRaw = segment.slice(eqIndex + 1).trim();
        params.push({
            key,
            valueRaw,
            valueDecoded: safeLoveDecodeRepeated(valueRaw, 3),
            rawSegment: segment,
            position
        });
    });

    return { params, issues };
}

function getLoveLayerDisplayName(name, depth) {
    if (name === 'outer') return '';
    if (name) return `【${name}嵌套层】`;
    return depth > 0 ? `【第${depth}层】` : '';
}

function isLoveNestedParamKey(key) {
    const k = String(key || '').toLowerCase();
    return [
        'url', 'scheme', 'ugparams', 'targeturl', 'redirecturl',
        'landingurl', 'deeplink', 'deeplinkurl', 'deep_link',
        'h5url', 'pageurl', 'jumpurl', 'linkurl'
    ].includes(k);
}

function looksLikeNestedLoveContent(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (/^https?:\/\//i.test(value) || /^alipays:\/\//i.test(value)) return true;
    return looksLikeParamString(value);
}

function looksLikeParamString(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (!/[A-Za-z_][A-Za-z0-9_]{0,60}=/.test(value)) return false;
    return value.includes('&') || /^[A-Za-z_][A-Za-z0-9_]{0,60}=/.test(value);
}

function safeLoveDecodeRepeated(text, maxLayers = 3) {
    const layers = loveDecodeLayers(text, maxLayers);
    return layers[layers.length - 1] || String(text || '');
}

function loveDecodeLayers(text, maxLayers = 4) {
    const layers = [];
    let current = normalizeLoveUrlText(String(text || '').trim());

    for (let i = 0; i < maxLayers; i += 1) {
        if (!layers.includes(current)) layers.push(current);
        let next = current;
        try {
            next = decodeURIComponent(current.replace(/\+/g, '%20'));
            next = normalizeLoveUrlText(next);
        } catch (e) {
            break;
        }
        if (next === current) break;
        current = next;
    }

    return layers;
}

function normalizeLoveUrlText(text) {
    return String(text || '').replace(/&amp;/gi, '&').trim();
}

function normalizeLoveParamValue(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function isLovePlaceholderValue(value) {
    const v = normalizeLoveParamValue(value);
    if (!v) return true;
    if (/^_+[A-Z0-9]+_+$/i.test(v)) return true;
    if (/^(xxxx|yyyy|null|undefined|-|\*\*\*)$/i.test(v)) return true;
    return false;
}

function formatLoveValues(values) {
    if (!values || values.length === 0) return '空/未检测到';
    return values.join('、');
}

function addUniqueLoveError(errors, seenMessages, message) {
    if (seenMessages.has(message)) return;
    seenMessages.add(message);
    errors.push(message);
}

function dedupeLoveErrors(errors) {
    return Array.from(new Set(errors));
}

function shortLoveText(text, maxLen = 120) {
    const value = String(text || '');
    if (value.length <= maxLen) return value;
    return value.slice(0, maxLen) + '...';
}

function normalizeLoveText(text) {
    return String(text || '').replace(/\s+/g, '').trim();
}

function escapeLoveHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showLoveLinkCheckModal(errors, options = {}) {
    const existing = document.getElementById('love-link-check-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'love-link-check-modal';
    const hasErrors = errors && errors.length > 0;

    modal.innerHTML = `
        <style>
            #love-link-check-modal {
                position: fixed !important;
                inset: 0 !important;
                z-index: 2147483647 !important;
                background: rgba(0, 0, 0, 0.35) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
            }
            #love-link-check-modal .love-link-dialog {
                width: 560px !important;
                max-width: calc(100vw - 40px) !important;
                max-height: calc(100vh - 80px) !important;
                background: #fff !important;
                border-radius: 14px !important;
                box-shadow: 0 16px 44px rgba(0,0,0,0.25) !important;
                overflow: hidden !important;
            }
            #love-link-check-modal .love-link-header {
                height: 52px !important;
                padding: 0 18px 0 22px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                border-bottom: 1px solid #eef0f5 !important;
                font-size: 16px !important;
                font-weight: 700 !important;
                color: #222 !important;
            }
            #love-link-check-modal .love-link-close {
                cursor: pointer !important;
                font-size: 24px !important;
                color: #999 !important;
                line-height: 1 !important;
                padding: 4px 6px !important;
                user-select: none !important;
            }
            #love-link-check-modal .love-link-body {
                padding: 18px 22px 22px !important;
                overflow: auto !important;
                max-height: calc(100vh - 160px) !important;
            }
            #love-link-check-modal .love-link-ok {
                color: #159947 !important;
                font-size: 16px !important;
                font-weight: 700 !important;
                line-height: 1.8 !important;
            }
            #love-link-check-modal .love-link-error-list {
                margin: 0 !important;
                padding: 0 !important;
                list-style: none !important;
            }
            #love-link-check-modal .love-history-title { font-size: 15px; font-weight: 700; margin: 12px 0 8px; }
            #love-link-check-modal .love-history-hint { color: #159947; font-weight: 650; }
            #love-link-check-modal .love-history-alert { color: #dc2626; font-weight: 700; }
            #love-link-check-modal .love-history-muted { color: #64748b; font-size: 12px; }
            #love-link-check-modal .love-history-line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #edf0f4; }
            #love-link-check-modal .love-history-match { color: #159947; }
            #love-link-check-modal .love-history-diff { border-bottom: 1px dashed #f1c7c7; padding: 10px 0; color: #c52b2b; }
            #love-link-check-modal .love-history-diff b { display: inline-block; margin-right: 12px; }
            #love-link-check-modal .love-history-diff span { font-size: 12px; }
            #love-link-check-modal .love-history-url { font-size: 12px; color: #525b6a; margin: 6px 0; padding: 7px; border-radius: 6px; background: #f5f7fa; overflow-wrap: anywhere; white-space: pre-wrap; }
            #love-link-check-modal .love-history-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
            #love-link-check-modal .love-history-actions button { padding: 9px 16px; border-radius: 7px; border: 1px solid #d5dbe5; background: #fff; cursor: pointer; font-weight: 650; }
            #love-link-check-modal .love-history-actions button.love-history-primary { background: #2c60d3; color: #fff; border-color: #2c60d3; }
            #love-link-check-modal .love-link-error-list li {
                color: #e02020 !important;
                font-size: 14px !important;
                font-weight: 700 !important;
                line-height: 1.65 !important;
                padding: 8px 0 !important;
                border-bottom: 1px dashed #f1c7c7 !important;
                word-break: break-all !important;
            }
        </style>
        <div class="love-link-dialog">
            <div class="love-link-header">
                <span>请逐项人工复核以下检测结果</span>
                <span class="love-link-close" id="love-link-check-close">×</span>
            </div>
            <div class="love-link-body">
                ${hasErrors
                    ? `<ul class="love-link-error-list">${errors.map(err => `<li>${escapeLoveHtml(err)}</li>`).join('')}</ul>`
                    : (options.body || `<div class="love-link-ok">未发现错误</div>`)
                }
                ${!hasErrors && options.action ? `<div class="love-history-actions">
                    <button type="button" class="love-history-cancel">暂不操作</button>
                    <button type="button" class="love-history-primary">${escapeLoveHtml(options.action)}</button>
                </div>` : ''}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('#love-link-check-close').onclick = close;
    const cancel = modal.querySelector('.love-history-cancel');
    if (cancel) cancel.onclick = close;
    const action = modal.querySelector('.love-history-primary');
    if (action && typeof options.onAction === 'function') {
        action.onclick = async () => {
            if (action.disabled) return;
            action.disabled = true;
            action.textContent = '正在保存…';
            try {
                await options.onAction();
            } catch (err) {
                console.error('[LoveExtension] 历史基准写入失败:', err);
                showLoveLinkCheckModal(['本地存储写入失败，未确认保存成功。请重新检测或重试。']);
            }
        };
    }
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) close();
    });
}



function disableLoveTextInputHistory(inputs) {
    const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    inputs.filter(Boolean).forEach((input, index) => {
        const uniqueName = `love_text_${token}_${index}`;

        // 这些属性只作用于插件弹窗输入框，不影响页面原本样式和图片/视频逻辑。
        input.setAttribute('name', uniqueName);
        input.setAttribute('autocomplete', 'new-password');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('data-lpignore', 'true');
        input.setAttribute('data-form-type', 'other');

        // Chrome 有时会忽略 autocomplete=off/new-password。
        // readonly 延迟解除可以阻止聚焦瞬间弹出历史记录下拉框。
        input.setAttribute('readonly', 'readonly');

        const unlock = () => {
            setTimeout(() => {
                input.removeAttribute('readonly');
                input.setAttribute('autocomplete', 'new-password');
            }, 60);
        };

        input.addEventListener('focus', unlock);
        input.addEventListener('mousedown', unlock);
        input.addEventListener('touchstart', unlock, { passive: true });
    });
}

// === 1.0 一键素材+应用文案：新增功能，独立于原有图片/视频/文案/链接检测入口 ===
function openCombinedCreativeDialog() {
    const existing = document.getElementById('love-combined-modal');
    if (existing) existing.remove();

    const context = detectCurrentAdCreativeContext();

    const overlay = document.createElement('div');
    overlay.id = 'love-combined-modal';
    const mediaLabel = context.mediaKind === 'video' ? '视频' : (context.mediaKind === 'image' ? '图片' : '图片/视频');
    const accept = context.mediaKind === 'video'
        ? 'video/*,.mp4'
        : (context.mediaKind === 'image' ? 'image/*,.jpg,.jpeg,.png,.gif' : 'image/*,video/*,.jpg,.jpeg,.png,.gif,.mp4');

    overlay.innerHTML = `
        <style>
            #love-combined-modal {
                position: fixed !important;
                inset: 0 !important;
                z-index: 2147483647 !important;
                background: rgba(0, 0, 0, 0.38) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
            }
            #love-combined-modal .love-combined-dialog {
                width: 460px !important;
                background: #fff !important;
                border-radius: 14px !important;
                box-shadow: 0 14px 42px rgba(0,0,0,0.24) !important;
                overflow: hidden !important;
            }
            #love-combined-modal .love-combined-header {
                padding: 16px 20px !important;
                border-bottom: 1px solid #eef0f5 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                color: #222 !important;
                font-size: 16px !important;
                font-weight: 700 !important;
            }
            #love-combined-modal .love-combined-close {
                cursor: pointer !important;
                font-size: 22px !important;
                color: #999 !important;
                line-height: 1 !important;
                user-select: none !important;
            }
            #love-combined-modal .love-combined-body { padding: 18px 20px 8px !important; }
            #love-combined-modal .love-combined-context {
                margin-bottom: 14px !important;
                padding: 10px 12px !important;
                border-radius: 10px !important;
                background: rgba(65,95,255,0.07) !important;
                color: #415fff !important;
                font-size: 12px !important;
                line-height: 1.6 !important;
            }
            #love-combined-modal .love-combined-field { margin-bottom: 14px !important; }
            #love-combined-modal label {
                display: block !important;
                margin-bottom: 8px !important;
                font-size: 13px !important;
                color: #333 !important;
                font-weight: 600 !important;
            }
            #love-combined-modal input[type="text"], #love-combined-modal input[type="file"] {
                width: 100% !important;
                box-sizing: border-box !important;
                min-height: 38px !important;
                border: 1px solid #dcdfe6 !important;
                border-radius: 8px !important;
                padding: 8px 12px !important;
                font-size: 14px !important;
                outline: none !important;
                background: #fff !important;
            }
            #love-combined-modal input[type="text"]:focus {
                border-color: #415fff !important;
                box-shadow: 0 0 0 2px rgba(65,95,255,0.12) !important;
            }
            #love-combined-modal .love-combined-tip {
                color: #888 !important;
                font-size: 12px !important;
                line-height: 1.55 !important;
                margin-top: 2px !important;
            }
            #love-combined-modal .love-combined-footer {
                padding: 14px 20px 18px !important;
                display: flex !important;
                justify-content: flex-end !important;
                gap: 10px !important;
            }
            #love-combined-modal button {
                min-width: 88px !important;
                height: 34px !important;
                border-radius: 18px !important;
                border: 1px solid #dcdfe6 !important;
                background: #fff !important;
                cursor: pointer !important;
                font-size: 14px !important;
            }
            #love-combined-modal .love-combined-confirm {
                background: #415fff !important;
                color: white !important;
                border-color: #415fff !important;
            }
        </style>
        <div class="love-combined-dialog">
            <div class="love-combined-header">
                <span>一键处理素材和标题</span>
                <span class="love-combined-close" id="love-combined-close">×</span>
            </div>
            <div class="love-combined-body">
                <div class="love-combined-field">
                    <label for="love-combined-file">选择${mediaLabel}素材</label>
                    <input id="love-combined-file" type="file" accept="${accept}" multiple>
                    <div class="love-combined-tip">可选。选择素材时会按创意 1、创意 2、创意 3……依次上传；不选择素材时只处理标题。</div>
                </div>
                <div class="love-combined-field">
                    <label for="love-combined-app-name">标题 / 名称</label>
                    <input id="love-combined-app-name" type="text" placeholder="请输入应用名称或创意标题" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other" readonly>
                </div>
                <div class="love-combined-field">
                    <label for="love-combined-app-subtitle">副标题</label>
                    <input id="love-combined-app-subtitle" type="text" placeholder="请输入应用副标题或创意副标题" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other" readonly>
                </div>
                <div class="love-combined-tip">可以只更新素材、只更新标题，或素材和标题一起更新；新建广告空白状态下建议素材和标题一起填写。运行中按 ESC 可立即停止。</div>
            </div>
            <div class="love-combined-footer">
                <button type="button" id="love-combined-cancel">取消</button>
                <button type="button" class="love-combined-confirm" id="love-combined-confirm">开始运行</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#love-combined-close').onclick = close;
    overlay.querySelector('#love-combined-cancel').onclick = close;
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) close();
    });

    const fileInput = overlay.querySelector('#love-combined-file');
    const appNameInput = overlay.querySelector('#love-combined-app-name');
    const appSubtitleInput = overlay.querySelector('#love-combined-app-subtitle');
    const confirmBtn = overlay.querySelector('#love-combined-confirm');

    disableLoveTextInputHistory([appNameInput, appSubtitleInput]);

    confirmBtn.onclick = async () => {
        const files = Array.from(fileInput.files || []).slice(0, LOVE_VIDEO_CONFIG.maxFiles);
        const appName = appNameInput.value.trim();
        const appSubtitle = appSubtitleInput.value.trim();
        const hasMedia = files.length > 0;
        const hasText = !!(appName || appSubtitle);

        if (!hasMedia && !hasText) {
            showToast('请至少选择素材，或填写标题/副标题', 4500, '⚠️');
            fileInput.focus();
            return;
        }

        const inferredMediaKind = hasMedia ? inferCombinedMediaKindFromFiles(files, context.mediaKind) : '';
        if (hasMedia && !inferredMediaKind) {
            showToast('暂不支持图片和视频混合处理，请一次只选择图片或只选择视频', 5200, '⚠️');
            return;
        }

        const blankNewAd = isLikelyBlankNewAdForCombined(context);
        if (blankNewAd && (!hasMedia || !appName || !appSubtitle)) {
            showToast('当前看起来是新建空白广告，请同时选择素材并填写标题/名称和副标题', 6500, '⚠️');
            if (!hasMedia) fileInput.focus();
            else (!appName ? appNameInput : appSubtitleInput).focus();
            return;
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = '运行中...';
        close();

        await startCombinedCreativeAutomation({
            files,
            appName,
            appSubtitle,
            hasMedia,
            hasText,
            targetCount: hasMedia ? files.length : Math.max(1, getCombinedCreativeIndices().length || 1),
            mediaKind: inferredMediaKind || context.mediaKind,
            displayType: context.displayType,
            creativeType: context.creativeType
        });
    };

    setTimeout(() => fileInput.focus(), 50);
}

function detectCurrentAdCreativeContext() {
    const displayType = detectSelectedOptionText(['开屏', 'Banner', '插屏', '原生', '激励互动']);
    const creativeType = detectSelectedOptionTextStrict(['竖版大图', '横版大图', '竖版视频', '横版视频', '小图', '组图', '无图']) || detectSelectedOptionText(['竖版大图', '横版大图', '竖版视频', '横版视频', '小图', '组图', '无图']);

    let mediaKind = '';
    if (creativeType.includes('视频')) {
        mediaKind = 'video';
    } else if (creativeType.includes('大图') || creativeType.includes('小图') || creativeType.includes('组图')) {
        mediaKind = 'image';
    } else {
        const areas = identifyVideoUploadAreas(1, { silent: true });
        const imageInput = identifyUploadInputs().image;
        if (areas.videoInput) mediaKind = 'video';
        else if (imageInput) mediaKind = 'image';
    }

    return { displayType, creativeType, mediaKind };
}


function inferCombinedMediaKindFromFiles(files, fallbackKind = '') {
    const kinds = new Set();
    for (const file of files || []) {
        const type = (file.type || '').toLowerCase();
        const name = (file.name || '').toLowerCase();
        if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name)) {
            kinds.add('image');
        } else if (type.startsWith('video/') || /\.(mp4|mov|m4v|avi|webm|mkv)$/i.test(name)) {
            kinds.add('video');
        }
    }
    if (kinds.size === 1) return Array.from(kinds)[0];
    if (kinds.size > 1) return '';
    return fallbackKind === 'image' || fallbackKind === 'video' ? fallbackKind : '';
}

function isLikelyBlankNewAdForCombined(context = {}) {
    const creativeIndices = getCombinedCreativeIndices();
    if (creativeIndices.length > 0) return false;

    const bodyText = normalizeText(document.body.innerText || document.body.textContent || '');
    const hasZeroCount = /创意个数\s*0\s*\/\s*10/.test(bodyText) || bodyText.includes('创意个数0/10');
    const hasEmptyAddHint = (bodyText.includes('暂无') && bodyText.includes('立即添加')) || bodyText.includes('暂无无图') || bodyText.includes('暂无竖版大图') || bodyText.includes('暂无横版大图') || bodyText.includes('暂无竖版视频') || bodyText.includes('暂无横版视频');
    const hasAddButton = !!findCombinedAddCreativeButton();
    const hasVisibleFileInput = Array.from(document.querySelectorAll('input[type="file"]')).some(input => isElementVisible(input) || input.closest('.ep-upload, .el-upload'));

    if (hasZeroCount || hasEmptyAddHint) return true;
    return hasAddButton && !hasVisibleFileInput;
}

function detectSelectedOptionText(optionTexts) {
    const candidates = [];
    const all = Array.from(document.querySelectorAll('button, span, div, label, li, [role="tab"], [role="button"], [aria-selected]'));

    for (const el of all) {
        if (!isElementVisible(el)) continue;
        const rawText = normalizeText(el.innerText || el.textContent || '');
        if (!rawText) continue;

        const matchedOption = optionTexts.find(option => {
            const opt = normalizeText(option);
            const simplified = stripLoveOptionCount(rawText);
            return simplified === opt || simplified.startsWith(opt) || rawText.includes(opt);
        });
        if (!matchedOption) continue;

        const score = getLoveSelectedOptionScore(el);
        if (score > 0) {
            const rect = el.getBoundingClientRect();
            candidates.push({
                el,
                text: matchedOption,
                score,
                area: Math.max(1, rect.width * rect.height),
                rawText
            });
        }
    }

    candidates.sort((a, b) => (b.score - a.score) || (a.area - b.area));
    return candidates[0] ? candidates[0].text : '';
}


function detectSelectedOptionTextStrict(optionTexts) {
    const normalizedOptions = optionTexts.map(option => normalizeText(option));
    const candidates = [];
    const selector = 'button, span, div, label, li, [role="tab"], [role="button"], [aria-selected], .ep-radio-button, .el-radio-button';
    const all = Array.from(document.querySelectorAll(selector));

    for (const el of all) {
        if (!isElementVisible(el)) continue;
        const rawText = normalizeText(el.innerText || el.textContent || '');
        if (!rawText) continue;
        const simplified = stripLoveOptionCount(rawText);

        // 严格匹配单个选项，避免把“竖版视频 横版视频”这种整组容器误认为选中的竖版视频。
        const matchedIndex = normalizedOptions.findIndex(opt => simplified === opt || simplified.startsWith(opt));
        if (matchedIndex < 0) continue;

        const containsOtherOption = normalizedOptions.some((opt, idx) => idx !== matchedIndex && rawText.includes(opt));
        if (containsOtherOption) continue;

        const score = getLoveSelectedOptionScore(el);
        if (score <= 0) continue;
        const rect = el.getBoundingClientRect();
        candidates.push({
            el,
            text: optionTexts[matchedIndex],
            score,
            area: Math.max(1, rect.width * rect.height),
            rawText
        });
    }

    candidates.sort((a, b) => (b.score - a.score) || (a.area - b.area));
    return candidates[0] ? candidates[0].text : '';
}

function stripLoveOptionCount(text) {
    return normalizeText(text || '')
        .replace(/[（(]\s*\d+\s*[）)]/g, '')
        .replace(/\s+/g, '');
}

function getLoveSelectedOptionScore(el) {
    let score = 0;
    const attrs = [
        el.getAttribute('aria-selected'),
        el.getAttribute('aria-pressed'),
        el.getAttribute('aria-checked')
    ].join(' ');
    if (attrs.includes('true')) score += 6;

    const checkedInput = (el.matches && el.matches('input[type="radio"], input[type="checkbox"]'))
        ? el
        : (el.querySelector && el.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked'));
    if (checkedInput && checkedInput.checked) score += 8;

    for (let node = el; node && node !== document.body; node = node.parentElement) {
        const cls = getElementClassText(node).toLowerCase();
        if (cls.includes('is-active') || cls.includes('active') || cls.includes('selected') || cls.includes('checked')) score += 5;
        if (cls.includes('disabled')) score -= 2;
        if (node !== el && score > 0) break;
    }

    try {
        const style = window.getComputedStyle(el);
        const colorText = `${style.color} ${style.borderColor} ${style.backgroundColor} ${style.boxShadow}`;
        if (colorText.includes('65, 95, 255') || colorText.includes('45, 96, 255') || colorText.includes('48, 91, 255') || colorText.includes('64, 105, 255')) {
            score += 3;
        }
        if (style.fontWeight && Number(style.fontWeight) >= 600) score += 1;
    } catch (e) {}

    return score;
}

async function waitForCombinedRequestCooldown(label = '请求', index = '') {
    const elapsed = Date.now() - LoveRuntime.lastNetworkActionAt;
    const waitMs = Math.max(0, LOVE_VIDEO_CONFIG.requestCooldownMs - elapsed);
    if (waitMs > 0) {
        await combinedSleep(waitMs);
    }
    assertLoveCombinedNotCancelled();
}

async function waitForCreativeRootReadyForCombinedTextFill(index, timeoutMs = 5000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        const root = getActiveCreativeRoot(index) || getVisibleCreativeRootForTextFill();
        if (root && isElementVisible(root)) return root;
        await combinedSleep(120);
    }

    assertLoveCombinedNotCancelled();
    return getActiveCreativeRoot(index) || getVisibleCreativeRootForTextFill();
}

async function startCombinedCreativeAutomation(options) {
    installLoveRuntimeGuards();
    beginLoveCombinedTask();

    const ball = document.getElementById('love-float-ball');
    if (ball) ball.style.background = '#e6f7ff';
    // v19：每次一键任务启动都清空上一轮限流/错误记忆，避免上次“请求频繁”残留影响新一轮更新。
    resetRecentRateLimitRecord();
    LoveRuntime.lastNetworkActionAt = 0;
    clearLoveToasts();
    clearPlatformMessages();

    try {
        assertLoveCombinedNotCancelled();

        const hasMedia = !!options.hasMedia && Array.isArray(options.files) && options.files.length > 0;
        const hasText = !!options.hasText && !!(options.appName || options.appSubtitle);
        const mediaCount = hasMedia ? options.files.length : 0;
        const textTargetCount = hasMedia ? mediaCount : Math.max(1, options.targetCount || getCombinedCreativeIndices().length || 1);

        if (hasMedia) {
            await ensureCombinedCreativeCount(mediaCount);

            if (options.mediaKind === 'video') {
                await runCombinedVideoFlow(options);
            } else if (options.mediaKind === 'image') {
                await runCombinedImageFlow(options);
            } else {
                throw new Error('未能识别素材类型，请先选择图片或视频素材');
            }
        }

        if (hasText) {
            await combinedFillUnifiedTextForTargetCreatives(options.appName, options.appSubtitle, textTargetCount);
        }

        assertLoveCombinedNotCancelled();
        showToast('完成了', 1500, '✅');
    } catch (err) {
        if (isLoveCombinedCancelError(err)) {
        } else {
            showToast(`一键任务失败：${err.message || '请重试或检查页面'}`, 6500, '⚠️');
        }
    } finally {
        if (ball) ball.style.background = '';
        finishLoveCombinedTask();
    }
}

async function ensureCombinedCreativeCount(requiredCount) {
    if (requiredCount > LOVE_VIDEO_CONFIG.maxFiles) {
        throw new Error(`最多只能一次处理 ${LOVE_VIDEO_CONFIG.maxFiles} 个创意`);
    }

    let count = getCombinedCreativeIndices().length;
    if (count >= requiredCount) return true;

    for (let target = count + 1; target <= requiredCount; target++) {
        assertLoveCombinedNotCancelled();
        const addBtn = findCombinedAddCreativeButton();
        if (!addBtn) {
            throw new Error(`当前只有 ${getCombinedCreativeIndices().length} 个创意，未找到“立即添加+ / 添加创意”按钮`);
        }

        clickCombinedSafeNonSubmit(addBtn, '添加创意');
        await waitCombinedCreativeCountAtLeast(target, 8000);
        count = getCombinedCreativeIndices().length;
        if (count < target) {
            throw new Error(`添加创意${target}失败，请手动检查页面`);
        }
        await combinedSleep(300);
    }

    return true;
}

function getCombinedCreativeIndices() {
    const nodes = Array.from(document.querySelectorAll('.ep-tabs__item, .el-tabs__item, [role="tab"], button, span, div'));
    const set = new Set();

    for (const node of nodes) {
        if (!isElementVisible(node)) continue;
        const text = normalizeText(node.innerText || node.textContent || '');
        const match = text.match(/^创意(\d+)$/);
        if (match) set.add(Number(match[1]));
    }

    return Array.from(set).filter(n => n >= 1 && n <= 10).sort((a, b) => a - b);
}

function findCombinedAddCreativeButton() {
    const dangerWords = ['提交', '保存', '发布', '送审', '上架', '完成', '确认提交', '确认保存', '确认发布'];
    const nodes = Array.from(document.querySelectorAll('button, a, span, div, [role="button"]'))
        .filter(el => isElementVisible(el))
        .map(el => {
            const text = normalizeText(el.innerText || el.textContent || '');
            const clickable = el.closest('button, a, [role="button"], .ep-button, .el-button') || el;
            const rect = clickable.getBoundingClientRect();
            return { el, clickable, text, area: Math.max(1, rect.width * rect.height) };
        })
        .filter(item => item.text && !dangerWords.some(word => item.text.includes(word)))
        .filter(item => item.text.includes('立即添加') || item.text.includes('添加创意') || item.text === '添加+' || item.text === '+添加');

    nodes.sort((a, b) => a.area - b.area);
    return nodes[0] ? nodes[0].clickable : null;
}

async function waitCombinedCreativeCountAtLeast(targetCount, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        if (getCombinedCreativeIndices().length >= targetCount) return true;
        await combinedSleep(250);
    }
    return false;
}

function clickCombinedSafeNonSubmit(element, actionName = '') {
    if (!element) return false;
    const clickable = element.closest('button, a, [role="button"], .ep-button, .el-button') || element;
    const text = normalizeText((clickable.innerText || clickable.textContent || '') + actionName);
    const dangerWords = ['提交', '保存', '发布', '送审', '上架', '完成', '下一步', '确认提交', '确认保存', '确认发布', 'Submit', 'Save', 'Publish'];
    if (dangerWords.some(word => text.includes(word))) {
        throw new Error(`已阻止危险点击：${text}`);
    }
    return forceClickElement(clickable);
}

async function runCombinedImageFlow(options) {
    for (let i = 0; i < options.files.length; i++) {
        assertLoveCombinedNotCancelled();
        const index = i + 1;
        const file = options.files[i];

        const tabSuccess = await switchToCreativeTabCombined(index);
        if (!tabSuccess) throw new Error(`没找到创意${index}`);

        await maybeSelectCombinedVerticalImageSpec(index, options);
        await combinedSleep(60);

        let imageInput = await waitCombinedImageInput(index, 8000);
        if (!imageInput) throw new Error(`创意${index} 没找到图片上传框`);

        // 只在真正进入上传前清理一次“页面原本就存在”的旧图。
        // 之前的问题是：第一次上传后如果平台裁剪/回显稍慢，重试逻辑会把刚刚上传的图片误判成旧图，
        // 然后删除、重传、再删除，造成创意里反复失败。这里把“上传前旧图清理”和“上传后重试确认”彻底分开。
        imageInput = await prepareCombinedImageInputForUpload(index, imageInput);
        if (!imageInput) throw new Error(`创意${index} 旧图片未能删除，已停止`);

        const uploadOk = await retryCombinedUploadStep(`创意${index} 图片上传`, async (attempt) => {
            assertLoveCombinedNotCancelled();

            // 重试时先看当前创意是否已经有上传结果。只要已经回显/有删除或重新上传状态，
            // 就认为这次图片已经进入平台组件，不再删除它，也不再重复塞同一个文件。
            if (attempt > 1 && combinedImageFieldHasUploadedMedia(index, imageInput)) {
                return true;
            }

            let latestInput = identifyUploadInputs().image || findImageInputInCreativeRoot(index) || imageInput;
            if (!latestInput) {
                if (combinedImageFieldHasUploadedMedia(index, imageInput)) return true;
                throw new Error(`创意${index} 没找到图片上传框`);
            }

            const uploadContainer = getImageFieldContainer(latestInput, index) || latestInput.closest('.ep-upload, .el-upload') || latestInput.parentElement;
            const initialCount = uploadContainer ? uploadContainer.querySelectorAll('*').length : 0;
            await strongUploadCombinedImage(latestInput, file);
            return await waitForCombinedImageUploadSettled(uploadContainer, initialCount, index, 15000);
        });

        if (!uploadOk) throw new Error(`创意${index} 图片未确认上传成功`);
        await combinedSleep(40);
    }
}

async function runCombinedVideoFlow(options) {
    for (let i = 0; i < options.files.length; i++) {
        assertLoveCombinedNotCancelled();
        const index = i + 1;
        const file = options.files[i];

        const tabSuccess = await switchToCreativeTabCombined(index);
        if (!tabSuccess) throw new Error(`没找到创意${index}`);

        resetRecentRateLimitRecord();
        clearPlatformMessages();

        let areas = await waitCombinedVideoAreasReady(index, 10000);
        if (!areas.videoInput) throw new Error(`创意${index} 没找到视频上传框`);
        clearUploadFieldVisibleErrors(areas.videoInput);

        const cleared = await clearCombinedExistingVideoAndPreview(index, areas);
        if (!cleared) throw new Error(`创意${index} 旧视频/预览图未能删除，已停止`);

        const videoOk = await retryCombinedUploadStep(`创意${index} 视频上传`, async (attempt) => {
            const latestAreas = await waitCombinedVideoAreasReady(index, 10000);
            if (!latestAreas.videoInput) throw new Error(`创意${index} 清理后找不到视频上传框`);
            if (attempt > 1) {
                // 上一轮可能仍在上传/解析，或者已经回显但平台校验状态还没同步。
                // 重试时先确认上一轮结果，不能立刻删除当前视频，否则更新场景会在创意1反复删、反复传。
                if (videoFieldHasUploadedMedia(index, latestAreas.videoInput)) {
                    clearUploadFieldVisibleErrors(latestAreas.videoInput);
                    return true;
                }
                const retryField = getVideoFieldContainer(latestAreas.videoInput, index);
                if (retryField && videoFieldHasAnyActivity(retryField)) {
                    const retrySnapshot = makeVideoUploadSnapshot(latestAreas.videoInput, index);
                    const retryDone = await waitForCombinedVideoUploadComplete(index, retrySnapshot, 15000);
                    if (retryDone || videoFieldHasUploadedMedia(index, latestAreas.videoInput)) {
                        clearUploadFieldVisibleErrors(latestAreas.videoInput);
                        return true;
                    }
                }
                const hardError = getScopedHardUploadErrorText(retryField);
                const retryStatus = getVideoFieldMediaStatus(retryField);
                // v18：如果上一轮已经产生了视频回显/成功卡片，就不要在重试分支里再次删除，
                // 否则“更新已有视频”会在创意1反复删新视频、反复上传。
                if (retryStatus.hasVideoSrc || retryStatus.hasSuccess || retryStatus.hasUploadItem || fieldHasExistingMedia(retryField)) {
                    clearUploadFieldVisibleErrors(latestAreas.videoInput);
                    return true;
                }
                if (hardError || !retryField || !videoFieldHasAnyActivity(retryField)) {
                    await clearCombinedExistingMediaField(index, 'video', latestAreas.videoInput);
                }
            }
            const refreshedAreas = await waitCombinedVideoAreasReady(index, 10000);
            const videoInput = refreshedAreas.videoInput || latestAreas.videoInput;
            const snapshot = makeVideoUploadSnapshot(videoInput, index);
            await waitForCombinedRequestCooldown('视频上传', index);
            await strongUploadCombinedVideo(videoInput, file);
            noteNetworkAction();
            const uploadDone = await waitForCombinedVideoUploadComplete(index, snapshot, 120000);
            const latestAfterUpload = identifyVideoUploadAreas(index, { silent: true });
            const latestVideoInput = latestAfterUpload.videoInput || videoInput;
            if (uploadDone || videoFieldHasUploadedMedia(index, latestVideoInput)) {
                clearUploadFieldVisibleErrors(latestVideoInput);
                resetRecentRateLimitRecord();
                return true;
            }
            const scopedVideoError = getScopedHardUploadErrorText(getVideoFieldContainer(latestVideoInput, index));
            return false && !scopedVideoError;
        });
        if (!videoOk) throw new Error(`创意${index} 视频未确认上传成功`);

        if (shouldSkipCombinedPreviewForCurrentContext(options, index)) {
            continue;
        }

        const previewOk = await retryCombinedUploadStep(`创意${index} 第三帧预览图上传`, async (attempt) => {
            const previewAreas = await waitCombinedPreviewAreaReady(index, 15000);

            // 激励互动 + 竖版视频是平台特殊结构：页面虽然有“预览图”字段，
            // 但该字段没有自动生成逻辑，强行上传第三帧会触发表单报错。
            // 因此在等待预览图区域之后再兜底判断一次，避免页面动态切换后误处理。
            if (shouldSkipCombinedPreviewForCurrentContext(options, index, previewAreas)) {
                return true;
            }

            if (!previewAreas.previewInput) throw new Error(`创意${index} 没找到预览图上传区域`);
            // v9 加速：旧预览图放到这里再清理；如果没有旧预览图会立即返回。
            await clearCombinedExistingMediaField(index, 'preview', previewAreas.previewInput);
            const refreshedPreviewAreas = await waitCombinedPreviewAreaReady(index, 15000);
            const previewInput = refreshedPreviewAreas.previewInput || previewAreas.previewInput;
            const filled = await fillCombinedPreviewByThirdFrame(previewInput, index, file);
            const scopedPreviewError = getScopedPreviewUploadErrorText(getPreviewFieldContainer(previewInput, index));
            // v15：预览图字段在上传完成前会长期残留“请上传图片”，这只是 required 校验，
            // 不能作为硬失败；只在真正的接口/格式/频繁类错误时重试。
            return filled && !scopedPreviewError;
        });
        if (!previewOk) {
            const latestAreasAfterPreview = identifyVideoUploadAreas(index, { silent: true });
            if (shouldSkipCombinedPreviewForCurrentContext(options, index, latestAreasAfterPreview) && videoFieldHasUploadedMedia(index, latestAreasAfterPreview.videoInput)) {
                continue;
            }
            throw new Error(`创意${index} 第三帧预览图未确认成功`);
        }
    }
}

async function switchToCreativeTabCombined(index) {
    assertLoveCombinedNotCancelled();
    const tabs = Array.from(document.querySelectorAll('.ep-tabs__item, .el-tabs__item, [role="tab"]'));
    const targetTab = tabs.find(el => normalizeText(el.innerText || el.textContent || '') === `创意${index}`);
    if (!targetTab) return false;
    clickCombinedSafeNonSubmit(targetTab, `切换创意${index}`);
    await combinedSleep(220);
    return true;
}

async function waitCombinedImageInput(index, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        let input = identifyUploadInputs().image;
        if (!input) input = findImageInputInCreativeRoot(index);
        if (input && input.isConnected) return input;
        await combinedSleep(200);
    }
    return identifyUploadInputs().image || findImageInputInCreativeRoot(index);
}

function findImageInputInCreativeRoot(index) {
    const root = getActiveCreativeRoot(index) || document.body;
    const inputs = Array.from(root.querySelectorAll('.ep-upload__input, .el-upload__input, input[type="file"]'));
    return inputs.find(input => {
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        const text = getNearbyText(input, 10);
        if (text.includes('头像') || text.includes('Logo') || text.includes('logo') || text.includes('视频') || text.includes('预览图') || text.includes('封面')) return false;
        return accept.includes('image') || accept.includes('jpg') || accept.includes('jpeg') || accept.includes('png') || text.includes('图片') || text.includes('素材');
    }) || null;
}

async function maybeSelectCombinedVerticalImageSpec(index, options) {
    const display = normalizeText(options.displayType || detectSelectedOptionText(['开屏', 'Banner', '插屏', '原生', '激励互动']) || '');
    const creative = normalizeText(options.creativeType || detectSelectedOptionText(['竖版大图', '横版大图', '竖版视频', '横版视频', '小图', '组图', '无图']) || '');
    const need1920 = (display.includes('插屏') || display.includes('开屏')) && creative.includes('竖版大图');
    if (!need1920) return false;

    for (let attempt = 1; attempt <= 3; attempt++) {
        assertLoveCombinedNotCancelled();
        const root = getActiveCreativeRoot(index) || document.body;
        const target = findCombinedCreativeSpecOption(root, ['1080*1920', '1080×1920']);

        if (!target) {
            await combinedSleep(180);
            continue;
        }

        const currentText = normalizeDimensionText(target.innerText || target.textContent || '');
        if (currentText.includes('1080*1920') && getLoveSelectedOptionScore(target) > 0) {
            return true;
        }

        selectCombinedCreativeSpecRadioOption(target);
        await combinedSleep(260);

        const verifyRoot = getActiveCreativeRoot(index) || document.body;
        const verified = findCombinedCreativeSpecOption(verifyRoot, ['1080*1920', '1080×1920']);
        if (verified && getLoveSelectedOptionScore(verified) > 0) return true;
    }

    throw new Error(`当前是${display}/${creative}，但未能自动切换创意规格到 1080*1920，请检查页面结构`);
}

function findCombinedCreativeSpecOption(scope, texts) {
    const normalizedTargets = texts.map(normalizeDimensionText);
    const specRows = findCombinedSpecRows(scope || document.body);
    const searchScopes = specRows.length ? specRows : [scope || document.body, document.body];

    const candidates = [];
    for (const searchScope of searchScopes) {
        const nodes = Array.from(searchScope.querySelectorAll('button, span, div, label, [role="button"], [aria-selected]'))
            .filter(isElementVisible)
            .map(el => ({
                el,
                text: normalizeDimensionText(el.innerText || el.textContent || ''),
                clickable: el.closest('button, [role="button"], label, .ep-radio-button, .el-radio-button, .ep-segmented__item, .el-segmented__item') || el
            }))
            .filter(item => normalizedTargets.some(target => item.text === target || item.text.includes(target)));

        for (const item of nodes) {
            const rect = item.clickable.getBoundingClientRect();
            const area = Math.max(1, rect.width * rect.height);
            if (area > 60000) continue;
            candidates.push({ ...item, area, score: getLoveSelectedOptionScore(item.clickable) });
        }
        if (candidates.length) break;
    }

    candidates.sort((a, b) => (a.area - b.area) || (b.score - a.score));
    return candidates[0]?.clickable || null;
}

function selectCombinedCreativeSpecRadioOption(optionEl) {
    if (!optionEl) return false;

    // Element Plus 的规格按钮实际是 label.ep-radio-button 包着 input[type=radio] 和 span.inner。
    // 重要：这里不能复用 forceClickElement。forceClickElement 为了删除上传图标会临时写入 display/opacity 等 inline style，
    // 用在规格 radio 上会破坏 Element Plus 原本的 border-radius / 相邻边框折叠，造成 1080*1920 选中后视觉错位。
    const label = optionEl.closest('label.ep-radio-button, label.el-radio-button, label') || optionEl;
    const input = label.querySelector && label.querySelector('input[type="radio"]');
    const inner = label.querySelector && (label.querySelector('.ep-radio-button__inner') || label.querySelector('.el-radio-button__inner') || label.querySelector('span'));

    cleanupCombinedRadioButtonInlineStyles(label);

    // 按人工点击的路径触发，但不修改任何布局样式。
    if (inner) clickElementWithoutLayoutMutation(inner);
    clickElementWithoutLayoutMutation(label);

    if (input) {
        try {
            const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
            if (checkedSetter) checkedSetter.call(input, true);
            else input.checked = true;
        } catch (e) {
            try { input.checked = true; } catch (ignore) {}
        }

        ['input', 'change'].forEach(type => {
            input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        });

        try { input.click(); } catch (e) {}
        clickElementWithoutLayoutMutation(label);
        cleanupCombinedRadioButtonInlineStyles(label);
    }

    return true;
}

function cleanupCombinedRadioButtonInlineStyles(label) {
    if (!label || !label.querySelectorAll) return;
    const nodes = [
        label,
        ...Array.from(label.querySelectorAll('.ep-radio-button__inner, .el-radio-button__inner, span, input[type="radio"]'))
    ];
    nodes.forEach(node => {
        if (!node || !node.style) return;
        ['display', 'opacity', 'visibility', 'pointer-events', 'z-index'].forEach(prop => {
            try { node.style.removeProperty(prop); } catch (e) {}
        });
    });
}

function clickElementWithoutLayoutMutation(element) {
    if (!element || !element.dispatchEvent) return false;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, rect.width / 2 || 1);
    const clientY = rect.top + Math.max(1, rect.height / 2 || 1);

    ['pointerenter', 'mouseenter', 'pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
        element.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY
        }));
    });

    if (typeof element.click === 'function') {
        try { element.click(); } catch (e) {}
    }
    return true;
}

function findCombinedSpecRows(scope) {
    const all = Array.from((scope || document).querySelectorAll('div, section, form, .ep-form-item, .el-form-item'))
        .filter(isElementVisible)
        .filter(el => {
            const text = normalizeDimensionText(el.innerText || el.textContent || '');
            const rect = el.getBoundingClientRect();
            return text.includes('创意规格') && (text.includes('1080*1920') || text.includes('1080*1880') || text.includes('780*800')) && rect.width > 80 && rect.height < 180;
        });

    all.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
    });
    return all;
}

function findCombinedTextOption(scope, texts) {
    const normalizedTargets = texts.map(normalizeDimensionText);
    const nodes = Array.from((scope || document).querySelectorAll('button, span, div, label, [role="button"], [aria-selected]'))
        .filter(isElementVisible)
        .map(el => ({ el, text: normalizeDimensionText(el.innerText || el.textContent || '') }))
        .filter(item => normalizedTargets.some(target => item.text === target || item.text.includes(target)));

    nodes.sort((a, b) => {
        const ar = a.el.getBoundingClientRect();
        const br = b.el.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
    });

    return nodes[0] ? (nodes[0].el.closest('button, [role="button"], label, span, div') || nodes[0].el) : null;
}

function normalizeDimensionText(text) {
    return normalizeText(text || '').replace(/×/g, '*').replace(/[xX]/g, '*');
}

function combinedImageFieldHasUploadedMedia(index, fallbackInput) {
    const input = identifyUploadInputs().image || findImageInputInCreativeRoot(index) || fallbackInput;
    const container = getImageFieldContainer(input, index);
    if (!container || !container.isConnected) return false;

    const text = normalizeText(container.innerText || container.textContent || '');
    const uploading = text.includes('上传中') || text.includes('正在上传') || text.includes('处理中') || text.includes('解析中') || /\d{1,3}%/.test(text);
    if (uploading) return false;

    const hasRealMedia = Array.from(container.querySelectorAll('img, video, canvas, [style*="background-image"]'))
        .some(el => {
            const rect = el.getBoundingClientRect();
            return isElementVisible(el) && rect.width > 30 && rect.height > 30;
        });

    const hasUploadedState = text.includes('删除') || text.includes('重新上传') || text.includes('已上传') || text.includes('上传成功') ||
        text.includes('取消填充') || text.includes('消填充');

    const hasUploadListItem = Array.from(container.querySelectorAll('.ep-upload-list__item, .el-upload-list__item, [class*="upload-list__item"]'))
        .some(el => {
            const rect = el.getBoundingClientRect();
            return isElementVisible(el) && rect.width > 30 && rect.height > 30;
        });

    return !!(hasRealMedia || hasUploadedState || hasUploadListItem);
}

async function prepareCombinedImageInputForUpload(index, imageInput) {
    if (!imageInput) return null;

    const imageContainer = getImageFieldContainer(imageInput, index);
    if (!imageContainer || !fieldHasExistingMedia(imageContainer)) return imageInput;

    const cleared = await clearCombinedExistingImageFieldMedia(index, imageInput);
    if (!cleared) return null;

    // 删除完成后不再固定等待。waitCombinedImageFieldMediaCleared 已经确认旧图消失，
    // 这里直接取最新 input，减少“删除后空等一小会儿”的体感延迟。
    return getFastFreshCombinedImageInput(index, imageInput);
}

async function getFastFreshCombinedImageInput(index, fallbackInput, timeoutMs = 700) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        const currentInput = identifyUploadInputs().image || findImageInputInCreativeRoot(index) || fallbackInput;
        if (currentInput && currentInput.isConnected) return currentInput;
        await combinedSleep(40);
    }
    return identifyUploadInputs().image || findImageInputInCreativeRoot(index) || fallbackInput;
}

async function clearCombinedExistingImageFieldMedia(index, fallbackInput) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        assertLoveCombinedNotCancelled();
        const currentInput = identifyUploadInputs().image || findImageInputInCreativeRoot(index) || fallbackInput;
        const container = getImageFieldContainer(currentInput, index);
        if (!container || !fieldHasExistingMedia(container)) return true;

        revealUploadOverlay(container);
        await combinedSleep(10);

        const deleteBtn = findDeleteControlInField(container);
        if (!deleteBtn) {
            await combinedSleep(120);
            continue;
        }

        clickCombinedSafeNonSubmit(deleteBtn, '删除旧图片');
        // 删除按钮点下去后，很多情况下没有确认弹窗；之前默认等 1.8 秒会显得很慢。
        // 这里只短探测一次确认弹窗，后续在 waitCombinedImageFieldMediaCleared 中继续快速补点。
        await combinedSleep(45);
        await raceLoveCombinedCancel(clickVisibleDeleteConfirmIfAny(100));

        const cleared = await waitCombinedImageFieldMediaCleared(index, fallbackInput, 3000);
        if (cleared) return true;
    }
    return false;
}

async function waitCombinedImageFieldMediaCleared(index, fallbackInput, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        await raceLoveCombinedCancel(clickVisibleDeleteConfirmIfAny(60));
        const currentInput = identifyUploadInputs().image || findImageInputInCreativeRoot(index) || fallbackInput;
        const container = getImageFieldContainer(currentInput, index);
        if (!container || !fieldHasExistingMedia(container)) return true;
        await combinedSleep(60);
    }
    return false;
}

async function strongUploadCombinedImage(inputElement, file) {
    assertLoveCombinedNotCancelled();
    const dt = new DataTransfer();
    dt.items.add(file);

    const dropZone = inputElement.closest('.ep-upload-dragger') || inputElement.closest('.ep-upload') || inputElement.closest('.el-upload') || inputElement.parentElement;
    if (dropZone) {
        dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }

    try {
        if (inputElement._valueTracker) inputElement._valueTracker.setValue('');
    } catch (e) {}

    inputElement.files = dt.files;
    inputElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

async function waitForCombinedImageReaction(container, initialChildCount, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        if (!container) return true;
        const hasMedia = container.querySelector('img') || container.querySelector('video') || container.querySelector('canvas');
        const hasProgress = container.querySelector('.ep-progress, .el-progress, [class*="progress"]');
        const hasList = container.querySelectorAll('.ep-upload-list__item, .el-upload-list__item, li[class*="upload"]').length > 0;
        const currentCount = container.querySelectorAll('*').length;
        if (hasMedia || hasProgress || hasList || currentCount !== initialChildCount) return true;
        await combinedSleep(100);
    }
    return false;
}

async function waitForCombinedImageUploadSettled(container, initialChildCount, index, timeoutMs = 12000) {
    const start = Date.now();
    let sawCropDialog = false;
    let stableCount = 0;

    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();

        const clickedCrop = await clickCombinedImageCropUploadIfAny();
        if (clickedCrop) {
            sawCropDialog = true;
            await combinedSleep(180);
            continue;
        }

        const visibleError = getVisibleLoveUploadErrorMessage();
        if (visibleError) {
            return false;
        }

        const latestInput = identifyUploadInputs().image || findImageInputInCreativeRoot(index);
        const activeContainer = getImageFieldContainer(latestInput, index) || container;
        if (!activeContainer) return combinedImageFieldHasUploadedMedia(index, latestInput);

        const text = normalizeText(activeContainer.innerText || activeContainer.textContent || '');
        const hasMedia = activeContainer.querySelector('img') || activeContainer.querySelector('video') || activeContainer.querySelector('canvas') || activeContainer.querySelector('[style*="background-image"]');
        const hasProgress = activeContainer.querySelector('.ep-progress, .el-progress, [class*="progress"]') || /\d{1,3}%/.test(text);
        const hasList = activeContainer.querySelectorAll('.ep-upload-list__item, .el-upload-list__item, li[class*="upload"], [class*="upload-list__item"]').length > 0;
        const currentCount = activeContainer.querySelectorAll('*').length;
        const changed = activeContainer === container && currentCount !== initialChildCount;
        const uploading = hasProgress || text.includes('上传中') || text.includes('正在上传') || text.includes('处理中') || text.includes('解析中');
        const readyText = text.includes('重新上传') || text.includes('删除') || text.includes('已上传') || text.includes('上传成功') || text.includes('取消填充') || text.includes('消填充');
        const fieldReady = combinedImageFieldHasUploadedMedia(index, latestInput);

        if (!uploading && (fieldReady || hasMedia || hasList || readyText || changed)) {
            stableCount += 1;
            if (stableCount >= (sawCropDialog ? 2 : 1)) return true;
        } else {
            stableCount = 0;
        }

        await combinedSleep(120);
    }

    const stillDialog = getVisibleImageCropDialog();
    if (stillDialog) {
        // 不让页面一直被裁剪弹窗卡住：最后再尝试点一次上传图片。
        const clicked = await clickCombinedImageCropUploadIfAny();
        if (clicked) {
            await combinedSleep(500);
            return !getVisibleImageCropDialog();
        }
    }

    return false;
}

async function retryCombinedUploadStep(label, stepFn) {
    let lastError = '';
    const retries = LOVE_VIDEO_CONFIG.uploadMaxRetries || 3;
    for (let attempt = 1; attempt <= retries; attempt++) {
        assertLoveCombinedNotCancelled();
        resetRecentRateLimitRecord();
        clearPlatformMessages();
        try {
            const ok = await stepFn(attempt);
            // v19：stepFn 已经做了当前字段的精确确认。只要当前字段确认成功，
            // 就不要再用页面上可能残留的全局 toast / form-error 把成功结果推翻。
            if (ok) {
                clearPlatformMessages();
                resetRecentRateLimitRecord();
                return true;
            }
            const rawPageError = getRecentRateLimitMessage(10000) || getVisibleLoveUploadErrorMessage();
            const pageError = getHardVideoUploadErrorText(rawPageError) || (rawPageError && !normalizeText(rawPageError).includes('请先上传视频') ? rawPageError : '');
            lastError = pageError || `${label}未确认成功`;
        } catch (err) {
            if (isLoveCombinedCancelError(err)) throw err;
            lastError = err?.message || String(err);
        }

        if (attempt < retries) {
            clearPlatformMessages();
            await combinedSleep(LOVE_VIDEO_CONFIG.uploadRetryDelayMs || 500);
        }
    }

    return false;
}

function getVisibleLoveUploadErrorMessage() {
    const nodes = Array.from(document.querySelectorAll(
        [
            '.ep-message',
            '.el-message',
            '.ep-notification',
            '.el-notification',
            '[role="alert"]',
            '[class*="message"]',
            '[class*="toast"]',
            '.ep-form-item__error',
            '.el-form-item__error',
            '[class*="form-item__error"]',
            '[class*="form-item"] .is-error',
            '[class*="upload-tip"]'
        ].join(', ')
    ));

    const texts = nodes
        .filter(node => isElementVisible(node))
        .map(node => normalizeText(node.innerText || node.textContent || ''))
        .filter(Boolean);

    const errorText = texts.find(text =>
        text.includes('上传失败') ||
        text.includes('请求频繁') ||
        text.includes('稍后重试') ||
        text.includes('请稍后重试') ||
        // 单独的“请先上传视频”通常是删除旧视频后的临时校验提示，不作为上传失败；
        // 如果它和“请求频繁/稍后重试”同时出现，上面的限流关键词仍会命中。
        text.includes('接口') ||
        text.includes('错误') ||
        text.includes('失败') ||
        text.includes('超时') ||
        text.includes('格式不支持') ||
        text.includes('超过') ||
        text.includes('超出') ||
        text.includes('Too Many') ||
        text.includes('too frequent') ||
        text.includes('509115')
    ) || '';

    if (errorText && isRateLimitMessage(errorText)) {
        recordRateLimit(errorText);
    }
    return errorText;
}

function getVisibleImageCropDialog() {
    const dialogs = Array.from(document.querySelectorAll('.ep-dialog, .el-dialog, [role="dialog"]'));
    return dialogs.find(dialog => {
        if (!isElementVisible(dialog)) return false;
        const text = normalizeText(dialog.innerText || dialog.textContent || '');
        return text.includes('裁剪图片') && text.includes('上传图片');
    }) || null;
}

async function clickCombinedImageCropUploadIfAny() {
    const dialog = getVisibleImageCropDialog();
    if (!dialog) return false;

    const btn = findButtonByTexts(dialog, ['上传图片']) || Array.from(dialog.querySelectorAll('button, [role="button"], .ep-button, .el-button'))
        .find(el => isElementVisible(el) && normalizeText(el.innerText || el.textContent || '').includes('上传图片'));

    if (!btn) return false;
    clickCombinedSafeNonSubmit(btn, '上传图片');
    await combinedSleep(220);
    return true;
}

async function waitCombinedVideoAreasReady(index, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        const areas = identifyVideoUploadAreas(index, { silent: true });
        if (areas.videoInput && areas.videoInput.isConnected) return areas;
        await combinedSleep(100);
    }
    return { videoInput: null, previewInput: null, root: getActiveCreativeRoot(index) || document.body };
}

async function waitCombinedPreviewAreaReady(index, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        const areas = identifyVideoUploadAreas(index, { silent: true });
        if (areas.previewInput && areas.previewInput.isConnected) return areas;
        await combinedSleep(100);
    }
    return { videoInput: null, previewInput: null, root: getActiveCreativeRoot(index) || document.body };
}

function shouldSkipCombinedPreviewForCurrentContext(options = {}, index = 1, areas = null) {
    const display = normalizeText(options.displayType || detectSelectedOptionText(['开屏', 'Banner', '插屏', '原生', '激励互动']) || '');

    // 这里必须非常严格：只有“激励互动 + 竖版视频”才跳过预览图。
    // 之前把 bodyText 也拿来判断创意类型，横版视频页面里同样会出现“竖版视频”这个未选中的按钮文案，
    // 结果把“激励互动 + 横版视频”误判成竖版视频，导致横版预览图被跳过。
    const strictCreative = normalizeText(
        options.creativeType ||
        detectSelectedOptionTextStrict(['竖版视频', '横版视频', '竖版大图', '横版大图', '小图', '组图', '无图']) ||
        detectSelectedOptionText(['竖版视频', '横版视频', '竖版大图', '横版大图', '小图', '组图', '无图']) ||
        ''
    );

    const currentAreas = areas || identifyVideoUploadAreas(index, { silent: true });
    const root = (currentAreas && currentAreas.root) || getActiveCreativeRoot(index) || document.body;
    const rootText = normalizeText(root.innerText || root.textContent || '');
    const bodyText = normalizeText(document.body.innerText || document.body.textContent || '');
    const selectedContextText = getCombinedSelectedOptionContextText();

    const isIncentive =
        display.includes('激励互动') ||
        selectedContextText.includes('激励互动') ||
        rootText.includes('激励视频') ||
        rootText.includes('广告联盟-激励视频') ||
        bodyText.includes('广告联盟-激励视频');

    const selectedHasHorizontalVideo =
        strictCreative.includes('横版视频') ||
        selectedContextText.includes('横版视频');

    const selectedHasVerticalVideo =
        strictCreative.includes('竖版视频') ||
        selectedContextText.includes('竖版视频');

    // 横版视频优先级最高：只要当前选中的创意类型明确是横版视频，就绝不能跳过预览图。
    if (isIncentive && selectedHasHorizontalVideo) {
        return false;
    }

    if (isIncentive && selectedHasVerticalVideo) {
        return true;
    }

    return false;
}

function getCombinedSelectedOptionContextText() {
    const nodes = Array.from(document.querySelectorAll(
        '.is-active, .active, .selected, .checked, [aria-selected="true"], [aria-checked="true"], [aria-pressed="true"]'
    ));
    return normalizeText(nodes
        .filter(node => isElementVisible(node))
        .map(node => node.innerText || node.textContent || '')
        .filter(Boolean)
        .join(' '));
}

async function clearCombinedExistingVideoAndPreview(index, areas) {
    // v9 加速：视频上传前只清理“旧视频”。旧预览图不阻塞新视频上传，
    // 等视频上传完成、真正要写入第三帧预览图时再清理预览图，减少“删除旧视频后空等”的体感时间。
    let ok = true;
    const latest = identifyVideoUploadAreas(index, { silent: true });
    const videoInput = latest.videoInput || areas.videoInput;

    const videoContainer = getVideoFieldContainer(videoInput, index);
    if (videoContainer && fieldHasExistingMedia(videoContainer)) {
        ok = await clearCombinedExistingMediaField(index, 'video', videoInput);
        if (!ok) return false;
    }

    return ok;
}

async function clearCombinedExistingMediaField(index, kind, fallbackInput) {
    const label = kind === 'video' ? '视频' : '预览图';
    for (let attempt = 1; attempt <= 3; attempt++) {
        assertLoveCombinedNotCancelled();
        const container = getFreshMediaFieldContainer(index, kind, fallbackInput);
        if (!container || !fieldHasExistingMedia(container)) return true;

        revealUploadOverlay(container);
        await combinedSleep(10);

        const deleteBtn = findDeleteControlInField(container);
        if (!deleteBtn) {
            await combinedSleep(80);
            continue;
        }

        clickCombinedSafeNonSubmit(deleteBtn, `删除旧${label}`);
        await combinedSleep(35);
        await raceLoveCombinedCancel(clickVisibleDeleteConfirmIfAny(90));

        const cleared = await waitCombinedFieldMediaCleared(index, kind, fallbackInput, 3500);
        if (cleared) return true;
    }
    return false;
}

async function waitCombinedFieldMediaCleared(index, kind, fallbackInput, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        await raceLoveCombinedCancel(clickVisibleDeleteConfirmIfAny(60));
        const container = getFreshMediaFieldContainer(index, kind, fallbackInput);
        if (!container || !fieldHasExistingMedia(container)) return true;
        await combinedSleep(60);
    }
    return false;
}


function clearUploadFieldVisibleErrors(inputElement) {
    if (!inputElement) return;
    const field = inputElement.closest('.ep-form-item, .el-form-item, [class*="form-item"]') ||
                  inputElement.closest('.ep-upload, .el-upload') ||
                  inputElement.parentElement;
    if (!field) return;

    Array.from(field.querySelectorAll('.ep-form-item__error, .el-form-item__error, [class*="form-item__error"]')).forEach(node => {
        const text = normalizeText(node.innerText || node.textContent || '');
        if (
            text.includes('请求频繁') ||
            text.includes('稍后重试') ||
            text.includes('请先上传视频') ||
            text.includes('上传失败') ||
            text.includes('错误') ||
            text.includes('失败')
        ) {
            try { node.remove(); } catch (e) { node.style.display = 'none'; }
        }
    });

    let node = field;
    for (let i = 0; node && i < 3; i++, node = node.parentElement) {
        try { node.classList && node.classList.remove('is-error'); } catch (e) {}
    }
}

async function strongUploadCombinedVideo(inputElement, file) {
    assertLoveCombinedNotCancelled();
    clearUploadFieldVisibleErrors(inputElement);
    const dt = new DataTransfer();
    dt.items.add(file);

    const uploadRoot = inputElement.closest('.ep-upload, .el-upload') || inputElement.parentElement;
    if (uploadRoot) {
        uploadRoot.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        uploadRoot.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        uploadRoot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }

    try {
        if (inputElement._valueTracker) inputElement._valueTracker.setValue('');
    } catch (e) {}

    inputElement.files = dt.files;
    inputElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

function waitForCombinedVideoUploadComplete(index, snapshot, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        let resolved = false;
        let stableDoneCount = 0;
        const root = snapshot.root || document.body;

        const finish = (result) => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            clearInterval(fallbackTimer);
            LoveCombinedTask.cancelHandlers.delete(cancelHandler);
            resolve(result);
        };

        const cancelHandler = () => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            clearInterval(fallbackTimer);
            LoveCombinedTask.cancelHandlers.delete(cancelHandler);
            const err = new Error(LoveCombinedTask.reason || '任务已停止');
            err.name = 'LoveCombinedCancelled';
            reject(err);
        };
        LoveCombinedTask.cancelHandlers.add(cancelHandler);

        let hardErrorFirstAt = 0;
        let hardErrorStableCount = 0;

        const check = () => {
            if (LoveCombinedTask.cancelled) return cancelHandler();
            const state = readVideoUploadState(index, snapshot);
            const elapsed = Date.now() - start;

            // v19：不要因为上一轮残留的“请求频繁/请稍后重试”在 650ms 内直接判失败。
            // 更新已有视频时，删除旧视频后平台会短暂保留校验文案；新上传也可能要先解析再回显。
            // 只有硬错误持续稳定存在，并且当前视频字段没有上传中、没有视频回显时，才交给外层重试。
            const recentRateLimit = getRecentRateLimitMessage(5000);
            const hardSignal = !!(state.error || recentRateLimit);
            if (hardSignal && !state.uploading && !state.fieldLooksUploaded) {
                if (!hardErrorFirstAt) hardErrorFirstAt = Date.now();
                hardErrorStableCount += 1;
                if (elapsed > 2800 && Date.now() - hardErrorFirstAt > 1200 && hardErrorStableCount >= 5) {
                    return finish(false);
                }
            } else {
                hardErrorFirstAt = 0;
                hardErrorStableCount = 0;
            }

            if (state.done) {
                // 如果 DOM 只是把旧视频 src 替换成新 src，结构可能不变；需要给平台一点点时间完成内部状态同步。
                // 但只要连续稳定检测到视频字段成功，就认定上传完成，不再因为预览图/图片字段中断。
                if (!state.changed && elapsed < 900) return;
                stableDoneCount += 1;
                if (stableDoneCount >= 2) return finish(true);
            } else {
                stableDoneCount = 0;
            }
            if (Date.now() - start > timeoutMs) return finish(false);
        };

        const observer = new MutationObserver(check);
        observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
        const fallbackTimer = setInterval(check, 180);
        check();
    });
}

async function fillCombinedPreviewByThirdFrame(previewInput, index, sourceVideoFile) {
    assertLoveCombinedNotCancelled();
    const latestAreas = identifyVideoUploadAreas(index, { silent: true });
    const latestPreviewInput = latestAreas.previewInput || previewInput;
    const previewContainer = getPreviewFieldContainer(latestPreviewInput, index);
    if (!previewContainer || !latestPreviewInput) return false;

    // v15：恢复 v10 的可靠路径，横版视频优先用本地第三帧直接注入预览图上传框。
    // v14 先点平台“自动生成”，但这个入口在横版视频场景里经常只打开/等待候选图，
    // 没有真正把图片回填到“预览图”字段，导致最后仍然提示“请上传图片”。
    // 所以这里保留平台自动生成作为兜底，而不是主路径。
    const localOk = await fillCombinedPreviewByLocalThirdFrame(latestPreviewInput, index, sourceVideoFile);
    if (localOk) return true;

    return await tryCombinedPlatformAutoGeneratePreview(latestPreviewInput, previewContainer, index);
}

async function fillCombinedPreviewByLocalThirdFrame(previewInput, index, sourceVideoFile) {
    assertLoveCombinedNotCancelled();
    const latestAreas = identifyVideoUploadAreas(index, { silent: true });
    const latestPreviewInput = latestAreas.previewInput || previewInput;
    const previewContainer = getPreviewFieldContainer(latestPreviewInput, index);
    if (!previewContainer || !latestPreviewInput) return false;

    const previewFile = await createCombinedPreviewImageFromThirdFrame(sourceVideoFile, index);
    const snapshot = makePreviewSnapshot(previewContainer);

    await waitForCombinedRequestCooldown('第三帧预览图上传', index);
    await strongUploadCombinedPreviewImage(latestPreviewInput, previewFile);
    noteNetworkAction();

    return await waitForCombinedPreviewFilled(previewContainer, snapshot, 22000);
}

async function tryCombinedPlatformAutoGeneratePreview(previewInput, previewContainer, index) {
    assertLoveCombinedNotCancelled();
    const latestAreas = identifyVideoUploadAreas(index, { silent: true });
    const latestPreviewInput = latestAreas.previewInput || previewInput;
    const latestPreviewContainer = getPreviewFieldContainer(latestPreviewInput, index) || previewContainer;
    if (!latestPreviewContainer) return false;

    const autoBtn = findPreviewAutoButtonLoose(latestPreviewContainer);
    if (!autoBtn) return false;

    // 如果已经有预览图，直接成功，避免把已填好的预览图删掉重来。
    if (fieldHasExistingMedia(latestPreviewContainer)) {
        return true;
    }

    // 自动生成依赖视频字段已经完成绑定。这里只等很短时间，不阻塞太久；
    // 如果平台还没准备好，后续点击失败会走本地第三帧兜底。
    await waitForCombinedVideoBindingReady(index, 5000);

    const snapshot = makePreviewSnapshot(latestPreviewContainer);
    clearPlatformMessages();
    clickCombinedSafeNonSubmit(autoBtn, `创意${index} 预览图自动生成`);
    noteNetworkAction();

    const blocked = await waitForAutoGenerateBlockedMessage(1200);
    if (blocked) {
        clearPlatformMessages(blocked);
        return false;
    }

    const result = await waitForCombinedDialogOrPreviewFilled(latestPreviewContainer, snapshot, 12000);
    if (result.type === 'filled') {
        return await waitForCombinedPreviewFilled(latestPreviewContainer, snapshot, 6000);
    }

    if (result.type !== 'dialog' || !result.dialog) {
        return false;
    }

    const dialog = result.dialog;
    await clickDialogGenerateButtonIfExists(dialog, index);

    const picked = await selectFirstGeneratedPreviewCombined(dialog, index, 18000);
    if (!picked) {
        await closeVisiblePreviewDialog(dialog);
        return false;
    }

    const fillBtn = await waitForDialogButton(dialog, ['填充', '确定', '确认'], 8000);
    if (!fillBtn) {
        await closeVisiblePreviewDialog(dialog);
        return false;
    }

    clickElementWithoutLayoutMutation(fillBtn);
    await waitForDialogClose(6000).catch(() => {});

    const refreshed = identifyVideoUploadAreas(index, { silent: true });
    const refreshedContainer = getPreviewFieldContainer(refreshed.previewInput || latestPreviewInput, index) || latestPreviewContainer;
    return await waitForCombinedPreviewFilled(refreshedContainer, snapshot, 12000);
}

async function waitForCombinedVideoBindingReady(index, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        const areas = identifyVideoUploadAreas(index, { silent: true });
        const root = areas.root || getActiveCreativeRoot(index) || document.body;
        const text = normalizeText(root.innerText || root.textContent || '');
        const hasVideo = videoFieldHasUploadedMedia(index, areas.videoInput);
        const previewContainer = areas.previewInput ? getPreviewFieldContainer(areas.previewInput, index) : null;
        const canAuto = !!findPreviewAutoButtonLoose(previewContainer);
        const noUploading = !text.includes('上传中') && !text.includes('正在上传') && !text.includes('处理中') && !text.includes('解析中') && !/\d{1,3}%/.test(text);
        if (hasVideo && canAuto && noUploading) return true;
        await combinedSleep(120);
    }
    return false;
}

async function waitForCombinedDialogOrPreviewFilled(previewContainer, beforeSnapshot, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        const dialog = getVisibleDialog();
        if (dialog) return { type: 'dialog', dialog };
        const state = readPreviewState(previewContainer, beforeSnapshot);
        if (state.filled) return { type: 'filled' };
        const blocked = getAutoGenerateBlockMessage();
        if (blocked) return { type: 'blocked', message: blocked };
        await combinedSleep(150);
    }
    return { type: 'timeout' };
}

async function selectFirstGeneratedPreviewCombined(dialog, index, timeoutMs = 18000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        assertLoveCombinedNotCancelled();
        const blockedText = getAutoGenerateBlockMessage();
        if (blockedText) {
            clearPlatformMessages(blockedText);
            return false;
        }

        const checkbox = dialog.querySelector('.ep-checkbox:not(.is-disabled), .el-checkbox:not(.is-disabled), input[type="checkbox"]');
        if (checkbox && isElementVisible(checkbox)) {
            clickElementWithoutLayoutMutation(checkbox.closest('.ep-checkbox, .el-checkbox, label') || checkbox);
            await combinedSleep(120);
            return true;
        }

        const candidates = Array.from(dialog.querySelectorAll(
            'img, video, canvas, [style*="background-image"], .ep-image, .el-image, [class*="preview"], [class*="cover"], [class*="card"], [class*="item"]'
        )).filter(el => {
            const text = normalizeText(el.innerText || el.textContent || '');
            const rect = el.getBoundingClientRect();
            return isElementVisible(el) &&
                   rect.width > 20 && rect.height > 20 &&
                   !text.includes('取消') &&
                   !text.includes('填充') &&
                   !text.includes('生成预览图') &&
                   !text.includes('自动生成');
        });

        if (candidates.length > 0) {
            clickElementWithoutLayoutMutation(candidates[0]);
            await combinedSleep(120);
            return true;
        }

        await combinedSleep(180);
    }
    return false;
}

async function createCombinedPreviewImageFromThirdFrame(videoFile, index) {
    assertLoveCombinedNotCancelled();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const objectUrl = URL.createObjectURL(videoFile);
    video.src = objectUrl;

    try {
        await raceLoveCombinedCancel(waitForVideoEvent(video, 'loadedmetadata', 12000));
        const fps = 30;
        const thirdFrameTime = 2 / fps;
        const fallbackTime = 0.08;
        const targetTime = Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(Math.max(thirdFrameTime, 0.001), Math.max(video.duration - 0.001, 0.001))
            : fallbackTime;

        video.currentTime = targetTime;
        await raceLoveCombinedCancel(waitForVideoEvent(video, 'seeked', 12000).catch(() => waitForVideoEvent(video, 'loadeddata', 12000)));

        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        if (!sourceWidth || !sourceHeight) throw new Error('无法读取视频第三帧尺寸');

        const canvas = document.createElement('canvas');
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, sourceWidth, sourceHeight);

        const blob = await raceLoveCombinedCancel(canvasToLimitedJpeg(canvas, 145 * 1024));
        return new File([blob], `preview_third_frame_${index}_${sourceWidth}x${sourceHeight}_${Date.now()}.jpg`, { type: 'image/jpeg' });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function strongUploadCombinedPreviewImage(inputElement, file) {
    assertLoveCombinedNotCancelled();
    const dt = new DataTransfer();
    dt.items.add(file);

    const uploadRoot = inputElement.closest('.ep-upload, .el-upload') || inputElement.parentElement;
    if (uploadRoot) {
        uploadRoot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }

    try {
        if (inputElement._valueTracker) inputElement._valueTracker.setValue('');
    } catch (e) {}

    inputElement.files = dt.files;
    inputElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

function waitForCombinedPreviewFilled(container, snapshot, timeoutMs = 22000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        let resolved = false;
        let stableCount = 0;

        const finish = (result) => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            clearInterval(timer);
            LoveCombinedTask.cancelHandlers.delete(cancelHandler);
            resolve(result);
        };

        const cancelHandler = () => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            clearInterval(timer);
            LoveCombinedTask.cancelHandlers.delete(cancelHandler);
            const err = new Error(LoveCombinedTask.reason || '任务已停止');
            err.name = 'LoveCombinedCancelled';
            reject(err);
        };
        LoveCombinedTask.cancelHandlers.add(cancelHandler);

        const check = () => {
            if (LoveCombinedTask.cancelled) return cancelHandler();
            clickCombinedImageCropUploadIfAny().catch(() => {});
            const state = readPreviewState(container, snapshot);
            const visibleError = getScopedPreviewUploadErrorText(container);
            // v15：这里只处理真正的硬错误。
            // “请上传图片”是预览图字段的必填校验，上传期间也会存在，不能 650ms 就判失败。
            if (visibleError && Date.now() - start > 650) return finish(false);
            if (state.filled) {
                stableCount += 1;
                if (stableCount >= 2) return finish(true);
            } else {
                stableCount = 0;
            }
            if (Date.now() - start > timeoutMs) return finish(false);
        };

        const observer = new MutationObserver(check);
        observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
        const timer = setInterval(check, 180);
        check();
    });
}

async function combinedFillUnifiedTextForTargetCreatives(titleOrName, subtitle, count) {
    const safeCount = Math.max(1, Math.min(Number(count) || 1, LOVE_VIDEO_CONFIG.maxFiles || 10));
    const hasAnyCreativeTab = getCombinedCreativeIndices().length > 0;

    for (let index = 1; index <= safeCount; index++) {
        assertLoveCombinedNotCancelled();

        let root = null;
        if (hasAnyCreativeTab) {
            const switched = await switchToCreativeTabCombined(index);
            if (!switched) {
                continue;
            }
            root = await waitForCreativeRootReadyForCombinedTextFill(index, 5000);
        } else if (index === 1) {
            root = getVisibleCreativeRootForTextFill() || document.body;
        }

        if (!root) {
            continue;
        }

        const result = fillUnifiedTitlePairInCreativeRoot(root, titleOrName, subtitle);
        if (result.filled) {
        } else {
        }

        await combinedSleep(80);
    }
}

function fillUnifiedTitlePairInCreativeRoot(root, titleOrName, subtitle) {
    const hasTitle = !!titleOrName;
    const hasSubtitle = !!subtitle;
    if (!hasTitle && !hasSubtitle) return { filled: false, kind: 'none' };

    const appNameField = findCreativeTextInput(root, ['应用名称'], ['请输入应用名称', '应用名称']);
    const appSubtitleField = findCreativeTextInput(root, ['应用副标题'], ['请输入应用副标题', '应用副标题']);
    const creativeTitleField = findCreativeTextInput(root, ['创意标题'], ['请输入创意标题', '创意标题']);
    const creativeSubtitleField = findCreativeTextInput(root, ['创意副标题'], ['请输入创意副标题', '创意副标题']);

    let titleField = null;
    let subtitleField = null;
    let kind = '';

    // 成对优先，避免把“创意标题 + 应用副标题”这种跨区域组合误填。
    if (appNameField && appSubtitleField) {
        titleField = appNameField;
        subtitleField = appSubtitleField;
        kind = '应用名称/应用副标题';
    } else if (creativeTitleField && creativeSubtitleField) {
        titleField = creativeTitleField;
        subtitleField = creativeSubtitleField;
        kind = '创意标题/创意副标题';
    } else {
        // 兜底：只在页面结构不完整时按同义字段查找，但仍然只有两个输入值。
        titleField = appNameField || creativeTitleField || findCreativeTextInput(
            root,
            ['应用名称', '创意标题'],
            ['请输入应用名称', '应用名称', '请输入创意标题', '创意标题']
        );
        subtitleField = appSubtitleField || creativeSubtitleField || findCreativeTextInput(
            root,
            ['应用副标题', '创意副标题'],
            ['请输入应用副标题', '应用副标题', '请输入创意副标题', '创意副标题']
        );
        kind = '兼容字段';
    }

    let filled = false;
    if (hasTitle && titleField) {
        setFormControlValue(titleField, titleOrName);
        filled = true;
    }
    if (hasSubtitle && subtitleField) {
        setFormControlValue(subtitleField, subtitle);
        filled = true;
    }

    return { filled, kind };
}


// 已移除：独立“批量填充应用文案”入口及其专用流程。
function getVisibleCreativeRootForTextFill() {
    const candidates = Array.from(document.querySelectorAll('.ep-tab-pane, .el-tab-pane, [id^="pane-"], [role="tabpanel"]'))
        .filter(el => isElementVisible(el));

    const textFillKeywords = ['应用名称', '应用副标题', '创意标题', '创意副标题'];

    return candidates.find(el => {
        const text = normalizeText(el.innerText || '');
        return textFillKeywords.some(keyword => text.includes(normalizeText(keyword)));
    }) || candidates[0] || document.body;
}

function findCreativeTextInput(root, labelKeywords = [], placeholderKeywords = []) {
    if (!root) return null;

    const controls = Array.from(root.querySelectorAll('input, textarea'))
        .filter(el => !isHiddenFormControl(el) && isElementVisible(el));

    const placeholderMatched = controls.find(el => {
        const placeholder = normalizeText(el.getAttribute('placeholder') || '');
        return placeholderKeywords.some(keyword => placeholder.includes(normalizeText(keyword)));
    });
    if (placeholderMatched) return placeholderMatched;

    const formItems = Array.from(root.querySelectorAll('.ep-form-item, .el-form-item, .form-item, [role="group"]'));

    for (const item of formItems) {
        const text = normalizeText(item.innerText || item.textContent || '');
        const labelMatched = labelKeywords.some(keyword => text.includes(normalizeText(keyword)));
        if (!labelMatched) continue;

        const input = Array.from(item.querySelectorAll('input, textarea'))
            .find(el => !isHiddenFormControl(el) && isElementVisible(el));
        if (input) return input;
    }

    const labelNodes = Array.from(root.querySelectorAll('label, .ep-form-item__label, .el-form-item__label'));
    for (const label of labelNodes) {
        const labelText = normalizeText(label.innerText || label.textContent || '');
        const labelMatched = labelKeywords.some(keyword => labelText.includes(normalizeText(keyword)));
        if (!labelMatched) continue;

        let node = label.parentElement;
        for (let i = 0; i < 5 && node; i++) {
            const input = Array.from(node.querySelectorAll('input, textarea'))
                .find(el => !isHiddenFormControl(el) && isElementVisible(el));
            if (input) return input;
            node = node.parentElement;
        }
    }

    return null;
}

function isHiddenFormControl(el) {
    if (!el) return true;
    const type = (el.getAttribute('type') || '').toLowerCase();
    return type === 'hidden' || type === 'file' || el.disabled || el.readOnly;
}

function setFormControlValue(el, value) {
    if (!el) return false;

    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.focus();

    const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && descriptor.set) {
        descriptor.set.call(el, value);
    } else {
        el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter' }));
    el.blur();
    return true;
}

function getImageFieldContainer(input, index) {
    if (!input) return null;

    // 优先找上传组件自身。你的截图里旧图片的 upload-list 和新上传 input 是兄弟节点，
    // 通常都在 mkt-upload-single / mkt-upload 内部；这个范围最适合删除旧图，不会扫到视频区。
    const uploadComponent = input.closest('.mkt-upload-single, .mkt-upload');
    if (uploadComponent) return uploadComponent;

    // 再尝试找表单项级别的“图片”字段，但排除头像/视频/预览图/封面。
    let node = input.closest('.ep-form-item, .el-form-item, .form-item, .field-row') ||
               input.closest('.ep-upload, .el-upload') ||
               input.parentElement;

    let fallback = node;

    for (let i = 0; i < 12 && node && node !== document.body; i++) {
        const text = node.innerText || '';
        const hasImageText = text.includes('图片') || text.includes('素材');
        const isOtherField =
            text.includes('视频') ||
            text.includes('预览图') ||
            text.includes('封面') ||
            text.includes('头像') ||
            text.includes('Logo') ||
            text.includes('logo');

        if (hasImageText && !isOtherField) {
            return node;
        }

        fallback = fallback || node;
        node = node.parentElement;
    }

    return fallback;
}


function getHardVideoUploadErrorText(text) {
    const t = normalizeText(text || '');
    if (!t) return '';
    if (
        t.includes('请求频繁') ||
        t.includes('稍后重试') ||
        t.includes('请稍后重试') ||
        t.includes('上传失败') ||
        t.includes('格式不支持') ||
        t.includes('接口') ||
        t.includes('超时') ||
        t.includes('超过') ||
        t.includes('超出') ||
        t.includes('TooMany') ||
        t.includes('toofrequent') ||
        t.includes('509115')
    ) {
        return t;
    }
    // “请先上传视频”单独出现，多数是删除旧视频后平台还没刷新校验状态，不能马上判失败。
    return '';
}


function getScopedVisibleUploadErrorMessage(container) {
    if (!container) return '';
    const nodes = Array.from(container.querySelectorAll(
        '.ep-message, .el-message, .ep-notification, .el-notification, [role="alert"], [class*="message"], [class*="toast"], .ep-form-item__error, .el-form-item__error, [class*="form-item__error"], [class*="upload-tip"]'
    ));
    const texts = nodes
        .filter(node => isElementVisible(node))
        .map(node => normalizeText(node.innerText || node.textContent || ''))
        .filter(Boolean);

    return texts.find(text =>
        text.includes('上传失败') ||
        text.includes('请求频繁') ||
        text.includes('稍后重试') ||
        text.includes('请稍后重试') ||
        text.includes('接口') ||
        text.includes('错误') ||
        text.includes('失败') ||
        text.includes('超时') ||
        text.includes('格式不支持') ||
        text.includes('超过') ||
        text.includes('超出') ||
        text.includes('Too Many') ||
        text.includes('too frequent') ||
        text.includes('509115')
    ) || '';
}

function getScopedHardUploadErrorText(container) {
    const scoped = getScopedVisibleUploadErrorMessage(container);
    const text = normalizeText((container && (container.innerText || container.textContent)) || '');
    const hard = getHardVideoUploadErrorText(scoped) || getHardVideoUploadErrorText(text);
    if (hard && isRateLimitMessage(hard)) recordRateLimit(hard);
    return hard;
}

function getScopedPreviewUploadErrorText(container) {
    const raw = getScopedHardUploadErrorText(container);
    const text = normalizeText(raw || '');
    if (!text) return '';

    // 预览图上传前/上传中，平台会保留“请上传图片/请选择图片”这类 required 校验。
    // 这些不是接口失败，不能让横版视频预览图流程提前停止。
    const isRequiredOnly =
        text.includes('请上传图片') ||
        text.includes('请选择图片') ||
        text.includes('预览图不能为空') ||
        text.includes('图片不能为空');

    const isRealHardError =
        text.includes('请求频繁') ||
        text.includes('稍后重试') ||
        text.includes('上传失败') ||
        text.includes('接口错误') ||
        text.includes('超时') ||
        text.includes('格式') ||
        text.includes('不支持') ||
        text.includes('大小') ||
        text.includes('超过') ||
        text.includes('失败');

    if (isRequiredOnly && !isRealHardError) return '';
    return raw;
}


// v13：视频更新场景里，平台会先删除旧视频再上传新视频。
// 有些时候 DOM 结构不变，只是 <video src> 换了；旧版签名只看 innerHTML.length，
// 会误以为“没有变化”，从而在创意 3 这类位置提示“视频未确认上传成功”。
// 这里把视频/图片的真实 src、poster、upload item class 一起纳入状态判断。
function getMediaAttrSignature(container) {
    if (!container) return '';
    const parts = [];
    const nodes = Array.from(container.querySelectorAll(
        'video, source, img, canvas, [style*="background-image"], .ep-upload-list__item, .el-upload-list__item, [class*="upload-list__item"]'
    ));
    for (const node of nodes.slice(0, 30)) {
        const tag = (node.tagName || '').toLowerCase();
        const src = node.currentSrc || node.src || node.getAttribute('src') || '';
        const poster = node.poster || node.getAttribute('poster') || '';
        const style = node.getAttribute('style') || '';
        const cls = node.className || '';
        const text = normalizeText(node.innerText || node.textContent || '').slice(0, 80);
        parts.push(`${tag}|${cls}|${src}|${poster}|${style}|${text}`);
    }
    return parts.join('||');
}

function getVideoFieldMediaStatus(container) {
    if (!container) {
        return { hasMedia: false, hasVideo: false, hasVideoSrc: false, hasUploadItem: false, hasSuccess: false, signature: '' };
    }

    const visibleVideos = Array.from(container.querySelectorAll('video, source')).filter(el => {
        const v = el.currentSrc || el.src || el.getAttribute('src') || '';
        return !!v && (isElementVisible(el) || isElementVisible(el.closest('.ep-upload-list__item, .el-upload-list__item, [class*="upload-list__item"]')));
    });

    const visibleMedia = Array.from(container.querySelectorAll('img, video, canvas, [style*="background-image"]')).filter(el => {
        const rect = el.getBoundingClientRect();
        return isElementVisible(el) && rect.width > 20 && rect.height > 20;
    });

    const uploadItems = Array.from(container.querySelectorAll(
        '.ep-upload-list__item, .el-upload-list__item, li[class*="upload"], [class*="upload-list__item"]'
    )).filter(el => {
        const rect = el.getBoundingClientRect();
        return isElementVisible(el) && rect.width > 20 && rect.height > 20;
    });

    const hasSuccess = !!container.querySelector(
        '.is-success, .ep-upload-list__item-status-label, .el-upload-list__item-status-label, [class*="upload-success"], [class*="success"], [class*="check"]'
    );

    const signature = getMediaAttrSignature(container);
    return {
        hasMedia: visibleVideos.length > 0 || visibleMedia.length > 0 || uploadItems.length > 0 || hasSuccess,
        hasVideo: visibleVideos.length > 0,
        hasVideoSrc: visibleVideos.some(el => !!(el.currentSrc || el.src || el.getAttribute('src'))),
        hasUploadItem: uploadItems.length > 0,
        hasSuccess,
        signature
    };
}

function videoFieldHasAnyActivity(container) {
    if (!container) return false;
    const text = normalizeText(container.innerText || container.textContent || '');
    const uploading =
        text.includes('上传中') ||
        text.includes('正在上传') ||
        text.includes('解析中') ||
        text.includes('处理中') ||
        text.includes('等待中') ||
        /\d{1,3}%/.test(text) ||
        !!container.querySelector('.ep-progress, .el-progress, [class*="progress"]');
    if (uploading) return true;
    const status = getVideoFieldMediaStatus(container);
    return !!(status.hasMedia || status.hasVideo || status.hasVideoSrc || status.hasUploadItem || status.hasSuccess || fieldHasExistingMedia(container));
}

function videoFieldHasUploadedMedia(index, fallbackInput) {
    const areas = identifyVideoUploadAreas(index, { silent: true });
    const input = (areas && areas.videoInput) || fallbackInput;
    const container = getVideoFieldContainer(input, index);
    if (!container) return false;

    const text = normalizeText(container.innerText || container.textContent || '');
    const uploading =
        text.includes('上传中') ||
        text.includes('正在上传') ||
        text.includes('解析中') ||
        text.includes('处理中') ||
        text.includes('等待中') ||
        /\d{1,3}%/.test(text) ||
        !!container.querySelector('.ep-progress, .el-progress, [class*="progress"]');

    if (uploading) return false;

    const status = getVideoFieldMediaStatus(container);
    const hardError = getHardVideoUploadErrorText(text);
    if (hardError && !status.hasMedia && !fieldHasExistingMedia(container)) return false;

    const videoSpecificMedia = status.hasVideoSrc || (status.hasVideo && status.hasSuccess);
    return videoSpecificMedia || (fieldHasExistingMedia(container) && text.includes('视频') && !text.includes('预览图'));
}

function makeVideoUploadSnapshot(videoInput, index) {
    const root = getActiveCreativeRoot(index) || document.body;
    const field = getVideoFieldContainer(videoInput, index) || root;

    return {
        index,
        root,
        field,
        rootSignature: getElementSignature(root),
        fieldSignature: getElementSignature(field),
        rootMediaCount: countMediaLike(root),
        fieldMediaCount: countMediaLike(field),
        rootMediaSignature: getMediaAttrSignature(root),
        fieldMediaSignature: getMediaAttrSignature(field),
        rootText: normalizeText(root.innerText || ''),
        fieldText: normalizeText(field.innerText || '')
    };
}

function readVideoUploadState(index, snapshot) {
    const root = getActiveCreativeRoot(index) || snapshot.root || document.body;
    const latestAreas = identifyVideoUploadAreas(index, { silent: true });
    const field = (latestAreas.videoInput && getVideoFieldContainer(latestAreas.videoInput, index)) || snapshot.field || root;

    const rootText = normalizeText(root.innerText || '');
    const fieldText = normalizeText(field.innerText || '');

    const rootSignature = getElementSignature(root);
    const fieldSignature = getElementSignature(field);
    const rootMediaCount = countMediaLike(root);
    const fieldMediaCount = countMediaLike(field);
    const rootMediaSignature = getMediaAttrSignature(root);
    const fieldMediaSignature = getMediaAttrSignature(field);
    const videoStatus = getVideoFieldMediaStatus(field);

    const changed =
        rootSignature !== snapshot.rootSignature ||
        fieldSignature !== snapshot.fieldSignature ||
        rootMediaCount !== snapshot.rootMediaCount ||
        fieldMediaCount !== snapshot.fieldMediaCount ||
        rootMediaSignature !== (snapshot.rootMediaSignature || '') ||
        fieldMediaSignature !== (snapshot.fieldMediaSignature || '');

    const hasProgress = !!field.querySelector('.ep-progress, .el-progress, [class*="progress"]');
    const hasPercent = /\d{1,3}%/.test(fieldText);

    const uploading =
        hasProgress ||
        hasPercent ||
        fieldText.includes('上传中') ||
        fieldText.includes('正在上传') ||
        fieldText.includes('解析中') ||
        fieldText.includes('处理中') ||
        fieldText.includes('等待中');

    // v12：视频上传状态只看“视频字段”本身的错误，不再扫整个创意 Pane。
    // 之前预览图/图片区域的“请上传图片、第三帧预览图未确认”等提示会被误认为视频上传失败，
    // 导致第 3 个创意开始视频已经传了却被反复重试或直接中断。
    let scopedErrorText = getScopedHardUploadErrorText(field);
    const fieldLooksUploaded =
        videoStatus.hasVideoSrc ||
        (videoStatus.hasVideo && videoStatus.hasSuccess) ||
        (videoStatus.hasUploadItem && fieldText.includes('视频') && !fieldText.includes('预览图') && !fieldText.includes('请先上传视频'));

    // v13：如果当前视频字段已经出现成功视频卡片，则忽略“请先上传视频/请稍后重试”这类残留校验文案。
    // 这类文案常见于旧视频刚删除、新视频已经回显但表单校验没同步刷新的瞬间；不能让它拖垮批量流程。
    if (fieldLooksUploaded && scopedErrorText) {
        const t = normalizeText(scopedErrorText);
        const residualOnly =
            t.includes('请先上传视频') ||
            (t.includes('稍后重试') && !t.includes('上传失败') && !t.includes('格式不支持') && !t.includes('接口') && !t.includes('超时'));
        if (residualOnly) scopedErrorText = '';
    }

    const rateLimitText = (!fieldLooksUploaded && isRateLimitMessage(fieldText)) ? (scopedErrorText || '请求频繁，请稍后重试') : '';
    if (rateLimitText) recordRateLimit(rateLimitText);

    const error = !fieldLooksUploaded && (!!scopedErrorText || !!rateLimitText);

    const readyText =
        fieldText.includes('上传成功') ||
        fieldText.includes('已上传') ||
        fieldText.includes('重新上传') ||
        fieldText.includes('删除') ||
        fieldText.includes('生成预览图') ||
        fieldText.includes('消填充') ||
        fieldText.includes('取消填充');

    const successClass = !!field.querySelector('.is-success, .ep-upload-list__item-status-label, .el-upload-list__item-status-label, [class*="success"], [class*="check"]');

    const mediaGrew = fieldMediaCount > snapshot.fieldMediaCount;
    const mediaSignatureChanged = !!fieldMediaSignature && fieldMediaSignature !== (snapshot.fieldMediaSignature || '');

    // 视频必须等到“当前视频字段里出现真实视频回显/成功卡片”，并且相对本次上传前的快照发生变化。
    // 这样不会因为旧视频尚未删除干净、或只出现“生成预览图/删除”等文案，就误认为当前视频已上传完成。
    const hasFreshVideoMedia =
        fieldLooksUploaded &&
        (
            mediaGrew ||
            mediaSignatureChanged ||
            fieldSignature !== snapshot.fieldSignature ||
            snapshot.fieldMediaCount === 0
        );

    // v18：更新视频时，平台经常复用同一个上传卡片节点，只替换内部 video/src，
    // 甚至新旧卡片的 DOM 数量完全一致。v17 过度依赖“必须变化”，会把已经回显的视频判成失败。
    // 因此只要当前“视频字段”里已经有真实 video src / 成功卡片，且不处于上传中/硬错误，就允许判定完成。
    // 旧视频是否已删除由 clearCombinedExistingVideoAndPreview 单独负责，不能在这里反复删除新视频。
    const hasConfirmedVideoMedia =
        fieldLooksUploaded &&
        (
            videoStatus.hasVideoSrc ||
            videoStatus.hasSuccess ||
            videoStatus.hasUploadItem ||
            fieldHasExistingMedia(field)
        );

    const done =
        !uploading &&
        !error &&
        (hasFreshVideoMedia || hasConfirmedVideoMedia);

    return {
        changed,
        uploading,
        done,
        error,
        readyText,
        mediaGrew,
        mediaSignatureChanged,
        fieldLooksUploaded,
        videoStatus,
        successClass,
        rootMediaCount,
        fieldMediaCount,
        errorText: scopedErrorText || rateLimitText || '',
        text: fieldText.slice(0, 120) || rootText.slice(0, 120)
    };
}

function getFreshMediaFieldContainer(index, kind, fallbackInput) {
    const areas = identifyVideoUploadAreas(index, { silent: true });
    if (kind === 'video') {
        return getVideoFieldContainer(areas.videoInput || fallbackInput, index);
    }
    return getPreviewFieldContainer(areas.previewInput || fallbackInput, index);
}

function fieldHasExistingMedia(container) {
    if (!container) return false;

    const text = normalizeText(container.innerText || '');
    if (text.includes('重新上传') || text.includes('删除') || text.includes('取消填充') || text.includes('消填充') || text.includes('已上传')) {
        return true;
    }

    const media = Array.from(container.querySelectorAll('img, video, canvas, [style*="background-image"]'))
        .filter(el => {
            const rect = el.getBoundingClientRect();
            return isElementVisible(el) && rect.width > 30 && rect.height > 30;
        });

    if (media.length > 0) return true;

    const uploadItems = Array.from(container.querySelectorAll(
        '.ep-upload-list__item, .el-upload-list__item, li[class*="upload"], [class*="upload-list__item"]'
    )).filter(el => {
        const rect = el.getBoundingClientRect();
        return isElementVisible(el) && rect.width > 30 && rect.height > 30;
    });

    return uploadItems.length > 0;
}

function revealUploadOverlay(container) {
    if (!container) return;

    const targets = [
        container,
        ...getFilledMediaCards(container),
        ...Array.from(container.querySelectorAll('img, video, canvas, [style*="background-image"], .ep-upload-list__item, .el-upload-list__item, [class*="upload-list__item"]'))
    ];

    for (const el of targets) {
        if (!el || !el.dispatchEvent) continue;
        dispatchHoverLikeEvents(el);
    }

    // 关键修复：Element Plus 的删除按钮通常不是不存在，而是被 :hover / opacity / display 隐藏。
    // 脚本触发 mouseover 不一定会让浏览器进入真正的 CSS :hover 状态，所以这里仅在上传卡片内部
    // 临时把 actions 层显示出来。不会改插件样式文件，也不会影响页面提交按钮。
    const actionLayers = container.querySelectorAll(
        '.ep-upload-list__item-actions, .el-upload-list__item-actions, [class*="upload-list__item-actions"]'
    );

    actionLayers.forEach(layer => {
        layer.dataset.loveForcedVisible = '1';
        layer.style.setProperty('display', 'inline-flex', 'important');
        layer.style.setProperty('opacity', '1', 'important');
        layer.style.setProperty('visibility', 'visible', 'important');
        layer.style.setProperty('pointer-events', 'auto', 'important');
        layer.style.setProperty('z-index', '2147483647', 'important');
    });
}

function dispatchHoverLikeEvents(el) {
    if (!el || !el.dispatchEvent) return;
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, rect.width / 2);
    const clientY = rect.top + Math.max(1, rect.height / 2);

    ['pointerenter', 'mouseenter', 'pointerover', 'mouseover', 'pointermove', 'mousemove'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY
        }));
    });
}

function getFilledMediaCards(container) {
    if (!container) return [];
    const set = new Set();

    const directCards = Array.from(container.querySelectorAll(
        '.ep-upload-list__item, .el-upload-list__item, [class*="upload-list__item"], [class*="upload-card"], [class*="picture-card"]'
    ));

    for (const card of directCards) {
        if (fieldElementLooksFilled(card)) set.add(card);
    }

    const media = Array.from(container.querySelectorAll('img, video, canvas, [style*="background-image"]'));
    for (const el of media) {
        if (!isElementVisible(el)) continue;
        const card = el.closest('.ep-upload-list__item, .el-upload-list__item, [class*="upload-list__item"], [class*="picture-card"], [class*="upload"]') || el.parentElement;
        if (card && card !== container) set.add(card);
    }

    return Array.from(set).filter(el => isElementVisible(el));
}

function fieldElementLooksFilled(el) {
    if (!el) return false;
    const text = normalizeText(el.innerText || '');
    if (text.includes('本地上传') || text.includes('素材库') || text.includes('自动生成')) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 30 || rect.height <= 30) return false;

    return !!el.querySelector('img, video, canvas, [style*="background-image"]') ||
           text.includes('删除') || text.includes('重新上传') || text.includes('取消填充') || text.includes('消填充');
}

function findDeleteControlInField(container) {
    if (!container) return null;

    revealUploadOverlay(container);

    const cards = getFilledMediaCards(container);
    const scopes = [container, ...cards];

    // 1. 优先找 Element Plus 上传列表里明确的删除节点。注意：这些节点可能被 hover 样式隐藏，
    // 所以这里不能用 isElementVisible 过滤，否则永远找不到。
    const explicitSelectors = [
        '.ep-upload-list__item-delete',
        '.el-upload-list__item-delete',
        '[class*="upload-list__item-delete"]',
        '[class*="item-delete"]',
        '[class*="delete"]',
        '[class*="remove"]',
        '[aria-label*="删除"]',
        '[title*="删除"]',
        '[aria-label*="移除"]',
        '[title*="移除"]'
    ].join(',');

    for (const scope of scopes) {
        if (!scope) continue;
        revealUploadOverlay(scope);

        const explicit = Array.from(scope.querySelectorAll(explicitSelectors))
            .map(el => el.closest('button, [role="button"], span, i, svg, div') || el)
            .filter(el => isClickableDeleteCandidate(el, scope));

        if (explicit.length > 0) return explicit[0];
    }

    // 2. 你截图里的结构是 ep-upload-list__item-actions，里面通常左边是预览，右边是删除。
    // 即使删除图标没有文字，也可以从 actions 层里排除 preview/success 后拿候选项。
    for (const card of cards) {
        revealUploadOverlay(card);
        const actionDelete = chooseDeleteFromActionLayer(card);
        if (actionDelete) return actionDelete;
    }

    // 3. 最后兜底：按坐标点击卡片中部偏右位置。这个位置就是你截图里垃圾桶出现的位置。
    for (const card of cards) {
        const coordTarget = getDeleteCandidateByCoordinates(card);
        if (coordTarget) return coordTarget;
    }

    return null;
}

function chooseDeleteFromActionLayer(card) {
    if (!card) return null;
    const layers = Array.from(card.querySelectorAll(
        '.ep-upload-list__item-actions, .el-upload-list__item-actions, [class*="upload-list__item-actions"]'
    ));

    for (const layer of layers) {
        layer.style.setProperty('display', 'inline-flex', 'important');
        layer.style.setProperty('opacity', '1', 'important');
        layer.style.setProperty('visibility', 'visible', 'important');
        layer.style.setProperty('pointer-events', 'auto', 'important');

        const children = Array.from(layer.querySelectorAll('button, [role="button"], span, i, svg'))
            .map(el => el.closest('button, [role="button"], span, i') || el)
            .filter((el, pos, arr) => el && arr.indexOf(el) === pos)
            .filter(el => {
                const cls = getElementClassText(el).toLowerCase();
                const text = normalizeText(el.innerText || el.textContent || '');
                const attrs = normalizeText((el.getAttribute('aria-label') || '') + (el.getAttribute('title') || ''));

                if (text.includes('本地上传') || text.includes('素材库') || text.includes('自动生成') || text.includes('填充')) return false;
                if (cls.includes('preview') || cls.includes('success') || cls.includes('check')) return false;
                if (attrs.includes('预览') || attrs.includes('查看')) return false;
                return true;
            });

        const explicit = children.find(el => {
            const cls = getElementClassText(el).toLowerCase();
            const text = normalizeText(el.innerText || el.textContent || '');
            const attrs = normalizeText((el.getAttribute('aria-label') || '') + (el.getAttribute('title') || ''));
            return cls.includes('delete') || cls.includes('remove') || text.includes('删除') || text.includes('移除') || attrs.includes('删除') || attrs.includes('移除');
        });
        if (explicit) return explicit;

        // 常见顺序：预览、删除。排除 preview 后，最靠右的通常就是删除。
        const byPosition = children
            .map(el => ({ el, rect: el.getBoundingClientRect() }))
            .filter(item => item.rect.width >= 0 && item.rect.height >= 0)
            .sort((a, b) => b.rect.left - a.rect.left);

        if (byPosition.length > 0) return byPosition[0].el;
    }

    return null;
}

function getDeleteCandidateByCoordinates(card) {
    if (!card) return null;
    revealUploadOverlay(card);
    const rect = card.getBoundingClientRect();
    if (!rect || rect.width < 30 || rect.height < 30) return null;

    // 垃圾桶一般在卡片中部偏右。多试几个点，避免不同卡片尺寸下偏差。
    const points = [
        [0.58, 0.50],
        [0.62, 0.50],
        [0.66, 0.50],
        [0.55, 0.48]
    ];

    for (const [px, py] of points) {
        const x = rect.left + rect.width * px;
        const y = rect.top + rect.height * py;
        let el = document.elementFromPoint(x, y);
        if (!el || !card.contains(el)) continue;

        el = el.closest('button, [role="button"], span, i, svg, div') || el;
        const text = normalizeText(el.innerText || el.textContent || '');
        const cls = getElementClassText(el).toLowerCase();

        if (text.includes('本地上传') || text.includes('素材库') || text.includes('自动生成') || cls.includes('preview')) continue;
        return el;
    }

    return null;
}

function isClickableDeleteCandidate(el, scope) {
    if (!el || !scope.contains(el)) return false;

    const text = normalizeText(el.innerText || el.textContent || '');
    if (text.includes('本地上传') || text.includes('素材库') || text.includes('自动生成') || text.includes('生成预览图') || text.includes('填充')) return false;

    const classText = getElementClassText(el).toLowerCase();
    const attrs = normalizeText((el.getAttribute('aria-label') || '') + (el.getAttribute('title') || ''));

    // 删除按钮可能因 hover 样式隐藏，所以这里不要求 isElementVisible。
    return classText.includes('delete') ||
           classText.includes('remove') ||
           classText.includes('trash') ||
           attrs.includes('删除') ||
           attrs.includes('移除') ||
           text === '删除' ||
           text === '移除';
}

function getElementClassText(el) {
    if (!el) return '';
    const cls = el.className;
    if (typeof cls === 'string') return cls;
    if (cls && typeof cls.baseVal === 'string') return cls.baseVal;
    return '';
}

function forceClickElement(element) {
    if (!element) return false;

    // 重要：Element Plus 的单选按钮规格是 <label class="ep-radio-button">...<input>...<span>1080*1920</span></label>。
    // 之前这里没有把 label 放进 selector，导致传入 label 时会向上命中父级 div.ep-radio-group，
    // 实际点到的是整组单选框而不是目标规格，所以开屏/插屏 + 竖版大图时无法稳定切到 1080*1920。
    const target = element.closest('button, [role="button"], label, span, i, svg, div') || element;

    // 如果删除按钮被 hover 样式隐藏，先临时解除隐藏和 pointer-events 限制。
    // 但不能对 Element Plus 的 radio-button 做这些 inline style 修改，否则规格按钮会出现选中框错位。
    const isRadioButtonTarget = !!(target.closest && target.closest('label.ep-radio-button, label.el-radio-button'));
    if (!isRadioButtonTarget) {
        try {
            target.style && target.style.setProperty('display', 'inline-flex', 'important');
            target.style && target.style.setProperty('opacity', '1', 'important');
            target.style && target.style.setProperty('visibility', 'visible', 'important');
            target.style && target.style.setProperty('pointer-events', 'auto', 'important');

            const parentAction = target.closest('.ep-upload-list__item-actions, .el-upload-list__item-actions, [class*="upload-list__item-actions"]');
            if (parentAction) {
                parentAction.style.setProperty('display', 'inline-flex', 'important');
                parentAction.style.setProperty('opacity', '1', 'important');
                parentAction.style.setProperty('visibility', 'visible', 'important');
                parentAction.style.setProperty('pointer-events', 'auto', 'important');
            }
        } catch (e) {}
    }

    const rect = target.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, rect.width / 2 || 1);
    const clientY = rect.top + Math.max(1, rect.height / 2 || 1);

    ['pointerenter', 'mouseenter', 'pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
        target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY
        }));
    });

    if (typeof target.click === 'function') target.click();
    return true;
}

async function clickVisibleDeleteConfirmIfAny(timeoutMs = 1800) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const popup = getVisibleDeleteConfirmPopup();
        if (popup) {
            const btn = findDeleteConfirmButton(popup);
            if (btn) {
                forceClickElement(btn);
                await sleep(90);
                return true;
            }
        }
        const remain = timeoutMs - (Date.now() - start);
        await sleep(Math.min(60, Math.max(10, remain)));
    }

    return false;
}

function getVisibleDeleteConfirmPopup() {
    const popups = Array.from(document.querySelectorAll(
        '.ep-message-box, .el-message-box, .ep-popconfirm, .el-popconfirm, .ep-popper, .el-popper, [role="dialog"], [role="tooltip"]'
    )).filter(isElementVisible);

    return popups.find(popup => {
        const text = normalizeText(popup.innerText || popup.textContent || '');
        return text.includes('删除') || text.includes('移除') || text.includes('确认') || text.includes('确定');
    }) || null;
}

function findDeleteConfirmButton(popup) {
    if (!popup) return null;
    const buttons = Array.from(popup.querySelectorAll('button'))
        .filter(btn => isElementVisible(btn) && isButtonUsable(btn));

    return buttons.find(btn => {
        const text = normalizeText(btn.innerText || btn.textContent || '');
        return text.includes('确定') || text.includes('确认') || text.includes('删除') || text.includes('移除');
    }) || null;
}

function clearLoveToasts() {
    const container = document.getElementById('love-toast-container');
    if (!container) return;
    Array.from(container.children).forEach(child => child.remove());
}

function showToast(message, duration = 2200, icon = 'ℹ️') {
    const container = document.getElementById('love-toast-container');
    if (!container) return;

    const displayDuration = Math.max(Number(duration) || 2200, 800);
    const toast = document.createElement('div');
    toast.className = `love-toast-slide`;
    toast.innerHTML = `<span class="love-toast-icon">${icon}</span> <span>${message}</span>`;
    
    container.insertBefore(toast, container.firstChild);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, displayDuration);
}

function waitForVideoEvent(video, eventName, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
            clearTimeout(timer);
            video.removeEventListener(eventName, onEvent);
            video.removeEventListener('error', onError);
        };
        const onEvent = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error('视频解码失败'));
        };
        timer = setTimeout(() => {
            cleanup();
            reject(new Error(`等待视频事件超时：${eventName}`));
        }, timeoutMs);

        video.addEventListener(eventName, onEvent, { once: true });
        video.addEventListener('error', onError, { once: true });
    });
}

function canvasToLimitedJpeg(canvas, maxBytes) {
    return new Promise(resolve => {
        const qualities = [0.82, 0.74, 0.66, 0.58, 0.50, 0.42, 0.35, 0.28, 0.22, 0.16];
        let idx = 0;

        const tryNext = () => {
            const q = qualities[idx] || qualities[qualities.length - 1];
            canvas.toBlob(blob => {
                if (!blob) {
                    resolve(new Blob([], { type: 'image/jpeg' }));
                    return;
                }
                if (blob.size <= maxBytes || idx >= qualities.length - 1) {
                    resolve(blob);
                    return;
                }
                idx += 1;
                tryNext();
            }, 'image/jpeg', q);
        };

        tryNext();
    });
}

function clearPlatformMessages(matchText = '') {
    const nodes = Array.from(document.querySelectorAll(
        '.ep-message, .el-message, .ep-notification, .el-notification, [role="alert"]'
    ));

    nodes.forEach(node => {
        const text = normalizeText(node.innerText || node.textContent || '');
        const shouldRemove = !matchText || text.includes(normalizeText(matchText)) || text.includes('请先上传视频') || text.includes('使用自动生成功能');
        if (shouldRemove) {
            try { node.remove(); } catch (e) { node.style.display = 'none'; }
        }
    });
}

function getAutoGenerateBlockMessage() {
    const nodes = Array.from(document.querySelectorAll(
        '.ep-message, .el-message, .ep-notification, .el-notification, [class*="message"], [class*="toast"], [role="alert"]'
    ));

    const texts = nodes
        .filter(node => isElementVisible(node))
        .map(node => normalizeText(node.innerText || node.textContent || ''))
        .filter(Boolean);

    return texts.find(text =>
        text.includes('请先上传视频') ||
        text.includes('先上传视频') ||
        text.includes('上传视频再使用自动生成') ||
        text.includes('使用自动生成功能') ||
        text.includes('请先使用自动生成')
    ) || '';
}

async function waitForAutoGenerateBlockedMessage(timeoutMs = 2200) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const msg = getAutoGenerateBlockMessage();
        if (msg) return msg;
        await sleep(150);
    }

    return '';
}

async function clickDialogGenerateButtonIfExists(dialog, index) {
    if (!dialog) return false;

    const btn = findButtonByTexts(dialog, ['自动生成', '生成预览图', '生成']);
    if (!btn || !isButtonUsable(btn)) return false;

    const text = normalizeText(btn.innerText || btn.textContent || '');

    // 避免把底部“填充”误当生成按钮。
    if (text.includes('填充')) return false;

    safeClick(btn, '弹窗内生成预览图');
    await sleep(500);
    return true;
}

async function closeVisiblePreviewDialog(dialog = null) {
    const target = dialog && isElementVisible(dialog) ? dialog : getVisibleDialog();
    if (!target) return true;

    const closeBtn = target.querySelector(
        '.ep-dialog__headerbtn, .el-dialog__headerbtn, .ep-dialog__close, .el-dialog__close, [aria-label="Close"], [aria-label="关闭"], [class*="close"]'
    );

    if (closeBtn && isElementVisible(closeBtn)) {
        closeBtn.click();
        await waitForDialogClose(5000);
        return true;
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    await waitForDialogClose(5000);
    return !getVisibleDialog();
}

function findPreviewAutoButtonLoose(container) {
    if (!container) return null;
    const buttons = Array.from(container.querySelectorAll('button'));
    return buttons.find(btn => {
        const btnText = normalizeText(btn.innerText || btn.textContent || '');
        return (btnText.includes('自动生成') || btnText.includes('生成预览图')) && isElementVisible(btn);
    }) || null;
}

function findButtonByTexts(scope, texts) {
    if (!scope) return null;
    const normalizedTexts = texts.map(t => normalizeText(t));
    const buttons = Array.from(scope.querySelectorAll('button'));

    return buttons.find(btn => {
        const btnText = normalizeText(btn.innerText || btn.textContent || '');
        return normalizedTexts.some(text => btnText.includes(text)) && isElementVisible(btn) && isButtonUsable(btn);
    }) || null;
}

function isButtonUsable(element) {
    if (!element) return false;
    const btn = element.closest('button') || element;
    const ariaDisabled = btn.getAttribute('aria-disabled');
    const disabledAttr = btn.getAttribute('disabled');

    return isElementVisible(btn) &&
           !btn.disabled &&
           disabledAttr === null &&
           ariaDisabled !== 'true' &&
           !btn.classList.contains('is-disabled') &&
           !btn.classList.contains('disabled');
}

function makePreviewSnapshot(container) {
    return {
        html: container.innerHTML,
        text: normalizeText(container.innerText || ''),
        mediaCount: countMediaLike(container),
        mediaSignature: getMediaAttrSignature(container),
        childCount: container.querySelectorAll('*').length
    };
}

function readPreviewState(container, snapshot) {
    const text = normalizeText(container.innerText || '');
    const mediaCount = countMediaLike(container);
    const childCount = container.querySelectorAll('*').length;
    const htmlChanged = container.innerHTML !== snapshot.html;

    const mediaNodes = Array.from(container.querySelectorAll('img, video, canvas, [style*="background-image"], .ep-upload-list__item, .el-upload-list__item, li[class*="upload"], [class*="upload-list__item"]'))
        .filter(el => {
            const cls = getElementClassText(el).toLowerCase();
            const nodeText = normalizeText(el.innerText || el.textContent || '');
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
            if (nodeText.includes('本地上传') || nodeText.includes('素材库') || nodeText.includes('自动生成')) return false;
            if (cls.includes('picture-card') && !cls.includes('item')) return false;
            return isElementVisible(el) && rect.width > 20 && rect.height > 20;
        });
    const hasPreviewMedia = mediaNodes.length > 0;
    const mediaGrew = mediaCount > snapshot.mediaCount;
    const hasFilledText = text.includes('删除') || text.includes('重新上传') || text.includes('已填充') || text.includes('取消填充') || text.includes('消填充');
    const mediaSignature = getMediaAttrSignature(container);
    const mediaSignatureChanged = !!mediaSignature && mediaSignature !== (snapshot.mediaSignature || '');

    // 预览图必须等到真实图片/上传成功卡片出现；不能只因为“请上传图片”校验消失就进入下一个创意。
    return {
        filled: hasPreviewMedia || mediaGrew || mediaSignatureChanged || (hasFilledText && mediaCount > 0),
        htmlChanged,
        mediaGrew,
        mediaSignatureChanged,
        hasFilledText,
        text: text.slice(0, 160),
        mediaCount,
        childCount
    };
}

function getVisibleDialog() {
    const dialogs = Array.from(document.querySelectorAll(
        '.ep-dialog, .el-dialog, .ep-dialog__body, .el-dialog__body, [role="dialog"]'
    ));

    const visible = dialogs.find(dialog => isElementVisible(dialog));
    return visible ? (visible.closest('.ep-dialog, .el-dialog, [role="dialog"]') || visible) : null;
}

async function waitForDialogButton(dialog, texts, timeoutMs = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const btn = findButtonByTexts(dialog, texts);
        if (btn) return btn;
        await sleep(250);
    }

    return null;
}

// 图片原识别函数：保留
function identifyUploadInputs() {
    const allInputs = Array.from(document.querySelectorAll('.ep-upload__input'));
    const visibleInputs = allInputs.filter(el => el.offsetParent !== null || (el.parentElement && el.parentElement.offsetParent !== null));
    let result = { video: null, image: null, cover: null, avatar: null };
    visibleInputs.forEach(input => {
        const container = input.closest('.form-item, .field-row, .ep-form-item') || input.parentElement.parentElement.parentElement;
        if (!container) return;
        const text = container.innerText.trim();
        if (text.includes('头像') || text.includes('Logo')) { result.avatar = input; return; }
        if (text.includes('视频') && !text.includes('封面')) { result.video = input; }
        else if (text.includes('封面') || text.includes('预览图')) { result.cover = input; }
        else if (text.includes('图片') || text.includes('素材')) { result.image = input; }
    });
    if (!result.video && !result.image && visibleInputs.length >= 1) {
        const candidates = visibleInputs.filter(i => i !== result.avatar);
        if (candidates.length > 0) {
            result.video = candidates[0]; result.image = candidates[0];
            if (candidates.length > 1) result.cover = candidates[1];
        }
    }
    return result;
}

// 视频专用：只在当前创意 Pane 内识别，避免创意2误用创意1的 input
function identifyVideoUploadAreas(index, options = {}) {
    const root = getActiveCreativeRoot(index) || document;
    const allInputs = Array.from(root.querySelectorAll('.ep-upload__input, .el-upload__input, input[type="file"]'));

    let videoInput = null;
    let previewInput = null;

    for (const input of allInputs) {
        const accept = (input.getAttribute('accept') || '').toLowerCase().replace(/\s+/g, '');
        const blockText = getNearbyText(input, 10);

        const isAvatar =
            blockText.includes('头像') ||
            blockText.includes('Logo') ||
            blockText.includes('logo');

        if (isAvatar) continue;

        const isVideo =
            accept === 'mp4' ||
            accept.includes('mp4') ||
            accept.includes('video') ||
            (
                blockText.includes('视频') &&
                !blockText.includes('预览图') &&
                !blockText.includes('封面')
            );

        const isPreview =
            (
                accept.includes('jpg') ||
                accept.includes('jpeg') ||
                accept.includes('png') ||
                accept.includes('image')
            ) &&
            (
                blockText.includes('预览图') ||
                blockText.includes('封面')
            );

        const inputVisibleByParent =
            isElementVisible(input) ||
            isElementVisible(input.closest('.ep-upload, .el-upload')) ||
            isElementVisible(input.parentElement);

        if (!inputVisibleByParent && root !== document) continue;

        if (!videoInput && isVideo) {
            videoInput = input;
            continue;
        }

        if (!previewInput && isPreview) {
            previewInput = input;
            continue;
        }
    }

    if (!options.silent) {
    }

    return { videoInput, previewInput, root };
}

function getActiveCreativeRoot(index) {
    const tabs = Array.from(document.querySelectorAll('.ep-tabs__item, .el-tabs__item, [role="tab"]'));
    const targetTab = tabs.find(el => normalizeText(el.innerText || '') === `创意${index}`);

    if (targetTab) {
        const ariaControls = targetTab.getAttribute('aria-controls');
        if (ariaControls) {
            const pane = document.getElementById(ariaControls);
            if (pane) return pane;
        }

        const id = targetTab.id || '';
        if (id.startsWith('tab-')) {
            const pane = document.getElementById('pane-' + id.slice(4));
            if (pane) return pane;
        }
    }

    const activePane = Array.from(document.querySelectorAll('.ep-tab-pane, .el-tab-pane, [role="tabpanel"]'))
        .find(pane => isElementVisible(pane) && normalizeText(pane.innerText || '').includes('视频'));

    return activePane || null;
}

function getVideoFieldContainer(input, index) {
    const tight = getTightUploadFormItem(input, index, ['视频'], ['预览图', '封面', '头像', 'Logo', 'logo']);
    return tight || getFieldContainer(input, index, ['视频'], ['预览图', '封面', '头像', 'Logo', 'logo']);
}

function getPreviewFieldContainer(input, index) {
    const tight = getTightUploadFormItem(input, index, ['预览图', '封面'], ['头像', 'Logo', 'logo']);
    return tight || getFieldContainer(input, index, ['预览图', '封面'], ['头像', 'Logo', 'logo']);
}

function getTightUploadFormItem(input, index, includeWords, excludeWords) {
    if (!input) return null;
    const root = getActiveCreativeRoot(index) || document.body;
    let node = input.closest('.ep-form-item, .el-form-item, [class*="form-item"]');
    for (let i = 0; i < 8 && node && node !== document.body; i++, node = node.parentElement) {
        if (root && root !== document.body && !root.contains(node)) break;
        const label = node.querySelector('.ep-form-item__label, .el-form-item__label, label');
        const labelText = normalizeText(label ? (label.innerText || label.textContent || '') : '');
        const allText = normalizeText(node.innerText || node.textContent || '');
        const hasInclude = includeWords.some(word => labelText.includes(normalizeText(word)) || allText.includes(normalizeText(word)));
        const hasExcludeInLabel = excludeWords.some(word => labelText.includes(normalizeText(word)));
        const hasExcludeInAll = excludeWords.some(word => allText.includes(normalizeText(word)));
        if (hasInclude && !hasExcludeInLabel && !hasExcludeInAll) return node;
        if (hasInclude && labelText && !hasExcludeInLabel) return node;
    }
    return null;
}

function getFieldContainer(input, index, includeWords, excludeWords) {
    if (!input) return null;

    const root = getActiveCreativeRoot(index) || document.body;
    let node = input.closest('.ep-upload, .el-upload') || input.parentElement;
    let fallback = node;

    for (let i = 0; i < 12 && node && node !== document.body; i++) {
        const text = node.innerText || '';
        const hasInclude = includeWords.some(word => text.includes(word));
        const hasExclude = excludeWords.some(word => text.includes(word));

        if (hasInclude && !hasExclude) {
            return node;
        }

        if (root && node.parentElement === root) {
            fallback = node;
        }

        node = node.parentElement;
    }

    return fallback || root;
}

function getElementSignature(el) {
    if (!el) return '';
    const text = normalizeText(el.innerText || '');
    const childCount = el.querySelectorAll('*').length;
    const mediaCount = countMediaLike(el);
    const progressCount = el.querySelectorAll('.ep-progress, .el-progress, [class*="progress"]').length;
    const mediaSignature = getMediaAttrSignature(el).slice(0, 2000);
    return `${childCount}|${mediaCount}|${progressCount}|${text.slice(0, 500)}|${el.innerHTML.length}|${mediaSignature}`;
}

function countMediaLike(el) {
    if (!el) return 0;
    return el.querySelectorAll('img, video, canvas, [style*="background-image"], .ep-upload-list__item, .el-upload-list__item, li[class*="upload"]').length;
}

function normalizeText(text) {
    return (text || '').replace(/\s+/g, '');
}

function safeClick(element, actionName = '') {
    if (!element) return false;

    const clickable = element.closest('button') || element;
    const text = ((clickable.innerText || clickable.textContent || '') + ' ' + actionName).trim();

    const dangerWords = [
        '提交',
        '保存',
        '发布',
        '送审',
        '上架',
        '完成',
        '创建',
        '下一步',
        '确认提交',
        '确认保存',
        '确认发布',
        'Submit',
        'Save',
        'Publish',
        'Confirm'
    ];

    const isDanger = dangerWords.some(word => text.includes(word));

    if (isDanger) {
        showToast(`已阻止危险点击：${text}`, 2000, '🛑');
        return false;
    }

    clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    clickable.click();
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
}

function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           rect.width >= 0 &&
           rect.height >= 0;
}

function getNearbyText(element, maxLevel = 6) {
    let node = element;

    for (let i = 0; i < maxLevel && node; i++) {
        const text = node.innerText || '';
        if (
            text.includes('视频') ||
            text.includes('预览图') ||
            text.includes('封面') ||
            text.includes('头像') ||
            text.includes('Logo')
        ) {
            return text;
        }
        node = node.parentElement;
    }

    return '';
}

async function waitForDialogClose(timeoutMs = 8000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const dialog = Array.from(document.querySelectorAll('.ep-dialog, .el-dialog'))
            .find(d => isElementVisible(d));
        if (!dialog) return true;
        await sleep(200);
    }

    return false;
}

function setupDrag(container, handle) {
    let isDragging = false;
    let shiftX, shiftY;
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        isDragging = true;
        container.classList.add('is-dragging');
        const rect = container.getBoundingClientRect();
        shiftX = e.clientX - rect.left; shiftY = e.clientY - rect.top;
        container.style.removeProperty('bottom'); container.style.removeProperty('right');
        container.style.top = rect.top + 'px'; container.style.left = rect.left + 'px';
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        container.style.left = (e.clientX - shiftX) + 'px'; container.style.top = (e.clientY - shiftY) + 'px';
    });
    window.addEventListener('mouseup', () => { isDragging = false; container.classList.remove('is-dragging'); });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

initFloatBall();
