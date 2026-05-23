
// === 视频批量上传配置：只影响视频，不影响图片 ===
const LOVE_VIDEO_CONFIG = {
    maxFiles: 10,
    requestCooldownMs: 2000,      // 防止 vivo 后台提示“请求频繁”
    rateLimitStopMs: 15000,
    useLocalPreviewFirst: true,   // 直接从本地视频首帧生成预览图，避免页面“自动生成”频繁报错
    clearExistingBeforeUpload: true, // 视频批量上传前，先清理当前创意已有的视频和预览图
    majorToastDuration: 5200,
    debug: true
};

const LoveRuntime = {
    guardInstalled: false,
    lastNetworkActionAt: 0,
    lastRateLimitAt: 0,
    lastRateLimitMessage: ''
};

function loveDebug(...args) {
    if (LOVE_VIDEO_CONFIG.debug) console.log(...args);
}

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
    console.warn('[LoveToolbox] 捕获到平台限流提示：', LoveRuntime.lastRateLimitMessage);
}

function getRecentRateLimitMessage(windowMs = LOVE_VIDEO_CONFIG.rateLimitStopMs) {
    if (Date.now() - LoveRuntime.lastRateLimitAt <= windowMs) {
        return LoveRuntime.lastRateLimitMessage || '请求频繁，请稍后重试';
    }
    return '';
}

async function waitForRequestCooldown(label = '请求', index = '') {
    const elapsed = Date.now() - LoveRuntime.lastNetworkActionAt;
    const waitMs = Math.max(0, LOVE_VIDEO_CONFIG.requestCooldownMs - elapsed);
    if (waitMs > 0) {
        loveDebug(`[LoveToolbox] 创意${index} ${label} 前等待 ${waitMs}ms，避免请求频繁`);
        await sleep(waitMs);
    }
}

function noteNetworkAction() {
    LoveRuntime.lastNetworkActionAt = Date.now();
}

