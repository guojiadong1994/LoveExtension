// === 1. 初始化 UI (保持最美外观) ===
function initFloatBall() {
    if (document.getElementById('love-float-ball')) return;

    const ball = document.createElement('div');
    ball.id = 'love-float-ball';
    ball.removeAttribute('style'); 
    
    ball.innerHTML = `
        <div class="center-icon">🍀</div>
        <div class="btn-group">
            <div class="action-btn" id="btn-img" title="批量上传图片">🎇</div>
            <div class="action-btn" id="btn-video" title="批量上传视频">🎬</div>
            <div class="action-btn" id="btn-move" title="按住拖动">✥</div>
        </div>
        <input type="file" id="love-hidden-input" multiple>
    `;
    document.body.appendChild(ball);

    const input = document.getElementById('love-hidden-input');
    const btnImg = document.getElementById('btn-img');
    const btnVideo = document.getElementById('btn-video');
    const btnMove = document.getElementById('btn-move');

    btnImg.onclick = () => { input.accept = "image/*"; input.click(); };
    btnVideo.onclick = () => { input.accept = "video/*"; input.click(); };

    input.onchange = (e) => {
        if (e.target.files.length > 0) {
            const files = Array.from(e.target.files).slice(0, 10);
            const type = input.accept.includes('video') ? 'video' : 'image';
            input.value = ''; 
            startAutomation(files, type);
        }
    };

    setupDrag(ball, btnMove);
}

// === 2. 核心自动化逻辑 ===
async function startAutomation(files, type) {
    const ball = document.getElementById('love-float-ball');
    ball.style.borderColor = '#415fff'; 
    ball.style.background = 'rgba(236, 245, 255, 0.9)'; 

    showToast(`🚀 准备上传 ${files.length} 个${type === 'video' ? '视频' : '图片'}...`, 3000);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const index = i + 1; 

        console.log(`>>> 正在处理创意 ${index}`);
        
        // --- A. 切 Tab ---
        const tabSuccess = await switchToTab(index);
        if (!tabSuccess) {
            showToast(`⚠️ 没找到 "创意${index}"，跳过`, 2000);
            continue;
        }
        await sleep(1000); 

        // --- B. 智能识别上传框 ---
        const classifiedInputs = identifyUploadInputs();
        let mainInput = null;
        let coverInput = null;

        if (type === 'video') {
            mainInput = classifiedInputs.video; 
            coverInput = classifiedInputs.cover; 
            
            if (!mainInput) {
                showToast(`❌ 创意${index} 未找到视频区域，为安全跳过`, 4000);
                continue; 
            }
        } else {
            mainInput = classifiedInputs.image;
            if (!mainInput) {
                showToast(`❌ 创意${index} 未找到图片区域，跳过`, 3000);
                continue;
            }
        }

        // --- C. 处理主文件 ---
        const uploadContainer = mainInput.closest('.ep-upload');

        // 1. 删旧文件
        if (uploadContainer) {
            const deleteBtn = uploadContainer.querySelector('.ep-icon');
            if (deleteBtn) {
                console.log('发现旧文件，删除中...');
                deleteBtn.click();
                await sleep(800);
            }
        }

        // 2. 上传新文件
        uploadFileToInput(mainInput, file);
        
        // 3. 🌟 智能等待 (带错误感知)
        // 图片也要检查，因为图片也可能尺寸不对
        showToast(`⏳ 正在上传... 请稍候`, 2000);
        
        // 视频给60秒，图片给10秒
        const waitTime = type === 'video' ? 60 : 10;
        
        // 🌟 核心变化：接收详细的返回结果
        const result = await waitForUploadResult(uploadContainer, waitTime); 
        
        if (!result.success) {
            // 🚨 失败了！
            // 播放一个失败的视觉反馈（红框闪烁）
            ball.style.borderColor = 'red';
            setTimeout(() => ball.style.borderColor = '#415fff', 3000);

            if (result.reason === 'error_toast') {
                // 网页报错了（比如尺寸不对）
                showToast(`❌ 上传失败！网页提示：${result.message}`, 6000);
            } else {
                // 超时了
                showToast(`⚠️ 创意${index} 上传超时，可能网速慢`, 4000);
            }

            // 遇到错误，直接跳过当前创意的后续步骤，去搞下一个
            continue; 
        }

        // --- D. 处理视频封面 (仅当视频成功后) ---
        if (type === 'video' && coverInput) {
            const coverContainer = coverInput.closest('.ep-upload');
            
            if (coverContainer) {
                const oldCoverBtn = coverContainer.querySelector('.ep-icon');
                if (oldCoverBtn) {
                    oldCoverBtn.click();
                    await sleep(500);
                }
            }

            const parentArea = coverContainer.parentElement.parentElement; 
            const autoGenBtn = findButtonByText(parentArea, '自动生成');
            
            if (autoGenBtn) {
                autoGenBtn.click();
                showToast('🤖 正在自动生成封面...', 1500);
                await sleep(2000); 

                const dialogBody = document.querySelector('.ep-dialog__body'); 
                if (dialogBody) {
                    const firstCheckbox = dialogBody.querySelector('.ep-checkbox');
                    if (firstCheckbox) firstCheckbox.click();
                    await sleep(300);
                }

                const dialogFooter = document.querySelector('.ep-dialog__footer');
                if (dialogFooter) {
                    const confirmBtn = findButtonByText(dialogFooter, '填充') || findButtonByText(dialogFooter, '确定');
                    if (confirmBtn) confirmBtn.click();
                }
                await sleep(1000); 
            }
        }
    }

    ball.style.borderColor = ''; 
    ball.style.background = '';
    showToast(`✅ 所有任务结束！`, 5000);
}

