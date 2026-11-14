/*
 * LoveExtension V1.3.24 – narrowly scoped Chrome debugger input for vivo's
 * optimization-goal dropdown.  No DOM-based fake pointer events, no network
 * requests, no arbitrary coordinates supplied by the content script.
 *
 * The worker validates the active batch task and work-tab identity before
 * calling this helper. This helper independently checks the URL and locates
 * both targets by live page DOM, then detaches in a finally block.
 */
'use strict';
(() => {
  const busy = new Set();
  const TARGET_ORIGIN = 'https://ad.vivo.com.cn';
  const PROTOCOL = '1.3';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function requireWorkPage(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) throw Error('无法确认广告创建标签页地址');
    const url = new URL(tab.url);
    if (url.origin !== TARGET_ORIGIN || !url.pathname.startsWith('/marketing/ads/add/'))
      throw Error('浏览器级点击仅允许在绑定的 vivo 新建广告页面使用');
  }

  async function evaluate(target, expression) {
    const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false
    });
    if (response?.exceptionDetails || response?.result?.subtype === 'error')
      throw Error('读取优化目标控件时页面脚本执行失败');
    return response?.result?.value;
  }

  // The exact input identified by the user's trusted mouse event diagnostics.
  const inputPosition = `(() => {
    const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
    const item = [...document.querySelectorAll('.ep-form-item,.el-form-item')]
      .find(f => [...f.querySelectorAll('.ep-form-item__label,.el-form-item__label')]
        .some(label => clean(label.textContent) === '优化目标'));
    if (!item) return {error:'未找到优化目标表单字段'};
    const input = item.querySelector('input.ep-input__inner,input.el-input__inner');
    if (!input) return {error:'优化目标字段内没有输入框'};
    input.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const r = input.getBoundingClientRect(), s = getComputedStyle(input);
    if (r.width < 5 || r.height < 5 || s.display === 'none' || s.visibility === 'hidden')
      return {error:'优化目标输入框不可见'};
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    if (x <= 0 || y <= 0 || x >= innerWidth || y >= innerHeight)
      return {error:'优化目标输入框不在当前视口'};
    const hit = document.elementFromPoint(x,y);
    if (hit !== input && !input.contains(hit))
      return {error:'优化目标输入框被其他页面元素遮挡'};
    return {x,y};
  })()`;

  function optionsExpression(desired, getPosition) {
    // The selected text is escaped as a JS string literal, never interpolated
    // into an unquoted selector or an HTML expression.
    return `(() => {
      const desired = ${JSON.stringify(desired)};
      const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
      const visible = el => {
        if (!el || !el.isConnected || !el.getClientRects().length) return false;
        for (let p=el; p && p.nodeType===1; p=p.parentElement) {
          const s=getComputedStyle(p);
          if (s.display==='none' || s.visibility==='hidden' || Number(s.opacity)===0) return false;
          if (p.hasAttribute('inert') || p.getAttribute('aria-hidden')==='true') return false;
        }
        return true;
      };
      const options = [...document.querySelectorAll(
        '.ads-app__cvtype-select li.ep-select-dropdown__item, .ads-app__cvtype-select li.el-select-dropdown__item'
      )].filter(el => visible(el) && !el.matches('.is-disabled,[aria-disabled="true"]'));
      const name = el => clean(el.querySelector('.cvtype-info,.ep-select-dropdown__item__label,.el-select-dropdown__item__label')?.textContent || el.textContent);
      const names = [...new Set(options.map(name))];
      const matches = options.filter(el => name(el) === desired);
      if (!${getPosition ? 'true' : 'false'}) return {count:options.length,names,matchCount:matches.length};
      if (matches.length !== 1) return {error:matches.length ? '优化目标存在多个可见的同名选项' : '下拉菜单没有目标选项',names,matchCount:matches.length};
      const option = matches[0];
      option.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
      const r = option.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) return {error:'优化目标选项没有有效点击区域'};
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      if (x <= 0 || y <= 0 || x >= innerWidth || y >= innerHeight) return {error:'目标选项不在当前视口'};
      const hit = document.elementFromPoint(x,y);
      if (!hit || (hit !== option && !option.contains(hit)))
        return {error:'目标选项被其他元素遮挡'};
      return {x,y,names,matchCount:matches.length};
    })()`;
  }

  const selectionExpression = desired => `(() => {
    const desired=${JSON.stringify(desired)};
    const clean=s=>String(s||'').replace(/\\s+/g,' ').trim();
    const item=[...document.querySelectorAll('.ep-form-item,.el-form-item')]
      .find(f=>[...f.querySelectorAll('.ep-form-item__label,.el-form-item__label')]
        .some(label=>clean(label.textContent)==='优化目标'));
    if(!item)return false;
    return [...item.querySelectorAll('input.ep-input__inner,input.el-input__inner,.ep-select__selected-item,.el-select__selected-item')]
      .some(el=>[el.value,el.title,el.textContent].some(v=>clean(v)===desired));
  })()`;

  async function waitFor(target, expression, predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last;
    do {
      last = await evaluate(target, expression);
      if (predicate(last)) return last;
      await sleep(140);
    } while (Date.now() < deadline);
    return last;
  }

  async function click(target, x, y) {
    const at = { x, y, modifiers: 0 };
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      ...at, type: 'mouseMoved', button: 'none', buttons: 0
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      ...at, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      ...at, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1
    });
  }

  async function select(tabId, goal) {
    if (!Number.isInteger(tabId) || typeof goal !== 'string' || !goal.trim() || goal.length > 100)
      throw Error('浏览器级点击参数无效');
    if (busy.has(tabId)) throw Error('优化目标操作正在进行，不允许并发点击');
    busy.add(tabId);
    const target = {tabId};
    let attached = false;
    try {
      await requireWorkPage(tabId);
      try {
        await chrome.debugger.attach(target, PROTOCOL);
        attached = true;
      } catch (error) {
        throw Error('无法连接 Chrome 浏览器级点击：请关闭该页面的 F12 开发者工具，并确认已授予扩展 debugger 权限。原错误：' + (error?.message || error));
      }
      // A previously selected goal needs no additional mouse action.
      if (await evaluate(target, selectionExpression(goal)) === true)
        return {selected:goal, mode:'chrome-debugger-already-selected'};
      // First see whether the menu is already open (never toggle it closed).
      let rows = await evaluate(target, optionsExpression(goal, false));
      if (!rows?.count) {
        let pos = await evaluate(target, inputPosition);
        if (pos?.error) throw Error(pos.error);
        // Allow scrollIntoView/layout to settle before clicking at CSS pixels.
        await sleep(140);
        pos = await evaluate(target, inputPosition);
        if (pos?.error || !Number.isFinite(pos?.x) || !Number.isFinite(pos?.y))
          throw Error(pos?.error || '无法定位优化目标输入框');
        await requireWorkPage(tabId);
        await click(target, pos.x, pos.y);
        rows = await waitFor(target, optionsExpression(goal, false), v => v?.count > 0, 5500);
      }
      if (!rows?.count)
        throw Error('Chrome 浏览器级点击后仍未出现优化目标选项；请保留页面以便诊断（当前候选：无）');
      let opt = await evaluate(target, optionsExpression(goal, true));
      if (opt?.error) throw Error(`${opt.error}（可见选项：${(opt.names || []).join('、') || '无'}）`);
      if (!Number.isFinite(opt?.x) || !Number.isFinite(opt?.y)) throw Error('无法定位优化目标选项坐标');
      await sleep(100);
      // Re-read after scrolling; never click a position from a stale layout.
      opt = await evaluate(target, optionsExpression(goal, true));
      if (opt?.error) throw Error(opt.error);
      await requireWorkPage(tabId);
      await click(target, opt.x, opt.y);
      const selected = await waitFor(target, selectionExpression(goal), v => v === true, 4500);
      if (selected !== true)
        throw Error(`已点击「${goal}」，但未检测到优化目标选中回显，已停止后续操作`);
      return {selected:goal, mode:'chrome-debugger'};
    } catch (error) {
      throw Error(`浏览器级优化目标选择失败：${error?.message || error}`);
    } finally {
      if (attached) {
        try { await chrome.debugger.detach(target); }
        catch (error) { console.warn('[LoveBatch] Chrome debugger detach:', error); }
      }
      busy.delete(tabId);
    }
  }
  globalThis.LoveBatchNativeGoal = Object.freeze({select});
})();