// === 1. 初始化 UI (🍀 幸运草通知版) ===
function initFloatBall() {
    installLoveRuntimeGuards();
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
                position: fixed !important; bottom: 30px !important; left: 30px !important;
                width: 48px !important; height: 48px !important;
                background: rgba(255, 255, 255, 0.95) !important;
                backdrop-filter: blur(10px) !important;
                border: 1px solid rgba(0,0,0,0.1) !important;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15) !important;
                border-radius: 50px !important; z-index: 2147483647 !important;
                display: flex !important; align-items: center !important; justify-content: center !important;
            }
            #love-float-ball:hover { width: 180px !important; }
            .center-icon { font-size: 24px; position: absolute; pointer-events: none; transition: opacity 0.2s; }
            #love-float-ball:hover .center-icon { opacity: 0; }
            .btn-group { display: flex; gap: 10px; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
            #love-float-ball:hover .btn-group { opacity: 1; pointer-events: auto; }
            .action-btn { font-size: 20px; cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #f0f0f0; }
            .action-btn:hover { background: #e0e0e0; transform: scale(1.1); }
        </style>
        <div class="center-icon">🍀</div>
        <div class="btn-group">
            <div class="action-btn" id="btn-img" title="极速传图">🎇</div>
            <div class="action-btn" id="btn-video" title="批量视频">🎬</div>
            <div class="action-btn" id="btn-text" title="批量填充应用文案">📝</div>
            <div class="action-btn" id="btn-move" title="拖动">✥</div>
        </div>
        <input type="file" id="love-hidden-input" multiple>
    `;
    document.body.appendChild(ball);

    const input = document.getElementById('love-hidden-input');
    const btnImg = document.getElementById('btn-img');
    const btnVideo = document.getElementById('btn-video');
    const btnText = document.getElementById('btn-text');
    const btnMove = document.getElementById('btn-move');

    // 图片按钮：继续使用原来的图片上传机制，不动图片逻辑
    btnImg.onclick = () => {
        input.accept = "image/*";
        input.multiple = true;
        input.dataset.loveUploadType = "image";
        input.click();
    };

    // 视频按钮：单独走视频批量上传机制
    btnVideo.onclick = () => {
        input.accept = "video/*,.mp4";
        input.multiple = true;
        input.dataset.loveUploadType = "video";
        input.click();
    };

    // 文案按钮：新增应用名称/应用副标题批量填充，不影响图片和视频上传逻辑
    btnText.onclick = () => {
        openAppTextFillDialog();
    };

    input.onchange = async (e) => {
        if (e.target.files.length > 0) {
            const files = Array.from(e.target.files).slice(0, LOVE_VIDEO_CONFIG.maxFiles);
            const type = input.dataset.loveUploadType || "image";
            input.value = "";

            if (type === "video") {
                await startVideoAutomation(files);
            } else {
                await startAutomation(files, "image");
            }
        }
    };
    setupDrag(ball, btnMove);
}



// === 1.1 应用名称/应用副标题批量填充：独立功能，不影响图片/视频 ===
function openAppTextFillDialog() {
    const existing = document.getElementById('love-text-fill-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'love-text-fill-modal';
    overlay.innerHTML = `
        <style>
            #love-text-fill-modal {
                position: fixed !important;
                inset: 0 !important;
                z-index: 2147483647 !important;
                background: rgba(0, 0, 0, 0.38) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
            }
            #love-text-fill-modal .love-text-dialog {
                width: 420px !important;
                background: #fff !important;
                border-radius: 12px !important;
                box-shadow: 0 12px 36px rgba(0,0,0,0.22) !important;
                overflow: hidden !important;
            }
            #love-text-fill-modal .love-text-header {
                padding: 16px 20px !important;
                font-size: 16px !important;
                font-weight: 700 !important;
                border-bottom: 1px solid #eef0f5 !important;
                color: #222 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
            }
            #love-text-fill-modal .love-text-close {
                cursor: pointer !important;
                font-size: 20px !important;
                color: #999 !important;
                line-height: 1 !important;
                user-select: none !important;
            }
            #love-text-fill-modal .love-text-body {
                padding: 18px 20px 8px !important;
            }
            #love-text-fill-modal .love-text-field {
                margin-bottom: 14px !important;
            }
            #love-text-fill-modal label {
                display: block !important;
                margin-bottom: 8px !important;
                font-size: 13px !important;
                color: #333 !important;
                font-weight: 600 !important;
            }
            #love-text-fill-modal input {
                width: 100% !important;
                box-sizing: border-box !important;
                height: 38px !important;
                border: 1px solid #dcdfe6 !important;
                border-radius: 8px !important;
                padding: 0 12px !important;
                font-size: 14px !important;
                outline: none !important;
            }
            #love-text-fill-modal input:focus {
                border-color: #415fff !important;
                box-shadow: 0 0 0 2px rgba(65,95,255,0.12) !important;
            }
            #love-text-fill-modal .love-text-tip {
                color: #888 !important;
                font-size: 12px !important;
                line-height: 1.5 !important;
                margin-top: 2px !important;
            }
            #love-text-fill-modal .love-text-footer {
                padding: 14px 20px 18px !important;
                display: flex !important;
                justify-content: flex-end !important;
                gap: 10px !important;
            }
            #love-text-fill-modal button {
                min-width: 86px !important;
                height: 34px !important;
                border-radius: 18px !important;
                border: 1px solid #dcdfe6 !important;
                background: #fff !important;
                cursor: pointer !important;
                font-size: 14px !important;
            }
            #love-text-fill-modal .love-text-confirm {
                background: #415fff !important;
                color: white !important;
                border-color: #415fff !important;
            }
        </style>
        <div class="love-text-dialog">
            <div class="love-text-header">
                <span>批量填充应用文案</span>
                <span class="love-text-close" id="love-text-close">×</span>
            </div>
            <div class="love-text-body">
                <div class="love-text-field">
                    <label for="love-app-name-input">应用名称</label>
                    <input id="love-app-name-input" type="text" placeholder="请输入应用名称" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other" readonly>
                </div>
                <div class="love-text-field">
                    <label for="love-app-subtitle-input">应用副标题</label>
                    <input id="love-app-subtitle-input" type="text" placeholder="请输入应用副标题" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other" readonly>
                </div>
                <div class="love-text-field">
                    <label for="love-creative-title-input">创意标题</label>
                    <input id="love-creative-title-input" type="text" placeholder="请输入创意标题" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other" readonly>
                </div>
                <div class="love-text-field">
                    <label for="love-creative-subtitle-input">创意副标题</label>
                    <input id="love-creative-subtitle-input" type="text" placeholder="请输入创意副标题" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other" readonly>
                </div>
                <div class="love-text-tip">确认后会依次切换“创意1”到“创意10”；应用名称和应用副标题同时出现时才填应用文案；创意标题和创意副标题会单独填充；不会点击提交、保存或发布。</div>
            </div>
            <div class="love-text-footer">
                <button type="button" id="love-text-cancel">取消</button>
                <button type="button" class="love-text-confirm" id="love-text-confirm">开始填充</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#love-text-close').onclick = close;
    overlay.querySelector('#love-text-cancel').onclick = close;
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) close();
    });

    const nameInput = overlay.querySelector('#love-app-name-input');
    const subtitleInput = overlay.querySelector('#love-app-subtitle-input');
    const creativeTitleInput = overlay.querySelector('#love-creative-title-input');
    const creativeSubtitleInput = overlay.querySelector('#love-creative-subtitle-input');
    const confirmBtn = overlay.querySelector('#love-text-confirm');

    // 禁止浏览器/密码管理器弹出历史输入记录，避免显示之前填过的内容。
    disableLoveTextInputHistory([
        nameInput,
        subtitleInput,
        creativeTitleInput,
        creativeSubtitleInput
    ]);

    confirmBtn.onclick = async () => {
        const appName = nameInput.value.trim();
        const appSubtitle = subtitleInput.value.trim();
        const creativeTitle = creativeTitleInput.value.trim();
        const creativeSubtitle = creativeSubtitleInput.value.trim();

        if (!appName && !appSubtitle && !creativeTitle && !creativeSubtitle) {
            showToast('请先填写需要填充的文案', 3500, '⚠️');
            nameInput.focus();
            return;
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = '填充中...';

        try {
            close();
            await fillAppTextForAllCreatives(appName, appSubtitle, creativeTitle, creativeSubtitle);
        } catch (err) {
            console.error('[LoveToolbox] 批量填充文案失败：', err);
            showToast('文案填充失败，请查看控制台', 6000, '⚠️');
        }
    };

    setTimeout(() => nameInput.focus(), 50);
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

async function fillAppTextForAllCreatives(appName, appSubtitle, creativeTitle = '', creativeSubtitle = '') {
    const tabs = getCreativeTabInfoForTextFill()
        .filter(item => item.index >= 1 && item.index <= 10);

    if (tabs.length === 0) {
        showToast('未找到创意1到创意10标签，无法填充文案', 5000, '⚠️');
        return;
    }

    const ball = document.getElementById('love-float-ball');
    if (ball) ball.style.background = '#e6f7ff';

    clearLoveToasts();

    let successCount = 0;

    for (const item of tabs) {
        const switched = await switchToCreativeTabForTextFill(item.index);
        if (!switched) {
            console.warn(`[LoveToolbox] 创意${item.index} 切换失败，跳过文案填充`);
            continue;
        }

        const root = await waitForCreativeRootReadyForTextFill(item.index, 5000);
        if (!root) {
            console.warn(`[LoveToolbox] 创意${item.index} 未找到当前内容区域，跳过文案填充`);
            continue;
        }

        let filledAny = false;

        // 应用文案保护：只有同一个创意页里同时存在“应用名称”和“应用副标题”时，才填应用文案。
        // 这样不会误填新页面里位于“创意标题/创意副标题”下面的单独“应用副标题”。
        const appNameField = findCreativeTextInput(
            root,
            ['应用名称'],
            ['请输入应用名称', '应用名称']
        );

        const appSubtitleField = findCreativeTextInput(
            root,
            ['应用副标题'],
            ['请输入应用副标题', '应用副标题']
        );

        const canFillAppFields = !!appNameField && !!appSubtitleField;

        if (canFillAppFields) {
            if (appName) {
                setFormControlValue(appNameField, appName);
                filledAny = true;
            }

            if (appSubtitle) {
                setFormControlValue(appSubtitleField, appSubtitle);
                filledAny = true;
            }
        } else if (appName || appSubtitle) {
            console.log(`[LoveToolbox] 创意${item.index} 未同时找到应用名称和应用副标题，跳过应用文案填充`);
        }

        // 新网页文案：单独填“创意标题/创意副标题”，不触碰下面那个单独的“应用副标题”。
        if (creativeTitle) {
            const creativeTitleField = findCreativeTextInput(
                root,
                ['创意标题'],
                ['请输入创意标题', '创意标题']
            );

            if (creativeTitleField) {
                setFormControlValue(creativeTitleField, creativeTitle);
                filledAny = true;
            } else {
                console.warn(`[LoveToolbox] 创意${item.index} 没找到创意标题输入框`);
            }
        }

        if (creativeSubtitle) {
            const creativeSubtitleField = findCreativeTextInput(
                root,
                ['创意副标题'],
                ['请输入创意副标题', '创意副标题']
            );

            if (creativeSubtitleField) {
                setFormControlValue(creativeSubtitleField, creativeSubtitle);
                filledAny = true;
            } else {
                console.warn(`[LoveToolbox] 创意${item.index} 没找到创意副标题输入框`);
            }
        }

        if (filledAny) {
            successCount += 1;
            console.log(`[LoveToolbox] 创意${item.index} 文案已填充`, {
                appName,
                appSubtitle,
                creativeTitle,
                creativeSubtitle
            });
        }

        await sleep(120);
    }

    if (ball) ball.style.background = '';
    clearLoveToasts();

    console.log(`[LoveToolbox] 批量文案填充完成，共处理 ${successCount} 个创意`);
}

function getCreativeTabInfoForTextFill() {
    const tabs = Array.from(document.querySelectorAll('.ep-tabs__item, .el-tabs__item, [role="tab"]'));
    const map = new Map();

    for (const tab of tabs) {
        const rawText = normalizeText(tab.innerText || tab.textContent || '');
        const match = rawText.match(/创意\s*(\d+)/);
        if (!match) continue;
        const index = Number(match[1]);
        if (!Number.isFinite(index)) continue;
        if (!map.has(index)) map.set(index, { index, tab });
    }

    return Array.from(map.values()).sort((a, b) => a.index - b.index);
}

async function switchToCreativeTabForTextFill(index) {
    const tabs = getCreativeTabInfoForTextFill();
    const item = tabs.find(t => t.index === index);
    if (!item || !item.tab) return false;

    item.tab.click();
    await sleep(180);
    return true;
}

async function waitForCreativeRootReadyForTextFill(index, timeoutMs = 5000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const root = getActiveCreativeRoot(index) || getVisibleCreativeRootForTextFill();
        if (root && isElementVisible(root)) return root;
        await nextFrame();
    }

    return getActiveCreativeRoot(index) || getVisibleCreativeRootForTextFill();
}

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

