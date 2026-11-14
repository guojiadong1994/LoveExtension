/* V1.3.28 - CDP cascader with asynchronous field readiness and hit-test diagnostics.
 * Grounded by actual vivo markup: mkt-cascader-panel > ep-cascader-panel >
 * two ep-cascader-menu columns > li.ep-cascader-node > .options-item > span.
 * Limit interactions to the current task tab; require a selected-value echo.
 */
'use strict';
(() => {
 const busy=new Set(),ORIGIN='https://ad.vivo.com.cn',PROTOCOL='1.3';
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function checkTab(tabId){
  const tab=await chrome.tabs.get(tabId),url=new URL(tab?.url||'about:blank');
  if(url.origin!==ORIGIN||!url.pathname.startsWith('/marketing/ads/add/'))
   throw Error('行业/产品浏览器级点击仅允许当前 vivo 创建广告页面');
 }
 async function evaluate(target,expr){
  const r=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:false});
  if(r?.exceptionDetails||r?.result?.subtype==='error')
   throw Error('读取行业/产品页面控件失败'+(r?.exceptionDetails?.text?'：'+r.exceptionDetails.text:''));
  return r?.result?.value;
 }
 // A menu's options must NOT be mistaken for the form's selected value.
 const selectedExpression=(industry,product)=>`(() => {
  const industry=${JSON.stringify(industry)},product=${JSON.stringify(product)};
  const clean=s=>String(s||'').replace(/\\s+/g,' ').trim();
  const f=[...document.querySelectorAll('.ep-form-item,.el-form-item')]
   .find(el=>[...el.querySelectorAll('.ep-form-item__label,.el-form-item__label')]
    .some(label=>clean(label.textContent)==='行业/产品'));
  if(!f)return {selected:false,reason:'未找到行业/产品字段'};
  const content=f.querySelector('.ep-form-item__content,.el-form-item__content')||f;
  // Do not mistake text in an open floating cascader for a committed selection.
  const popupSelector='.ep-popper,.el-popper,.ep-cascader-panel,.el-cascader-panel,.mkt-cascader-panel,.ep-cascader-menu,.el-cascader-menu,[role=menu],[role=listbox]';
  const clone=content.cloneNode(true);
  clone.querySelectorAll(popupSelector).forEach(el=>el.remove());
  const fieldText=clean(clone.textContent);
  const values=[...content.querySelectorAll('input,textarea,[title],.ep-tag,.el-tag,[class*=selected],[class*=value]')]
   .filter(el=>!el.closest(popupSelector))
   .flatMap(el=>[clean(el.value),clean(el.getAttribute('title')),clean(el.getAttribute('aria-label')),clean(el.textContent)])
   .filter(Boolean);
  const observed=[fieldText,...values];
  const selected=observed.some(value=>value.includes(industry)&&value.includes(product)) ||
   (observed.some(value=>value===industry)&&observed.some(value=>value===product));
  const popupOpen=[...document.querySelectorAll('.mkt-cascader-panel .ep-cascader-panel')]
   .some(el=>{const r=el.getBoundingClientRect(),st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'});
  return {selected,fieldText:fieldText.slice(0,160),controlValues:[...new Set(values)].slice(0,6).map(s=>s.slice(0,120)),popupOpen};
 })()`;
 // A visibility test based on actual rendering and clickability. Some vivo
 // poppers set aria-hidden on an ancestor while still being hit-testable;
 // aria-hidden alone must not cause an otherwise visible row to disappear.
 const menuExpression=(industry,product,level,position)=>`(() => {
  const industry=${JSON.stringify(industry)},product=${JSON.stringify(product)},level=${JSON.stringify(level)},position=${Boolean(position)};
  const clean=s=>String(s||'').replace(/\\s+/g,' ').trim();
  const rendered=el=>{
   if(!el||!el.isConnected||!el.getClientRects().length)return false;
   const r=el.getBoundingClientRect();if(r.width<2||r.height<2)return false;
   for(let p=el;p&&p.nodeType===1;p=p.parentElement){
    const s=getComputedStyle(p);
    if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.hasAttribute('inert'))return false;
   }
   return true;
  };
  const f=[...document.querySelectorAll('.ep-form-item,.el-form-item')].find(el=>
   [...el.querySelectorAll('.ep-form-item__label,.el-form-item__label')]
    .some(label=>clean(label.textContent)==='行业/产品'));
  if(!f)return {error:'行业/产品字段不存在'};
  // Distinguish the industry-product two-column popup from other vivo menus.
  const panels=[...document.querySelectorAll('.mkt-cascader-panel .ep-cascader-panel, .mkt-cascader-panel .el-cascader-panel, .ep-cascader-panel, .el-cascader-panel')];
  const unique=[...new Set(panels)].filter(rendered);
  const candidates=[];
  for(const panel of unique){
   const menus=[...panel.querySelectorAll('.ep-cascader-menu,.el-cascader-menu')]
    .filter(menu=>rendered(menu));
   if(!menus.length)continue;
   const columns=menus.map(menu=>{
    const rows=[...menu.querySelectorAll('li.ep-cascader-node,li.el-cascader-node,[role="menuitem"],li')]
     .filter(el=>!el.closest('li li') && rendered(el));
    return rows.map(el=>{
     const label=el.querySelector('.options-item span,.options-item .mkt-ellipsis,.ep-cascader-node__label,.el-cascader-node__label,.options-item')||el;
     const text=clean(label.getAttribute('title')||label.textContent);
     return {el,label,text,disabled:el.matches('.is-disabled,[aria-disabled="true"]'),rect:el.getBoundingClientRect()};
    });
   });
   const all=columns.flat();
   // A live panel must have at least one row whose hit target belongs to the
   // row; this ignores offscreen/stale poppers without rejecting aria-hidden.
   const hitTest=row=>{
    // vivo can bind its click handler to .options-item or its span rather
    // than to the containing <li>. Click the exact rendered label, not an
    // arbitrary x offset from the left edge of the list item.
    const rect=row.label.getBoundingClientRect();
    const r=rect.width>=2&&rect.height>=2?rect:row.rect;
    const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
    if(x<=0||y<=0||x>=innerWidth||y>=innerHeight)return null;
    const hit=document.elementFromPoint(x,y);
    return hit&&(hit===row.el||row.el.contains(hit))?{x,y}:null;
   };
   if(!all.some(row=>hitTest(row)))continue;
   candidates.push({panel,columns,hitTest});
  }
  if(!candidates.length)return {menuOpen:false,count:0,candidates:[],panelsFound:unique.length};
  const target=level==='industry'?industry:product;
  const matched=[];
  for(const item of candidates){
   const col=level==='industry'?item.columns[0]:item.columns[1];
   for(const row of col||[]){
    if(row.disabled||row.text!==target)continue;
    const point=item.hitTest(row);
    if(point)matched.push({row,point});
   }
  }
  const labels=[...new Set(candidates.flatMap(item=>
   (item.columns[level==='industry'?0:1]||[]).map(row=>row.text).filter(Boolean)))].slice(0,20);
  if(!position)return {menuOpen:true,count:matched.length,candidates:labels,panelsFound:candidates.length,
   leftCount:candidates.reduce((n,item)=>n+(item.columns[0]||[]).length,0),
   rightCount:candidates.reduce((n,item)=>n+(item.columns[1]||[]).length,0)};
  if(matched.length!==1)return {error:matched.length?'目标名称在多个菜单中重复':'未找到目标选项',count:matched.length,candidates:labels};
  const {row}=matched[0];row.label.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  const rect=row.label.getBoundingClientRect(),r=rect.width>=2&&rect.height>=2?rect:row.el.getBoundingClientRect();
  const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
  const hit=x>0&&y>0&&x<innerWidth&&y<innerHeight?document.elementFromPoint(x,y):null;
  if(!hit||(hit!==row.el&&!row.el.contains(hit)))return {error:'目标选项文字区域被其他元素遮挡'};
  return {x,y,name:target,hit:hit.tagName.toLowerCase()+'.'+String(hit.className||'').replace(/\\s+/g,'.')};
 })()`;
 // Gather several grounded clickable targets within THIS field only.
 // A live vivo cascader can be attached to a dropdown trigger rather than the
 // first input; try a small set, checking menu state after EACH trusted click.
 // DOM can reflow immediately after the preceding application selection. Before
 // dispatching a real mouse click, wait until the target is actually hit-testable.
 // Don't click blindly through loading masks, lingering popovers, or animations.
 const openCandidatesExpression=`(() => {
  const clean=s=>String(s||'').replace(/\\s+/g,' ').trim();
  const descriptor=el=>el?(el.tagName.toLowerCase()+'.'+String(el.className||'').replace(/\\s+/g,'.')).slice(0,115):'无';
  const matches=[...document.querySelectorAll('.ep-form-item,.el-form-item')].filter(el=>
   [...el.querySelectorAll('.ep-form-item__label,.el-form-item__label')]
    .some(label=>clean(label.textContent)==='行业/产品'));
  if(matches.length!==1)return {ready:false,reason:'字段数量不是1',fieldCount:matches.length,blockers:[]};
  const f=matches[0],content=f.querySelector('.ep-form-item__content,.el-form-item__content')||f;
  // The initial scroll can trigger asynchronous layout. Every caller must
  // evaluate again after the browser has had a chance to paint.
  content.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  const selectors=[
   '.ep-dropdown__trigger,.el-dropdown__trigger,.ep-tooltip__trigger,[aria-haspopup="menu"],[aria-haspopup="listbox"]',
   '.ep-cascader,.el-cascader,.mkt-cascader,.ep-dropdown,.el-dropdown',
   'input.ep-input__inner,input.el-input__inner,.ep-cascader__search-input,.el-cascader__search-input',
   '.ep-input__wrapper,.el-input__wrapper,.ep-select,.el-select',
   '.ep-form-item__content,.el-form-item__content'
  ];
  const candidates=[],keys=new Set(),blockers=[];
  let examined=0;
  const sample=(el,source)=>{
   if(!el||!el.isConnected)return;
   const r=el.getBoundingClientRect(),st=getComputedStyle(el);
   if(r.width<8||r.height<8||st.display==='none'||st.visibility==='hidden'||st.pointerEvents==='none')return;
   // Intersections prevent a point in a hidden/off-screen fragment.
   const l=Math.max(0,r.left),t=Math.max(0,r.top),rr=Math.min(innerWidth,r.right),bb=Math.min(innerHeight,r.bottom);
   if(rr-l<8||bb-t<8)return;
   const xPoints=[l+(rr-l)*0.18,l+(rr-l)*0.5,l+(rr-l)*0.82];
   const yPoints=[t+(bb-t)*0.5];
   for(const rawY of yPoints)for(const rawX of xPoints){
    const x=Math.round(rawX),y=Math.round(rawY);
    const key=x+':'+y;if(keys.has(key))continue;keys.add(key);examined++;
    const hit=document.elementFromPoint(x,y);
    if(!hit)continue;
    if(!f.contains(hit)){
     if(blockers.length<6)blockers.push({at:source,hit:descriptor(hit),overlay:descriptor(hit.closest('.ep-popper,.el-popper,.ep-loading-mask,.el-loading-mask,.el-overlay,[role="dialog"]'))});
     continue;
    }
    if(hit.closest('.ep-tag__close,.el-tag__close,[class*="__close"],button,[aria-label*="删除"]'))continue;
    if(candidates.length<14)candidates.push({x,y,element:source,hit:descriptor(hit)});
   }
  };
  for(const selector of selectors){
   for(const el of content.querySelectorAll(selector)){
    if(el.closest('.ep-popper,.el-popper,.mkt-cascader-panel'))continue;
    sample(el,descriptor(el));
   }
  }
  if(!candidates.length)sample(content,'表单内容区域');
  return {ready:candidates.length>0,candidates,fieldCount:1,examined,
   blockers,content:descriptor(content),fieldRect:({x:Math.round(content.getBoundingClientRect().x),y:Math.round(content.getBoundingClientRect().y),w:Math.round(content.getBoundingClientRect().width),h:Math.round(content.getBoundingClientRect().height)}),
   loading:!!document.querySelector('.ep-loading-mask,.el-loading-mask,[class*="loading-mask"]')};
 })()`;
 // Escape dismisses an unrelated, lingering dropdown after selecting the
 // application; it does not alter saved form values or submit an ad. Only use
 // it if the hit-test explicitly found an ordinary dropdown overlay.
 async function dismissStaleDropdown(target){
  await chrome.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await chrome.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
 }
 async function waitFor(target,expr,predicate,timeout=5500){
  const deadline=Date.now()+timeout;let v;
  do{v=await evaluate(target,expr);if(predicate(v))return v;await sleep(170);}while(Date.now()<deadline);
  return v;
 }
 async function click(target,x,y){
  await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0,modifiers:0});
  await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
  await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
 }
 async function select(tabId,industry,product){
  if(!Number.isInteger(tabId)||![industry,product].every(s=>typeof s==='string'&&s.trim()&&s.length<=200))throw Error('行业/产品两级参数无效');
  if(busy.has(tabId))throw Error('行业/产品点击正在执行中，不允许并发操作');
  busy.add(tabId);const target={tabId};let attached=false;
  try{
   await checkTab(tabId);
   try{await chrome.debugger.attach(target,PROTOCOL);attached=true;}
   catch(err){throw Error('Chrome 调试连接失败：请关闭该标签页 F12，并确认扩展拥有 debugger 权限。'+(err?.message||err));}
   if((await evaluate(target,selectedExpression(industry,product)))?.selected===true)
    return {selected:true,mode:'already-selected'};
   let left=await evaluate(target,menuExpression(industry,product,'industry',false));
   const clicked=[];
   if(!left?.menuOpen){
    // First poll for a stable, unobscured form field. The previous application
    // dropdown may still be closing or the form may be rerendering.
    let probe=await waitFor(target,openCandidatesExpression,v=>v?.ready,8500);
    if(!probe?.ready){
     const stale=probe?.blockers?.some(b=>/ep-popper|el-popper/.test(b.overlay||'')) &&
      !probe?.blockers?.some(b=>/dialog|loading-mask|overlay/.test(b.overlay||''));
     if(stale){
      // Verify the target cascader isn't already open before pressing Escape.
      left=await evaluate(target,menuExpression(industry,product,'industry',false));
      if(!left?.menuOpen){
       await dismissStaleDropdown(target);
       probe=await waitFor(target,openCandidatesExpression,v=>v?.ready,3500);
      }
     }
    }
    left=await evaluate(target,menuExpression(industry,product,'industry',false));
    if(!left?.menuOpen){
     if(!probe?.ready){
      const obstacles=(probe?.blockers||[]).map(b=>b.hit+(b.overlay&&b.overlay!=='无'?'（'+b.overlay+'）':'')).join('、');
      throw Error('行业/产品控件尚不可点击：'+(probe?.fieldRect?JSON.stringify(probe.fieldRect):'无控件尺寸')+
       '；遮挡：'+(obstacles||'未发现')+'；检查点数：'+(probe?.examined||0)+'；正在加载：'+(probe?.loading?'是':'否')+'。已等待页面稳定，未盲目点击');
     }
     // Read positions afresh each time: dropdown opening can shift the form.
     for(let index=0;index<Math.min(probe.candidates.length,10);index++){
      left=await evaluate(target,menuExpression(industry,product,'industry',false));
      if(left?.menuOpen)break;
      const current=await evaluate(target,openCandidatesExpression);
      if(!current?.ready) {
       probe=await waitFor(target,openCandidatesExpression,v=>v?.ready,2500);
       if(!probe?.ready)break;
      }else probe=current;
      const p=probe.candidates[index];if(!p)break;
      await checkTab(tabId);
      await click(target,p.x,p.y);
      clicked.push(p.element+' ['+p.x+','+p.y+']');
      left=await waitFor(target,menuExpression(industry,product,'industry',false),v=>v?.menuOpen||v?.error,1200);
      if(left?.menuOpen)break;
     }
    }
   }
   if(!left?.menuOpen)
    throw Error('「行业/产品」菜单没有展开（尝试坐标：'+(clicked.join(' → ')||'无')+'；识别到的级联面板：'+(left?.panelsFound||0)+'）');
   if(left.count!==1)
    throw Error('一级行业「'+industry+'」未唯一匹配（匹配'+(left.count||0)+'项；左列候选：'+(left.candidates||[]).join('、')+'）');
   let first=await evaluate(target,menuExpression(industry,product,'industry',true));
   if(first?.error)throw Error('一级行业定位失败：'+first.error);
   first=await evaluate(target,menuExpression(industry,product,'industry',true));
   if(first?.error)throw Error('一级行业二次定位失败：'+first.error);
   await checkTab(tabId);await click(target,first.x,first.y);
   let right=await waitFor(target,menuExpression(industry,product,'product',false),v=>v?.count>0||v?.error,6500);
   if(right?.count!==1)
    throw Error('二级产品「'+product+'」未唯一匹配（匹配'+(right?.count||0)+'项；右列候选：'+(right?.candidates||[]).join('、')+'）');
   let second=await evaluate(target,menuExpression(industry,product,'product',true));
   if(second?.error)throw Error('二级产品定位失败：'+second.error);
   second=await evaluate(target,menuExpression(industry,product,'product',true));
   if(second?.error)throw Error('二级产品二次定位失败：'+second.error);
   await checkTab(tabId);await click(target,second.x,second.y);
   const selected=await waitFor(target,selectedExpression(industry,product),v=>v?.selected===true,5500);
   if(!selected?.selected)throw Error('点击两级菜单后仍未确认选中（字段显示：'+(selected?.fieldText||'空')+'；控件值：'+(selected?.controlValues||[]).join('、')+'；菜单仍展开：'+(selected?.popupOpen?'是':'否')+'）。已停止保存广告');
   return {selected:true,industry,product,mode:'chrome-debugger-two-column'};
  }catch(err){throw Error('浏览器级行业/产品联动选择失败：'+(err?.message||err));}
  finally{
   if(attached){try{await chrome.debugger.detach(target);}catch(e){console.warn('[LoveBatch] Cascader debugger detach:',e);}}
   busy.delete(tabId);
  }
 }
 globalThis.LoveBatchNativeCascader=Object.freeze({select});
})();
