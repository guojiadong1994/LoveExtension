/* LoveExtension batch-create application -> industry -> product catalog.
 * Version 2 preserves ambiguous legacy entries for user review. Metadata only.
 */
(() => {
'use strict';
if (globalThis.LoveBatchCatalog) return;
const KEY='loveBatchV1:applicationCatalog';
const trim=s=>String(s==null?'':s).trim().replace(/\s+/g,' ');
const keyOf=p=>JSON.stringify([p.app,p.industry,p.product,p.legacyCategory||'']);
const pairValue=p=>JSON.stringify([p.industry,p.product]);
function normalize(items){
 if(!Array.isArray(items))throw Error('关联列表必须是数组');
 if(items.length>500)throw Error('最多保存500条应用与行业/产品关联');
 const result=[],seen=new Set(),defaults=new Set();
 for(const input of items){
   const app=trim(input?.app);
   let industry=trim(input?.industry),product=trim(input?.product),legacyCategory='';
   if(!industry&&!product&&typeof input?.category==='string'){
     const raw=trim(input.category);
     // Only the unambiguous two-level arrow syntax can be migrated automatically.
     const segments=raw.split(/\s*→\s*/);
     if(segments.length===2&&segments.every(s=>trim(s))){
       industry=trim(segments[0]);product=trim(segments[1]);
     }else{legacyCategory=raw;}
   }else if(!industry&&!product&&input?.legacyCategory){legacyCategory=trim(input.legacyCategory);}
   if(!app||app.length>200||industry.length>200||product.length>200||legacyCategory.length>300)
     throw Error('应用、行业、产品名称长度不符合要求');
   if(!(industry&&product)&&!legacyCategory)throw Error('必须提供完整的一级行业和二级产品');
   if(!!industry!==!!product)throw Error('一级行业和二级产品必须同时填写');
   const entry={app,industry,product,isDefault:!!input?.isDefault};
   if(legacyCategory)entry.legacyCategory=legacyCategory;
   if(legacyCategory)entry.isDefault=false;
   const key=keyOf(entry);
   if(seen.has(key))throw Error(`关联列表存在重复项：${app} / ${industry||legacyCategory}`);
   seen.add(key);
   if(entry.isDefault){
     if(defaults.has(app))throw Error(`推广应用「${app}」只能设置一条默认关联`);
     defaults.add(app);
   }
   result.push(entry);
 }
 return result;
}
async function load(){
 const item=(await chrome.storage.local.get(KEY))[KEY];
 return normalize(item?.pairs||[]);
}
async function save(items){
 const pairs=normalize(items);
 await chrome.storage.local.set({[KEY]:{version:2,pairs,updatedAt:Date.now()}});
 return pairs;
}
const apps=items=>[...new Set(items.map(p=>p.app))];
const choices=(items,app)=>items.filter(p=>p.app===app&&p.industry&&p.product);
const categories=(items,app)=>choices(items,app).map(p=>`${p.industry} → ${p.product}`);
function preferred(items,app,previous=''){
 const matches=choices(items,app);
 if(matches.some(p=>pairValue(p)===previous))return previous;
 if(matches.length===1)return pairValue(matches[0]);
 const d=matches.find(p=>p.isDefault);
 return d?pairValue(d):'';
}
globalThis.LoveBatchCatalog=Object.freeze({KEY,load,save,normalize,apps,choices,categories,preferred,pairValue,keyOf});
})();