// === 2. 图片核心逻辑：保持原机制 ===
async function startAutomation(files, type) {
    // 安全保护：视频不再走旧逻辑，避免触发旧的 handleVideoCover / 确定按钮逻辑
    if (type === 'video') {
        return startVideoAutomation(files);
    }

    const ball = document.getElementById('love-float-ball');
    ball.style.background = '#e6f7ff';

    

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const index = i + 1;
        console.log(`>>> 处理创意 ${index}`);

        // A. 切 Tab (不犹豫)
        const tabSuccess = await switchToTab(index);
        if (!tabSuccess) continue;

        // ⚡️ 保持图片原来的极速节奏
        await randomSleep(150, 250);

        // B. 识别区域
        const classifiedInputs = identifyUploadInputs();
        let mainInput = null;
        let coverInput = null;

        if (type === 'video') {
            mainInput = classifiedInputs.video;
            coverInput = classifiedInputs.cover;
            if (!mainInput) continue;
        } else {
            mainInput = classifiedInputs.image;
            if (!mainInput) {
                await sleep(100);
                mainInput = identifyUploadInputs().image;
            }
            if (!mainInput) {
                showToast(`❌ 创意${index} 没框`, 1000, '⚠️');
                continue;
            }
        }

        // 图片新增功能：如果当前创意已经有旧图片，先删除旧图片，再按原来的 strongUpload 机制上传新图片。
        // 这里仅在 type === 'image' 时执行，不影响视频批量上传逻辑。
        if (type === 'image') {
            const preparedInput = await prepareImageInputForUpload(index, mainInput);
            if (!preparedInput) {
                showToast(`🛑 创意${index} 旧图片未能删除，已跳过该图片`, 5000, '🛑');
                continue;
            }
            mainInput = preparedInput;
        }

        const uploadContainer = mainInput.closest('.ep-upload, .el-upload') || mainInput.parentElement;
        const initialCount = uploadContainer ? uploadContainer.querySelectorAll('*').length : 0;

        await strongUpload(mainInput, file);

        if (type === 'image') {
            const reacted = await waitForReactionBroad(uploadContainer, initialCount, 1500);
            if (reacted) await sleep(100);
        } else {
            await waitForReactionBroad(uploadContainer, initialCount, 60000);
            if (coverInput) await handleVideoCover(coverInput);
        }
    }

    ball.style.background = '';
}


// === 2.0.1 图片专用：上传前删除当前创意已有图片；不影响视频 ===
async function prepareImageInputForUpload(index, imageInput) {
    if (!imageInput) return null;

    const imageContainer = getImageFieldContainer(imageInput, index);

    if (!imageContainer || !fieldHasExistingMedia(imageContainer)) {
        return imageInput;
    }

    console.log(`[LoveToolbox] 创意${index} 检测到已有图片，准备先删除旧图片`);

    const cleared = await clearExistingImageFieldMedia(index, imageInput);
    if (!cleared) {
        console.warn(`[LoveToolbox] 创意${index} 旧图片删除失败，为避免叠加上传，跳过本次图片上传`);
        return null;
    }

    // 删除后页面可能重建 input，因此重新识别一次图片上传框。
    await sleep(150);
    let refreshedInput = identifyUploadInputs().image;

    if (!refreshedInput) {
        await sleep(250);
        refreshedInput = identifyUploadInputs().image;
    }

    return refreshedInput || imageInput;
}

