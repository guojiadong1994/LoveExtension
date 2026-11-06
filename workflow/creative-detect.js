/*
 * LoveExtension workflow creative format detector (V1.3.2)
 *
 * The original uploader's detectCurrentAdCreativeContext() may temporarily
 * return "无图" before Vivo finishes rendering the selected format. It is
 * advisory only. Upload decisions MUST use an explicitly selected option.
 * This module does not modify content.js.
 */
(() => {
  'use strict';
  if (globalThis.LoveWorkflowCreativeDetect) return;

  const OPTIONS = ['竖版大图', '横版大图', '竖版视频', '横版视频', '小图', '组图', '无图'];
  const KIND = Object.freeze({
    '竖版大图': 'image', '横版大图': 'image',
    '竖版视频': 'video', '横版视频': 'video',
    '小图': 'image', '组图': 'image', '无图': 'none'
  });
  function isSelectionBlue(value) {
    const match = String(value || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!match) return /^#415fff$/i.test(String(value || '').trim());
    const [red, green, blue] = match.slice(1).map(Number);
    // Vivo can deploy several shades of primary blue; computed CSS is rgb().
    return red <= 130 && green >= 45 && green <= 170 && blue >= 175 &&
      blue > red + 70 && blue > green + 55;
  }
  const OPTION_SELECTOR = [
    '.ep-radio-button', '.el-radio-button', '.ep-radio-button__inner',
    '.el-radio-button__inner', '.ep-tabs__item', '.el-tabs__item',
    '[role="tab"]', '[role="radio"]', 'button', 'label', 'li', 'span', 'div'
  ].join(',');

  const trimText = text => String(text || '').replace(/[\s\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[（(]\d+[）)]/g, '');
  function optionType(text) {
    const normalized = trimText(text);
    return OPTIONS.includes(normalized) ? normalized : '';
  }
  function visible(el) {
    if (!el || !el.isConnected || !el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  function classText(el) {
    return typeof el?.className === 'string' ? el.className : '';
  }
  function isSemanticSelected(node) {
    if (!node) return false;
    const cls = classText(node);
    if (/(?:^|[\s_-])(?:is-active|is-checked|is-selected|active|checked|selected)(?:$|[\s_-])/i.test(cls)) return true;
    if (['aria-selected', 'aria-checked', 'aria-pressed'].some(key => node.getAttribute(key) === 'true')) return true;
    if (node.matches?.('input[type="radio"]:checked, input[type="checkbox"]:checked')) return true;
    // Some radio inputs are visually hidden while their enclosing label is visible.
    if (node.querySelector?.('input[type="radio"]:checked, input[type="checkbox"]:checked')) return true;
    return false;
  }
  function selectedBySemantics(root) {
    if (isSemanticSelected(root)) return true;
    for (const el of root.querySelectorAll('*')) {
      if (isSemanticSelected(el)) return true;
    }
    return false;
  }
  function hasSelectedBorder(node) {
    const css = getComputedStyle(node);
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const border = sides.some(side => {
      const width = Number.parseFloat(css[`border${side}Width`] || '0');
      return width > 0 && css[`border${side}Style`] !== 'none' && isSelectionBlue(css[`border${side}Color`] || '');
    });
    const outlined = Number.parseFloat(css.outlineWidth || '0') > 0 &&
      css.outlineStyle !== 'none' && isSelectionBlue(css.outlineColor || '');
    const shaded = isSelectionBlue(css.backgroundColor || '');
    return border || outlined || shaded;
  }
  function selectedByAppearance(root) {
    // Blue text alone is not proof of selection: the site uses blue for links,
    // hover states, and other controls. Require a colored border/background.
    if (hasSelectedBorder(root)) return true;
    for (const el of root.querySelectorAll('*')) {
      if (visible(el) && hasSelectedBorder(el)) return true;
    }
    return false;
  }
  function optionRoot(element, type) {
    let root = element;
    // Climb to the largest element that ONLY contains this one format. Its
    // parent should then be the selector group containing the other formats.
    while (root.parentElement && root.parentElement !== document.body &&
      optionType(root.parentElement.textContent) === type) root = root.parentElement;
    return root;
  }
  function selectedOption() {
    const roots = new Set();
    for (const element of document.querySelectorAll(OPTION_SELECTOR)) {
      if (!visible(element)) continue;
      const type = optionType(element.textContent);
      if (!type) continue;
      roots.add(optionRoot(element, type));
    }

    const groups = new Map();
    for (const root of roots) {
      if (!visible(root) || !root.parentElement) continue;
      const parent = root.parentElement;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push({ root, type: optionType(root.textContent) });
    }

    const semantics = new Set();
    const appearances = new Set();
    let optionsSeen = 0;
    for (const group of groups.values()) {
      // An isolated text "无图" in the page is NOT a creative type selection.
      // Only groups with multiple distinct sibling options are meaningful.
      if (new Set(group.map(item => item.type)).size < 2) continue;
      optionsSeen += group.length;
      for (const {root, type} of group) {
        if (selectedBySemantics(root)) semantics.add(type);
        else if (selectedByAppearance(root)) appearances.add(type);
      }
    }
    if (semantics.size === 1) return { type: [...semantics][0], source: '选中状态', optionNodes: optionsSeen, reliable: true };
    if (semantics.size > 1) return { type: '', source: '存在多个被标记选中的创意类型', optionNodes: optionsSeen, reliable: false };
    if (appearances.size === 1) return { type: [...appearances][0], source: '选中边框', optionNodes: optionsSeen, reliable: true };
    return { type: '', source: appearances.size ? '多个选项具有选中样式' : '尚未找到可验证的选中状态', optionNodes: optionsSeen, reliable: false };
  }
  function detect() {
    let legacy = {};
    try {
      if (typeof detectCurrentAdCreativeContext === 'function') legacy = detectCurrentAdCreativeContext() || {};
    } catch (_) { /* page is still loading */ }
    const selection = selectedOption();
    // IMPORTANT: legacy's "无图" is often a rendering-time default. It must
    // never immediately block upload, nor should ANY legacy guess authorize it.
    return {
      displayType: legacy.displayType || '',
      creativeType: selection.reliable ? selection.type : '',
      mediaKind: selection.reliable ? KIND[selection.type] || '' : '',
      source: selection.reliable ? selection.source : '',
      evidence: selection.source,
      optionNodes: selection.optionNodes,
      reliable: selection.reliable,
      legacyHint: optionType(legacy.creativeType)
    };
  }
  globalThis.LoveWorkflowCreativeDetect = Object.freeze({
    detect, mediaKind: type => KIND[type] || '', options: OPTIONS
  });
})();