// === 3. 🧠 智能识别函数 ===
function identifyUploadInputs() {
    const allInputs = Array.from(document.querySelectorAll('.ep-upload__input'));
    const visibleInputs = allInputs.filter(el => el.offsetParent !== null || (el.parentElement && el.parentElement.offsetParent !== null));

    let result = { video: null, image: null, cover: null, avatar: null };

    visibleInputs.forEach(input => {
        const container = input.closest('.form-item, .field-row, .ep-form-item') || input.parentElement.parentElement.parentElement;
        if (!container) return;
        const text = container.innerText.trim();

        if (text.includes('头像') || text.includes('Logo') || text.includes('图标')) {
            result.avatar = input;
            return;
        }
        if (text.includes('视频') && !text.includes('封面') && !text.includes('预览图')) {
            result.video = input;
        }
        else if (text.includes('封面') || text.includes('预览图')) {
            result.cover = input;
        }
        else if (text.includes('图片') || text.includes('素材')) {
            result.image = input;
        }
    });

    if (!result.video && !result.image && visibleInputs.length >= 1) {
        const candidates = visibleInputs.filter(i => i !== result.avatar);
        if (candidates.length > 0) {
            result.video = candidates[0];
            result.image = candidates[0];
            if (candidates.length > 1) result.cover = candidates[1];
        }
    }
    return result;
}

// === 4. 工具函数 ===

// 🌟🌟🌟 核心升级：同时监控成功和报错 🌟🌟🌟
async function waitForUploadResult(container, timeoutSeconds) {
    let retries = 0;
    return new Promise(resolve => {
        const timer = setInterval(() => {
            retries++;
            
            // 1. 检查成功：看到删除按钮
            const deleteIcon = container.querySelector('.ep-icon');
            if (deleteIcon) {
                clearInterval(timer);
                resolve({ success: true, reason: 'uploaded' });
                return;
            }

            // 2. 检查失败：扫描网页上有没有红色的错误提示
            // Element UI 的错误提示通常是 div.ep-message--error
            const errorToast = document.querySelector('.ep-message--error');
            if (errorToast && errorToast.offsetParent !== null) {
                // 找到了错误提示！抓取里面的文字
                const errorText = errorToast.innerText || '未知错误';
                console.warn('捕获到网页报错:', errorText);
                clearInterval(timer);
                resolve({ success: false, reason: 'error_toast', message: errorText });
                return;
            }

            // 3. 检查超时
            if (retries >= timeoutSeconds) {
                clearInterval(timer);
                resolve({ success: false, reason: 'timeout' });
            }
        }, 1000); 
    });
}

function switchToTab(index) {
    const tabs = Array.from(document.querySelectorAll('.ep-tabs__item'));
    const targetTab = tabs.find(el => el.innerText.trim() === `创意${index}`);
    if (targetTab) {
        targetTab.click();
        return true;
    }
    return false;
}

function uploadFileToInput(inputElement, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputElement.files = dt.files;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
}

function findButtonByText(scope, text) {
    if (!scope) return null;
    const btns = Array.from(scope.querySelectorAll('button, span, div')); 
    return btns.find(el => el.innerText.trim().includes(text) && el.offsetParent !== null);
}

function setupDrag(container, handle) {
    let isDragging = false;
    let shiftX, shiftY; 
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        isDragging = true;
        container.classList.add('is-dragging');
        const rect = container.getBoundingClientRect();
        shiftX = e.clientX - rect.left;
        shiftY = e.clientY - rect.top;
        container.style.removeProperty('bottom');
        container.style.removeProperty('right');
        container.style.top = rect.top + 'px';
        container.style.left = rect.left + 'px';
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const newLeft = e.clientX - shiftX;
        const newTop = e.clientY - shiftY;
        container.style.left = newLeft + 'px';
        container.style.top = newTop + 'px';
    });
    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        container.classList.remove('is-dragging');
    });
}

function showToast(message, duration = 3000) {
    const old = document.querySelector('.love-toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.className = 'love-toast';
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

initFloatBall();