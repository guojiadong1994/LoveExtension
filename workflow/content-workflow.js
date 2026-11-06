/*
 * LoveExtension V1.3.5: existing navigation plus optional automatic legacy upload.
 * Pure addition: no changes to content.js, style.css or the existing upload logic.
 */
(() => {
  'use strict';
  if (window.__LOVE_NAV_V1__) return;
  window.__LOVE_NAV_V1__ = true;

  const path = () => location.pathname.replace(/\/$/, '');
  const stage = () => {
    if (path() === '/marketing/promotion/plan') return 'plan';
    if (/^\/marketing\/promotion\/group\/\d+$/.test(path())) return 'group';
    if (/^\/marketing\/promotion\/advertisement\/\d+$/.test(path())) return 'ad';
    if (/^\/marketing\/ads\/edit\/\d+\/\d+$/.test(path())) return 'editor';
    return 'other';
  };
  const STAGE_FROM_STEP = { OPEN_GROUP: 'group', OPEN_AD: 'ad', VERIFY_AD: 'ad', OPEN_EDITOR: 'ad', UPLOAD_READY: 'editor', UPLOADING: 'editor' };
  const STEPS = {
    OPEN_GROUP: '进入广告组并同步名称',
    OPEN_AD: '进入广告并同步名称',
    VERIFY_AD: '刷新后校验广告名称',
    OPEN_EDITOR: '打开广告编辑页',
    UPLOAD_READY: '等待广告编辑页加载并准备素材',
    UPLOADING: '正在调用原有一键素材+文案',
    DONE: '已完成自动处理'
  };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el && el.isConnected && !!el.getClientRects().length &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const ui = { host: null, root: null, dialogOpen: false, pickReject: null, noticeShown: false };
  let inFlight = false;
  let awaitingNavigationReload = false;
  let knownTask = null;
  let workingTaskId = '';
  let uploadInFlight = false;
  let uploadCheckTimer = null;

  async function api(type, fields = {}) {
    const res = await chrome.runtime.sendMessage({ type: `LOVE_WORKFLOW_${type}`, ...fields });
    if (!res?.ok) throw new Error(res?.error || '扩展后台暂时无法响应，请刷新页面重试。');
    return res.task || null;
  }

  function ensureUI() {
    if (ui.host?.isConnected) return ui.root;
    const host = document.createElement('div');
    host.id = 'love-workflow-v1-host';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all:initial; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif; color:#283042; }
      * { box-sizing:border-box; }
      .screen { position:fixed; inset:0; z-index:2147483646; background:rgba(18,23,37,.43); display:flex; align-items:center; justify-content:center; padding:20px; }
      .panel { background:white; width:min(480px,95vw); border-radius:15px; box-shadow:0 15px 50px rgba(17,26,54,.2); overflow:hidden; }
      .head { display:flex; align-items:center; justify-content:space-between; padding:18px 20px; border-bottom:1px solid #eef0f5; font-size:16px; font-weight:700; }
      /* Compact, truly centered heading for the plan-start dialog only. */
      .head.plan-head { position:relative; justify-content:center; min-height:42px; padding:9px 44px; font-size:15px; font-weight:600; text-align:center; }
      .head.plan-head .close { position:absolute; right:10px; top:50%; transform:translateY(-50%); padding:1px 8px; border:0; line-height:1.2; }
      .close { background:none; border:0; font-size:23px; cursor:pointer; color:#8992a5; }
      .body { padding:18px 20px; font-size:13px; line-height:1.7; }
      .muted { color:#748096; } .name { overflow-wrap:anywhere; color:#415fff; background:#f2f5ff; border-radius:8px; padding:10px; margin:8px 0 16px; font-weight:600; }
      .small { color:#8790a3; font-size:12px; margin-top:10px; }
      .name-input { display:block; width:100%; margin:8px 0 6px; padding:10px; border:1px solid #dce2f0; border-radius:8px; background:#f2f5ff; color:#415fff; font-family:inherit; font-weight:600; font-size:13px; line-height:1.5; outline:none; overflow-wrap:anywhere; }
      .name-input:focus { border-color:#415fff; background:white; box-shadow:0 0 0 2px rgba(65,95,255,.12); }
      .wf-label { display:block; font-weight:600; color:#4c586d; margin:12px 0 5px; }
      .wf-input { display:block; width:100%; padding:9px 10px; background:white; color:#30394a; border:1px solid #dce2f0; border-radius:8px; font-size:13px; font-family:inherit; }
      .wf-input:focus { outline:1px solid #415fff; }
      .wf-file-info { margin-top:5px; font-size:12px; color:#6e7b91; overflow-wrap:anywhere; }
      .wf-choice-tip { padding:9px 10px; background:#f7f9fd; border-radius:7px; color:#728097; font-size:12px; }
      .wf-scroll { max-height:65vh; overflow-y:auto; }
      .field-error { color:#b33530; font-size:12px; margin:2px 0 8px; }
      .steps { margin:10px 0 0; padding-left:20px; line-height:2; }
      .actions { display:flex; gap:10px; justify-content:flex-end; padding:0 20px 18px; }
      button { font-family:inherit; cursor:pointer; border-radius:8px; padding:9px 16px; border:1px solid #dce0e8; background:white; color:#333; }
      button.primary { color:white; background:#415fff; border-color:#415fff; }
      button.warn { color:#c34438; border-color:#f2c7c2; }
      button:disabled { opacity:.6; cursor:default; }
      .item { display:block; width:100%; border-radius:8px; margin:7px 0; text-align:left; line-height:1.5; overflow-wrap:anywhere; }
      .item:hover { border-color:#415fff; background:#f3f5ff; }
      .choices { max-height:40vh; overflow-y:auto; margin:10px 0 0; }
      .progress { position:fixed; right:18px; bottom:18px; z-index:2147483645; width:320px; max-width:calc(100vw - 36px); background:white; padding:14px 16px; border:1px solid #e7e9f0; box-shadow:0 7px 28px rgba(24,29,50,.17); border-radius:12px; font-size:13px; line-height:1.6; }
      .progress-title { font-weight:700; color:#415fff; margin-bottom:5px; }
      .progress-name { color:#4c596f; overflow-wrap:anywhere; font-size:12px; }
      .progress-state { margin:8px 0; color:#283042; }
      .progress-actions { display:flex; justify-content:flex-end; }
      .progress-actions button { padding:5px 12px; font-size:12px; }
      .error { color:#b33530; overflow-wrap:anywhere; }
    `;
    shadow.appendChild(style);
    ui.host = host;
    ui.root = shadow;
    return shadow;
  }

  function clearModal() {
    const root = ensureUI();
    root.getElementById('love-wf-modal')?.remove();
    ui.dialogOpen = false;
  }
  function modal(title, populate) {
    const root = ensureUI();
    clearModal();
    const screen = document.createElement('div');
    screen.id = 'love-wf-modal';
    screen.className = 'screen';
    const panel = document.createElement('div');
    panel.className = 'panel';
    const heading = document.createElement('div');
    heading.className = title === '自动处理广告计划' ? 'head plan-head' : 'head';
    const h = document.createElement('span'); h.textContent = title;
    const close = document.createElement('button'); close.className = 'close'; close.textContent = '×'; close.title = '关闭';
    close.onclick = () => {
      if (ui.pickReject) { const r = ui.pickReject; ui.pickReject = null; r(new Error('已取消选择目标')); }
      clearModal();
    };
    heading.append(h, close);
    const body = document.createElement('div'); body.className = 'body wf-scroll';
    const foot = document.createElement('div'); foot.className = 'actions';
    panel.append(heading, body, foot);
    screen.appendChild(panel);
    root.appendChild(screen);
    ui.dialogOpen = true;
    populate(body, foot, close);
  }
  function textDiv(parent, text, className = '') {
    const el = document.createElement('div'); el.className = className; el.textContent = text; parent.appendChild(el); return el;
  }
  function button(parent, label, handler, cls = '') {
    const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = handler; parent.appendChild(b); return b;
  }

  function renderProgress(task) {
    // Only workflow failures should open the bottom-right notification.
    // Keep tracking knownTask for the navigation/upload state machine, but
    // silently remove progress, completion, and user-stop notices.
    knownTask = task;
    ui.root?.getElementById('love-wf-progress')?.remove();
    if (!task || task.status !== 'failed') return;

    const root = ensureUI();
    const wrap = document.createElement('div');
    wrap.id = 'love-wf-progress';
    wrap.className = 'progress';
    textDiv(wrap, 'LoveExtension · 计划自动处理', 'progress-title');
    textDiv(wrap, task.name || '', 'progress-name');
    textDiv(wrap, `任务失败：${task.error || '未知原因'}`, 'progress-state error');
    const actions = document.createElement('div');
    actions.className = 'progress-actions';
    button(actions, '复制错误', () => {
      const detail = `LoveExtension V1.3.5\n页面：${location.pathname}\n步骤：${task.step}\n计划：${task.name}\n错误：${task.error || ''}`;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(detail).catch(() => window.prompt('复制以下错误信息', detail));
      } else {
        window.prompt('复制以下错误信息', detail);
      }
    });
    button(actions, '关闭提示', () => wrap.remove());
    wrap.appendChild(actions);
    root.appendChild(wrap);
  }

  // Vivo uses slightly different table markup on plan/group/ad pages. The ad
  // name cell may lose the .common-text or the direct-child span wrapper after
  // a Vue render, even though its row, pencil and edit link are still present.
  // We *only* fall back within the dedicated name cell, never to row.textContent
  // (which would accidentally mix the name with status, actions and metrics).
  function nameCell(row, kind) {
    const candidates = [
      ...row.querySelectorAll('.name-div-content, .name-div')
    ];
    const named = candidates.find(el => el.closest('td'));
    if (named) return named.closest('td');
    const cells = [...row.querySelectorAll(':scope > td')];
    // Element Plus: ad = checkbox | expand arrow | name; group/plan = checkbox | name.
    const expectedIndex = kind === 'ad' ? 2 : 1;
    return cells[expectedIndex] || null;
  }

  function getName(row, kind) {
    // Prefer the title element but don't require a *direct child* span.
    const selectors = [
      '.name-div-content .common-text',
      '.name-div .common-text',
      '.name-div-content',
      '.name-div'
    ];
    const cell = nameCell(row, kind);
    if (!cell) return '';
    for (const selector of selectors) {
      const element = cell.querySelector(selector);
      if (element) {
        // Icon fonts may insert glyphs or even literal text in a development
        // environment. Remove control nodes before reading the actual title.
        const clone = element.cloneNode(true);
        clone.querySelectorAll('.icon-wrap, .icon-edit, [class*="icon-edit"], button, input, svg, [role="button"]').forEach(el => el.remove());
        const value = clean(clone.textContent);
        if (value) return value;
      }
    }
    // Last resort: the ad name may be directly in the name cell without the
    // familiar wrappers. Never fall back to the entire row's text.
    const fallback = cell.cloneNode(true);
    fallback.querySelectorAll('.icon-wrap, .icon-edit, button, input, svg, [role="button"]').forEach(el => el.remove());
    return clean(fallback.textContent);
  }

  function rows(kind) {
    const selectors = [
      '.ep-table__body-wrapper:not(.is-mobile) tr.ep-table__row',
      '.ep-table__body-wrapper tr.ep-table__row',
      'tr.ep-table__row'
    ];
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)]
        .filter(row => row.isConnected && visible(row))
        .filter(row => kind !== 'ad' || !!row.querySelector('a[href*="/marketing/ads/edit/"]'))
        .map(row => ({ row, name: getName(row, kind) }))
        .filter(item => item.name);
      // Do not consider cloned table rows as separate records when possible.
      const unique = found.filter((item, index, all) =>
        all.findIndex(other => other.row === item.row) === index);
      if (unique.length) return unique;
    }
    return [];
  }

  async function waitFor(test, description, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = test();
      if (result) return result;
      if (knownTask?.status === 'stopped') throw new Error('任务已停止');
      await pause(180);
    }
    throw new Error(`等待${description}超时`);
  }
  const waitForPage = (expected, timeout = 26000) => waitFor(() => stage() === expected, `跳转到${expected}页面`, timeout);

  function selectedMediaKind(files) {
    const kinds = new Set();
    for (const file of files) {
      const name = file.name || '';
      if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name)) kinds.add('image');
      else if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|avi|webm|mkv)$/i.test(name)) kinds.add('video');
      else return '';
    }
    return kinds.size === 1 ? [...kinds][0] : '';
  }

  function announceStart(name, row, anchor) {
    if (knownTask?.status === 'running') {
      renderProgress(knownTask);
      return;
    }
    modal('自动处理广告计划', (body, foot) => {
      textDiv(body, '已识别广告计划名称（可修改）：', 'muted');
      const nameInput = document.createElement('input');
      nameInput.className = 'name-input';
      nameInput.type = 'text';
      nameInput.value = name;
      nameInput.maxLength = 200;
      nameInput.autocomplete = 'off';
      nameInput.spellcheck = false;
      nameInput.setAttribute('aria-label', '广告计划名称（可修改）');
      nameInput.placeholder = '请输入最终需要同步的广告计划名称';
      body.appendChild(nameInput);
      textDiv(body, '以下名称只用于同步广告组、广告，不会再次修改计划名称。', 'small');

      const mediaLabel = document.createElement('label');
      mediaLabel.className = 'wf-label';
      mediaLabel.textContent = '选择图片或视频（可选，最多10个）';
      body.appendChild(mediaLabel);
      let chosenHandles = [];
      let chosenDescriptions = [];
      let chosenKind = '';
      const fileInfo = textDiv(body, '未选择素材；可以只修改文案，也可以仅同步名称。', 'wf-file-info');
      const picker = button(body, '选择图片 / 视频文件', async () => {
        fileInfo.textContent = '正在打开文件选择器…';
        if (typeof window.showOpenFilePicker !== 'function') {
          fileInfo.textContent = '此浏览器或页面不支持文件句柄选择器，请使用新版 Chrome。不会回退到复制视频的旧方式。';
          return;
        }
        try {
          // This call MUST precede any await, to preserve the user gesture.
          const handles = await window.showOpenFilePicker({
            id: 'love-workflow-media',
            multiple: true,
            types: [{
              description: '图片和视频',
              accept: {
                'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
                'video/*': ['.mp4', '.mov', '.m4v', '.avi', '.webm', '.mkv']
              }
            }]
          });
          if (!handles?.length) return;
          if (handles.length > 10) throw new Error('一次最多选择 10 个素材。');
          // getFile() here obtains only a lazy file reference and its metadata;
          // it does NOT read video/image bytes or persist copies.
          const descriptions = await Promise.all(handles.map(async h => {
            const f = await h.getFile();
            return { name: f.name, type: f.type, size: f.size, lastModified: f.lastModified };
          }));
          const kind = selectedMediaKind(descriptions);
          if (!kind) throw new Error('请只选择图片或只选择视频，不能混选。');
          chosenHandles = handles;
          chosenDescriptions = descriptions;
          chosenKind = kind;
          fileInfo.textContent = `${handles.length} 个${kind === 'image' ? '图片' : '视频'}文件 · ${descriptions.map(d => d.name).slice(0, 3).join('、')}${handles.length > 3 ? '……' : ''}（仅保留文件句柄）`;
          nameError.textContent = '';
        } catch (err) {
          if (err?.name !== 'AbortError') {
            fileInfo.textContent = `选择失败：${err?.message || err}`;
          } else {
            fileInfo.textContent = chosenHandles.length
              ? `已保留之前选择的 ${chosenHandles.length} 个文件句柄`
              : '未选择素材；可以只修改文案，也可以仅同步名称。';
          }
        }
      }, 'wf-picker');
      picker.type = 'button';
      picker.style.width = '100%';
      picker.style.textAlign = 'left';
      const clearFiles = button(body, '清除已选素材', () => {
        chosenHandles = [];
        chosenDescriptions = [];
        chosenKind = '';
        fileInfo.textContent = '未选择素材；可以只修改文案，也可以仅同步名称。';
        nameError.textContent = '';
      });
      clearFiles.type = 'button';
      clearFiles.style.padding = '4px 9px';
      clearFiles.style.fontSize = '12px';
      clearFiles.style.marginTop = '5px';
      const appLabel = document.createElement('label'); appLabel.className = 'wf-label'; appLabel.textContent = '标题 / 应用名称（可选）'; body.appendChild(appLabel);
      const appName = document.createElement('input'); appName.className = 'wf-input'; appName.type = 'text'; appName.maxLength = 200; appName.placeholder = '填写给所有目标创意的应用名称'; appName.autocomplete = 'off'; body.appendChild(appName);
      const subtitleLabel = document.createElement('label'); subtitleLabel.className = 'wf-label'; subtitleLabel.textContent = '应用副标题（可选）'; body.appendChild(subtitleLabel);
      const appSubtitle = document.createElement('input'); appSubtitle.className = 'wf-input'; appSubtitle.type = 'text'; appSubtitle.maxLength = 500; appSubtitle.placeholder = '填写给所有目标创意的副标题'; appSubtitle.autocomplete = 'off'; body.appendChild(appSubtitle);
      textDiv(body, '支持只换素材、只改文案、两者同时处理。图片和视频不能混选。这里的名称与广告编辑页的“应用名称”互不关联。', 'wf-choice-tip');
      const nameError = textDiv(body, '', 'field-error');
      [nameInput, appName, appSubtitle].forEach(input => input.addEventListener('input', () => { nameError.textContent = ''; }));
      button(foot, '取消', clearModal);
      const start = button(foot, '开始自动处理', async () => {
        const finalName = nameInput.value.trim();
        const handles = chosenHandles;
        const descriptions = chosenDescriptions;
        const kind = chosenKind;
        if (!finalName || finalName.length > 200) {
          nameError.textContent = '计划名称不能为空或超过 200 个字符。'; nameInput.focus(); return;
        }
        if (handles.length > 10) { nameError.textContent = '一次最多选择 10 个素材。'; return; }
        if (handles.length && !kind) { nameError.textContent = '请只选图片或只选视频，不支持两类素材混合。'; return; }
        const title = appName.value.trim();
        const subtitle = appSubtitle.value.trim();
        start.disabled = true;
        start.textContent = handles.length ? '保存文件句柄中…' : '启动中…';
        try {
          // A corrected target name never changes the selected plan-row identity.
          if (!row.isConnected || getName(row, 'plan') !== name || !visible(anchor)) throw new Error('计划行已更新，请重新在标题上右键启动。');
          const task = await api('START', {
            name: finalName, appName: title, appSubtitle: subtitle,
            mediaKind: kind, fileCount: handles.length
          });
          knownTask = task;
          if (handles.length) await LoveWorkflowMediaStore.put(task.id, handles, descriptions, kind);
          if (!row.isConnected || getName(row, 'plan') !== name) throw new Error('保存文件句柄期间计划列表发生变化，请重新启动。');
          if ((await api('GET'))?.status !== 'running') throw new Error('任务已停止');
          clearModal();
          renderProgress(task);
          clickName(row, 'plan');
          await waitForPage('group');
        } catch (err) {
          if (knownTask?.status === 'running') await fail(err);
          else { start.disabled = false; start.textContent = '开始自动处理'; nameError.textContent = `启动失败：${err.message}`; }
        }
      }, 'primary');
    });
  }

  function onContextMenu(event) {
    if (stage() !== 'plan') return;
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest('.name-div .common-text');
    const row = target?.closest('tr.ep-table__row');
    if (!target || !row || !visible(target)) return;
    const name = getName(row, 'plan');
    if (!name || name.length > 200) return;
    event.preventDefault();
    event.stopPropagation();
    announceStart(name, row, target);
  }

  function clickName(row, kind) {
    if (!row?.isConnected) throw new Error('目标记录已刷新，请重新选择。');
    const content = kind === 'ad'
      ? row.querySelector('.name-div-content .common-text')
      : row.querySelector('.name-div .common-text');
    if (!content) throw new Error('找不到可以点击的名称元素。');
    content.click();
  }

  async function chooseRow(items, kind, name) {
    if (items.length === 1) return items[0];
    return new Promise((resolve, reject) => {
      ui.pickReject = reject;
      modal(`${kind === 'group' ? '选择广告组' : '选择广告'}`, (body, foot, close) => {
        textDiv(body, `当前找到 ${items.length} 条记录，请指定需要同步名称的那一条（目标计划：${name}）。不会自动选择第一条。`);
        const choices = document.createElement('div'); choices.className = 'choices';
        for (const [index, item] of items.entries()) {
          button(choices, `${index + 1}. ${item.name}`, () => {
            ui.pickReject = null;
            clearModal();
            resolve(item);
          }, 'item');
        }
        body.appendChild(choices);
        button(foot, '取消本次任务', close.click.bind(close));
      });
    });
  }

  async function findRow(kind, name) {
    let items;
    try {
      items = await waitFor(() => {
        const found = rows(kind);
        return found.length ? found : null;
      }, `${kind === 'group' ? '广告组' : '广告'}记录`, 25000);
    } catch (error) {
      // If Vivo changes its markup again, provide enough diagnostics to fix the
      // selector without asking the user to reproduce the whole workflow.
      const candidates = [...document.querySelectorAll('tr.ep-table__row')];
      const samples = candidates.slice(0, 2).map(row => {
        const cell = nameCell(row, kind);
        return `单元格=${row.cells?.length ?? '?'}, 名称列=${clean(cell?.textContent).slice(0, 65) || '空'}, 编辑入口=${!!findEditLink(row)}`;
      });
      throw new Error(`${error.message}（表格行=${candidates.length}；${samples.join('；') || '无样本'}）`);
    }
    return chooseRow(items, kind, name);
  }

  function smallPencil(row, kind) {
    const parent = kind === 'ad'
      ? (row.querySelector('.name-div-content') || row.querySelector('.name-div'))
      : row.querySelector('.name-div');
    return parent?.querySelector('.icon-wrap .icon-edit, .icon-edit, [class*="icon-edit"]') || null;
  }
  function nameDialogs(kind) {
    const expected = kind === 'ad' ? /修改.*广告名称|修改名称/ : /修改.*(广告组)?名称/;
    return [...document.querySelectorAll('.ep-dialog, .el-dialog')].filter(el => {
      const title = clean(el.getAttribute('aria-label') || el.querySelector('.ep-dialog__title, .el-dialog__title')?.textContent);
      return visible(el) && expected.test(title) && el.querySelector('input.ep-input__inner, input.el-input__inner');
    });
  }
  async function openRenameDialog(row, kind) {
    if (!row.isConnected) throw new Error('名称所在记录已经刷新，请在列表中重新选择。');
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const pencil = await waitFor(() => smallPencil(row, kind), '名称旁的小铅笔', 10000);
    if (knownTask?.status !== 'running') throw new Error('任务已停止');
    // Site handlers can be on the pencil or its nearest wrapper: bubbling handles both.
    pencil.click();
    return waitFor(() => nameDialogs(kind)[0] || null, '修改名称弹窗（确认点击的是标题旁的小铅笔）', 12000);
  }

  // Vivo's table renders multiple copies of a row (including .is-mobile wrappers).
  // Ad editing URLs identify the *actual ad*, unlike table row objects or names.
  function adEditorHref(row) {
    const a = findEditLink(row);
    if (!a) return '';
    try {
      const url = new URL(a.href, location.origin);
      if (url.origin !== 'https://ad.vivo.com.cn' || !/^\/marketing\/ads\/edit\/\d+\/\d+\/?$/.test(url.pathname)) return '';
      return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    } catch { return ''; }
  }

  function adCopiesForHref(href) {
    const expected = String(href || '').replace(/\/$/, '');
    return [...document.querySelectorAll('tr.ep-table__row')]
      .filter(row => visible(row) && adEditorHref(row) === expected)
      .map(row => ({ row, name: getName(row, 'ad') }));
  }

  function findUpdatedRow(item, kind, newName, href = '') {
    if (kind === 'ad' && href) {
      // Do NOT treat an unrelated record with the same name as success.
      return adCopiesForHref(href).find(candidate => candidate.name === newName) || null;
    }
    if (item.row.isConnected && getName(item.row, kind) === newName) {
      return { row: item.row, name: newName };
    }
    const others = rows(kind).filter(i => i.name === item.name);
    if (item.row.isConnected || others.length) return null;
    const matches = rows(kind).filter(i => i.name === newName);
    return matches.length === 1 ? matches[0] : null;
  }

  async function rename(item, kind, newName) {
    if (item.name === newName) return item;
    const editorHref = kind === 'ad' ? adEditorHref(item.row) : '';
    if (kind === 'ad' && !editorHref) throw new Error('无法识别此条广告的唯一编辑地址，已停止，避免误改其他广告。');
    const dialog = await openRenameDialog(item.row, kind);
    const input = dialog.querySelector('input.ep-input__inner, input.el-input__inner');
    if (!input || input.disabled) throw new Error('修改名称输入框不可用');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('无法操作名称输入框');
    setter.call(input, newName);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const actionText = value => String(value || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
    const footer = dialog.querySelector('.ep-dialog__footer, .el-dialog__footer') || dialog;
    const getConfirm = () => {
      const buttons = [...footer.querySelectorAll('button')].filter(visible);
      const candidates = buttons.filter(b => actionText(b.innerText || b.textContent || b.getAttribute('aria-label')) === '确定');
      return candidates.length === 1 ? candidates[0] : null;
    };
    let confirm;
    try {
      confirm = await waitFor(() => {
        if (!visible(dialog)) throw new Error('填写名称后弹窗已关闭');
        const b = getConfirm();
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.classList.contains('is-disabled') ? b : null;
      }, '修改名称弹窗中可点击的「确定」按钮', 12000);
    } catch (error) {
      const detail = [...footer.querySelectorAll('button')]
        .map(b => `${actionText(b.innerText || b.textContent)}${b.disabled || b.getAttribute('aria-disabled') === 'true' ? '(禁用)' : ''}`)
        .join('、');
      throw new Error(`${error.message}。实际按钮：${detail || '未找到'}。如仍失败，请检查名称是否符合网站要求。`);
    }
    if (knownTask?.status !== 'running') throw new Error('任务已取消');
    confirm.click();
    await waitFor(() => !visible(dialog), '修改名称弹窗关闭', 16000);

    try {
      const updated = await waitFor(() => findUpdatedRow(item, kind, newName, editorHref), '选中记录的名称更新', kind === 'ad' ? 7500 : 18000);
      return updated;
    } catch (err) {
      // Closing the modal is not evidence of a successful server-side rename.
      // If Vue keeps the original ad row in memory, verify via a single page reload.
      if (kind === 'ad' && /^等待选中记录的名称更新超时$/.test(err.message) && knownTask?.status === 'running') {
        return { ...item, editorHref, pendingVerification: true };
      }
      throw err;
    }
  }

  async function advance(task, from, to, extra = {}) {
    const updated = await api('ADVANCE', { taskId: task.id, from, to, ...extra });
    knownTask = updated;
    renderProgress(updated);
    return updated;
  }

  async function isTaskRunning(id) {
    const latest = await api('GET');
    knownTask = latest;
    if (!latest || latest.id !== id || latest.status !== 'running') throw new Error('任务已停止或被其他任务替代');
    return latest;
  }

  async function runGroup(task) {
    const target = await findRow('group', task.name);
    await isTaskRunning(task.id);
    const current = await rename(target, 'group', task.name);
    await isTaskRunning(task.id);
    await advance(task, 'OPEN_GROUP', 'OPEN_AD');
    clickName(current.row, 'group');
    await waitForPage('ad');
  }

  function findEditLink(row) {
    const links = [...row.querySelectorAll('a[href^="/marketing/ads/edit/"], a[href^="https://ad.vivo.com.cn/marketing/ads/edit/"]')];
    return links.find(a => clean(a.innerText || a.textContent) === '编辑' || clean(a.querySelector('button')?.textContent) === '编辑') || null;
  }

  async function openAdEditor(task, href, from) {
    const progressed = await advance(task, from, 'OPEN_EDITOR', { href });
    const finished = await api('OPEN_EDITOR', { taskId: progressed.id, href });
    knownTask = finished;
    renderProgress(finished);
  }

  async function runAd(task) {
    const target = await findRow('ad', task.name);
    await isTaskRunning(task.id);
    const href = adEditorHref(target.row);
    if (!href) throw new Error('无法提取选中广告的唯一编辑地址，已停止操作。');
    const current = await rename(target, 'ad', task.name);
    await isTaskRunning(task.id);
    if (current.pendingVerification) {
      // Persist the exact ad identity BEFORE refreshing to prevent a second rename.
      await advance(task, 'OPEN_AD', 'VERIFY_AD', { href });
      awaitingNavigationReload = true;
      location.reload();
      return;
    }
    const verified = findUpdatedRow(target, 'ad', task.name, href);
    if (!verified) throw new Error('无法确认选中广告名称已更新，已停止打开编辑页面。');
    await openAdEditor(task, href, 'OPEN_AD');
  }

  async function runVerifyAd(task) {
    if (!task.editHref) throw new Error('任务缺少广告标识，无法安全验证。');
    // After a reload Vue must fetch the rows again. Never click rename here.
    await waitFor(() => {
      const matches = adCopiesForHref(task.editHref);
      return matches.length ? matches : null;
    }, '刷新后原广告记录', 25000);
    const match = await waitFor(() => adCopiesForHref(task.editHref).find(item => item.name === task.name) || null,
      '刷新后原广告名称更新', 12000).catch(err => {
      if (/^等待刷新后原广告名称更新超时$/.test(err.message)) {
        const names = adCopiesForHref(task.editHref).map(item => item.name).filter(Boolean);
        throw new Error(`广告重命名弹窗已关闭，但刷新后该广告名称仍未变为目标名称（目前：${[...new Set(names)].join(' / ') || '未读取到'}）。可能是网站未保存成功；已停止，避免重复修改。`);
      }
      throw err;
    });
    if (!match) throw new Error('没有找到匹配的目标广告。');
    await isTaskRunning(task.id);
    await openAdEditor(task, task.editHref, 'VERIFY_AD');
  }

  async function confirmEditorCreativeType(task, detection) {
    // This is a fail-safe, not an automatic guess. No upload is claimed or
    // started until the operator explicitly confirms the selected Vivo tab.
    return new Promise((resolve, reject) => {
      ui.pickReject = reject;
      modal('需要确认编辑页的创意类型', (body, foot, close) => {
        textDiv(body, '网页已经打开，但无法确认「创意类型」中哪个选项被高亮。请对照编辑页顶部的实际选中项，并选择下面对应的一项。不要依据文件格式猜测。', 'muted');
        textDiv(body, `待上传：${task.mediaKind === 'image' ? '图片' : '视频'}。当前页面识别：${detection?.creativeType || '未确认'}；${detection?.evidence || '尚未得到可靠结果'}。${detection?.legacyHint ? `初始提示：${detection.legacyHint}（不作为最终依据）。` : ''}`, 'small');
        const choices = document.createElement('div'); choices.className = 'choices';
        const choiceList = task.mediaKind === 'image'
          ? ['横版大图', '竖版大图', '小图', '组图', '无图', '横版视频', '竖版视频']
          : ['横版视频', '竖版视频', '横版大图', '竖版大图', '小图', '组图', '无图'];
        let chosen = '';
        const warning = textDiv(body, '请点击与页面当前高亮项一致的选项。', 'small');
        const confirm = button(foot, '核对一致，继续上传', () => {
          if (!chosen) return;
          const kind = LoveWorkflowCreativeDetect.mediaKind(chosen);
          if (kind !== task.mediaKind) {
            warning.textContent = '所选的实际创意类型与提前准备的素材不匹配，请停止任务并更换素材。';
            return;
          }
          ui.pickReject = null;
          clearModal();
          resolve({ ...detection, creativeType: chosen, mediaKind: kind, source: '人工确认' });
        }, 'primary');
        confirm.disabled = true;
        for (const type of choiceList) {
          button(choices, type, () => {
            chosen = type;
            const kind = LoveWorkflowCreativeDetect.mediaKind(type);
            confirm.disabled = kind !== task.mediaKind;
            warning.textContent = kind !== task.mediaKind
              ? '该选项和待上传素材类型不同，不能继续上传。'
              : `已选择「${type}」，请确认它就是 vivo 网页当前高亮的选项。`;
          }, 'item');
        }
        body.appendChild(choices);
        button(foot, '停止任务', close.click.bind(close), 'warn');
      });
    });
  }

  function watchLegacyUploadResult() {
    // The legacy upload function catches its own exceptions and returns void.
    // Its own result toast is therefore the source of truth: never report
    // success solely because the Promise returned without throwing.
    const container = document.getElementById('love-toast-container');
    if (!container) throw new Error('找不到原有一键上传的状态提示组件，请刷新编辑页重试。');
    let outcome = null;
    const scan = () => {
      for (const el of container.querySelectorAll('.love-toast-slide')) {
        const text = clean(el.textContent);
        if (text.includes('一键任务失败')) outcome = { success: false, message: text };
        else if (text.includes('已停止')) outcome = { success: false, message: text };
        else if (text.includes('完成了') && !outcome) outcome = { success: true, message: text };
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return {
      result: () => { scan(); return outcome; },
      close: () => observer.disconnect()
    };
  }

  async function recoverFilePermission(task) {
    const saved = await LoveWorkflowMediaStore.record(task.id);
    if (!saved) throw new Error('文件访问句柄已过期，请重新在广告计划页面选择素材');
    return new Promise((resolve, reject) => {
      modal('重新授权读取素材', (body, foot, close) => {
        textDiv(body, 'Chrome 已失去对之前选取的本地图片/视频的读取权限。请点击下方按钮重新授权；不会保存文件内容，也不会修改本地文件。', 'wf-choice-tip');
        const errText = textDiv(body, '', 'field-error');
        button(foot, '停止本次任务', () => {
          clearModal();
          reject(new Error('用户拒绝重新授权素材，任务已停止'));
        }, 'warn');
        const authorize = button(foot, '重新授权文件', async () => {
          authorize.disabled = true;
          errText.textContent = '';
          try {
            // Initiated directly by user click; requestAccess does not await
            // unrelated operations before requesting permissions.
            await LoveWorkflowMediaStore.requestAccess(saved.handles);
            clearModal();
            resolve(true);
          } catch (err) {
            errText.textContent = err?.message || String(err);
            authorize.disabled = false;
          }
        }, 'primary');
        close.onclick = () => {
          clearModal();
          reject(new Error('已取消文件访问授权，任务停止'));
        };
      });
    });
  }

  async function runEditorUpload(task) {
    if (stage() !== 'editor' || !task.editHref ||
        new URL(task.editHref).pathname.replace(/\/$/, '') !== location.pathname.replace(/\/$/, '')) {
      throw new Error('当前不是指定广告的编辑页面，已阻止上传。');
    }
    if (!task.autoUpload) throw new Error('此任务没有选择自动上传素材或文案。');
    await waitFor(() => {
      if (typeof startCombinedCreativeAutomation !== 'function' ||
          typeof detectCurrentAdCreativeContext !== 'function') return null;
      const pageText = document.body?.innerText || '';
      // Wait for the actual Vivo editor, not merely the URL or an empty page.
      return pageText.includes('创意类型') &&
        (pageText.includes('上传创意') || pageText.includes('创意1') || pageText.includes('创意 1'));
    }, '广告编辑页面的创意区域', 45000);

    let files = [];
    if (task.fileCount) {
      try {
        files = await LoveWorkflowMediaStore.get(task.id);
      } catch (err) {
        if (err?.code !== 'LOVE_HANDLE_PERMISSION') throw err;
        await recoverFilePermission(task);
        files = await LoveWorkflowMediaStore.get(task.id);
      }
    }
    if (task.fileCount && (!files || files.length !== task.fileCount)) {
      throw new Error('跨页面文件句柄恢复失败：句柄可能过期、被清理或来源不匹配；没有复制文件内容，也没有执行上传。');
    }
    const detected = files.length ? selectedMediaKind(files) : '';
    if (files.length && detected !== task.mediaKind) {
      throw new Error('跨页面素材类型与原选择不一致，已停止。');
    }
    // V1.3.2: The old detector can report "无图" BEFORE the radio/tabs finish
    // rendering. "none" is a non-empty mediaKind, so waiting only for
    // !context.mediaKind used to stop immediately on this temporary state.
    // A real selected option must be observed several times before any upload.
    let context = typeof LoveWorkflowCreativeDetect !== 'undefined'
      ? LoveWorkflowCreativeDetect.detect() : { mediaKind: '', creativeType: '', evidence: '识别模块未加载' };
    if (files.length) {
      const started = Date.now();
      const deadline = started + 20000;
      let matchingType = '';
      let stableMatches = 0;
      let firstMatchingAt = 0;
      let verified = null;
      while (Date.now() < deadline) {
        await isTaskRunning(task.id);
        context = typeof LoveWorkflowCreativeDetect !== 'undefined'
          ? LoveWorkflowCreativeDetect.detect() : { mediaKind: '', creativeType: '', evidence: '识别模块未加载' };
        // Only a real, independently verified UI selection can authorize
        // unattended uploading. The historical detector is never proof.
        if (context.reliable && context.mediaKind === task.mediaKind && context.creativeType) {
          if (context.creativeType !== matchingType) {
            matchingType = context.creativeType;
            stableMatches = 0;
            firstMatchingAt = Date.now();
          }
          stableMatches += 1;
          if (stableMatches >= 4 && Date.now() - firstMatchingAt >= 900 &&
              Date.now() - started >= 1600) {
            verified = context;
            break;
          }
        } else {
          matchingType = '';
          stableMatches = 0;
          firstMatchingAt = 0;
        }
        await pause(320);
      }
      if (verified) {
        context = verified;
      } else {
        // On persistent "无图" / mismatched / unreadable states, do NOT fail
        // immediately and do NOT assume the image/video selection from file
        // extensions. The user may verify the actual highlighted option.
        context = await confirmEditorCreativeType(task, context);
      }
      if (context.mediaKind !== task.mediaKind || !context.creativeType) {
        throw new Error('未确认编辑页创意类型与待上传素材一致，已停止。');
      }
    }
    if (typeof isLikelyBlankNewAdForCombined === 'function' && isLikelyBlankNewAdForCombined(context) &&
        (!files.length || !task.appName || !task.appSubtitle)) {
      throw new Error('当前是空白广告，原有上传功能要求同时提供素材、标题及副标题。');
    }

    // Claim before touching the editor: no automatic retry after reload.
    const claimed = await api('CLAIM_UPLOAD', { taskId: task.id });
    knownTask = claimed;
    renderProgress(claimed);
    const watcher = watchLegacyUploadResult();
    let result;
    try {
      const options = {
        files: files || [],
        appName: task.appName || '',
        appSubtitle: task.appSubtitle || '',
        hasMedia: !!files?.length,
        hasText: !!(task.appName || task.appSubtitle),
        targetCount: files?.length || Math.max(1, getCombinedCreativeIndices().length || 1),
        mediaKind: task.mediaKind || context.mediaKind,
        displayType: context.displayType,
        creativeType: context.creativeType
      };
      await startCombinedCreativeAutomation(options);
      result = watcher.result();
    } finally {
      watcher.close();
    }
    const latest = await api('GET');
    if (!latest || latest.id !== task.id || latest.status !== 'running') {
      await LoveWorkflowMediaStore.remove(task.id).catch(() => {});
      return; // stopped via button or another tab, do not revive it
    }
    if (result?.success) {
      knownTask = await api('FINISH_UPLOAD', { taskId: task.id, success: true });
    } else {
      knownTask = await api('FINISH_UPLOAD', {
        taskId: task.id,
        success: false,
        error: result?.message || '原有上传函数已返回，但未检测到「完成了」提示；请检查编辑页实际结果，避免重复上传。'
      });
    }
    renderProgress(knownTask);
    await LoveWorkflowMediaStore.remove(task.id).catch(() => {});
  }

  async function fail(error) {
    const msg = `[${{ plan: '广告计划', group: '广告组', ad: '广告', editor: '广告编辑' }[stage()] || '未知页面'}] ${error?.message || String(error)}`;
    if (knownTask?.status === 'running') {
      try { knownTask = await api('FAIL', { taskId: knownTask.id, error: msg }); }
      catch (e) { console.error('[LoveWorkflow] Failed to report error:', e); }
    }
    if (ui.pickReject) { const reject = ui.pickReject; ui.pickReject = null; reject(new Error('任务已停止')); }
    clearModal();
    await LoveWorkflowMediaStore.remove(knownTask?.id).catch(() => {});
    renderProgress(knownTask || { name: '', status: 'failed', error: msg });
    console.warn('[LoveWorkflow]', msg);
  }

  async function poll() {
    if (inFlight || ui.pickReject || awaitingNavigationReload) return;
    try {
      const task = await api('GET');
      if (!task || inFlight) return;
      if (!knownTask || task.id !== knownTask.id || task.status !== knownTask.status || task.step !== knownTask.step) renderProgress(task);
      else knownTask = task;
      if (task.status !== 'running') return;
      const currentStage = stage();
      if (currentStage !== STAGE_FROM_STEP[task.step]) return;
      // A claimed upload is never automatically repeated on refresh. A new
      // content-script instance means the previous upload was interrupted.
      if (task.step === 'UPLOADING' && !uploadInFlight) {
        inFlight = true;
        try { await fail(new Error('自动上传过程中页面被刷新或中断。为防止重复上传，已停止；请检查编辑页的实际内容。')); }
        finally { inFlight = false; }
        return;
      }
      if (task.step === 'UPLOAD_READY') {
        inFlight = true;
        uploadInFlight = true;
        try { await runEditorUpload(task); }
        catch (err) { await fail(err); }
        finally { uploadInFlight = false; inFlight = false; }
        return;
      }
      // OPEN_EDITOR is handled in runAd synchronously after the advance.
      if (task.step === 'OPEN_EDITOR') {
        inFlight = true;
        try {
          if (!task.editHref) throw new Error('缺少目标广告标识，拒绝按名称随意打开其他广告。');
          const item = await waitFor(() => adCopiesForHref(task.editHref).find(i => i.name === task.name) || null,
            '指定广告编辑入口和名称', 15000);
          const finished = await api('OPEN_EDITOR', { taskId: task.id, href: task.editHref });
          renderProgress(finished);
        } catch (e) { await fail(e); }
        finally { inFlight = false; }
        return;
      }
      inFlight = true;
      try {
        if (task.step === 'OPEN_GROUP') await runGroup(task);
        if (task.step === 'OPEN_AD') await runAd(task);
        if (task.step === 'VERIFY_AD') await runVerifyAd(task);
      } catch (err) { await fail(err); }
      finally { inFlight = false; }
    } catch (err) {
      console.warn('[LoveWorkflow] 获取状态失败:', err);
    }
  }

  document.addEventListener('contextmenu', onContextMenu, true);
  // SPA route changes don't necessarily reload content scripts. Polling is deliberately
  // lightweight and waits on DOM changes only while a workflow is active.
  setInterval(poll, 850);
  if (stage() === 'plan') {
    LoveWorkflowMediaStore.cleanupExpired().catch(() => {});
    LoveWorkflowMediaStore.deleteOldBlobDatabase();
  }
  poll();
})();