async function clearExistingImageFieldMedia(index, fallbackInput) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        const currentInput = identifyUploadInputs().image || fallbackInput;
        const container = getImageFieldContainer(currentInput, index);

        if (!container || !fieldHasExistingMedia(container)) {
            return true;
        }

        revealUploadOverlay(container);
        await sleep(120);

        const deleteBtn = findDeleteControlInField(container);
        if (!deleteBtn) {
            console.warn(`[LoveToolbox] 创意${index} 图片找不到删除按钮，第${attempt}次尝试`);
            await sleep(300);
            continue;
        }

        console.log(`[LoveToolbox] 创意${index} 删除已有图片：`, deleteBtn);
        forceClickElement(deleteBtn);
        await sleep(250);
        await clickVisibleDeleteConfirmIfAny();

        const cleared = await waitForImageFieldMediaCleared(index, fallbackInput, 8000);
        if (cleared) {
            console.log(`[LoveToolbox] 创意${index} 已删除旧图片`);
            return true;
        }
    }

    return false;
}

async function waitForImageFieldMediaCleared(index, fallbackInput, timeoutMs = 8000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        await clickVisibleDeleteConfirmIfAny(250);

        const currentInput = identifyUploadInputs().image || fallbackInput;
        const container = getImageFieldContainer(currentInput, index);

        if (!container || !fieldHasExistingMedia(container)) {
            return true;
        }

        await sleep(250);
    }

    return false;
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

// === 2.1 视频批量上传逻辑：完全独立，不影响图片 ===
async function startVideoAutomation(files) {
    installLoveRuntimeGuards();

    const ball = document.getElementById('love-float-ball');
    if (ball) ball.style.background = '#e6f7ff';

    clearLoveToasts();
    
    let stopped = false;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const index = i + 1;

        loveDebug(`[LoveToolbox] === 开始处理创意${index} ===`, file.name, file.size);

        const tabSuccess = await switchToTabForVideo(index);
        if (!tabSuccess) {
            showToast(`❌ 没找到创意${index}，批量流程已停止`, 8000, '🛑');
            stopped = true;
            break;
        }

        let areas = await waitForVideoAreasReady(index, 10000);
        if (!areas.videoInput) {
            showToast(`❌ 创意${index} 没找到视频上传框，批量流程已停止`, 8000, '🛑');
            stopped = true;
            break;
        }

        if (LOVE_VIDEO_CONFIG.clearExistingBeforeUpload) {
            const cleared = await clearExistingVideoAndPreview(index, areas);
            if (!cleared) {
                showToast(`🛑 创意${index} 旧素材未能清理，批量流程已停止`, 10000, '🛑');
                stopped = true;
                break;
            }

            // 删除后 DOM 可能重建，重新拿一次当前创意的视频/预览图 input。
            areas = await waitForVideoAreasReady(index, 10000);
            if (!areas.videoInput) {
                showToast(`🛑 创意${index} 清理后找不到视频上传框，批量流程已停止`, 10000, '🛑');
                stopped = true;
                break;
            }
        }

        const snapshot = makeVideoUploadSnapshot(areas.videoInput, index);
        loveDebug(`[LoveToolbox] 创意${index} 准备上传视频：`, file.name, file.size);

        await waitForRequestCooldown('视频上传', index);
        await strongUploadVideo(areas.videoInput, file);
        noteNetworkAction();

        const uploadDone = await waitForVideoUploadComplete(index, snapshot, 120000);
        const rateLimitAfterVideo = getRecentRateLimitMessage();

        if (!uploadDone || rateLimitAfterVideo) {
            const reason = rateLimitAfterVideo || `视频未确认上传成功`;
            showToast(`🛑 创意${index} 已停止：${reason}`, 10000, '🛑');
            stopped = true;
            break;
        }

        const previewAreas = await waitForPreviewAreaReady(index, 12000);
        if (!previewAreas.previewInput) {
            showToast(`🛑 创意${index} 没找到预览图区域，批量流程已停止`, 9000, '🛑');
            stopped = true;
            break;
        }

        const previewOk = await handlePreviewAutoGenerate(previewAreas.previewInput, index, file);
        const rateLimitAfterPreview = getRecentRateLimitMessage();

        if (!previewOk || rateLimitAfterPreview) {
            const reason = rateLimitAfterPreview || `预览图未确认成功`;
            showToast(`🛑 创意${index} 已停止：${reason}`, 10000, '🛑');
            stopped = true;
            break;
        }

        loveDebug(`[LoveToolbox] ✅ 创意${index} 完成`);
    }

    if (ball) ball.style.background = '';

    if (!stopped) {
        // 等最后一个预览图状态稳定一点，再显示最终提示；同时清理前面的侧边提示，避免视觉上像“提前完成”。
        await sleep(900);
        clearLoveToasts();
    }
}

async function waitForVideoAreasReady(index, timeoutMs = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const areas = identifyVideoUploadAreas(index);
        if (areas.videoInput && areas.videoInput.isConnected) {
            console.log(`[LoveToolbox] 创意${index} 视频区域已准备好`, areas);
            return areas;
        }
        await nextFrame();
    }

    return { videoInput: null, previewInput: null };
}

