// === 1. 初始化 UI (极简黑白文字版 - 最终修正) ===
function initFloatBall() {
    if (document.getElementById('love-float-ball')) return;

    const ball = document.createElement('div');
    ball.id = 'love-float-ball';
    
    // 🌟 样式调整：右下角，黑白简约风
    Object.assign(ball.style, {
        position: 'fixed',
        bottom: '50px',            
        right: '50px',
        // 🌟 新增：强制重置 top 和 left，防止被旧 CSS 抢走位置
        top: 'auto',
        left: 'auto',
        
        zIndex: '2147483647',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        border: '1px solid #e0e0e0',
        padding: '10px 20px',       
        borderRadius: '8px',
        cursor: 'pointer',         
        userSelect: 'none',
        transition: 'all 0.2s ease',
        fontFamily: 'sans-serif'
    });

    // 🌟 HTML：只有纯文字
    ball.innerHTML = `
        <div id="btn-text" style="
            color: #333333; 
            font-size: 14px; 
            font-weight: 600;
            white-space: nowrap;
        ">
            开始录制
        </div>
        
        <div id="recording-border" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; border:4px solid rgba(255, 0, 0, 0.3); pointer-events:none; z-index:999998; box-sizing:border-box;"></div>
    `;
    
    document.body.appendChild(ball);

    const btnText = document.getElementById('btn-text');
    const border = document.getElementById('recording-border');
    let isRecording = false;

    ball.onclick = () => {
        if (!isRecording) {
            // === 开始 ===
            isRecording = true;
            btnText.innerHTML = `结束录制 (0)`;
            ball.style.borderColor = '#999';
            ball.style.background = '#f9f9f9';
            border.style.display = 'block';
            showToast('🎥 录制已开始', 2000);
            
            startRecording((count) => {
                btnText.innerHTML = `结束录制 (${count})`;
            });
            
        } else {
            // === 停止 ===
            isRecording = false;
            stopRecording();
            btnText.innerHTML = `开始录制`;
            ball.style.borderColor = '#e0e0e0';
            ball.style.background = 'rgba(255, 255, 255, 0.95)';
            border.style.display = 'none';
        }
    };
}

// === 下面的逻辑保持不变 ===

let recordedActions = []; 
let clickListener = null; 

function startRecording(onActionCaptured) {
    recordedActions = []; 
    clickListener = (e) => {
        if (e.target.closest('#love-float-ball')) return;
        const target = e.target;
        const actionData = {
            step: recordedActions.length + 1,
            time: new Date().toLocaleTimeString(),
            tagName: target.tagName,
            id: target.id || '',
            className: target.className || '',
            innerText: target.innerText ? target.innerText.trim().substring(0, 50) : '',
            name: target.name || '',
            type: target.type || '',
            parentHTML: target.parentElement ? target.parentElement.outerHTML.substring(0, 100) : ''
        };
        recordedActions.push(actionData);
        console.log(`[录制] 步骤 ${actionData.step}:`, actionData);
        target.style.outline = '2px solid red';
        setTimeout(() => target.style.outline = '', 300);
        if (onActionCaptured) onActionCaptured(recordedActions.length);
    };
    document.addEventListener('click', clickListener, true);
}

function stopRecording() {
    if (clickListener) {
        document.removeEventListener('click', clickListener, true);
    }
    if (recordedActions.length === 0) {
        showToast('⚠️ 没操作？', 2000);
        return;
    }
    showToast('💾 正在保存...', 2000);
    const fullData = {
        url: window.location.href,
        totalSteps: recordedActions.length,
        actions: recordedActions,
        htmlSnapshot: document.body.outerHTML 
    };
    const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timeStr = new Date().toLocaleTimeString().replace(/:/g, '-');
    a.download = `girlfriend_data_${timeStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function showToast(message, duration = 3000) {
    const oldToast = document.querySelector('.love-toast');
    if (oldToast) oldToast.remove();
    const toast = document.createElement('div');
    toast.className = 'love-toast';
    Object.assign(toast.style, {
        position: 'fixed',
        top: '20px', 
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: '4px',
        fontSize: '13px',
        zIndex: '2147483647',
        opacity: '0',
        transition: 'opacity 0.3s',
        pointerEvents: 'none'
    });
    toast.innerText = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.style.opacity = '1');
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

initFloatBall();