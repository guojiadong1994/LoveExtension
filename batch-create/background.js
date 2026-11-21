/* Batch-create V1: independent runtime Port protocol; legacy background listener untouched. */
'use strict';
(() => {
 const KEY = 'loveBatchV1:active';
 const allowedStages = ['PLAN','GROUP','AD','VERIFY'];
 const nextStage = {PLAN:'GROUP', GROUP:'AD', AD:'VERIFY'};
 // State writes are serialized. A superseded task must never overwrite the new
 // task through a late asynchronous operation (e.g. delayed VERIFY/FAIL).
 let stateWrites=Promise.resolve();
 let startQueue=Promise.resolve();
 const read = async () => (await chrome.storage.session.get(KEY))[KEY] || null;
 function write(task,{replace=false}={}) {
   const operation=stateWrites.catch(()=>{}).then(async()=>{
     const active=await read();
     if(!replace && active?.id!==task.id)
       throw Error('本次任务已经被新批次替换，旧任务不能再写入状态');
     task.updatedAt=Date.now();
     await chrome.storage.session.set({[KEY]:task});
     return task;
   });
   stateWrites=operation.catch(()=>{});
   return operation;
 }
 // Closing a retired, extension-created work tab aborts its old content script.
 // Never close the user's source tab or any tab repurposed for another website.
 async function retirePriorWorkTab(oldTask,newSourceTabId){
   const id=oldTask?.workTabId;
   if(!Number.isInteger(id)||id===newSourceTabId)return;
   try {
     const tab=await chrome.tabs.get(id);
     const url=new URL(tab?.url||'about:blank');
     if(url.origin!=='https://ad.vivo.com.cn'||!url.pathname.startsWith('/marketing/ads/'))return;
     await chrome.tabs.remove(id);
   }catch(error){
     // The old tab may already be gone, or temporarily not removable.
     console.warn('[LoveBatch] old work tab cleanup:',error);
   }
 }

 function checkSender(port) {
   if (port.sender?.frameId !== 0 || !Number.isInteger(port.sender?.tab?.id)) throw Error('只允许 vivo 的主网页脚本执行批量任务');
   const url = new URL(port.sender.url || port.sender.tab.url || 'about:blank');
   if (url.origin !== 'https://ad.vivo.com.cn') throw Error('批量任务仅支持 vivo 营销平台');
   return port.sender.tab.id;
 }
 function event(t, label) { (t.events ||= []).push({at:Date.now(),index:t.index,stage:t.stage,label}); if(t.events.length>80)t.events.shift(); }
 const normalizeName=s=>String(s||'').trim();
 const PLAN_URL = 'https://ad.vivo.com.cn/marketing/promotion/plan';
 // After the LAST ad has been verified, return to the original plan-list tab.
 // Never close the work tab if the original tab cannot be recovered; a failed or
 // stopped task must keep its page so the user can inspect the actual result.
 async function finishAndReturnToPlan(completedTask) {
   const isStillCompleted=async()=>{
     const current=await read();
     return current?.id===completedTask.id && current.status==='completed' &&
       current.sourceTabId===completedTask.sourceTabId && current.workTabId===completedTask.workTabId;
   };
   if(!await isStillCompleted())return;
   try {
     const original=await chrome.tabs.get(completedTask.sourceTabId);
     // Preserve the original plan tab. Restore its URL only if it is still a vivo
     // marketing page but has navigated to another section in the meantime.
     const url=new URL(original.url||'about:blank');
     let sourceId=original.id;
     if(url.origin==='https://ad.vivo.com.cn') {
       const alreadyPlan=url.pathname.replace(/\/$/,'')==='/marketing/promotion/plan';
       if(alreadyPlan) {
         // Re-activate the ORIGINAL plan-list tab, then reload it exactly once.
         // Keeping the same URL preserves any existing query/filter parameters.
         await chrome.tabs.update(sourceId,{active:true});
         await chrome.tabs.reload(sourceId);
       } else {
         // Navigating back to the plan list already triggers a fresh page load.
         await chrome.tabs.update(sourceId,{active:true,url:PLAN_URL});
       }
     } else {
       // The user repurposed the original tab. Do not overwrite an unrelated site.
       const planTab=await chrome.tabs.create({windowId:original.windowId,url:PLAN_URL,active:true});
       sourceId=planTab.id;
     }
     if(original.windowId!==undefined&&chrome.windows?.update) {
       try{await chrome.windows.update(original.windowId,{focused:true});}catch(_){}
     }
     // Give COMPLETE_ONE's response a chance to reach the work page before its
     // tab is removed. The state is already durably saved as completed.
     await new Promise(resolve=>setTimeout(resolve,350));
     if(!await isStillCompleted())return;
     await chrome.tabs.remove(completedTask.workTabId);
   } catch(error) {
     // Completion itself remains successful. A tab/window API failure must not
     // make the extension retry an already-submitted ad or close the only page.
     console.warn('[LoveBatch] return to plan failed:',error);
   }
 }
 async function openWorkTab(task) {
   const created=await chrome.tabs.create({url:'https://ad.vivo.com.cn/marketing/ads/add/0/0',active:true,openerTabId:task.sourceTabId});
   // Another source page may have started a newer batch while this tab opened.
   // Never keep a stale work tab or overwrite the replacement task's checkpoint.
   const active=await read();
   if(active?.id!==task.id){
     await chrome.tabs.remove(created.id).catch(()=>{});
     throw Error('任务打开页面期间已被新任务替换');
   }
   task.workTabId=created.id;
   task.phase='pending';task.stage='PLAN';
   event(task,`已打开第${task.index+1}套的新建页面`);
   return write(task);
 }
 async function dispatch(port,message) {
   const tabId=checkSender(port);let task=await read(); const op=message.op;
   if(op==='GET') {
     if(!task||![task.sourceTabId,task.workTabId].includes(tabId))return {task:null};
     return {task};
   }
   if(op==='START') {
     // Opening the right-click dialog alone does nothing. A VALID START replaces
     // all earlier task states, including running/paused/failed/stopped tasks.
     if(String(message.path||'')!=='/marketing/promotion/plan')throw Error('请从广告计划列表的空白处右键启动');
     const config=message.config||{};
     if(config.planTasks!==undefined){
       if(!Array.isArray(config.planTasks)||!config.planTasks.length||config.planTasks.length>10)
         throw Error('请配置1～10个任务');
       const flattened=[];
       config.planMap=[];
       for(const [taskIndex,group] of config.planTasks.entries()){
         if(!group||!Array.isArray(group.plans)||!group.plans.length)
           throw Error(`任务${taskIndex+1}至少需要一条广告计划`);
         for(const [planIndex,plan] of group.plans.entries()){
           flattened.push(plan);
           config.planMap.push({taskIndex,planIndex});
         }
       }
       if(flattened.length>10)throw Error('整批最多创建10套广告计划');
       config.names=flattened.map(p=>p?.name);
       config.displays=flattened.map(p=>p?.display);
       // Legacy fields stay populated for existing transition/diagnostic code.
       config.planType=config.planTasks[0].planType;
       config.scene=config.planTasks[0].scene;
       config.creativeType=config.planTasks[0].creativeType;
       config.spec=config.planTasks[0].spec;
       config.mediaCount=0;
       config.previewCount=0;
       config.mediaKind='';
       config.autoSubmit=true;
     }
     if(!Array.isArray(config.names)||!config.names.length||config.names.length>10)throw Error('请填写1～10个广告名称');
     config.names=config.names.map(normalizeName);
     if(config.names.some(n=>!n||n.length>200)||new Set(config.names).size!==config.names.length)throw Error('广告名称不能重复、为空或超过200字');
     if(!['商店','非商店','联盟'].includes(config.planType))throw Error('广告计划类型无效');
     if(!['普通投放','极速唤新'].includes(config.scene))throw Error('场景定制无效');
     if(!normalizeName(config.app))throw Error('请选择推广应用');
     if(!normalizeName(config.industry)||!normalizeName(config.product))throw Error('请选择完整的一级行业和二级产品');
     const catalog=(await chrome.storage.local.get('loveBatchV1:applicationCatalog'))['loveBatchV1:applicationCatalog']?.pairs||[];
     if(!catalog.some(p=>p.app===config.app&&p.industry===config.industry&&p.product===config.product) &&
        !catalog.some(p=>{
          if(p.app!==config.app||typeof p.category!=='string')return false;
          const parts=p.category.split(/\s*→\s*/).map(x=>x.trim());
          return parts.length===2&&parts[0]===config.industry&&parts[1]===config.product;
        }))throw Error('应用与两级行业/产品不匹配本地关联列表，请重新选择');
     if(!['不限','未安装','已安装'].includes(config.install))throw Error('安装定向配置无效');
     if(!['按千次展示出价','按点击出价','按转化目标出价'].includes(config.bidMethod))throw Error('出价方式无效');
     if(config.bidMethod==='按转化目标出价'&&!normalizeName(config.goal))throw Error('请选择优化目标');
     if(!Number.isFinite(Number(config.bidAmount))||Number(config.bidAmount)<=0)throw Error('请填写正确的出价金额');
     const allowedDisplays=['开屏','Banner','插屏','原生','激励互动','信息流'];
     // New batches persist a display per name. Older active tasks retain a global display.
     if(config.displays!==undefined){
       if(!Array.isArray(config.displays)||config.displays.length!==config.names.length||config.displays.some(d=>!allowedDisplays.includes(d)))
         throw Error('每条广告必须有对应的有效展现形式，且数量应与名称相同');
     }else if(!allowedDisplays.includes(config.display))throw Error('展现形式无效');
     const typeOptions={
       '开屏':['无图','竖版大图','横版大图'],
       'Banner':['无图','横版大图'],
       '插屏':['无图','竖版大图','横版大图','竖版视频','横版视频'],
       '原生':['无图','小图','竖版大图','横版大图','竖版视频','横版视频','组图'],
       '激励互动':['竖版视频','横版视频'],
       '信息流':['小图','组图','竖版大图','横版大图','竖版视频','横版视频']
     };
     const formats=config.displays??[config.display];
     if(config.planTasks){
       for(const [taskIndex,group] of config.planTasks.entries()){
         if(!['商店','非商店','联盟'].includes(group.planType)||
            !['普通投放','极速唤新'].includes(group.scene))
           throw Error(`任务${taskIndex+1}的计划类型或场景定制无效`);
         if(!['无图','竖版大图','横版大图','小图','组图','竖版视频','横版视频'].includes(group.creativeType))
           throw Error(`任务${taskIndex+1}的创意类型无效`);
         if(!['1080*1920','1080*1880'].includes(group.spec))
           throw Error(`任务${taskIndex+1}的创意规格无效`);
         const kind=group.creativeType.includes('视频')?'video':group.creativeType==='无图'?'':'image';
         if(group.mediaKind!==kind||!Number.isInteger(group.mediaCount)||
            group.mediaCount<0||group.mediaCount>10||(kind&&!group.mediaCount)||(!kind&&group.mediaCount))
           throw Error(`任务${taskIndex+1}素材数量或类型不符合创意类型`);
         if(!Number.isInteger(group.previewCount)||group.previewCount<0||group.previewCount>group.mediaCount||
            (kind!=='video'&&group.previewCount))
           throw Error(`任务${taskIndex+1}的预览图数量或类型无效`);
         if(!Array.isArray(group.previewIndices)||group.previewIndices.length!==group.previewCount||
            new Set(group.previewIndices).size!==group.previewIndices.length||
            group.previewIndices.some(i=>!Number.isInteger(i)||i<0||i>=group.mediaCount))
           throw Error(`任务${taskIndex+1}的预览图与视频对应关系无效`);
         for(const plan of group.plans){
           if(!typeOptions[plan.display]?.includes(group.creativeType))
             throw Error(`任务${taskIndex+1}计划「${plan.name}」展现形式「${plan.display}」不支持「${group.creativeType}」`);
         }
       }
     }else if(formats.some(d=>!typeOptions[d].includes(config.creativeType)))
       throw Error('部分展现形式与公共创意类型不兼容，请修改后重试');
     if(!normalizeName(config.creativeType))throw Error('请选择创意类型');
     if((config.mediaCount||0)>10||(config.previewCount||0)>10)throw Error('素材数量不能超过10');
     if(config.previewCount && config.mediaCount && config.previewCount!==config.mediaCount && formats.includes('激励互动')&&config.creativeType==='竖版视频')throw Error('竖版激励互动：视频和预览图数量必须一致');
     const newId=String(message.taskId||'');
     if(!/^[\w-]{20,80}$/.test(newId)||newId===task?.id)throw Error('任务编号无效或与旧任务重复');
     const prior=task;
     const replacement={id:newId,status:'running',index:0,stage:'PLAN',phase:'pending',sourceTabId:tabId,workTabId:null,
       config,results:[],events:[],startedAt:Date.now(),updatedAt:Date.now(),replacedTaskId:prior?.id||null};
     // Commit replacement only after every user-config validation passed.
     // Late calls from the old job are rejected by the task identity check.
     await write(replacement,{replace:true});
     task=replacement;
     event(task,prior?`已在点击开始后结束上一批次 ${prior.id}，清空旧进度和错误`:'已建立全新批量任务');
     await write(task);
     // Closing the prior worker tab stops the old page from continuing to act.
     // Do this only after the new task state is committed, NEVER on right click.
     await retirePriorWorkTab(prior,tabId);
     try { await openWorkTab(task); }catch(e){task.status='paused';task.phase='paused';task.pausedFrom={stage:'PLAN',phase:'pending'};task.error='工作标签页打开失败：'+e.message;event(task,task.error);await write(task);throw e;}
     return {task,replacedTaskId:prior?.id||null};
   }
   if(!task)throw Error('当前没有可操作的批量任务');
   if(op==='STOP') {
     if(![task.sourceTabId,task.workTabId].includes(tabId))throw Error('无权停止其他页面的任务');
     if(message.taskId && message.taskId!==task.id)throw Error('任务已变化，拒绝停止另一项任务');
     if(!['running','paused','failed'].includes(task.status))throw Error('当前任务已结束，无需停止');
     task.status='stopped';task.phase='done';event(task,message.reason==='close'?'用户点击进度窗 ×，主动停止任务':'用户停止任务');return {task:await write(task)};
   }
   if(op==='PAUSE') {
     if(tabId!==task.workTabId || task.status!=='running')throw Error('只有运行中的任务工作页可以申请人工接管');
     task.pausedFrom={stage:task.stage,phase:task.phase,expectedStage:task.expectedStage||null};
     task.status='paused';task.phase='paused';
     task.error='已暂停，等待人工处理。完成当前页面的必要操作后，点击「继续任务」。';
     event(task,'用户选择人工接管，保留页面与任务检查点');return {task:await write(task)};
   }
   if(op==='FAIL') {
     if(tabId!==task.workTabId)throw Error('只有任务工作页可报告异常');
     if(task.status==='paused')return {task}; // Preserve deliberate pause; never overwrite it.
     if(task.status!=='running')throw Error('任务不在运行状态，拒绝覆盖终止/完成状态');
     task.pausedFrom={stage:task.stage,phase:task.phase,expectedStage:task.expectedStage||null};
     task.status='paused';task.error=String(message.error||'未知错误').slice(0,1400);
     task.phase='paused';event(task,'自动执行异常，已暂停，等待人工处理：'+task.error);
     return {task:await write(task)};
   }
   if(op==='RESUME') {
     if(!['paused','failed'].includes(task.status))throw Error(task.status==='stopped'?'任务已由用户手动停止，不能恢复':'当前任务不处于可恢复状态');
     // Opening the NEXT set can fail after the previous set was verified.
     // A fresh new PLAN tab is safe because this index has not started yet.
     if(task.pausedFrom?.phase==='opening' && [task.sourceTabId,task.workTabId].includes(tabId) &&
       task.index===task.results.length && task.index<task.config.names.length){
       const oldTabId=task.workTabId;
       task.status='running';delete task.error;delete task.pausedFrom;
       task.resumeCount=(task.resumeCount||0)+1;
       try{
         await openWorkTab(task);
         if(oldTabId!==null&&oldTabId!==task.workTabId)await chrome.tabs.remove(oldTabId).catch(()=>{});
       }catch(err){task.status='paused';task.phase='paused';task.pausedFrom={stage:task.stage,phase:'opening'};task.error='重试打开下一套页面失败：'+err.message;await write(task);throw err;}
       return {task};
     }
     // The first tab creation can fail before any plan exists. In that ONLY
     // case reopening a blank PLAN tab is safe, and media handles are retained.
     if(task.workTabId===null && tabId===task.sourceTabId && task.index===0 && task.stage==='PLAN' && !(task.results||[]).length){
       task.status='running';delete task.error;delete task.pausedFrom;task.resumeCount=(task.resumeCount||0)+1;
       try{await openWorkTab(task);}catch(err){task.status='paused';task.phase='paused';task.pausedFrom={stage:'PLAN',phase:'pending'};task.error='重新打开工作页失败：'+err.message;await write(task);throw err;}
       return {task};
     }
     if(tabId!==task.workTabId)throw Error('请在原广告工作标签页手动修复后点击「继续任务」');
     const observed=String(message.observedStage||'');
     const current=task.stage, next=nextStage[current];
     const checkpoint=task.pausedFrom?.phase==='transition'||(task.status==='failed'&&!!task.expectedStage);
     if(!allowedStages.includes(observed))throw Error('未能识别当前广告页面，请先打开正确的创建/核验页面再继续');
     if(checkpoint){
       const expected=task.expectedStage||task.pausedFrom?.expectedStage;
       if(observed===expected){
         // The platform already reached its next stage. No second submit.
         task.stage=expected;task.phase='pending';delete task.expectedStage;delete task.transitionAt;
         delete task.transitionClickIssued;delete task.retryTransition;delete task.manualResumeStage;
         event(task,`已进入 ${expected}，沿用平台结果，不重复保存/提交`);
       }else if(observed===current && expected===next){
         // A human pressing Continue explicitly authorizes ONE stage-local
         // retry, after the work page rechecks the current/next stage. There
         // is NO timer or automatic repeated submit; a further retry needs a
         // separate user click after a new pause.
         task.retryTransition={from:current,to:expected,authorizedAt:Date.now(),
           mayHaveSubmitted:task.transitionClickIssued!==false};
         task.phase='pending';task.manualResumeStage=current;
         delete task.expectedStage;delete task.transitionAt;delete task.transitionClickIssued;
         event(task,`点击「继续任务」：仍在 ${current}，将先复查页面，再由扩展尝试一次${current==='AD'?'最终提交':'保存并继续'}`);
       }else throw Error(`当前页面是 ${observed}，但检查点是 ${current} → ${expected}；请回到当前任务页面或核对平台是否已经保存`);
     }else if(observed===current){
       task.phase='pending';task.manualResumeStage=current;
       // A trusted human may have fixed a dropdown that this site's automation
       // cannot verify. Skip only that failed interaction, NOT later form/save.
       const failure=String(task.error||'');
       task.manualFix=current==='GROUP'&&/行业\/产品|一级行业|二级产品/.test(failure)?'category':
        current==='GROUP'&&/优化目标/.test(failure)?'goal':
        current==='GROUP'&&/选择应用|应用.*选择|推广应用/.test(failure)?'application':
        current==='VERIFY'&&message.manualVerified===true?'verify':null;
       if(task.manualFix)task.manualFixes=[...new Set([...(task.manualFixes||[]),task.manualFix])];
       event(task,`从 ${current} 当前页面恢复${task.manualFixes?.length?'（已人工修复 '+task.manualFixes.join('、')+'，不重复点击）':''}`);
     }else if(next && observed===next){
       // User may have manually completed and saved the entire current step.
       task.stage=next;task.phase='pending';delete task.expectedStage;delete task.transitionAt;delete task.transitionClickIssued;delete task.retryTransition;delete task.manualResumeStage;delete task.manualFix;delete task.manualFixes;
       event(task,`人工已推进到 ${next}；跳过前一阶段，不重复保存/提交`);
     }else throw Error(`页面阶段 ${observed} 与任务检查点 ${current} 不符。请回到当前任务页面，不会重新创建或跳过广告`);
     task.status='running';delete task.error;delete task.pausedFrom;
     task.resumeCount=(task.resumeCount||0)+1;
     return {task:await write(task)};
   }
   if(task.status!=='running')throw Error('当前任务已暂停或结束；必须先点击「继续任务」');
   if(op==='SELECT_CATEGORY_CDP') {
     if(tabId!==task.workTabId || task.stage!=='GROUP' || task.phase!=='busy')
       throw Error('仅允许当前广告组步骤选择行业与产品');
     const industry=normalizeName(message.industry),product=normalizeName(message.product);
     if(!industry||!product||industry!==task.config.industry||product!==task.config.product)
       throw Error('请求的行业/产品与批量任务配置不一致');
     return globalThis.LoveBatchNativeCascader.select(tabId,industry,product);
   }
   if(op==='SELECT_GOAL_CDP') {
     if(tabId!==task.workTabId || task.stage!=='GROUP' || task.phase!=='busy')
       throw Error('仅允许当前广告组步骤使用浏览器级点击');
     const goal=normalizeName(message.goal);
     if(!goal || goal!==normalizeName(task.config.goal))
       throw Error('请求的优化目标与当前批量任务不一致，已停止');
     const result=await globalThis.LoveBatchNativeGoal.select(tabId,goal);
     // The CDP helper verifies the page and the selected option before returning.
     return result;
   }
   if(tabId!==task.workTabId)throw Error('当前网页不是绑定的批量创建标签页');
   if(op==='CLAIM') {
     if(task.stage!==message.stage || task.phase!=='pending' ||!allowedStages.includes(task.stage))throw Error('任务已被执行或阶段不匹配');
     task.phase='busy';event(task,`开始执行 ${task.stage}`);return {task:await write(task)};
   }
   if(op==='PREPARE_TRANSITION') {
     if(task.stage!==message.stage || task.phase!=='busy' || nextStage[task.stage]!==message.to) throw Error('当前创建步骤不允许开始页面切换');
     // Persist BEFORE clicking Save/Submit. A full document navigation may
     // destroy the initiating content-script context. No second click allowed.
     task.phase='transition';task.expectedStage=message.to;task.transitionAt=Date.now();
     task.transitionClickIssued=false;delete task.retryTransition;
     event(task,`准备跳转到 ${message.to}（只点击一次）`);
     return {task:await write(task)};
   }
   if(op==='MARK_TRANSITION_DISPATCH') {
     // Persist the fact that the submit is about to be dispatched, distinct
     // from PREPARE, which only writes a pre-click checkpoint.
     if(task.stage!==message.stage||task.phase!=='transition'||task.expectedStage!==message.to)
       throw Error('提交检查点已变化，禁止发送本次点击');
     if(task.transitionClickIssued)throw Error('当前检查点已经发送过点击，拒绝重复发送');
     task.transitionClickIssued=true;event(task,`即将点击 ${task.stage==='AD'?'最终提交':'保存并继续'}`);
     return {task:await write(task)};
   }
   if(op==='ADVANCE_RETRY_TRANSITION') {
     // Only for the resumed, stage-local click retry; it might have navigated
     // just before the retry began. The work-page caller must see the next stage.
     if(!['busy','pending'].includes(task.phase)||task.stage!==message.stage||task.retryTransition?.from!==message.stage||task.retryTransition?.to!==message.to)
       throw Error('阶段已变化，无法完成恢复核验');
     task.stage=message.to;task.phase='pending';delete task.retryTransition;delete task.manualResumeStage;
     delete task.expectedStage;delete task.transitionAt;delete task.transitionClickIssued;delete task.manualFix;delete task.manualFixes;
     event(task,`恢复时发现平台已进入 ${message.to}，未再次点击保存/提交`);
     return {task:await write(task)};
   }
   if(op==='CONFIRM_TRANSITION') {
     if(task.phase!=='transition'||task.stage!==message.stage||task.expectedStage!==message.to) throw Error('页面切换状态不匹配，不会重复提交');
     task.stage=message.to;task.phase='pending';delete task.expectedStage;delete task.transitionAt;delete task.transitionClickIssued;delete task.retryTransition;delete task.manualResumeStage;delete task.manualFix;delete task.manualFixes;
     event(task,`已核验进入 ${message.to}`);return {task:await write(task)};
   }
   if(op==='COMPLETE_ONE') {
     if(task.stage!=='VERIFY'||task.phase!=='busy')throw Error('尚未验证提交成功，不可跳到下一套');
     if(message.manualVerified===true && task.manualFix!=='verify')throw Error('仅允许明确人工核验并确认后的列表核验跳过');
     task.results.push({name:task.config.names[task.index], status:message.manualVerified===true?'manually-verified':'verified',at:Date.now(), url:String(message.pageUrl||'').slice(0,250)});
     event(task,`第${task.index+1}套验证成功`);
     const oldTabId=task.workTabId;
     if(task.index+1===task.config.names.length){delete task.manualResumeStage;delete task.manualFix;delete task.manualFixes;task.status='completed';task.stage='DONE';task.phase='done';event(task,'所有广告已验证完成，返回广告计划页并关闭本次工作标签页');await write(task);return {task};}
     task.index++;delete task.manualResumeStage;delete task.manualFix;delete task.manualFixes;task.phase='opening';await write(task);
     // A fresh work tab for each set: no cross-set DOM residue or accidental reuse.
     try { await openWorkTab(task); await chrome.tabs.remove(oldTabId).catch(()=>{}); }
     catch(err){ task.pausedFrom={stage:task.stage,phase:'opening'};task.status='paused';task.phase='paused';task.error='下一套页面打开失败：'+err.message;event(task,task.error);await write(task);}
     return {task};
   }
   throw Error('未知批量任务操作');
 }
 chrome.tabs.onRemoved.addListener(async id => {
   try { const task=await read();if(['running','paused'].includes(task?.status)&&(task.workTabId===id||task.sourceTabId===id)){task.pausedFrom={stage:task.stage,phase:task.phase,expectedStage:task.expectedStage||null};task.status='paused';task.phase='paused';task.error='任务依赖的标签页已关闭，请恢复原创建页面后核对进度；扩展不会重复创建或自动关闭其他页面。';event(task,task.error);await write(task);} }catch(err){console.warn('[LoveBatch] tab removed:',err);} 
 });
 chrome.runtime.onConnect.addListener(port => {
   if(port.name!=='LOVE_BATCH_V1')return;
   port.onMessage.addListener(async message => {
     const reply={rid:message?.rid};
     try {
       if(message?.op==='START') {
         // Multiple plan tabs may click Start nearly simultaneously; serialize
         // replacement so at most one task remains authoritative.
         const operation=startQueue.catch(()=>{}).then(()=>dispatch(port,message||{}));
         startQueue=operation.catch(()=>{});
         reply.data=await operation;
       } else reply.data=await dispatch(port,message||{});
       reply.ok=true;
     }catch(e){reply.ok=false;reply.error=e?.message||String(e);}
     try {port.postMessage(reply);}catch(_){}
     // Reply first: removing the work tab before replying would disconnect the
     // Port, causing the content script to report a false failure after success.
     if(message?.op==='COMPLETE_ONE' && reply.ok && reply.data?.task?.status==='completed') {
       await finishAndReturnToPlan(reply.data.task);
     }
   });
 });
})();