async function waitForPreviewAreaReady(index, timeoutMs = 15000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const areas = identifyVideoUploadAreas(index, { silent: true });
        if (areas.previewInput && areas.previewInput.isConnected) {
            const container = getPreviewFieldContainer(areas.previewInput, index);
            const autoBtn = container ? findPreviewAutoButtonLoose(container) : null;

            console.log(`[LoveToolbox] 创意${index} 预览图区域检测：`, {
                hasPreviewInput: !!areas.previewInput,
                hasContainer: !!container,
                hasAutoButton: !!autoBtn,
                buttonText: autoBtn ? normalizeText(autoBtn.innerText || autoBtn.textContent || '') : null,
                text: container ? normalizeText(container.innerText || '').slice(0, 160) : ''
            });

            // 这里不再要求必须存在“自动生成/生成预览图”按钮。
            // 是否生成预览图交给 handlePreviewAutoGenerate 判断：有按钮就本地首帧上传，没有按钮就跳过。
            return areas;
        }
        await sleep(250);
    }

    return { videoInput: null, previewInput: null };
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
    const allText = rootText + fieldText;

    const rootSignature = getElementSignature(root);
    const fieldSignature = getElementSignature(field);
    const rootMediaCount = countMediaLike(root);
    const fieldMediaCount = countMediaLike(field);

    const changed =
        rootSignature !== snapshot.rootSignature ||
        fieldSignature !== snapshot.fieldSignature ||
        rootMediaCount !== snapshot.rootMediaCount ||
        fieldMediaCount !== snapshot.fieldMediaCount;

    const hasProgress = !!root.querySelector('.ep-progress, .el-progress, [class*="progress"]') ||
                        !!field.querySelector('.ep-progress, .el-progress, [class*="progress"]');

    const hasPercent = /\d{1,3}%/.test(allText);

    const uploading =
        hasProgress ||
        hasPercent ||
        allText.includes('上传中') ||
        allText.includes('正在上传') ||
        allText.includes('解析中') ||
        allText.includes('处理中') ||
        allText.includes('等待中');

    const error =
        allText.includes('上传失败') ||
        allText.includes('格式不支持') ||
        allText.includes('超出') ||
        allText.includes('错误');

    const readyText =
        allText.includes('上传成功') ||
        allText.includes('已上传') ||
        allText.includes('重新上传') ||
        allText.includes('删除') ||
        allText.includes('生成预览图') ||
        allText.includes('消填充') ||
        allText.includes('取消填充');

    const successClass = !!root.querySelector('.is-success, .ep-upload-list__item-status-label, .el-upload-list__item-status-label, [class*="success"], [class*="check"]') ||
                         !!field.querySelector('.is-success, .ep-upload-list__item-status-label, .el-upload-list__item-status-label, [class*="success"], [class*="check"]');

    const mediaGrew =
        rootMediaCount > snapshot.rootMediaCount ||
        fieldMediaCount > snapshot.fieldMediaCount;

    const hasVideoPreviewInField = !!field.querySelector('video, img, canvas, [style*="background-image"], .ep-upload-list__item, .el-upload-list__item, li[class*="upload"]');

    const done =
        !uploading &&
        changed &&
        (readyText || successClass || mediaGrew || hasVideoPreviewInField);

    return {
        changed,
        uploading,
        done,
        error,
        readyText,
        mediaGrew,
        successClass,
        rootMediaCount,
        fieldMediaCount,
        text: fieldText.slice(0, 120) || rootText.slice(0, 120)
    };
}

function waitForVideoUploadComplete(index, snapshot, timeoutMs = 120000) {
    return new Promise(resolve => {
        const start = Date.now();
        let resolved = false;
        let stableDoneCount = 0;
        let lastLogAt = 0;

        const root = snapshot.root || document.body;

        const finish = (result) => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            clearInterval(fallbackTimer);
            resolve(result);
        };

        const check = () => {
            const state = readVideoUploadState(index, snapshot);

            const now = Date.now();
            if (now - lastLogAt > 1200 || state.done || state.error) {
                console.log(`[LoveToolbox] 创意${index} 视频上传状态检测：`, state);
                lastLogAt = now;
            }

            if (state.error || getRecentRateLimitMessage(5000)) {
                finish(false);
                return;
            }

            if (state.done) {
                stableDoneCount += 1;
                if (stableDoneCount >= 2) {
                    finish(true);
                    return;
                }
            } else {
                stableDoneCount = 0;
            }

            if (Date.now() - start > timeoutMs) {
                finish(false);
            }
        };

        const observer = new MutationObserver(check);
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });

        const fallbackTimer = setInterval(check, 350);
        check();
    });
}


// === 2.2 视频专用：上传前清理当前创意已有的视频和预览图 ===
async function clearExistingVideoAndPreview(index, areas) {
    const latestBefore = identifyVideoUploadAreas(index, { silent: true });
    const previewInput = latestBefore.previewInput || areas.previewInput;
    const videoInput = latestBefore.videoInput || areas.videoInput;

    let hasAnythingToClear = false;

    const previewContainer = getPreviewFieldContainer(previewInput, index);
    const hasPreviewAutoButton = !!findPreviewAutoButtonLoose(previewContainer);
    if (previewContainer && fieldHasExistingMedia(previewContainer) && hasPreviewAutoButton) {
        hasAnythingToClear = true;
        loveDebug(`[LoveToolbox] 创意${index} 检测到已有预览图，且存在自动生成按钮，准备删除旧预览图`);
        const ok = await clearExistingFieldMedia(index, 'preview', previewInput);
        if (!ok) return false;
        await sleep(250);
    } else if (previewContainer && fieldHasExistingMedia(previewContainer) && !hasPreviewAutoButton) {
        // 激励互动等无“自动生成/生成预览图”按钮的场景：不生成预览图，也不删除已有预览图。
        loveDebug(`[LoveToolbox] 创意${index} 预览图区域无自动生成按钮，保留已有预览图并跳过预览图处理`);
    }

    // 重新识别一次，因为删除预览图后页面可能重建。
    const latestAfterPreview = identifyVideoUploadAreas(index, { silent: true });
    const refreshedVideoInput = latestAfterPreview.videoInput || videoInput;
    const videoContainer = getVideoFieldContainer(refreshedVideoInput, index);

    if (videoContainer && fieldHasExistingMedia(videoContainer)) {
        hasAnythingToClear = true;
        loveDebug(`[LoveToolbox] 创意${index} 检测到已有视频，准备删除`);
        const ok = await clearExistingFieldMedia(index, 'video', refreshedVideoInput);
        if (!ok) return false;
        await sleep(250);
    }

    if (hasAnythingToClear) {
        loveDebug(`[LoveToolbox] 创意${index} 旧视频/预览图清理完成`);
    }

    return true;
}

