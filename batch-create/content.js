/* LoveExtension isolated batch-create module. Does not mutate legacy workflows. */
(() => {
'use strict';
if (globalThis.__loveBatchCreateV1) return;
globalThis.__loveBatchCreateV1=true;
const PLAN='/marketing/promotion/plan', CREATE='/marketing/ads/add/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const visible=el=>!!el&&el.isConnected&&el.getClientRects().length>0&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';
let host=null,shadow=null, running=false, lastRunKey='', lastCleanedId='', hiddenProgressKey='', stoppedTaskId='';
const COMPLETED_PROGRESS_HIDE_MS=1000;
let completedProgressTimer=null,completedProgressTimerKey='';
function cancelCompletedProgressHide(){
 if(completedProgressTimer!==null)clearTimeout(completedProgressTimer);
 completedProgressTimer=null;completedProgressTimerKey='';
}
function scheduleCompletedProgressHide(key){
 if(completedProgressTimerKey===key)return; // Polling must not restart the countdown.
 cancelCompletedProgressHide();
 completedProgressTimerKey=key;
 completedProgressTimer=setTimeout(()=>{
  completedProgressTimer=null;completedProgressTimerKey='';
  const el=document.getElementById('love-batch-progress');
  if(el?.__taskKey!==key)return; // Never hide a newer task or a changed status.
  hiddenProgressKey=key;el.remove();
 },COMPLETED_PROGRESS_HIDE_MS);
}
const usePlan=()=>location.pathname.replace(/\/$/,'')===PLAN;
const isCreate=()=>location.pathname.startsWith(CREATE);
function api(op,payload={}){
  return new Promise((resolve,reject)=>{
    let done=false; const rid=String(Date.now())+Math.random();const port=chrome.runtime.connect({name:'LOVE_BATCH_V1'});
    const timeout=setTimeout(()=>end(new Error('后台未响应，请检查扩展状态')),op==='SELECT_CATEGORY_CDP'?50000:15000);
    function end(err,data){if(done)return;done=true;clearTimeout(timeout);try{port.disconnect();}catch(_){};err?reject(err):resolve(data);}
    port.onMessage.addListener(res=>{if(res?.rid!==rid)return;end(res.ok?null:new Error(res.error||'批量任务失败'),res.data);});
    port.onDisconnect.addListener(()=>end(new Error('扩展后台连接中断，请刷新页面')));
    port.postMessage({rid,op,...payload});
  });
}
function node(tag,props={},text=''){const el=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='className')el.className=v;else if(k==='type'||k==='placeholder'||k==='title'||k==='aria-label')el.setAttribute(k,v);else el[k]=v;}if(text)el.textContent=text;return el;}
function modal(title){
  host?.remove();host=node('div');host.id='love-batch-host';document.documentElement.appendChild(host);shadow=host.attachShadow({mode:'open'});
  const style=node('style');style.textContent=`
  :host{all:initial}*{box-sizing:border-box} .shade{position:fixed;inset:0;z-index:2147483647;background:rgba(20,27,48,.42);display:flex;align-items:center;justify-content:center;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#25314d}
  .dialog{width:min(650px,96vw);max-height:94vh;display:flex;flex-direction:column;background:white;border-radius:14px;box-shadow:0 20px 70px #0003;overflow:hidden}header{display:flex;justify-content:space-between;align-items:center;padding:13px 20px;font-size:16px;font-weight:700;border-bottom:1px solid #eaedf3}main{padding:15px 20px;overflow:auto}footer{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid #edf0f5}footer>button{flex:0 0 auto;white-space:nowrap}.footer-error{flex:1 1 auto;min-width:0;max-height:76px;overflow-y:auto;overflow-wrap:anywhere;line-height:1.45;align-self:center}.footer-error:empty{display:none}
  section{padding:12px 0;border-bottom:1px solid #edf0f5}h3{font-size:14px;margin:0 0 10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 12px}.row{display:flex;align-items:center;gap:8px}.row>*{min-width:0}.field{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}label{font-size:12px;font-weight:600;color:#34405b}input,select,textarea{width:100%;min-height:34px;border:1px solid #d9dfec;background:white;color:#28344e;border-radius:7px;padding:7px 9px;font:inherit;font-size:13px;outline:none}input:focus,select:focus{border-color:#415fff}input[type=checkbox]{width:auto;min-height:0}button{border:1px solid #d9dfec;border-radius:7px;background:white;color:#3d4c6a;cursor:pointer;font-size:13px;padding:7px 12px}button.primary{background:#415fff;color:white;border-color:#415fff;font-weight:600}button:hover{filter:brightness(.97)}.hint{font-size:11px;color:#78859c}.warn{font-size:12px;color:#c93b42;white-space:pre-wrap}.name-row{display:flex;align-items:center;gap:7px;margin:6px 0}.name-row input{flex:1;min-width:0}.name-row select{width:128px;min-width:128px;flex:0 0 128px}.name-row button{flex:0 0 auto}.name-head{display:flex;align-items:center;gap:7px;color:#65718a;font-size:12px;margin:0 0 5px}.name-head .num-col,.name-row .num-col{flex:0 0 15px;text-align:center}.name-head .name-col{flex:1;min-width:0}.name-head .display-col{flex:0 0 128px}.name-head .action-col{flex:0 0 50px}@media(max-width:470px){.name-row{gap:4px}.name-row select{width:94px;min-width:94px;flex-basis:94px}.name-row button{padding:7px 5px}.name-head .display-col{flex-basis:94px}.name-head .action-col{flex-basis:40px}}.zone{border:1.5px dashed #b9c9e9;background:#f8faff;padding:13px;color:#415fff;width:100%;text-align:center}.summary{margin:8px 0 0;font-size:12px;color:#66758e;word-break:break-all}.progress{position:fixed;right:16px;bottom:16px;z-index:2147483600;width:320px;max-width:90vw;padding:12px;background:#fff;box-shadow:0 4px 24px #0003;border-radius:9px;font:12px/1.5 Arial,sans-serif;color:#26344d}.progress strong{font-size:13px}.progress button{float:right}.check{font-weight:400;display:flex;gap:7px;align-items:start}.check input{margin:3px 0 0} .catalog-trigger{margin-top:5px;color:#415fff;border-color:#b4c2ef;align-self:flex-start}.manage-shade{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(20,27,48,.52);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}.manage-dialog{width:min(680px,94vw);max-height:90vh;background:white;color:#25314d;border-radius:12px;display:flex;flex-direction:column;box-shadow:0 10px 60px #0004;overflow:hidden}.manage-dialog header,.manage-dialog footer{flex-shrink:0}.manage-dialog main{overflow:auto}.catalog-item{border:1px solid #e1e6ef;border-radius:8px;margin:7px 0;padding:8px;display:flex;gap:6px;justify-content:space-between;align-items:center}.catalog-item .detail{flex:1;min-width:0;overflow-wrap:anywhere}.catalog-item .detail span{color:#6c7991} .manage-hint{margin:5px 0;color:#74809a;font-size:12px} 
  `;
  const backdrop=node('div',{className:'shade'}), dialog=node('div',{className:'dialog'}),header=node('header'),main=node('main'),footer=node('footer');
  header.append(node('span',{},title));const x=node('button',{'aria-label':'关闭'},'×');x.onclick=()=>closeModal();header.append(x);
  dialog.append(header,main,footer);backdrop.append(dialog);shadow.append(style,backdrop);return {main,footer};
}
function closeModal(){host?.remove();host=null;shadow=null;}
function addSection(parent,title){const sec=node('section');sec.append(node('h3',{},title));parent.append(sec);return sec;}
function addInput(parent,label,placeholder='',value=''){const wrap=node('div',{className:'field'});wrap.append(node('label',{},label));const input=node('input',{type:'text',placeholder});input.value=value;wrap.append(input);parent.append(wrap);return input;}
function addSelect(parent,label,values,selected){const wrap=node('div',{className:'field'});wrap.append(node('label',{},label));const select=node('select');for(const v of values){const o=node('option');o.value=v;o.textContent=v;select.append(o);}if(selected)select.value=selected;wrap.append(select);parent.append(wrap);return select;}
function addNumber(parent,label,value){const el=addInput(parent,label,'请输入数值');el.type='number';el.min='0.001';el.step='any';el.value=value||'';return el;}
function addHelp(parent,text){const c=node('div',{className:'hint'},text);parent.append(c);return c;}
// All application-to-category associations are owned by the batch-create module.
// Managing them never dismisses the user's unfinished batch-create form.
async function openCatalogManager(onUpdated) {
 if(!shadow)return;
 let pairs=await LoveBatchCatalog.load();
 const layer=node('div',{className:'manage-shade'}),dialog=node('div',{className:'manage-dialog'}),header=node('header'),main=node('main'),footer=node('footer');
 header.append(node('span',{},'管理推广应用 → 一级行业 → 二级产品'));
 const close=node('button',{'aria-label':'关闭管理窗口'},'×');header.append(close);
 main.append(node('div',{className:'manage-hint'},'每条关联包含平台显示的三个完整名称。一个应用允许多条行业/产品组合；可指定一条默认关联。旧版无法明确拆分的记录会保留为「待完善」，不会用于自动创建。'));
 const form=node('div',{className:'grid'});
 const appInput=addInput(form,'推广应用（平台完整名称）','如 支付宝-便捷生活一点就好');
 const industryInput=addInput(form,'一级行业（左侧菜单）','如 金融-第三方支付');
 const productInput=addInput(form,'二级产品（右侧菜单）','如 支付宝-便捷生活一点就好');
 main.append(form);
 const checkRow=node('label',{className:'check'}),defaultBox=node('input',{type:'checkbox'});
 checkRow.append(defaultBox,node('span',{},'设为该推广应用的默认关联（创建时自动选中）'));main.append(checkRow);
 const actionRow=node('div',{className:'row'}),saveBtn=node('button',{className:'primary'},'添加关联'),resetBtn=node('button',{},'取消编辑');
 actionRow.append(saveBtn,resetBtn);main.append(actionRow);
 main.append(node('div',{className:'manage-hint'},'请输入两个独立层级的完整名称；不要把「金融-第三方支付 → 产品名称」写在同一个输入框里。只保存文字，不保存素材文件。'));
 const listing=node('div');main.append(listing);
 const warn=node('div',{className:'warn'});main.append(warn);
 let editing=null;
 function same(a,b){return LoveBatchCatalog.keyOf(a)===LoveBatchCatalog.keyOf(b);}
 function exitEdit(){editing=null;appInput.value='';industryInput.value='';productInput.value='';defaultBox.checked=false;saveBtn.textContent='添加关联';resetBtn.style.display='none';}
 resetBtn.onclick=exitEdit;
 async function persist(next){
   const saved=await LoveBatchCatalog.save(next);
   pairs=saved;
   await onUpdated();render();
 }
 async function removePair(item){
   try{warn.textContent='';await persist(pairs.filter(p=>!same(p,item)));if(editing&&same(editing,item))exitEdit();}
   catch(e){warn.textContent=e.message;}
 }
 function editPair(item){
   editing={...item};appInput.value=item.app;
   industryInput.value=item.industry;productInput.value=item.product;
   defaultBox.checked=!!item.isDefault;
   saveBtn.textContent=item.legacyCategory?'完善旧关联':'保存修改';
   resetBtn.style.display='inline-block';
   if(item.legacyCategory)warn.textContent='旧关联原文：'+item.legacyCategory+'。请分别填好一级行业和二级产品再保存。';
   else warn.textContent='';
   appInput.focus();
 }
 function render(){
   listing.replaceChildren();listing.append(node('h3',{},`已保存 ${pairs.length} 条关联`));
   if(!pairs.length)listing.append(node('div',{className:'manage-hint'},'还没有记录。请添加推广应用、一级行业、二级产品。'));
   for(const item of pairs){
     const row=node('div',{className:'catalog-item'}),detail=node('div',{className:'detail'});
     detail.append(node('strong',{},item.app));
     const label=item.legacyCategory?'⚠ 待完善旧关联：'+item.legacyCategory:
       `一级行业：${item.industry} / 二级产品：${item.product}${item.isDefault?'（默认）':''}`;
     detail.append(node('div',{},label));
     const edit=node('button',{},item.legacyCategory?'完善':'编辑'),del=node('button',{},'删除');
     row.append(detail);
     if(!item.legacyCategory&&!item.isDefault){
       const makeDefault=node('button',{},'设默认');row.append(makeDefault);
       makeDefault.onclick=async()=>{try{warn.textContent='';await persist(pairs.map(p=>({...p,isDefault:p.app===item.app?same(p,item):p.isDefault})));}catch(e){warn.textContent=e.message;}};
     }else if(item.isDefault){
       const clearDefault=node('button',{},'取消默认');row.append(clearDefault);
       clearDefault.onclick=async()=>{try{warn.textContent='';await persist(pairs.map(p=>same(p,item)?{...p,isDefault:false}:p));}catch(e){warn.textContent=e.message;}};
     }
     row.append(edit,del);listing.append(row);
     edit.onclick=()=>editPair(item);del.onclick=()=>removePair(item);
   }
 }
 saveBtn.onclick=async()=>{
   warn.textContent='';
   const app=clean(appInput.value),industry=clean(industryInput.value),product=clean(productInput.value);
   if(!app||!industry||!product){warn.textContent='请分别填写推广应用、一级行业和二级产品。';return;}
   try{
     let next=pairs.filter(p=>!editing||!same(p,editing));
     if(defaultBox.checked)next=next.map(p=>p.app===app?{...p,isDefault:false}:p);
     next.push({app,industry,product,isDefault:defaultBox.checked});
     await persist(next);exitEdit();
   }catch(e){warn.textContent=e.message;}
 };
 const exportBtn=node('button',{},'导出 JSON'),importBtn=node('button',{},'导入 JSON'),importFile=node('input',{type:'file'});
 importFile.accept='.json,application/json';importFile.style.display='none';
 exportBtn.onclick=()=>{
   const blob=new Blob([JSON.stringify({version:2,pairs},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');
   a.href=url;a.download='LoveExtension-应用行业产品关联-v2.json';a.style.display='none';main.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
 };
 importBtn.onclick=()=>importFile.click();
 importFile.onchange=async()=>{
   try{
     const file=importFile.files?.[0];if(!file)return;if(file.size>500000)throw Error('导入文件过大');
     const raw=JSON.parse(await file.text());const imported=LoveBatchCatalog.normalize(Array.isArray(raw)?raw:raw?.pairs);
     await persist(imported);exitEdit();warn.textContent=`导入成功，保存${imported.length}条关联；未完成的旧记录请点击「完善」。`;
   }catch(e){warn.textContent='导入失败：'+e.message;}finally{importFile.value='';}
 };
 const done=node('button',{className:'primary'},'完成');footer.append(exportBtn,importBtn,importFile,done);
 function dismiss(){layer.remove();}
 done.onclick=dismiss;close.onclick=dismiss;dialog.append(header,main,footer);layer.append(dialog);shadow.append(layer);render();exitEdit();
}
function populateDropdown(select,choices,placeholder,wanted=''){
  select.replaceChildren();const empty=node('option',{},placeholder);empty.value='';select.append(empty);
  for(const value of choices){const item=node('option',{},value);item.value=value;select.append(item);}
  select.value=choices.includes(wanted)?wanted:'';
}
// Platform creative options observed for each display format. Other form inputs stay shared.
const DISPLAY_CREATIVE_TYPES={
 '开屏':['无图','竖版大图','横版大图'],
 'Banner':['无图','横版大图'],
 '插屏':['无图','竖版大图','横版大图','竖版视频','横版视频'],
 '原生':['无图','小图','竖版大图','横版大图','竖版视频','横版视频','组图'],
 '激励互动':['竖版视频','横版视频'],
 // Vivo's information-feed placement supports small image, grouped images,
 // large images and video. Do not offer No Image without platform evidence.
 '信息流':['小图','组图','竖版大图','横版大图','竖版视频','横版视频']
};
function supportedCreativeTypes(display){return DISPLAY_CREATIVE_TYPES[display]||[];}
function displayFor(task){
 const c=task.config;
 // Backwards compatible with an existing V1.3.29 task in storage.session.
 return Array.isArray(c.displays)?c.displays[task.index]:c.display;
}
function mediaTypeOf(f){const nm=f.name||'',tp=f.type||'';return /^image\//.test(tp)||/\.(png|jpe?g|gif|webp)$/i.test(nm)?'image': /^video\//.test(tp)||/\.(mp4|mov|m4v|webm)$/i.test(nm)?'video':'';}
async function selectFiles(kind,preview=false){
  if(typeof window.showOpenFilePicker!=='function')throw Error('当前浏览器不支持文件句柄选择，请使用新版 Chrome');
  const types=preview?[{description:'横版预览图',accept:{'image/jpeg':['.jpg','.jpeg'],'image/png':['.png']}}]:[
    {description:kind==='video'?'视频素材':'图片素材',accept:kind==='video'?{'video/mp4':['.mp4'],'video/quicktime':['.mov'],'video/webm':['.webm']}:{'image/jpeg':['.jpg','.jpeg'],'image/png':['.png'],'image/gif':['.gif']}}
  ];
  const handles=await window.showOpenFilePicker({multiple:true,types,excludeAcceptAllOption:true});
  if(handles.length>10)throw Error('一次最多选择10个素材');
  const descriptions=[];
  for(const handle of handles){const f=await handle.getFile();if(preview&&!/\.(jpe?g|png)$/i.test(f.name))throw Error('预览图仅支持 JPG/PNG');if(!preview&&mediaTypeOf(f)!==kind)throw Error('所选文件类型不匹配');descriptions.push({name:f.name,type:f.type,size:f.size,lastModified:f.lastModified});}
  return {handles,descriptions};
}
async function openForm(){
  if(!usePlan())return;
  const {main,footer}=modal('批量新建广告');let media={handles:[],descriptions:[],kind:''},preview={handles:[],descriptions:[]};
  const names=addSection(main,'广告名称与展现形式（每行创建一套完整广告）');
  const heading=node('div',{className:'name-head'});
  for(const [cls,label] of [['num-col',''],['name-col','广告名称'],['display-col','展现形式'],['action-col','']])heading.append(node('span',{className:cls},label));
  names.append(heading);
  const nameBox=node('div');names.append(nameBox);
  const displayTypes=['开屏','Banner','插屏','原生','激励互动','信息流'];
  let entries=[];
  const appendName=(v='',displayValue='开屏')=>{
    if(entries.length>=10)return;
    const row=node('div',{className:'name-row'}),counter=node('span',{className:'num-col'},String(entries.length+1)+'.');
    const input=node('input',{type:'text',placeholder:'填写广告名称，三层名称保持一致'});
    input.maxLength=200;input.value=v;
    const displaySelect=node('select',{'aria-label':`第${entries.length+1}套广告的展现形式`});
    for(const display of displayTypes){const item=node('option',{},display);item.value=display;displaySelect.append(item);}
    displaySelect.value=displayValue;
    const del=node('button',{},'删除');row.append(counter,input,displaySelect,del);nameBox.append(row);
    const entry={row,counter,input,displaySelect};entries.push(entry);
    del.onclick=()=>{
      if(entries.length===1){input.value='';return;}
      entries=entries.filter(item=>item!==entry);row.remove();
      entries.forEach((item,i)=>{item.counter.textContent=String(i+1)+'.';item.displaySelect.setAttribute('aria-label',`第${i+1}套广告的展现形式`);});
    };
  };
  appendName();
  const addName=node('button',{},'＋ 添加广告名称');
  addName.onclick=()=>{
    if(entries.length>=10)return;
    const previous=entries[entries.length-1];
    appendName(previous?.input.value||'',previous?.displaySelect.value||'开屏');
    const added=entries[entries.length-1].input;added.focus();added.setSelectionRange(added.value.length,added.value.length);
  };
  names.append(addName);
  addHelp(names,'每套广告独立选择展现形式；新增行复制上一行的名称与展现形式。下面的创意类型、素材和其他参数仍为全部广告共用；开始前会检查各展现形式是否支持该创意类型。每批最多10套。');
  const p=addSection(main,'广告计划');const pg=node('div',{className:'grid'});p.append(pg);
  const planType=addSelect(pg,'计划类型',['商店','非商店','联盟'],'联盟'), scene=addSelect(pg,'场景定制',['普通投放','极速唤新'],'普通投放');
  const g=addSection(main,'广告组');const gg=node('div',{className:'grid'});g.append(gg);
  const appWrap=node('div',{className:'field'}),categoryWrap=node('div',{className:'field'});
  gg.append(appWrap,categoryWrap);
  appWrap.append(node('label',{},'推广应用 *'));const app=node('select');appWrap.append(app);
  categoryWrap.append(node('label',{},'行业/产品（二级关联）*'));const category=node('select');categoryWrap.append(category);
  let catalogPairs=[],categoryOptions=[];
  function updateCategory(wanted=''){
    categoryOptions=LoveBatchCatalog.choices(catalogPairs,app.value);
    category.replaceChildren();const empty=node('option',{},'请选择该应用的「一级行业 → 二级产品」');empty.value='';category.append(empty);
    for(const pair of categoryOptions){
      const opt=node('option',{},`${pair.industry} → ${pair.product}${pair.isDefault?'（默认）':''}`);
      opt.value=LoveBatchCatalog.pairValue(pair);category.append(opt);
    }
    category.value=LoveBatchCatalog.preferred(catalogPairs,app.value,wanted);
  }
  async function refreshCatalog(wantedApp=app.value,wantedCategory=category.value){
    catalogPairs=await LoveBatchCatalog.load();
    populateDropdown(app,LoveBatchCatalog.apps(catalogPairs),'请选择推广应用',wantedApp);
    updateCategory(wantedCategory);
  }
  app.onchange=()=>updateCategory();
  const manage=node('button',{className:'catalog-trigger'},'管理应用、行业与产品');g.append(manage);
  manage.onclick=async()=>{try{await openCatalogManager(()=>refreshCatalog());}catch(e){error.textContent='打开应用管理失败：'+e.message;}};
  addHelp(g,'先选推广应用，再选它绑定的「一级行业 → 二级产品」；仅有一组或已设默认时自动选中。旧记录若显示待完善，请在管理窗口分别填写两个层级。');
  refreshCatalog().catch(e=>{error.textContent='读取应用列表失败：'+e.message;});
  const install=addSelect(gg,'安装定向',['不限','未安装','已安装'],'已安装');
  const bidMethod=addSelect(gg,'出价方式',['按千次展示出价','按点击出价','按转化目标出价'],'按转化目标出价');
  const goal=addSelect(gg,'优化目标',['自定义拉活','自定义付费','自定义激活','自定义注册','下载','游戏注册','新增激活','游戏ROI-充值付费'],'自定义拉活');
  const bidAmount=addNumber(gg,'出价金额（按平台对应单位填写）','0.1');
  const ad=addSection(main,'广告创意');const ag=node('div',{className:'grid'});ad.append(ag);
  const creativeType=addSelect(ag,'创意类型',['无图','竖版大图','横版大图','小图','组图','竖版视频','横版视频'],'竖版大图');
  const spec=addSelect(ag,'创意规格',['不指定','1080*1880','1080*1920'],'1080*1920');
  // 素材类型由创意类型唯一决定：视频选视频，其他有图类型选图片，无图无需素材。
  // 此处不再让用户重复选择「素材种类」，也不更改原文件句柄上传引擎。
  const mediaKindForCreative=()=>expectedMediaType({creativeType:creativeType.value});
  const mediaBtn=node('button',{className:'zone'},'＋ 选择图片素材（最多10个）'),mediaInfo=addHelp(ad,'未选择素材');ad.append(mediaBtn);
  const removeMedia=node('button',{},'清除所选素材');ad.append(removeMedia);
  let lastDisplayedMediaKind=null;
  function refreshMediaUi(){
    const kind=mediaKindForCreative();
    const kindChanged=kind!==lastDisplayedMediaKind;
    const discarded=!!media.handles.length&&media.kind!==kind;
    if(discarded)media={handles:[],descriptions:[],kind:''};
    mediaBtn.disabled=!kind;
    mediaBtn.textContent=kind==='video'?'＋ 选择视频素材（最多10个）':kind==='image'?'＋ 选择图片素材（最多10个）':'无图创意无需选择素材';
    if(!kind)mediaInfo.textContent='当前为「无图」创意，无需图片或视频';
    else if(discarded)mediaInfo.textContent='创意类型已变更为'+(kind==='video'?'视频':'图片')+'，原素材已清除，请重新选择';
    else if(kindChanged&&!media.handles.length)mediaInfo.textContent='未选择素材';
    lastDisplayedMediaKind=kind;
  }
  creativeType.addEventListener('change',refreshMediaUi);
  refreshMediaUi();
  mediaBtn.onclick=async()=>{
    const kind=mediaKindForCreative();if(!kind)return;
    try{
      const next=await selectFiles(kind);
      // 用户在文件选择过程中改变了创意类型时，不得保留错误类型的句柄。
      if(mediaKindForCreative()!==kind){mediaInfo.textContent='创意类型已经改变，请重新选择对应素材';return;}
      media={...next,kind};
      mediaInfo.textContent=`已选${media.handles.length}个：${media.descriptions.map(d=>d.name).join('、')}`;
    }catch(e){if(e.name!=='AbortError')error.textContent=e.message;}
  };
  removeMedia.onclick=()=>{media={handles:[],descriptions:[],kind:''};mediaInfo.textContent=mediaKindForCreative()?'未选择素材':'当前为「无图」创意，无需图片或视频';};
  const coverBtn=node('button',{className:'zone'},'＋ 选择横版预览图（可选，最多10张）'),coverInfo=addHelp(ad,'仅激励互动＋竖版视频使用；与视频逐张对应。');ad.append(coverBtn);
  const removeCover=node('button',{},'清除预览图');ad.append(removeCover);
  coverBtn.onclick=async()=>{try{preview=await selectFiles('image',true);coverInfo.textContent=`已选${preview.handles.length}张：${preview.descriptions.map(d=>d.name).join('、')}`;}catch(e){if(e.name!=='AbortError')error.textContent=e.message;}};
  removeCover.onclick=()=>{preview={handles:[],descriptions:[]};coverInfo.textContent='未选择横版预览图';};
  const textGrid=node('div',{className:'grid'});ad.append(textGrid);const appName=addInput(textGrid,'应用名称 / 标题','创意标题'),subtitle=addInput(textGrid,'应用副标题','创意副标题');
  addHelp(ad,'使用原来的上传引擎，图片/视频只保留文件句柄；不自动复制整份素材到数据库。页面其他字段保留 vivo 默认值。');
  const errSection=addSection(main,'执行与投放安全');
  const check=node('label',{className:'check'});const auto=node('input',{type:'checkbox'});check.append(auto,node('span',{},'允许自动点击最终「提交」并依次创建下一套；我了解新建广告可能立即投放并产生费用。'));errSection.append(check);
  addHelp(errSection,'不勾选：每套执行到最后一步时，必须在创建页面手动点击「确认提交当前广告」才会继续。若页面存在额外必填项或无法确认成功，任务会停止。');
  // Keep validation and task-start errors next to the Start button so they are visible
  // even when the scrollable configuration form is long.
  const error=node('div',{className:'warn footer-error'});error.setAttribute('role','alert');
  const cancel=node('button',{},'取消'),start=node('button',{className:'primary'},'开始批量创建');footer.append(error,cancel,start);cancel.onclick=closeModal;
  start.onclick=async()=>{
    error.textContent='';
    const values=entries.map(item=>clean(item.input.value));
    const displays=entries.map(item=>item.displaySelect.value);
    if(values.some(n=>!n)||new Set(values).size!==values.length){error.textContent='请为每套填写不同的广告名称。';return;}
    const incompatible=entries.find(item=>!supportedCreativeTypes(item.displaySelect.value).includes(creativeType.value));
    if(incompatible){
      const idx=entries.indexOf(incompatible)+1;
      error.textContent=`第${idx}套「${clean(incompatible.input.value)}」选择的展现形式「${incompatible.displaySelect.value}」不支持公共创意类型「${creativeType.value}」。该展现形式可选：${supportedCreativeTypes(incompatible.displaySelect.value).join('、')}。请修改展现形式或下面的公共创意类型。`;
      return;
    }
    if(!app.value||!category.value){error.textContent='请从联动列表中选择推广应用和完整的一级行业、二级产品；没有选项时请点击「管理应用、行业与产品」添加。';return;}
    const association=categoryOptions.find(p=>LoveBatchCatalog.pairValue(p)===category.value);
    if(!association){error.textContent='应用与行业/产品关联无效，请重新选择。';return;}
    const inferredMediaKind=mediaKindForCreative();
    if(!media.handles.length&&inferredMediaKind){error.textContent=`当前创意类型「${creativeType.value}」需要${inferredMediaKind==='video'?'视频':'图片'}；请选择至少1个素材。`;return;}
    if(media.handles.length&&inferredMediaKind!==media.kind){error.textContent='已选素材与当前创意类型不一致，请重新选择。';return;}
    if(media.handles.length&&(!appName.value.trim()||!subtitle.value.trim())){error.textContent='新建创意需要应用名称和副标题，请填写。';return;}
    start.disabled=true;start.textContent='准备任务中…';const taskId='love-batch-'+crypto.randomUUID();
    try{
      if(media.handles.length)await LoveWorkflowMediaStore.put(taskId,media.handles,media.descriptions,media.kind);
      if(preview.handles.length)await LoveWorkflowMediaStore.putPreview(taskId,preview.handles,preview.descriptions);
      const config={names:values,displays,planType:planType.value,scene:scene.value,app:app.value,industry:association.industry,product:association.product,install:install.value,bidMethod:bidMethod.value,goal:goal.value,bidAmount:bidAmount.value,display:displays[0],creativeType:creativeType.value,spec:spec.value,appName:appName.value.trim(),subtitle:subtitle.value.trim(),mediaKind:inferredMediaKind,mediaCount:media.handles.length,previewCount:preview.handles.length,autoSubmit:auto.checked};
      const started=await api('START',{path:location.pathname,taskId,config});
      // START, not right-click, is the moment the previous task is retired.
      // Remove only the retired batch's file HANDLE references, never its
      // source files and never the newly stored batch's handles.
      const retiredId=started?.replacedTaskId||started?.task?.replacedTaskId;
      if(retiredId&&retiredId!==taskId)
        await LoveWorkflowMediaStore.remove(retiredId).catch(e=>console.warn('[LoveBatch] retired media cleanup:',e));
      lastRunKey='';hiddenProgressKey='';stoppedTaskId='';cancelCompletedProgressHide();
      closeModal();renderProgress();
    }catch(e){
      // If START already persisted a paused task (e.g. tabs.create failed),
      // keep its file handles so the user can reopen the first work tab.
      let persisted=false;
      try{persisted=(await api('GET')).task?.id===taskId;}catch(_){}
      if(!persisted)await LoveWorkflowMediaStore.remove(taskId).catch(()=>{});
      error.textContent=e.message+(persisted?'；本次任务已暂停，可关闭配置窗口后点击「继续任务」':'');
      start.disabled=false;start.textContent='开始批量创建';
      if(persisted){
        try{
          const current=(await api('GET')).task;
          if(current?.replacedTaskId&&current.replacedTaskId!==taskId)
            await LoveWorkflowMediaStore.remove(current.replacedTaskId).catch(()=>{});
        }catch(_){}
        renderProgress();
      }
    }
  };
}
function activeLabelMatches(el,txt){const t=clean(el.textContent);return t===txt||t.replace(/\s+/g,'')===txt.replace(/\s+/g,'');}
function field(label){
 const items=[...document.querySelectorAll('.ep-form-item,.el-form-item')];
 const found=items.filter(el=>visible(el)&&[...el.querySelectorAll('.ep-form-item__label,.el-form-item__label,label')].some(l=>activeLabelMatches(l,label))).sort((a,b)=>a.querySelectorAll('.ep-form-item').length-b.querySelectorAll('.ep-form-item').length);
 if(found.length)return found[0];
 return null;
}
function buttonBy(text,root=document){return [...root.querySelectorAll('button,[role="button"]')].find(e=>visible(e)&&clean(e.textContent)===text&&!e.disabled&&e.getAttribute('aria-disabled')!=='true')||null;}
function switchValue(input,value){if(!input)throw Error('目标输入框不存在');const desc=Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');desc?.set?.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();}
function findInput(label){const f=field(label);return f?.querySelector('input.ep-input__inner,input.el-input__inner,textarea.ep-textarea__inner,textarea.el-textarea__inner,input:not([type="radio"]):not([type="checkbox"]),textarea')||null;}
function requireInput(label,value){const el=findInput(label);if(!el)throw Error(`找不到「${label}」输入框`);if(clean(el.value)!==clean(value))switchValue(el,value);if(clean(el.value)!==clean(value))throw Error(`「${label}」填写未通过验证`);}
function selected(e){return !!e.closest('.is-active,.is-checked')||!!e.querySelector('input:checked')||e.classList.contains('is-active')||e.classList.contains('is-checked');}
function findOption(container,value){
 const selectors=['.mkt-radio-card','.ep-radio-button','.el-radio-button','.ep-radio','.el-radio','label','button','[role="radio"]'];
 const options=[...container.querySelectorAll(selectors.join(','))].filter(visible).filter(e=>activeLabelMatches(e,value));
 // Prefer the smallest clickable element with exact label text, avoiding parent radio groups.
 options.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
 return options[0]||null;
}
async function clickChoice(label,value){
 const f=field(label);if(!f)throw Error(`找不到「${label}」选项组`);
 let opt=findOption(f,value);if(!opt)throw Error(`「${label}」未找到「${value}」，请检查该组合是否支持`);
 const wrapper=opt.closest('.ep-radio-button,.el-radio-button,.ep-radio,.el-radio,.mkt-radio-card,label')||opt;
 if(!selected(wrapper))wrapper.click();
 await waitFor(()=>{const latest=field(label);const x=latest&&findOption(latest,value);return x&&selected(x.closest('.mkt-radio-card,.ep-radio-button,.el-radio-button,.ep-radio,.el-radio')||x);},`选中 ${label}：${value}`,5000);
}
async function waitFor(fn,label,ms=16000){const until=Date.now()+ms;while(Date.now()<until){const value=fn();if(value)return value;await sleep(180);}throw Error(`${label} 等待超时；已停止防止误操作`);}
// vivo asks for an explicit confirmation before switching display formats.
// Only acknowledge that exact, named, non-submission confirmation on a fresh
// ad-create form. Never auto-confirm a generic system dialog or existing media.
function displayChoiceSelected(value){
 const f=field('展现形式');
 const option=f&&findOption(f,value);
 if(!option)return false;
 return selected(option.closest('.mkt-radio-card,.ep-radio-button,.el-radio-button,.ep-radio,.el-radio')||option);
}
function exposedElement(el){
 if(!visible(el))return false;
 const r=el.getBoundingClientRect();
 if(r.width<=0||r.height<=0)return false;
 for(let p=el;p&&p.nodeType===1;p=p.parentElement){
  const style=getComputedStyle(p);
  if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0'||p.getAttribute('aria-hidden')==='true'||p.hasAttribute('inert'))return false;
 }
 return true;
}
function visibleSystemDialogs(){
 return [...document.querySelectorAll('.ep-message-box,.el-message-box')]
  .filter(exposedElement);
}
function displayResetPrompt(dialog){
 const message=clean(dialog.querySelector('.ep-message-box__message,.el-message-box__message')?.textContent);
 return /^切换展现形式会还原下面所有创意内容[，,]确定切换吗[？?]?$/.test(message);
}
function existingCreativeCount(){
 // The vivo AD page shows "创意个数 0/10" immediately above the creative area.
 // Don't infer an empty page from a missing counter.
 const text=clean(document.body.innerText);
 const match=text.match(/创意\s*个数\s*(\d+)\s*\/\s*(\d+)/);
 return match?{current:Number(match[1]),max:Number(match[2])}:null;
}
async function clickDisplayChoice(value){
 const label='展现形式';
 const f=field(label);
 if(!f)throw Error(`找不到「${label}」选项组`);
 const option=findOption(f,value);
 if(!option)throw Error(`「${label}」未找到「${value}」，请检查该组合是否支持`);
 if(displayChoiceSelected(value))return; // No switching, no confirmation.
 const preexisting=visibleSystemDialogs();
 if(preexisting.length)throw Error('切换展现形式前已有系统弹窗，已停止，避免误确认其他操作');
 const target=option.closest('.ep-radio-button,.el-radio-button,.ep-radio,.el-radio,.mkt-radio-card,label')||option;
 target.click();
 // A dialog can be rendered asynchronously, before the active tab changes.
 // Wait for either an exact-match confirmation or a stable, dialog-free selection.
 const deadline=Date.now()+7500;
 let selectedSince=0;
 while(Date.now()<deadline){
  const dialogs=visibleSystemDialogs();
  if(dialogs.length){
   if(dialogs.length!==1||!displayResetPrompt(dialogs[0])){
    throw Error('切换展现形式时出现非预期系统弹窗，已停止，未自动点击确定');
   }
   const count=existingCreativeCount();
   if(!count||count.current!==0){
    throw Error(`展现形式切换提示会清空创意，但当前创意数量为${count?count.current:'无法确认'}；未自动确认，已停止保护已有内容`);
   }
   const dialog=dialogs[0];
   const buttons=[...dialog.querySelectorAll('button')].filter(el=>exposedElement(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&clean(el.textContent)==='确定');
   if(buttons.length!==1)throw Error(`切换展现形式提示已出现，但「确定」按钮匹配${buttons.length}个；已停止防止误点击`);
   buttons[0].click(); // One action only: do not retry destructive confirmation.
   await waitFor(()=>!exposedElement(dialog),'切换展现形式确认框关闭',6000);
   await waitFor(()=>displayChoiceSelected(value),`确认切换后选中展现形式「${value}」`,7000);
   return;
  }
  if(displayChoiceSelected(value)){
   if(!selectedSince)selectedSince=Date.now();
   // Allow delayed confirmations to appear before treating the switch as done.
   if(Date.now()-selectedSince>=500)return;
  }else selectedSince=0;
  await sleep(80);
 }
 throw Error(`选中 展现形式：${value} 等待超时（未出现预期切换确认框或未确认选中），已停止防止误操作`);
}
function stageReady(stage){
 if(stage==='PLAN')return !!field('计划名称') && !!document.querySelector('.create-edit-plan, .left-bar-wrap, .scroll-content');
 if(stage==='GROUP')return !!field('广告组名称') && !!field('应用');
 if(stage==='AD')return !!field('展现形式')&&!!field('创意类型')&&!!field('广告名称');
 if(stage==='VERIFY')return location.pathname.includes('/promotion/advertisement')||!!document.querySelector('#ads tr.ep-table__row');
 return false;
}
// Element Plus renders the selected optimization goal in a nested .cvtype-info
// element. Select only one real option from the popup belonging to this field.
// This avoids the previous strict document-wide textContent / matches.length===1
// check, which could time out even while the option was visibly available.
function dropdownOptionName(option){
 const leaf=option.querySelector('.cvtype-info')||option.querySelector('.ep-select-dropdown__item__label')||option.querySelector('.el-select-dropdown__item__label')||option.querySelector('.cvtype-text');
 return clean(leaf?.textContent || option.textContent);
}
function dropdownPopper(option){
 return option.closest('.ep-select__popper,.el-select__popper,.ep-popper,.el-popper,.ep-select-dropdown,.el-select-dropdown') || option.parentElement;
}
function dropdownOptionActive(option){
 if(!visible(option) || option.matches('.is-disabled,[aria-disabled="true"]'))return false;
 const popper=dropdownPopper(option);
 if(popper?.closest('[aria-hidden="true"],[inert]'))return false;
 // Popup transitions may leave an invisible second copy of the menu in DOM.
 if(popper && (getComputedStyle(popper).visibility==='hidden'||getComputedStyle(popper).display==='none'||Number(getComputedStyle(popper).opacity)===0))return false;
 return true;
}
function dropdownDistance(option,anchor){
 const r=option.getBoundingClientRect(),a=anchor.getBoundingClientRect();
 const vertical=Math.min(Math.abs(r.top-a.bottom),Math.abs(a.top-r.bottom));
 return Math.abs(r.left-a.left)+vertical;
}
// Search only actually usable options, within the vivo optimization-goal popper.
// The page may retain hidden duplicate poppers after previous interactions.
function visibleDropdownRows(label){
 const rows=[...new Set(document.querySelectorAll('li.ep-select-dropdown__item,li.el-select-dropdown__item,[role="option"]'))]
  .filter(dropdownOptionActive);
 if(label==='优化目标'){
  const goalRows=rows.filter(el=>!!el.closest('.ads-app__cvtype-select'));
  if(goalRows.length || document.querySelector('.ads-app__cvtype-select'))return goalRows;
 }
 return rows;
}
// Vivo optimization goal uses an Element Plus select with a teleported popper.
// The user verified that a real mouse targets input.ep-input__inner and emits
// pointerdown -> mousedown -> mouseup -> click; .click() on the outer div did
// not open the menu. Use that input first and emulate the mouse lifecycle.
// These events are synthetic (isTrusted=false); a website requiring trusted
// events may still reject them, so never proceed unless real options appear.
function simulateMouseEvent(target,type){
 const rect=target.getBoundingClientRect();
 const init={bubbles:true,cancelable:true,composed:true,view:window,
   clientX:rect.left+Math.min(rect.width/2,24),clientY:rect.top+Math.min(rect.height/2,16),
   button:0,buttons:(type==='pointerdown'||type==='mousedown')?1:0};
 if(type.startsWith('pointer')){
   const e=typeof PointerEvent==='function'
     ?new PointerEvent(type,{...init,pointerId:1,pointerType:'mouse',isPrimary:true})
     :new MouseEvent(type,init);
   target.dispatchEvent(e);
 }else target.dispatchEvent(new MouseEvent(type,init));
}
async function awaitOpenDropdown(label,timeout=1100){
 const until=Date.now()+timeout;
 while(Date.now()<until){
   const rows=visibleDropdownRows(label);
   if(rows.length)return rows;
   await sleep(90);
 }
 return visibleDropdownRows(label);
}
async function chooseDropdown(label,value){
 // The vivo optimization target only responds reliably to browser-level input.
 // Restrict CDP to this one field; leave all other existing dropdown logic intact.
 if(label==='优化目标'){
  await api('SELECT_GOAL_CDP',{goal:clean(value)});
  await waitFor(()=>{
   const f=field(label);if(!f)return false;
   return [...f.querySelectorAll('input.ep-input__inner,input.el-input__inner,.ep-select__selected-item,.el-select__selected-item')]
    .some(el=>[el.value,el.getAttribute('title'),el.textContent].some(v=>clean(v)===clean(value)));
  },`「${label}」选中「${value}」后确认回显`,5000);
  return;
 }
 const f=field(label);if(!f)throw Error(`缺少「${label}」设置`);
 const desired=clean(value);
 const select=f.querySelector('.ep-select.form-control,.el-select.form-control,.ep-select,.el-select');
 const wrapper=select?.querySelector('.ep-select__wrapper,.el-select__wrapper,.ep-input__wrapper,.el-input__wrapper') || f.querySelector('.ep-select__wrapper,.el-select__wrapper,.ep-input__wrapper,.el-input__wrapper');
 const input=select?.querySelector('input.ep-input__inner,input.el-input__inner,input') || f.querySelector('input.ep-input__inner,input.el-input__inner,input');
 const anchor=select||wrapper||input||f;
 let rows=visibleDropdownRows(label);
 const attempts=[];
 // Prioritize the actual element receiving trusted mouse events.  Do not
 // repeatedly click a dropdown that has just opened; that can close it.
 const targets=[input,wrapper,select].filter((el,i,a)=>el&&visible(el)&&a.indexOf(el)===i);
 for(const target of targets){
  if(rows.length)break;
  const tag=`${target.tagName.toLowerCase()}.${clean(target.className).replace(/\s+/g,'.')||'no-class'}`;
  // 1. Emulate the actual mouse event order. A click-only strategy failed on
  // vivo even when the option was known to exist in the DOM.
  attempts.push(`${tag}: pointerdown/mousedown/mouseup/click`);
  target.focus?.({preventScroll:true});
  rows=visibleDropdownRows(label);
  if(rows.length)break;
  for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){
    simulateMouseEvent(target,type);
    // Once the menu opens, avoid any later synthetic event toggling it shut.
    // Both pointerdown and mousedown are real-site event candidates.
    if(type==='pointerdown'||type==='mousedown'){
      await sleep(100);
      rows=visibleDropdownRows(label);
      if(rows.length)break;
    }
  }
  if(!rows.length)rows=await awaitOpenDropdown(label,1250);
  if(rows.length)break;
  // 2. Some account versions still use an ordinary click handler.
  attempts.push(`${tag}: click()`);
  target.click();
  rows=await awaitOpenDropdown(label,850);
 }
 if(!rows.length){
  throw Error(`「${label}」下拉菜单仍未展开（已尝试：${attempts.join(' → ')||'菜单原本已展开'}；可见选项：无）。模拟鼠标事件仍属于非真实事件，如果网站限制 isTrusted，扩展无法仅靠页面脚本强制打开；已停止防止误操作`);
 }
 const names=[...new Set(rows.map(dropdownOptionName).filter(Boolean))];
 const exact=rows.filter(el=>dropdownOptionName(el)===desired);
 if(!exact.length){
  throw Error(`「${label}」未找到「${desired}」（可见选项：${names.slice(0,20).join('、')||'无'}）。请检查该选项是否属于当前推广应用，已停止防止误选`);
 }
 // Link the option to this select when the site exposes aria-controls/owns.
 const controlIds=[...f.querySelectorAll('[aria-controls],[aria-owns]')]
  .flatMap(el=>[el.getAttribute('aria-controls'),el.getAttribute('aria-owns')]).filter(Boolean);
 const linked=exact.filter(el=>controlIds.some(id=>{
  const owner=document.getElementById(id);
  return owner&&(owner===el||owner.contains(el));
 }));
 const group=linked.length?linked:exact;
 let opt=null;
 if(group.length===1)opt=group[0];
 else {
  const ranked=group.map(el=>({el,d:dropdownDistance(el,anchor)})).sort((a,b)=>a.d-b.d);
  if(ranked.length>1&&ranked[0].d+8<ranked[1].d)opt=ranked[0].el;
 }
 if(!opt)throw Error(`「${label}」找到${group.length}个可见的「${desired}」选项，无法唯一确定目标；已停止防止误选`);
 opt.scrollIntoView?.({block:'nearest'});
 opt.click();
 await waitFor(()=>{
  const latest=field(label);if(!latest)return false;
  const values=[...latest.querySelectorAll('input,.ep-select__selected-item,.el-select__selected-item,.ep-select__selection,.el-select__selection')]
   .flatMap(el=>[el.value,el.getAttribute('title'),el.textContent]).map(clean);
  return values.includes(desired)||clean(latest.textContent).includes(desired);
 },`「${label}」选中「${desired}」后确认回显`,7000);
}
async function chooseCascader(label,query){
 const f=field(label);if(!f)throw Error(`未找到「${label}」选择框`);
 (f.querySelector('input,.ep-input,.el-input,[role=combobox]')||f).click();
 const choices=query.split(/\s*(?:→|>|／|\s+[/]\s+)\s*/).map(clean).filter(Boolean);
 for(const choice of choices){
   let list=await waitFor(()=>{
     const opts=applicationRows();
     const exact=opts.filter(o=>applicationRowNames(o).some(t=>t===choice));
     if(exact.length===1)return exact[0];
     const partial=opts.filter(o=>applicationRowNames(o).some(t=>t.includes(choice)));
     return partial.length===1?partial[0]:null;
   },`查找「${label}」选项 ${choice}`,7000);
   list.click();await sleep(220);
 }
 await sleep(250);
}
// Treat a cascader row as ONE choice. vivo renders each application in nested
// .ep-cascader-node > .options-item > .mkt-ellipsis elements: searching all
// descendants as separate candidates incorrectly produces 2+ “matches”.
function applicationRows(){
 const selector='.ep-cascader-node,.el-cascader-node,.options-item,.ep-select-dropdown__item,[role="menuitem"],.mkt-cascader-panel li';
 const rowSelector='.ep-cascader-node,.el-cascader-node,.ep-select-dropdown__item,[role="menuitem"],.mkt-cascader-panel li';
 const rows=new Set();
 for(const el of document.querySelectorAll(selector)){
   if(!visible(el))continue;
   const row=el.closest(rowSelector)||el;
   if(visible(row)&&row.getAttribute('aria-disabled')!=='true'&&!row.classList.contains('is-disabled'))rows.add(row);
 }
 return [...rows];
}
function applicationRowNames(row){
 const names=new Set();
 const candidates=[row.querySelector('.options-item .mkt-ellipsis'),row.querySelector('.mkt-ellipsis'),row.querySelector('.options-item'),row];
 for(const el of candidates){
   if(!el)continue;
   for(const raw of [el.getAttribute('title'),el.textContent]){
     const text=clean(raw);if(text)names.add(text);
   }
 }
 return [...names];
}
function normalizeApplicationName(value){return clean(value).replace(/[‐‑‒–—－﹣]/g,'-');}
function matchApplicationRows(name){
 const query=normalizeApplicationName(name), rows=applicationRows();
 const exact=rows.filter(row=>applicationRowNames(row).some(text=>normalizeApplicationName(text)===query));
 if(exact.length)return {matches:exact,kind:'精确匹配',rows};
 // Partial matches are only a fallback when exactly one DISTINCT row matches.
 const partial=rows.filter(row=>applicationRowNames(row).some(text=>normalizeApplicationName(text).includes(query)));
 return {matches:partial,kind:'部分匹配',rows};
}
function applicationIsSelected(name){
 const f=field('应用');if(!f)return false;
 const expected=normalizeApplicationName(name);
 const controls=f.querySelectorAll('input:not([type="radio"]),textarea,.ep-select__selected-item,.el-select__selected-item,[title]');
 for(const el of controls){
   const values=[el.value,el.getAttribute('title'),el.textContent];
   if(values.some(text=>{const actual=normalizeApplicationName(text);return actual===expected||actual.includes(expected);}))return true;
 }
 // Some vivo accounts render the selected application as text inside the form item.
 return [...f.querySelectorAll('.ep-form-item__content,.el-form-item__content')]
   .some(el=>normalizeApplicationName(el.textContent).includes(expected));
}
async function chooseApplication(name){
 const f=field('应用');if(!f)throw Error('没有找到「应用」选择框');
 if(applicationIsSelected(name))return; // Avoid reopening or resetting an already repaired application.
 (f.querySelector('input,.ep-input,.el-input,[role=combobox]')||f).click();
 let observed={matches:[],kind:'',rows:[]};
 const matched=await waitFor(()=>{
   observed=matchApplicationRows(name);
   return observed.matches.length===1?observed.matches[0]:null;
 },`选择应用「${name}」失败（匹配${observed.matches.length}项、可见候选${observed.rows.length}项）`,12000).catch(err=>{
   // waitFor’s label is evaluated before polling; use final observed values.
   const details=observed.matches.length>1?`存在${observed.matches.length}个不同候选，禁止猜测`:`实际找到${observed.rows.length}个可见选项，未能唯一匹配`;
   throw Error(`应用「${name}」选择失败：${details}；已停止防止误操作`);
 });
 matched.click();
 await waitFor(()=>applicationIsSelected(name),`应用「${name}」点击后未显示为已选择`,8000);
}
async function applyBid(c,task){
 await clickChoice('出价方式',c.bidMethod);
 if(c.bidMethod==='按转化目标出价'){
   await waitFor(()=>field('优化目标'), '优化目标字段出现');
   if(task.manualFix==='goal'||task.manualFixes?.includes('goal')){
     if(!field('优化目标'))throw Error('优化目标字段不存在，请先手动修复');
     // The human has explicitly selected this goal; re-clicking its selector
     // would undo or interfere with the manually corrected value.
   }else await chooseDropdown('优化目标',c.goal);
   const item=field('优化目标');
   const amount=item?.querySelector('input[type=number],.price-input input')||document.querySelector('.price-input input[type=number]');
   if(!amount)throw Error('找不到优化目标对应的出价金额框，已停止');
   switchValue(amount,String(c.bidAmount));
   if(Number(amount.value)!==Number(c.bidAmount))throw Error('出价金额填写失败');
 }else{
   const x=findInput('出价')||document.querySelector('.price-input input[type=number]');if(!x)throw Error('未找到当前出价方式的金额输入框');switchValue(x,String(c.bidAmount));
 }
}
async function assertActive(task){
 const state=(await api('GET')).task;
 if(!state||state.id!==task.id||state.status!=='running'||state.index!==task.index||state.stage!==task.stage||state.phase!=='busy')throw Error('批量任务已停止或网页状态发生变化，禁止继续保存/提交');
}
async function assertTransitionActive(task,next){
 const state=(await api('GET')).task;
 if(!state||state.id!==task.id||state.status!=='running'||state.index!==task.index||state.stage!==task.stage||state.phase!=='transition'||state.expectedStage!==next)
   throw Error('任务已进入人工接管或停止，禁止继续点击保存/提交；请按检查点恢复');
}
// V1.3.42: fail fast on explicit vivo form-validation errors instead of
// waiting 35/60 seconds for a navigation that the platform has rejected.
// Read-only detection: never dismiss an unknown platform dialog or repeat
// Save/Submit automatically. A paused task can be resumed by the user.
function collectPlatformFormErrors(){
 const found=[];const add=value=>{
  const message=clean(value).slice(0,180);
  if(message && !found.includes(message))found.push(message);
 };
 const selectors=[
  '.ep-form-item__error','.el-form-item__error',
  '.ep-message--error','.el-message--error',
  '.ep-notification--error','.el-notification--error',
  '.ep-form-item.is-error .error-msg','.el-form-item.is-error .error-msg',
  '[role="alert"].is-error','[role="alert"].error',
  '.ep-message-box__message','.el-message-box__message'
 ].join(',');
 for(const el of document.querySelectorAll(selectors)){
  if(!exposedElement(el))continue;
  const value=clean(el.innerText||el.textContent);
  // An ordinary non-error message box is not a validation failure.
  if(el.matches('.ep-message-box__message,.el-message-box__message') &&
    !/(失败|错误|校验|不合法|请修改|必填|不能为空|超出范围|范围为)/.test(value))continue;
  add(value);
 }
 // vivo also shows validation details in a custom popover and a red price
 // warning. These do not consistently use Element Plus's __error class.
 // innerText ignores display:none, avoiding hidden historical error nodes.
 const pageText=document.body?.innerText||'';
 const lines=pageText.split(/\n+/).map(clean).filter(Boolean);
 for(const line of lines){
  if(line.length>160)continue;
  if(/有些项目填写错误|请检查以下选项|请修改后再提交|提交失败|保存失败|优化目标出价范围为\s*[\d.]+\s*[-–~～至]\s*[\d.]+\s*元/.test(line))add(line);
 }
 // Detect additional per-field red validation text without confusing a
 // neutral price-floor label or an asterisk with a failure.
 for(const item of document.querySelectorAll('.ep-form-item,.el-form-item')){
  if(!exposedElement(item))continue;
  if(!item.classList.contains('is-error')&&!item.classList.contains('is-invalid')&&
    !item.querySelector('[aria-invalid="true"]'))continue;
  const candidate=item.querySelector('.ep-form-item__error,.el-form-item__error,[class*="error-message"],[class*="error-tip"]');
  if(candidate&&exposedElement(candidate))add(candidate.innerText||candidate.textContent);
 }
 return found.slice(0,5);
}
async function waitForTransitionOrValidation(next,label,timeout){
 const started=Date.now(),until=started+timeout;
 let signature='',observedAt=0;
 while(Date.now()<until){
  // Navigation wins over stale toasts from the previous stage.
  if(stageReady(next))return;
  const errors=collectPlatformFormErrors();
  const current=errors.join('；');
  if(current&&Date.now()-started>=300){
   if(current!==signature){signature=current;observedAt=Date.now();}
   else if(Date.now()-observedAt>=360){
    throw Error(`vivo 页面校验失败：${errors.join('；')}。任务已自动暂停，请人工修正后点击「继续任务」`);
   }
  }else{signature='';observedAt=0;}
  await sleep(140);
 }
 throw Error(`${label} 等待超时；已自动暂停，人工检查后可点击「继续任务」`);
}
async function clickSaveAndWait(next,task){
 await assertActive(task);
 const button=buttonBy('保存并继续');if(!button)throw Error('找不到「保存并继续」按钮');
 // Write the one-click transition checkpoint first; a full reload can then
 // finish the verification in a new content-script instance.
 await api('PREPARE_TRANSITION',{stage:task.stage,to:next});
 await assertTransitionActive(task,next);
 await api('MARK_TRANSITION_DISPATCH',{stage:task.stage,to:next});
 await assertTransitionActive(task,next);
 button.click();
 await waitForTransitionOrValidation(next,`${next} 页面出现`,35000);
 await sleep(350);
 try{await api('CONFIRM_TRANSITION',{stage:task.stage,to:next});}
 catch(e){if(!/状态不匹配/.test(e.message))throw e;}
}
async function planStage(task){const c=task.config,name=c.names[task.index];await waitFor(()=>stageReady('PLAN'),'新建计划页面',25000);
 await clickChoice('计划类型',c.planType);
 if(c.scene!=='普通投放'||field('场景定制')) await clickChoice('场景定制',c.scene);
 requireInput('计划名称',name);
 await clickSaveAndWait('GROUP',task);
}
async function selectIndustryProductSafely(task){
 const c=task.config;
 const transient=/尚不可点击|菜单没有展开|未唯一匹配（匹配0项|选中.*未确认|点击两级菜单后仍未确认选中|一级行业.*匹配0项|二级产品.*匹配0项/;
 let firstError='';
 for(let attempt=0;attempt<2;attempt++){
   await assertActive(task);
   try{
     // CDP first checks the real selected value. Re-entering after a partial
     // cascader interaction cannot undo an already confirmed selection.
     await api('SELECT_CATEGORY_CDP',{industry:c.industry,product:c.product});
     return;
   }catch(e){
     if(attempt!==0||!transient.test(e.message))throw Error(firstError?`${e.message}；首次尝试：${firstError}`:e.message);
     firstError=e.message;
     await sleep(850); // One bounded retry only for verified transient DOM/loading failures.
   }
 }
}
async function groupStage(task){const c=task.config,name=c.names[task.index];await waitFor(()=>stageReady('GROUP'),'新建广告组页面',25000);
 await assertActive(task);
 if(task.manualFix==='application'||task.manualFixes?.includes('application')){
   if(!field('应用'))throw Error('手动选择后应用字段不存在，请返回广告组修复');
 }else await chooseApplication(c.app);
 if(task.manualFix==='category'||task.manualFixes?.includes('category')){
   if(!field('行业/产品'))throw Error('行业/产品字段不存在，请重新进入广告组后修复');
   // User explicitly confirmed manual repair. Do not run the unreliable CDP
   // picker again; let the vivo form validate this value at Save.
 }else await selectIndustryProductSafely(task);
 await assertActive(task);
 await clickChoice('安装定向',c.install);
 await applyBid(c,task);
 await assertActive(task);
 requireInput('广告组名称',name);
 await clickSaveAndWait('AD',task);
}
function expectedMediaType(c){return c.creativeType.includes('视频')?'video':c.creativeType==='无图'?'': 'image';}
async function creativeFiles(task){const c=task.config;
 if(!c.mediaCount)return [];
 if(!globalThis.LoveWorkflowMediaStore)throw Error('文件句柄模块未加载');
 const files=await LoveWorkflowMediaStore.get(task.id);
 if(files.length!==c.mediaCount||files.some(f=>mediaTypeOf(f)!==c.mediaKind))throw Error('媒体文件恢复数量或类型不一致');
 return files;
}
async function setupAdCreative(task){const c=task.config,name=c.names[task.index],display=displayFor(task);await waitFor(()=>stageReady('AD'),'新建创意页面',30000);
 if(!supportedCreativeTypes(display).includes(c.creativeType))throw Error(`第${task.index+1}套展现形式「${display}」不支持创意类型「${c.creativeType}」，已停止`);
 await clickDisplayChoice(display);
 // May be hidden on incentive format.
 if(field('创意生成方式'))await clickChoice('创意生成方式','自定义创意');
 await clickChoice('创意类型',c.creativeType);
 if(c.creativeType!=='无图'&&expectedMediaType(c)!==c.mediaKind)throw Error('选择的素材类型与创意类型不一致');
 const files=await creativeFiles(task), count=Math.max(1,files.length);
 if(typeof ensureCombinedCreativeCount!=='function')throw Error('原一键上传引擎未加载，请刷新页面');
 beginLoveCombinedTask();
 try{
   await ensureCombinedCreativeCount(count);
   await assertActive(task); // A user may have paused while the first creative was being prepared.
   if(c.spec!=='不指定'&&field('创意规格'))await clickChoice('创意规格',c.spec); // Only apply the shared spec when the selected format exposes it.
   await assertActive(task);
   const options={files,mediaKind:c.mediaKind,displayType:display,creativeType:c.creativeType,appName:c.appName,appSubtitle:c.subtitle,hasMedia:!!files.length,hasText:!!(c.appName||c.subtitle),targetCount:count};
   if(files.length){
     if(c.mediaKind==='image')await runCombinedImageFlow(options);
     else await runCombinedVideoFlow(options);
   }
   await assertActive(task); // Do not start preview/text work after a paused or stopped upload.
   if(c.previewCount&&display==='激励互动'&&c.creativeType==='竖版视频'){
     const previews=await LoveWorkflowMediaStore.getPreview(task.id);
     if(previews.length!==c.previewCount||previews.length!==files.length)throw Error('激励竖版视频的预览图数量与视频数量不符');
     await LoveHorizontalPreview.replace({files:previews,indexes:previews.map((_,i)=>i+1),activate:i=>LoveHorizontalPreview.activateManual(i)});
   }
   await assertActive(task);
   if(c.appName||c.subtitle)await combinedFillUnifiedTextForTargetCreatives(c.appName,c.subtitle,count);
   await assertActive(task);
 }finally{finishLoveCombinedTask();}
 requireInput('广告名称',name);
 // A fresh create page should show one or more populated creative tabs before saving.
 if(c.creativeType!=='无图' && typeof getCombinedCreativeIndices==='function' && getCombinedCreativeIndices().length<count)throw Error('未确认全部创意已创建，禁止提交');
}
async function askSubmit(task){if(task.config.autoSubmit)return true;
 return new Promise(resolve=>{
  const {main,footer}=modal('确认提交当前广告');
  main.append(node('p',{},`第 ${task.index+1} / ${task.config.names.length} 套：${task.config.names[task.index]}`));
  main.append(node('p',{},'全部表单已填写。点击「确认提交当前广告」会在 vivo 平台创建真实广告，可能进入投放状态并产生费用。'));
  const cancel=node('button',{},'暂不提交，暂停任务'),submit=node('button',{className:'primary'},'确认提交当前广告');footer.append(cancel,submit);
  cancel.onclick=()=>{closeModal();resolve(false);};submit.onclick=()=>{closeModal();resolve(true);};
 });
}
function manualAdReady(task){
 const c=task.config,name=c.names[task.index],display=displayFor(task);
 if(!stageReady('AD'))throw Error('当前不是广告设置页面，请回到广告设置阶段再继续');
 if(visibleSystemDialogs().length)throw Error('页面仍有系统弹窗，请先手动处理后点击继续');
 if(!displayChoiceSelected(display))throw Error(`手动修复后尚未确认展现形式「${display}」，请先选中再继续`);
 const cf=field('创意类型'),opt=cf&&findOption(cf,c.creativeType);
 if(!opt||!selected(opt.closest('.mkt-radio-card,.ep-radio-button,.el-radio-button,.ep-radio,.el-radio')||opt))
   throw Error(`手动修复后尚未确认创意类型「${c.creativeType}」，请先选中再继续`);
 const n=findInput('广告名称');if(!n)throw Error('未找到广告名称输入框');
 if(clean(n.value)!==name)requireInput('广告名称',name);
 const expected=Math.max(1,c.mediaCount||0);
 const counter=existingCreativeCount();
 const actual=typeof getCombinedCreativeIndices==='function'?getCombinedCreativeIndices().length:0;
 if(c.creativeType!=='无图'&&Math.max(actual,counter?.current||0)<expected)
   throw Error(`当前仅确认${Math.max(actual,counter?.current||0)}个创意，需要${expected}个。请先完成素材上传并检查成功，再点击继续`);
 // A rendered creative count does not prove media bytes were uploaded. The
 // user deliberately clicked Continue after manually inspecting the upload.
}
async function clickAdSubmitAndWait(task){
 await assertActive(task);
 const submit=buttonBy('提交');if(!submit)throw Error('找不到广告最终「提交」按钮');
 await api('PREPARE_TRANSITION',{stage:'AD',to:'VERIFY'});
 await assertTransitionActive(task,'VERIFY');
 await api('MARK_TRANSITION_DISPATCH',{stage:'AD',to:'VERIFY'});
 await assertTransitionActive(task,'VERIFY');
 submit.click();
 await waitForTransitionOrValidation('VERIFY','广告提交后返回列表',60000);
 try{await api('CONFIRM_TRANSITION',{stage:'AD',to:'VERIFY'});}
 catch(e){if(!/状态不匹配/.test(e.message))throw e;}
}
async function adStage(task){
 if(task.manualResumeStage==='AD')manualAdReady(task); // Never re-run uploads on a manually repaired AD page.
 else await setupAdCreative(task);
 await assertActive(task);
 const ok=await askSubmit(task);
 if(!ok){await api('PAUSE');return;} // Only Stop/× permanently terminates the batch.
 await clickAdSubmitAndWait(task);
}
// A timed-out Save/Submit must not force the user to press the platform button.
// Pressing Continue authorizes one attempt, never an unbounded automatic loop.
// First check whether navigation silently finished; if the stage is unchanged,
// preserve the human-repaired form, and retry only the final Save/Submit click.
async function resumePendingTransition(task){
 const retry=task.retryTransition;
 if(!retry||retry.from!==task.stage)throw Error('恢复提交检查点与当前阶段不一致');
 const {from,to}=retry;
 await assertActive(task);
 for(let attempt=0;attempt<10;attempt++){
   if(stageReady(to)){
     await api('ADVANCE_RETRY_TRANSITION',{stage:from,to});
     return;
   }
   await sleep(180);
   await assertActive(task);
 }
 if(!stageReady(from))throw Error(`继续时当前页面不是 ${from} 或 ${to}，请检查平台是否已切换页面`);
 if(visibleSystemDialogs().length)throw Error('当前仍有系统弹窗，请先处理后点击「继续任务」');
 if(from==='PLAN'){
   if(clean(findInput('计划名称')?.value)!==task.config.names[task.index])
     throw Error('计划名称不符合当前任务；请确认名称后点击「继续任务」');
   await clickSaveAndWait(to,task);
 }else if(from==='GROUP'){
   if(clean(findInput('广告组名称')?.value)!==task.config.names[task.index])
     throw Error('广告组名称不符合当前任务；请确认名称后点击「继续任务」');
   await clickSaveAndWait(to,task);
 }else if(from==='AD'){
   if(clean(findInput('广告名称')?.value)!==task.config.names[task.index])
     throw Error('广告名称不符合当前任务；请确认名称后点击「继续任务」');
   // Respect the original automatic-submit option. Otherwise ask once, just
   // like the normal AD stage; no new generic confirm for auto-submit users.
   const ok=await askSubmit(task);
   if(!ok){await api('PAUSE');return;}
   await clickAdSubmitAndWait(task);
 }else throw Error(`不支持从 ${from} 恢复保存/提交`);
}
async function verifyStage(task){const target=task.config.names[task.index];
 await waitFor(()=>stageReady('VERIFY'),'广告列表出现',30000);
 // Actual list may take time to render and search filters can hide the new row.
 await waitFor(()=>[...document.querySelectorAll('tr.ep-table__row')].some(row=>{
  if(!visible(row))return false;
  const n=clean(row.querySelector('.name-div-content .common-text,.name-div .common-text')?.textContent || '');return n===target;
 }),`在广告列表中确认新广告「${target}」`,40000);
}
async function runOne(task){if(running)return;running=true;
 try{
   await api('CLAIM',{stage:task.stage});
   if(task.retryTransition?.from===task.stage)await resumePendingTransition(task);
   else if(task.stage==='PLAN')await planStage(task);
   else if(task.stage==='GROUP')await groupStage(task);
   else if(task.stage==='AD')await adStage(task);
   else if(task.stage==='VERIFY'){
     if(task.manualFix==='verify'){
       await waitFor(()=>stageReady('VERIFY'),'人工核验的广告列表页面',18000);
       await assertActive(task);
     }else await verifyStage(task);
   }
   if(task.stage==='VERIFY')await api('COMPLETE_ONE',{pageUrl:location.href,manualVerified:task.manualFix==='verify'});
   // PLAN/GROUP/AD advance atomically from CONFIRM_TRANSITION after verifying
   // the new page. No second advance or save attempt here.
 }catch(e){console.error('[LoveBatch]',task.stage,e);
   try{await api('FAIL',{error:`第${task.index+1}套「${task.config.names[task.index]}」${task.stage}: ${e.message}`});}catch(_){}
 }finally{running=false;renderProgress();}
}
// Show both the current 1-based set number and the independently verified count.
// A batch with 0 verified sets may already be actively creating its first ad.
function batchProgressLabel(task){
 const total=task.config.names.length;
 const completed=task.results.length;
 if(task.status==='completed')return `全部完成 · 共 ${total} 套已成功创建`;
 const index=Math.min(Math.max(Number(task.index)||0,0),Math.max(total-1,0))+1;
 const stageNames={PLAN:'广告计划',GROUP:'广告组',AD:'广告',VERIFY:'结果核验'};
 const phaseNames={pending:'准备中',busy:'执行中',transition:'保存并切换中',opening:'打开下一套中'};
 const stage=stageNames[task.stage]||'任务准备';
 const phase=phaseNames[task.phase]||'';
 const step=phase?`${stage}·${phase}`:stage;
 if(task.status==='running')return `正在创建第 ${index}/${total} 套 · 已完成 ${completed} 套 · ${step}`;
 if(['paused','failed'].includes(task.status))return `等待人工处理 · 第 ${index}/${total} 套 · 已完成 ${completed} 套 · ${stage}`;
 return `已手动停止 · 第 ${index}/${total} 套 · 已完成 ${completed} 套`;
}
function progressRoot(){let el=document.getElementById('love-batch-progress');if(!el){el=node('div');el.id='love-batch-progress';document.documentElement.append(el);}return el;}
function batchErrorReport(task){
 return [
  `LoveExtension V${chrome.runtime.getManifest().version}`,
  `页面：${location.pathname}`,
  `任务：${task.id}`,
  `状态：${task.status}`,
  `进度：${batchProgressLabel(task)}`,
  `已核验完成：${task.results.length} 套，共 ${task.config.names.length} 套`,
  `第${task.index+1}套：${task.config.names[task.index]||'未知'}`,
  `步骤：${task.stage} / ${task.phase}`,
  `错误：${task.error||'未记录具体错误'}`,
  `最近记录：`,
  ...(task.events||[]).slice(-6).map(e=>`- ${new Date(e.at).toLocaleString()} ${e.stage||''} ${e.label||''}`)
 ].join('\n');
}
async function copyBatchError(task){
 const content=batchErrorReport(task);
 try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(content);return;}}catch(_){/* fallback below */}
 const textarea=node('textarea');textarea.value=content;textarea.style.cssText='position:fixed;top:0;left:-9999px';document.body.append(textarea);textarea.focus();textarea.select();
 const success=document.execCommand('copy');textarea.remove();if(!success)throw Error('浏览器拒绝复制，请检查剪贴板权限');
}
async function renderProgress(){
 try{
  const {task}=await api('GET');const old=document.getElementById('love-batch-progress');
  if(!task){cancelCompletedProgressHide();old?.remove();return;}
  if(task.status==='stopped'||task.id===stoppedTaskId){
    cancelCompletedProgressHide();
    old?.remove();
    // A stopped task is terminal and has no status panel, even after reload.
    // Retain the existing source-page-only cleanup for saved media handles.
    if(usePlan()&&lastCleanedId!==task.id){lastCleanedId=task.id;LoveWorkflowMediaStore.remove(task.id).catch(()=>{});}
    return;
  }
  if(task.status==='completed' && usePlan() && lastCleanedId!==task.id){
    lastCleanedId=task.id;LoveWorkflowMediaStore.remove(task.id).catch(()=>{});
  }
  if(!usePlan()&&!isCreate()&&!location.pathname.includes('/promotion/advertisement')){cancelCompletedProgressHide();old?.remove();return;}
  const currentKey=task.id+'/'+task.status;
  if(task.status!=='completed')cancelCompletedProgressHide();
  if(hiddenProgressKey===currentKey){cancelCompletedProgressHide();old?.remove();return;}
  const el=progressRoot();if(!el.shadowRoot){const sh=el.attachShadow({mode:'open'});sh.innerHTML='<style>:host{all:initial}.b{position:fixed;bottom:15px;right:15px;background:white;border:1px solid #dde2ed;border-radius:9px;padding:12px;width:320px;max-width:90vw;z-index:2147483600;box-shadow:0 4px 20px #0002;font:12px/1.6 Arial,sans-serif;color:#27324b}.top{display:flex;align-items:start;justify-content:space-between;gap:5px}button{border:1px solid #cbd2e1;border-radius:6px;padding:5px 10px;background:white;cursor:pointer}strong{font-size:13px;color:#415fff}.err{color:#bf3f45;overflow-wrap:anywhere;white-space:pre-wrap;margin:5px 0}.actions{display:flex;justify-content:flex-end;gap:7px;margin-top:8px}#close{padding:1px 7px;font-size:18px;line-height:20px;border:0;color:#68748a}</style><div class="b"><div class="top"><strong>批量新建广告</strong><button id="close" title="关闭提示" aria-label="关闭提示">×</button></div><div id="line"></div><div id="err" class="err"></div><div class="actions"><button id="copy" style="display:none">复制错误</button><button id="resume" style="display:none">继续任务</button><button id="stop">停止任务</button></div></div>';
   // The top-right × is an explicit, irreversible STOP for an active batch.
   // Only dismiss after the background has acknowledged that the SAME task stopped.
   const closeButton=sh.getElementById('close'),stopButton=sh.getElementById('stop');
   const dismissProgress=(key)=>{cancelCompletedProgressHide();hiddenProgressKey=key;el.remove();};
   async function stopCurrentTask(dismiss){
     if(el.__stopPending)return;
     const snapshot=el.__task;
     if(!snapshot)return;
     const key=snapshot.id+'/'+snapshot.status;
     if(!['running','paused','failed'].includes(snapshot.status)){
       if(dismiss)dismissProgress(key); // already completed or stopped; nothing left to terminate
       return;
     }
     el.__stopPending=true;el.__stopError='';el.__stopErrorKey=snapshot.id;closeButton.disabled=true;stopButton.disabled=true;
     try{
       const {task:stopped}=await api('STOP',{taskId:snapshot.id,reason:dismiss?'close':'button'});
       if(stopped?.id!==snapshot.id||stopped?.status!=='stopped')throw Error('后台没有确认本次任务已停止');
       stoppedTaskId=snapshot.id; // Ignore any in-flight GET that saw the pre-STOP status.
       if(dismiss)dismissProgress(snapshot.id+'/stopped');
       else await renderProgress();
     }catch(error){
       // Another tab may have stopped/completed it in the meantime. Recheck,
       // but never silently hide a still-running task after a failed STOP.
       let latest=null;
       try{latest=(await api('GET')).task;}catch(_){}
       if(latest?.id===snapshot.id&&['stopped','completed'].includes(latest.status)){
         if(latest.status==='stopped')stoppedTaskId=snapshot.id;
         if(dismiss)dismissProgress(snapshot.id+'/'+latest.status);
         else await renderProgress();
       }else{
         el.__stopError='停止任务失败：'+error.message+'；任务框已保留，请重试或手动点击「停止任务」。';
         sh.getElementById('err').textContent=el.__stopError;
       }
     }finally{el.__stopPending=false;closeButton.disabled=false;stopButton.disabled=false;}
   }
   stopButton.onclick=()=>stopCurrentTask(true);

   sh.getElementById('resume').onclick=async()=>{
     const btn=sh.getElementById('resume');btn.disabled=true;
     try{
       const observedStage=['VERIFY','AD','GROUP','PLAN'].find(stageReady)||'';
       await api('RESUME',{observedStage,manualVerified:el.__task?.stage==='VERIFY'});
       lastRunKey='';hiddenProgressKey='';await renderProgress();
       poll().catch(e=>console.warn('[LoveBatch] resume poll:',e.message));
     }catch(e){sh.getElementById('err').textContent=(el.__task?.error||'')+'\n继续失败：'+e.message;}
     finally{btn.disabled=false;}
   };
   closeButton.onclick=()=>stopCurrentTask(true);
   sh.getElementById('copy').onclick=async()=>{const button=sh.getElementById('copy');try{await copyBatchError(el.__task);button.textContent='已复制';}catch(e){button.textContent='复制失败';sh.getElementById('err').textContent=(el.__task?.error||'')+'\n复制失败：'+e.message;}};
  }
  el.__taskKey=currentKey;el.__task=task;
  const sh=el.shadowRoot;sh.getElementById('line').textContent=batchProgressLabel(task);
  const uncertainSubmit=task.status==='paused'&&task.pausedFrom?.phase==='transition';
  sh.getElementById('err').textContent=[task.error,
    uncertainSubmit?'如平台已受理上次保存/提交但页面未跳转，再次尝试可能重复创建。请先核对平台结果；若仍需补交，直接点击「继续任务」，扩展只会尝试一次。':'',
    el.__stopErrorKey===task.id?el.__stopError:''].filter(Boolean).join('\n');
  sh.getElementById('stop').style.display=['running','paused','failed'].includes(task.status)?'inline-block':'none';
  sh.getElementById('resume').style.display=['paused','failed'].includes(task.status)&&(!usePlan()||((task.workTabId===null||task.pausedFrom?.phase==='opening')&&usePlan()))?'inline-block':'none';
  sh.getElementById('resume').textContent=task.stage==='VERIFY'?'人工确认已创建，继续':'继续任务';
  sh.getElementById('resume').title=task.stage==='VERIFY'?'请先在 vivo 广告列表核实目标广告确实存在，再继续核验下一套':
    (task.pausedFrom?.phase==='transition'?'如果仍在原页面，点击后扩展会复查并尝试一次保存/提交；若平台已受理但页面未跳转，重复提交可能创建重复广告，请先核对平台结果。':'人工修复当前步骤后直接点击，扩展会从该步骤接着执行');
  sh.getElementById('close').title=['running','paused','failed'].includes(task.status)?'关闭并永久停止当前批量任务':'关闭提示';
  sh.getElementById('close').setAttribute('aria-label',sh.getElementById('close').title);
  sh.getElementById('copy').style.display=task.error?'inline-block':'none';
  if(task.status==='completed')scheduleCompletedProgressHide(currentKey);
 }catch(e){console.warn('[LoveBatch] progress:',e.message);}
}
function handleContext(event){
 if(!usePlan()||!(event.target instanceof Element))return;
 const target=event.target;
 // Only blank/table background areas: retain old title right click and normal controls.
 if(target.closest('tr,th,.ep-table__header-wrapper,.name-div,a,button,input,textarea,select,label,[role="button"],.ep-tabs,.el-tabs,.love-combined-dialog,#love-batch-host'))return;
 const safe=target.closest('.ep-table__body-wrapper,.ep-table__header-wrapper,.ep-table,.main-max-width,.root-app,.promotion-advertPlan')||target===document.body;
 if(!safe)return;
 event.preventDefault();event.stopPropagation();openForm();
}
let tick=0;
async function poll(){
 if(++tick%4===0)renderProgress();
 if(running)return;
 try{
  const {task}=await api('GET');
  if(!task||task.status!=='running')return;
  // A retry can have completed navigation while its old content script was
  // being destroyed. The new page must be able to reconcile a busy checkpoint.
  if(['busy','pending'].includes(task.phase) && task.retryTransition && !usePlan() &&
     stageReady(task.retryTransition.to)){
    await api('ADVANCE_RETRY_TRANSITION',{stage:task.retryTransition.from,to:task.retryTransition.to});
    return;
  }
  if(task.phase==='transition' && !usePlan()){
    if(stageReady(task.expectedStage)){
      await api('CONFIRM_TRANSITION',{stage:task.stage,to:task.expectedStage});
    } else if(Date.now()-task.transitionAt>65000){
      await api('FAIL',{error:`${task.stage} 保存/提交后未可靠进入 ${task.expectedStage}，已自动暂停。请先检查是否已实际创建；如需在当前页面重试，直接点击「继续任务」，扩展将再尝试一次。`});
      await renderProgress();
    }
    return;
  }
  if(task.phase!=='pending')return;
  // Port GET only returns the task to the originating and work tabs; the worker
  // also rejects CLAIM from any tab other than the bound work tab.
  if(task.workTabId!==null&&!usePlan()&&['PLAN','GROUP','AD','VERIFY'].includes(task.stage)){
   if(!stageReady(task.stage))return;
   const key=`${task.id}/${task.index}/${task.stage}/${task.resumeCount||0}`;
   if(key===lastRunKey)return;
   lastRunKey=key;
   await runOne(task);
  }
 }catch(e){console.warn('[LoveBatch] poll:',e.message);}
}
document.addEventListener('contextmenu',handleContext,true);
setInterval(poll,950);if(usePlan())renderProgress();
})();
