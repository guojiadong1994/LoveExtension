/*
 * LoveExtension - shared optional preview/cover uploader (V1.3.47).
 * Called by BOTH the plan-page workflow and the ad-page right-click uploader.
 * The ad-page uploader can also replace any creative's labeled preview field,
 * including preview-only actions, regardless of display/creative type.
 * Each target creative receives its OWN corresponding preview File. The
 * callers retrieve original files lazily from their handles. This module
 * NEVER stores File/Blob data or creates a file-content cache.
 */
(() => {
  'use strict';
  if (globalThis.LoveHorizontalPreview) return;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = node => !!node && node.isConnected && node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
  const isApplicable = context => !!context && context.reliable === true &&
    clean(context.creativeType) === '竖版视频' && clean(context.displayType).includes('激励互动');

  // Do not treat a transient/legacy "无图" as the actual active format.  Both
  // entrypoints wait for the reliably selected display/creative pair to settle.
  async function resolveContext({checkRunning = () => {}} = {}) {
    if (!globalThis.LoveWorkflowCreativeDetect?.detect) {
      throw new Error('创意类型识别模块未加载，请刷新广告编辑页后重试。');
    }
    let context;
    let signature = '';
    let stable = 0;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await checkRunning();
      context = globalThis.LoveWorkflowCreativeDetect.detect();
      const display = clean(context.displayType);
      const type = clean(context.creativeType);
      const pair = context.reliable && display && type ? `${display}|${type}` : '';
      if (pair && pair === signature) stable += 1;
      else { signature = pair; stable = pair ? 1 : 0; }
      if (stable >= 4) return { applicable: isApplicable(context), context };
      await sleep(300);
    }
    throw new Error('无法确认当前广告编辑页的展现形式与创意类型，预览图未上传；请检查页面加载状态。');
  }

  // Existing creative tabs can include a close icon (e.g. "创意2 ×").
  // This is only used by preview-only mode; legacy tab handling is untouched.
  function existingIndices() {
    const nodes = document.querySelectorAll('.ep-tabs__item, .el-tabs__item, [role="tab"]');
    const indices = new Set();
    for (const node of nodes) {
      if (!visible(node)) continue;
      const label = clean(node.innerText || node.textContent || '');
      const match = label.match(/^创意\s*(\d+)\s*(?:[×✕✖x])?$/i);
      if (match) {
        const n = Number(match[1]);
        if (n >= 1 && n <= 10) indices.add(n);
      }
    }
    return [...indices].sort((a,b) => a - b);
  }

  async function activateManual(index) {
    const tabs = [...document.querySelectorAll('.ep-tabs__item, .el-tabs__item, [role="tab"]')];
    const target = tabs.find(node => {
      if (!visible(node)) return false;
      const label = clean(node.innerText || node.textContent || '');
      const match = label.match(/^创意\s*(\d+)\s*(?:[×✕✖x])?$/i);
      return match && Number(match[1]) === index;
    });
    if (!target) return false;
    clickCombinedSafeNonSubmit(target, `切换创意${index}`);
    await sleep(220);
    return true;
  }

  // Exact upload field only: "头像" and "视频" must NEVER be deleted/replaced.
  function previewFieldFor(index) {
    const areas = identifyVideoUploadAreas(index, {silent:true});
    const input = areas?.previewInput;
    const field = input && getPreviewFieldContainer(input, index);
    if (!input || !field || !visible(field)) return null;
    const label = clean(field.querySelector('.ep-form-item__label, .el-form-item__label')?.textContent || '');
    if (!(label.includes('预览图') || label.includes('封面'))) return null;
    if (label.includes('头像') || label.includes('视频') || label.includes('Logo')) return null;
    return {input, field};
  }

  async function waitForPreviewField(index, label, checkRunning, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await checkRunning();
      const found = previewFieldFor(index);
      if (found) return found;
      await sleep(120);
    }
    throw new Error(`创意${index}${label}：找不到独立的「预览图」上传区域，已停止，未触碰头像或视频。`);
  }

  async function replace({files, indexes, activate, checkRunning = () => {}} = {}) {
    if (!Array.isArray(indexes) || !indexes.length || indexes.some(i => !Number.isInteger(i) || i < 1 || i > 10) ||
        new Set(indexes).size !== indexes.length || typeof activate !== 'function') {
      throw new Error('没有确认到需要更新预览图的创意，或创意列表重复。');
    }
    if (!Array.isArray(files) || files.length !== indexes.length || files.length > 10 ||
        files.some(f => !f || !/\.(jpe?g|png)$/i.test(f.name || ''))) {
      throw new Error(`预览图必须与目标创意一一对应：${indexes.length}个创意需要${indexes.length}张预览图（不允许复用同一张）。`);
    }
    const required = ['identifyVideoUploadAreas', 'getPreviewFieldContainer',
      'fieldHasExistingMedia', 'clearCombinedExistingMediaField',
      'strongUploadCombinedPreviewImage', 'makePreviewSnapshot',
      'waitForCombinedPreviewFilled'];
    for (const name of required) {
      if (typeof globalThis[name] !== 'function') {
        throw new Error(`原有上传组件缺少 ${name}，请刷新广告编辑页面重试。`);
      }
    }
    for (let position = 0; position < indexes.length; position++) {
      const index = indexes[position];
      const file = files[position];
      await checkRunning();
      const activated = await activate(index);
      if (activated === false) throw new Error(`无法切换到创意${index}，没有继续上传预览图。`);
      const area = await waitForPreviewField(index, '预览图定位失败', checkRunning);
      if (fieldHasExistingMedia(area.field)) {
        await checkRunning();
        const removed = await clearCombinedExistingMediaField(index, 'preview', area.input);
        if (!removed) throw new Error(`创意${index}旧预览图删除失败，停止后续上传；不会修改头像和视频。`);
      }
      const refreshed = await waitForPreviewField(index, '删除旧图后定位失败', checkRunning);
      const snapshot = makePreviewSnapshot(refreshed.field);
      await checkRunning();
      await strongUploadCombinedPreviewImage(refreshed.input, file);
      const done = await waitForCombinedPreviewFilled(refreshed.field, snapshot, 30000);
      if (!done) throw new Error(`创意${index}预览图未确认上传成功，请检查 vivo 平台返回的文件校验提示。`);
    }
  }

  globalThis.LoveHorizontalPreview = Object.freeze({isApplicable, resolveContext, existingIndices, activateManual, replace});
})();