async function clearExistingFieldMedia(index, kind, fallbackInput) {
    const label = kind === 'video' ? '视频' : '预览图';

    for (let attempt = 1; attempt <= 3; attempt++) {
        const container = getFreshMediaFieldContainer(index, kind, fallbackInput);

        if (!container || !fieldHasExistingMedia(container)) {
            return true;
        }

        revealUploadOverlay(container);
        await sleep(120);

        const deleteBtn = findDeleteControlInField(container);
        if (!deleteBtn) {
            console.warn(`[LoveToolbox] 创意${index} ${label} 找不到删除按钮，第${attempt}次尝试`);
            await sleep(300);
            continue;
        }

        console.log(`[LoveToolbox] 创意${index} 删除已有${label}：`, deleteBtn);
        forceClickElement(deleteBtn);
        await sleep(250);
        await clickVisibleDeleteConfirmIfAny();

        const cleared = await waitForFieldMediaCleared(index, kind, fallbackInput, 8000);
        if (cleared) {
            console.log(`[LoveToolbox] 创意${index} 已删除旧${label}`);
            return true;
        }
    }

    return false;
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

function isSmallIconCandidate(el, card) {
    if (!el || !card.contains(el)) return false;
    const rect = el.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const text = normalizeText(el.innerText || el.textContent || '');
    const cls = getElementClassText(el).toLowerCase();

    if (rect.width > 80 || rect.height > 80) return false;
    if (text.includes('本地上传') || text.includes('素材库') || text.includes('自动生成') || text.includes('生成预览图') || text.includes('填充')) return false;
    if (cls.includes('success') || cls.includes('check')) return false;

    const centerY = rect.top + rect.height / 2;
    if (centerY < cardRect.top + cardRect.height * 0.18 || centerY > cardRect.top + cardRect.height * 0.85) return false;

    return true;
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

    const target = element.closest('button, [role="button"], span, i, svg, div') || element;

    // 如果删除按钮被 hover 样式隐藏，先临时解除隐藏和 pointer-events 限制。
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
                console.log('[LoveToolbox] 点击删除确认按钮：', normalizeText(btn.innerText || btn.textContent || ''));
                forceClickElement(btn);
                await sleep(300);
                return true;
            }
        }
        await sleep(120);
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

async function waitForFieldMediaCleared(index, kind, fallbackInput, timeoutMs = 8000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        await clickVisibleDeleteConfirmIfAny(250);
        const container = getFreshMediaFieldContainer(index, kind, fallbackInput);
        if (!container || !fieldHasExistingMedia(container)) return true;
        await sleep(250);
    }

    return false;
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

// === 3. 工具函数 ===

// 💪 图片原强力上传：保留，不给视频复用，避免互相影响
async function strongUpload(inputElement, file) {
    const dt = new DataTransfer();
    dt.items.add(file);

    const dropZone = inputElement.closest('.ep-upload-dragger') || inputElement.closest('.ep-upload') || inputElement.parentElement;
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

// 视频专用上传函数
async function strongUploadVideo(inputElement, file) {
    const dt = new DataTransfer();
    dt.items.add(file);

    const uploadRoot = inputElement.closest('.ep-upload, .el-upload') || inputElement.parentElement;

    if (uploadRoot) {
        uploadRoot.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        uploadRoot.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        uploadRoot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }

    try {
        if (inputElement._valueTracker) {
            inputElement._valueTracker.setValue('');
        }
    } catch (e) {}

    inputElement.files = dt.files;

    inputElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

// 👁️ 图片原宽容检测：保留
function waitForReactionBroad(container, initialChildCount, timeoutMs) {
    return new Promise(resolve => {
        let elapsed = 0;
        const interval = 50;

        const timer = setInterval(() => {
            elapsed += interval;

            const hasMedia = container.querySelector('img') || container.querySelector('video');
            const hasProgress = container.querySelector('.ep-progress') || container.querySelector('.el-progress');
            const hasList = container.querySelectorAll('.ep-upload-list__item, li[class*="upload"]').length > 0;
            const currentCount = container.querySelectorAll('*').length;
            const hasDomChange = currentCount !== initialChildCount;

            if (hasMedia || hasProgress || hasList || hasDomChange) {
                clearInterval(timer);
                resolve(true);
                return;
            }

            if (elapsed >= timeoutMs) {
                clearInterval(timer);
                resolve(false);
            }
        }, interval);
    });
}

function clearLoveToasts() {
    const container = document.getElementById('love-toast-container');
    if (!container) return;
    Array.from(container.children).forEach(child => child.remove());
}

function showToast(message, duration = 5000, icon = 'ℹ️') {
    const container = document.getElementById('love-toast-container');
    if (!container) return;

    const displayDuration = Math.max(duration || 0, 4500);
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

function randomSleep(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 旧视频封面处理：保留但新视频流程不调用
async function handleVideoCover(coverInput) {
    const coverContainer = coverInput.closest('.ep-upload');
    const parentArea = coverContainer.parentElement.parentElement;
    const autoGenBtn = findButtonByText(parentArea, '自动生成');

    if (autoGenBtn) {
        autoGenBtn.click();
        await randomSleep(800, 1200);

        const dialogBody = document.querySelector('.ep-dialog__body');
        if (dialogBody) {
            const firstCheckbox = dialogBody.querySelector('.ep-checkbox');
            if (firstCheckbox) firstCheckbox.click();
            await randomSleep(100, 200);
        }

        const dialogFooter = document.querySelector('.ep-dialog__footer');
        if (dialogFooter) {
            const confirmBtn = findButtonByText(dialogFooter, '填充') || findButtonByText(dialogFooter, '确定');
            if (confirmBtn) confirmBtn.click();
        }
        await randomSleep(200, 400);
    }
}

// 视频专用：预览图处理。
// 新规则：
// 1. 如果预览图区域存在“自动生成/生成预览图”按钮，不点击页面按钮，直接从本地视频截取一帧并上传为预览图。
// 2. 如果没有“自动生成/生成预览图”按钮，直接跳过预览图，不本地生成，也不点击任何弹窗。
async function handlePreviewAutoGenerate(previewInput, index, sourceVideoFile = null) {
    const latestAreas = identifyVideoUploadAreas(index, { silent: true });
    const latestPreviewInput = latestAreas.previewInput || previewInput;
    const previewContainer = getPreviewFieldContainer(latestPreviewInput, index);

    if (!previewContainer || !latestPreviewInput) {
        loveDebug(`[LoveToolbox] 创意${index} 未找到预览图容器，跳过预览图处理`);
        return true;
    }

    const autoBtn = findPreviewAutoButtonLoose(previewContainer);
    loveDebug(`[LoveToolbox] 创意${index} 预览图处理判断：`, {
        hasAutoButton: !!autoBtn,
        buttonText: autoBtn ? normalizeText(autoBtn.innerText || autoBtn.textContent || '') : null,
        hasSourceVideoFile: !!sourceVideoFile,
        containerText: normalizeText(previewContainer.innerText || '').slice(0, 220)
    });

    if (!autoBtn) {
        // 激励互动这类没有自动生成按钮的页面：按你的要求直接跳过预览图。
        console.log(`[LoveToolbox] 创意${index} 无自动生成/生成预览图按钮，跳过预览图生成`);
        return true;
    }

    if (!sourceVideoFile) {
        console.warn(`[LoveToolbox] 创意${index} 有自动生成按钮，但没有本地视频文件，无法截取首帧`);
        return false;
    }

    const beforeSnapshot = makePreviewSnapshot(previewContainer);
    loveDebug(`[LoveToolbox] 创意${index} 检测到自动生成按钮，改用本地视频首帧上传预览图，不点击页面自动生成按钮`);
    return await fillPreviewByLocalVideoFrame(latestPreviewInput, previewContainer, beforeSnapshot, sourceVideoFile, index);
}

async function fillPreviewByLocalVideoFrame(previewInput, previewContainer, beforeSnapshot, sourceVideoFile, index) {
    if (!sourceVideoFile) {
        showToast(`⚠️ 创意${index} 没有可用于生成预览图的本地视频文件`, 8000, '⚠️');
        return false;
    }

    try {
        const previewFile = await createPreviewImageFromVideo(sourceVideoFile, index, previewContainer);
        loveDebug(`[LoveToolbox] 创意${index} 已生成本地预览图：`, previewFile.name, previewFile.size);

        const latestAreas = identifyVideoUploadAreas(index, { silent: true });
        const latestInput = latestAreas.previewInput || previewInput;
        const latestContainer = getPreviewFieldContainer(latestInput, index) || previewContainer;
        const snapshot = makePreviewSnapshot(latestContainer);

        await waitForRequestCooldown('预览图上传', index);
        await strongUploadPreviewImage(latestInput, previewFile);
        noteNetworkAction();

        const filled = await waitForPreviewFilled(latestContainer, snapshot, 20000);
        const rateLimit = getRecentRateLimitMessage();

        if (rateLimit) {
            console.warn(`[LoveToolbox] 创意${index} 预览图上传后检测到限流：`, rateLimit);
            return false;
        }

        if (filled) {
            loveDebug(`[LoveToolbox] 创意${index} 预览图已用视频首帧填充`);
            return true;
        }

        console.warn(`[LoveToolbox] 创意${index} 首帧预览图已注入，但页面未确认成功`);
        return false;
    } catch (err) {
        console.error(`[LoveToolbox] 创意${index} 生成/上传首帧预览图失败：`, err);
        showToast(`⚠️ 创意${index} 生成预览图失败，请人工处理`, 9000, '⚠️');
        return false;
    }
}

async function createPreviewImageFromVideo(videoFile, index, previewContainer = null) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const objectUrl = URL.createObjectURL(videoFile);
    video.src = objectUrl;

    try {
        await waitForVideoEvent(video, 'loadedmetadata', 12000);
        const targetTime = Number.isFinite(video.duration) && video.duration > 2 ? Math.min(1, video.duration / 4) : 0;

        if (targetTime > 0) {
            video.currentTime = targetTime;
            await waitForVideoEvent(video, 'seeked', 12000);
        } else {
            await waitForVideoEvent(video, 'loadeddata', 12000).catch(() => {});
        }

        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;

        if (!sourceWidth || !sourceHeight) {
            throw new Error('无法读取视频原始帧尺寸');
        }

        // 重要：不再读取页面要求尺寸，也不再把首帧缩放/裁剪成 1280x720 或 720x1280。
        // 预览图尺寸严格等于视频原始第一帧尺寸，避免对运营素材做隐性改造。
        const canvas = document.createElement('canvas');
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(video, 0, 0, sourceWidth, sourceHeight);

        // 只压缩 JPEG 质量，不改变宽高尺寸。若平台仍因尺寸/体积不接受，应人工处理素材。
        const blob = await canvasToLimitedJpeg(canvas, 145 * 1024);
        loveDebug(`[LoveToolbox] 创意${index} 预览图使用视频原始首帧尺寸：${sourceWidth}x${sourceHeight}，文件大小：${blob.size}`);
        return new File([blob], `preview_${index}_${sourceWidth}x${sourceHeight}_${Date.now()}.jpg`, { type: 'image/jpeg' });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
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

async function strongUploadPreviewImage(inputElement, file) {
    if (!inputElement) throw new Error('预览图 input 不存在');

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

async function waitForPreviewAutoButton(container, timeoutMs = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const btn = findPreviewAutoButton(container);
        if (btn && isButtonUsable(btn)) return btn;
        await sleep(250);
    }

    return findPreviewAutoButton(container);
}

async function waitUntilPreviewAutoButtonUsable(container, timeoutMs = 8000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const btn = findPreviewAutoButton(container);
        if (btn && isButtonUsable(btn)) return true;
        await sleep(300);
    }

    return false;
}

async function waitForVideoBindingReady(index, timeoutMs = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const areas = identifyVideoUploadAreas(index, { silent: true });
        const root = areas.root || getActiveCreativeRoot(index) || document.body;
        const text = normalizeText(root.innerText || '');
        const hasVideoPreview = !!root.querySelector('video, img, canvas, [style*="background-image"], .ep-upload-list__item, .el-upload-list__item, li[class*="upload"]');
        const canAuto = areas.previewInput && findPreviewAutoButton(getPreviewFieldContainer(areas.previewInput, index));
        const noUploading = !text.includes('上传中') && !text.includes('正在上传') && !text.includes('处理中') && !text.includes('解析中') && !/\d{1,3}%/.test(text);

        if (hasVideoPreview && canAuto && noUploading) return true;
        await sleep(350);
    }

    return false;
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

    console.log(`[LoveToolbox] 创意${index} 点击弹窗内部生成按钮：`, text);
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

function findPreviewAutoButton(container) {
    return findButtonByTexts(container, ['自动生成', '生成预览图']);
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
        childCount: container.querySelectorAll('*').length
    };
}

function readPreviewState(container, snapshot) {
    const text = normalizeText(container.innerText || '');
    const mediaCount = countMediaLike(container);
    const childCount = container.querySelectorAll('*').length;
    const htmlChanged = container.innerHTML !== snapshot.html;

    const hasPreviewMedia = !!container.querySelector('img, video, canvas, [style*="background-image"], .ep-upload-list__item, .el-upload-list__item, li[class*="upload"]');
    const mediaGrew = mediaCount > snapshot.mediaCount;
    const askUploadGone = snapshot.text.includes('请上传图片') && !text.includes('请上传图片');
    const hasFilledText = text.includes('删除') || text.includes('重新上传') || text.includes('已填充') || text.includes('取消填充') || text.includes('消填充');

    return {
        filled: hasPreviewMedia || mediaGrew || askUploadGone || hasFilledText,
        htmlChanged,
        mediaGrew,
        askUploadGone,
        hasFilledText,
        text: text.slice(0, 160),
        mediaCount,
        childCount
    };
}

function waitForPreviewFilled(container, snapshot, timeoutMs = 15000) {
    return new Promise(resolve => {
        const start = Date.now();
        let resolved = false;
        let stableCount = 0;

        const finish = (result) => {
            if (resolved) return;
            resolved = true;
            observer.disconnect();
            clearInterval(timer);
            resolve(result);
        };

        const check = () => {
            const state = readPreviewState(container, snapshot);
            console.log('[LoveToolbox] 预览图填充状态检测：', state);

            if (state.filled) {
                stableCount += 1;
                if (stableCount >= 2) {
                    finish(true);
                }
            } else {
                stableCount = 0;
            }

            if (Date.now() - start > timeoutMs) {
                finish(false);
            }
        };

        const observer = new MutationObserver(check);
        observer.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });

        const timer = setInterval(check, 350);
        check();
    });
}

async function waitForDialogOrPreviewFilled(previewContainer, beforeSnapshot, timeoutMs = 12000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const dialog = getVisibleDialog();
        if (dialog) {
            return { type: 'dialog', dialog };
        }

        const state = readPreviewState(previewContainer, beforeSnapshot);
        if (state.filled) {
            return { type: 'filled' };
        }

        await sleep(250);
    }

    return { type: 'timeout' };
}

function getVisibleDialog() {
    const dialogs = Array.from(document.querySelectorAll(
        '.ep-dialog, .el-dialog, .ep-dialog__body, .el-dialog__body, [role="dialog"]'
    ));

    const visible = dialogs.find(dialog => isElementVisible(dialog));
    return visible ? (visible.closest('.ep-dialog, .el-dialog, [role="dialog"]') || visible) : null;
}

async function selectFirstGeneratedPreview(dialog, index, timeoutMs = 18000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const blockedText = getAutoGenerateBlockMessage();
        if (blockedText) {
            console.warn(`[LoveToolbox] 创意${index} 等待候选图时发现页面提示：`, blockedText);
            return false;
        }

        const checkbox = dialog.querySelector('.ep-checkbox:not(.is-disabled), .el-checkbox:not(.is-disabled), input[type="checkbox"]');
        if (checkbox && isElementVisible(checkbox)) {
            safeClick(checkbox, '选择预览图');
            await sleep(300);
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
            safeClick(candidates[0], '选择预览图');
            await sleep(300);
            return true;
        }

        // 有些弹窗会先出现，但候选帧要等接口返回；继续等，不直接进入下一个创意。
        console.log(`[LoveToolbox] 创意${index} 等待预览图候选项...`);
        await sleep(300);
    }

    return false;
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
        console.log('[LoveToolbox] identifyVideoUploadAreas 识别结果：', {
            index,
            root,
            videoInput,
            videoAccept: videoInput ? videoInput.getAttribute('accept') : null,
            videoText: videoInput ? getNearbyText(videoInput, 10) : null,
            previewInput,
            previewAccept: previewInput ? previewInput.getAttribute('accept') : null,
            previewText: previewInput ? getNearbyText(previewInput, 10) : null
        });
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
    return getFieldContainer(input, index, ['视频'], ['预览图', '封面', '头像', 'Logo', 'logo']);
}

function getPreviewFieldContainer(input, index) {
    return getFieldContainer(input, index, ['预览图', '封面'], ['头像', 'Logo', 'logo']);
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
    return `${childCount}|${mediaCount}|${progressCount}|${text.slice(0, 500)}|${el.innerHTML.length}`;
}

function countMediaLike(el) {
    if (!el) return 0;
    return el.querySelectorAll('img, video, canvas, [style*="background-image"], .ep-upload-list__item, .el-upload-list__item, li[class*="upload"]').length;
}

function normalizeText(text) {
    return (text || '').replace(/\s+/g, '');
}

function switchToTab(index) {
    const tabs = Array.from(document.querySelectorAll('.ep-tabs__item'));
    const targetTab = tabs.find(el => el.innerText.trim() === `创意${index}`);
    if (targetTab) { targetTab.click(); return true; }
    return false;
}

async function switchToTabForVideo(index) {
    const tabs = Array.from(document.querySelectorAll('.ep-tabs__item, .el-tabs__item, [role="tab"]'));
    const targetTab = tabs.find(el => normalizeText(el.innerText || '') === `创意${index}`);
    if (!targetTab) return false;

    targetTab.click();
    return true;
}

function findButtonByText(scope, text) {
    if (!scope) return null;
    const btns = Array.from(scope.querySelectorAll('button, span, div'));
    return btns.find(el => el.innerText.trim().includes(text) && el.offsetParent !== null);
}

function findButtonByTextStrict(scope, text) {
    return findButtonByTexts(scope, [text]);
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
        console.warn('[LoveToolbox] 已阻止危险点击：', text);
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

async function waitForDialogOpen(timeoutMs = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const dialogs = Array.from(document.querySelectorAll(
            '.ep-dialog, .el-dialog, .ep-dialog__body, .el-dialog__body'
        ));

        const visibleDialog = dialogs.find(dialog => isElementVisible(dialog));
        if (visibleDialog) {
            return visibleDialog.closest('.ep-dialog, .el-dialog') || visibleDialog;
        }

        await sleep(200);
    }

    return null;
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

// 保留旧函数，避免别处调用报错；新视频流程不再使用它
async function waitForVideoUploadReaction(container, initialChildCount, timeoutMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const hasMedia = container.querySelector('img') || container.querySelector('video');
        const hasProgress = container.querySelector('.ep-progress') || container.querySelector('.el-progress');
        const currentCount = container.querySelectorAll('*').length;
        if (hasMedia || hasProgress || currentCount !== initialChildCount) return true;
        await sleep(300);
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
