/* Gecko's Places and NSS stores; the frontend receives no privileged objects. */
(() => {
const {shared,Services,IOUtils,PathUtils,PlacesUtils,profile,isPrivate,save}=Sona.backend;
let cache=null;shared.bookmarkSerial??=Math.max(0,...Object.values(shared.config.bookmarkIds||{}));
const guidToId=guid=>{const map=shared.config.bookmarkIds??={};if(!map[guid])map[guid]=++shared.bookmarkSerial;return map[guid];};
const hydrated=new WeakSet();
function hydrate(rows){if(hydrated.has(rows))return;hydrated.add(rows);let index=0,changed=false;const worker=async()=>{while(index<rows.length){const row=rows[index++];if(!row.url||row.favicon)continue;try{const icon=await PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(row.url),32);if(!icon?.rawData?.length||icon.rawData.length>65536)continue;let binary='';for(const byte of icon.rawData)binary+=String.fromCharCode(byte);row.favicon='data:'+icon.mimeType+';base64,'+btoa(binary);changed=true;}catch{}}};Promise.all(Array.from({length:8},worker)).then(()=>{if(changed&&cache===rows)Sona.dispatch('browser.bookmarks.get').catch(console.error);});}
const idToGuid=id=>Object.keys(shared.config.bookmarkIds||{}).find(g=>shared.config.bookmarkIds[g]===Number(id));
async function read(){const root=await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.rootGuid);const output=[];function walk(nodes,parentId=0){for(const node of nodes||[]){if(node.type===PlacesUtils.TYPE_X_MOZ_PLACE_SEPARATOR)continue;const id=guidToId(node.guid);output.push({id,guid:node.guid,type:node.type===PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER?'folder':node.uri?'url':'folder',title:node.title||node.uri||'',url:node.uri||'',parentId,order:node.index||0,favicon:node.iconuri||'',createdAt:node.dateAdded/1000||Date.now()});walk(node.children,id);}}for(const nativeRoot of root.children||[])walk(nativeRoot.children);await save();return output;}
function webURL(value) {
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)
  throw Error('Введите адрес HTTP или HTTPS.');
 return url.href;
}

async function changeBookmark({kind,id,parentId,beforeId,afterId,title,url,folder}){
 const bookmarks=PlacesUtils.bookmarks;
 const lookup=async key=>{
  const guid=idToGuid(key);
  const item=guid&&await bookmarks.fetch(guid);
  if(!item)throw Error('Элемент закладок уже изменён или удалён.');
  return item;
 };
 const item=id?await lookup(id):null;
 if(kind==='remove'&&item){
  await bookmarks.remove(item.guid);
  return item.guid;
 }
 if(!['save','move'].includes(kind)||kind==='move'&&!item)throw Error('Неизвестное действие с закладкой.');

 const before=beforeId||afterId?await lookup(beforeId||afterId):null;
 const parent=parentId?await lookup(parentId):null;
 if(parent&&parent.type!==bookmarks.TYPE_FOLDER)throw Error('Выберите папку.');
 const roots=[bookmarks.toolbarGuid,bookmarks.menuGuid,bookmarks.unfiledGuid,bookmarks.mobileGuid];
 const parentGuid=parent?.guid||before?.parentGuid||
  (item&&roots.includes(item.parentGuid)?item.parentGuid:bookmarks.toolbarGuid);
 if(before&&(before.guid===item?.guid||before.parentGuid!==parentGuid))
  throw Error('Место назначения изменилось. Повторите перемещение.');
 const index=before
  ? before.index+Number(Boolean(afterId))-Number(item?.parentGuid===parentGuid&&item.index<before.index)
  : bookmarks.DEFAULT_INDEX;

 if(item?.type===bookmarks.TYPE_FOLDER&&parent){
  let ancestor=parent;
  while(ancestor){
   if(ancestor.guid===item.guid)throw Error('Папку нельзя переместить внутрь неё самой.');
   ancestor=ancestor.parentGuid?await bookmarks.fetch(ancestor.parentGuid):null;
  }
 }
 if(kind==='move'){
  await bookmarks.update({guid:item.guid,parentGuid,index});
  return item.guid;
 }
 const fields={title:String(title||'').trim().slice(0,4096)};
 if(!fields.title)throw Error('Введите название.');
 if(!folder && (url!==item?.url?.href||item.parentGuid!==parentGuid)){
  if(url!==item?.url?.href)fields.url=webURL(url);
  let duplicate=false;
  await bookmarks.fetch({url:fields.url||item.url},row=>{duplicate ||= row.parentGuid===parentGuid&&row.guid!==item?.guid;});
  if(duplicate)throw Error('В этой папке уже есть закладка с таким адресом.');
 }
 if(item){
  const placement=item.parentGuid===parentGuid?{}:{parentGuid,index};
  await bookmarks.update({guid:item.guid,...placement,...fields});
  return item.guid;
 }
 return (await bookmarks.insert({parentGuid,index,...fields,type:folder?bookmarks.TYPE_FOLDER:bookmarks.TYPE_BOOKMARK})).guid;
}

async function importChromiumBookmarks(roots) {
 if(!roots||Array.isArray(roots)||typeof roots!=='object')throw Error('Нужен стандартный Chromium Bookmarks JSON.');
 const bookmarks=PlacesUtils.bookmarks;
 let count=0;
 function normalize(nodes,depth=0){
  if(depth>64)throw Error('Слишком глубокая вложенность закладок.');
  return nodes.flatMap(node=>{
   if(++count>20000)throw Error('Слишком много закладок.');
   if(!node||typeof node!=='object')return [];
   if(Array.isArray(node.children))
    return [{title:String(node.name||'Импорт').slice(0,4096),children:normalize(node.children,depth+1)}];
   if(node.type!=='url'||typeof node.url!=='string')return [];
   let url;
   try{url=webURL(node.url);}catch{return [];}
   return [{url,title:String(node.name||url).slice(0,4096)}];
  });
 }
 const items=normalize(Object.values(roots));
 if(!items.some(item=>item.children))throw Error('Файл не содержит папок Chromium.');

 let imported=0;
 async function append(nodes,parentGuid){
  if(!nodes.length)return;
  const byKey=new Map();
  const key=(title,url)=>JSON.stringify([title,url||'']);
  await bookmarks.fetch({parentGuid},item=>{
   if(item.type===bookmarks.TYPE_FOLDER||item.type===bookmarks.TYPE_BOOKMARK)
    byKey.set(key(item.title,item.url?.href),item);
  });
  for(const node of nodes){
   const id=key(node.title,node.url);
   let item=byKey.get(id);
   if(!item){
    item=await bookmarks.insert({parentGuid,title:node.title,
     ...(node.url?{url:node.url}:{type:bookmarks.TYPE_FOLDER})});
    byKey.set(id,item);
    imported++;
   }
   if(node.children)await append(node.children,item.guid);
  }
 }
 await append(items,bookmarks.toolbarGuid);
 return imported;
}

Sona.readingList=({kind,url,read},pageURL,title)=>{
 const path=PathUtils.join(profile,'sona-reading-list.json');
 const run=async()=>{
  if(isPrivate){
   if(kind==='get')return [];
   throw Error('Список для чтения доступен в обычном окне.');
  }
  let rows;
  try{rows=await IOUtils.readJSON(path);}catch(error){
   if(error.name!=='NotFoundError')throw error;
   rows=[];
  }
  if(!Array.isArray(rows))throw Error('Не удалось прочитать список для чтения.');
  if(kind==='get')return rows;
  url=webURL(kind==='add'?pageURL:url);
  if(kind==='add'){
   if(rows.some(row=>row.url===url))return rows;
   rows.unshift({url,title:String(title||url).slice(0,4096),read:false});
  }else if(kind==='remove'){
   rows=rows.filter(row=>row.url!==url);
  }else if(kind==='mark'){
   rows=rows.map(row=>row.url===url?{...row,read:read===true}:row);
  }else throw Error('Неизвестное действие со списком для чтения.');
  await IOUtils.writeJSON(path,rows,{tmpPath:path+'.tmp',permissions:0o600});
  return rows;
 };
 const result=(shared.readingQueue||Promise.resolve()).then(run);
 shared.readingQueue=result.catch(()=>{});
 return result;
};

Sona.bookmarks=async(operation,payload)=>{
 const task=async()=>{
  if(operation==='invalidate'){cache=null;return true;}
  if(operation==='get'){if(!cache)cache=await read();hydrate(cache);return structuredClone(cache);}
  if(operation==='importChromium'){
   try{return await importChromiumBookmarks(payload);}
   finally{cache=null;}
  }
  if(operation==='change'){
   const guid=await changeBookmark(payload);
   cache=await read();
   hydrate(cache);
   return {id:cache.find(row=>row.guid===guid)?.id,rows:structuredClone(cache)};
  }
  if(operation==='add'){const u=new URL(payload.url);if(!['http:','https:'].includes(u.protocol))throw Error('Закладки доступны для HTTP/HTTPS-страниц.');await PlacesUtils.bookmarks.insert({parentGuid:PlacesUtils.bookmarks.toolbarGuid,url:u.href,title:payload.title||u.hostname});}
  else if(operation==='remove'){const guid=idToGuid(payload);if(guid)await PlacesUtils.bookmarks.remove(guid);}
  else if(operation==='replace'){
   if(!Array.isArray(payload)||payload.length>20000)throw Error('Invalid bookmarks');const ids=new Set(payload.map(r=>r.id));if(ids.size!==payload.length)throw Error('Duplicate bookmark IDs');
   for(const row of payload){if(!Number.isSafeInteger(row.id)||row.id<1)throw Error('Invalid bookmark ID');if(row.type!=='folder'&&!/^https?:\/\//.test(row.url||''))throw Error('Invalid bookmark URL');let parent=row.parentId,seen=new Set([row.id]);while(parent){if(seen.has(parent))throw Error('Bookmark folder cycle');seen.add(parent);const p=payload.find(r=>r.id===parent&&r.type==='folder');if(!p)throw Error('Missing bookmark folder');parent=p.parentId;}}
   const previousRows=cache||await read(),removed=new Set(previousRows.filter(row=>!ids.has(row.id)).map(row=>row.id));
   for(const old of previousRows)if(removed.has(old.id)&&!removed.has(old.parentId)){if(await PlacesUtils.bookmarks.fetch(old.guid))await PlacesUtils.bookmarks.remove(old.guid);}
   const done=new Set();async function upsert(row){if(done.has(row.id))return;const parent=payload.find(r=>r.id===row.parentId);if(parent)await upsert(parent);const guid=idToGuid(row.id);let existing=guid?await PlacesUtils.bookmarks.fetch(guid):null;const previous=(cache||[]).find(r=>r.id===row.id);const parentGuid=parent?idToGuid(parent.id):previous?.parentId===0&&existing?existing.parentGuid:PlacesUtils.bookmarks.toolbarGuid;const data={parentGuid,index:PlacesUtils.bookmarks.DEFAULT_INDEX,title:String(row.title||'').slice(0,4096),...(row.type==='folder'?{}:{url:row.url})};if(existing){const change={guid};if(existing.parentGuid!==parentGuid){change.parentGuid=parentGuid;change.index=PlacesUtils.bookmarks.DEFAULT_INDEX;}if(existing.title!==data.title)change.title=data.title;if(row.type!=='folder'&&String(existing.url)!==row.url)change.url=row.url;if(Object.keys(change).length>1)await PlacesUtils.bookmarks.update(change);}else{const b=await PlacesUtils.bookmarks.insert({...data,type:row.type==='folder'?PlacesUtils.bookmarks.TYPE_FOLDER:PlacesUtils.bookmarks.TYPE_BOOKMARK});(shared.config.bookmarkIds??={})[b.guid]=row.id;shared.bookmarkSerial=Math.max(shared.bookmarkSerial,row.id);}done.add(row.id);}for(const row of payload)await upsert(row);const parents=new Set(payload.map(row=>row.parentId||0));for(const parentId of parents){const children=payload.filter(row=>(row.parentId||0)===parentId).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));const before=(cache||[]).filter(row=>(row.parentId||0)===parentId).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));if(JSON.stringify(before.map(r=>r.id))===JSON.stringify(children.map(r=>r.id)))continue;const groups=new Map();for(const row of children){const item=await PlacesUtils.bookmarks.fetch(idToGuid(row.id));if(!item)continue;if(!groups.has(item.parentGuid))groups.set(item.parentGuid,[]);groups.get(item.parentGuid).push(item.guid);}for(const [guid,ids] of groups)await PlacesUtils.bookmarks.reorder(guid,ids);}
  }else throw Error('Unknown bookmark operation');
  cache=await read();hydrate(cache);return structuredClone(cache);
 };
 const result=(shared.bookmarkQueue||Promise.resolve()).then(task);shared.bookmarkQueue=result.catch(()=>{});return result;
};
Sona.history=async(operation,payload={},source)=>{
 if(operation==='state'){const s=shared.config.settings;return {language:s.language,resolvedTheme:s.theme==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):s.theme,incognito:isPrivate,profileName:shared.config.profile,saveHistory:s.saveHistory!==false,groupDays:s.historyGroupDays!==false,filter:'all',openClear:source?.location.search.includes('clear=1')};}
 if(isPrivate){if(operation==='query')return {rows:[],more:false};throw Error('История не сохраняется в инкогнито.');}
 const db=await PlacesUtils.promiseDBConnection();
 if(operation==='query'){
  const limit=Math.max(1,Math.min(200,payload.limit||100)),offset=Math.max(0,Number(payload.offset)||0);
  const rows=await db.executeCached('SELECT h.id,p.url,p.title,h.visit_date FROM moz_historyvisits h JOIN moz_places p ON p.id=h.place_id WHERE p.url LIKE :web AND h.visit_date>=:begin AND h.visit_date<=:end AND (p.url LIKE :q OR p.title LIKE :q) ORDER BY h.visit_date DESC LIMIT :limit OFFSET :offset',{begin:Math.max(0,Number(payload.begin)||0)*1000,end:Math.min(Date.now()+1,Number(payload.end)||Date.now()+1)*1000,web:'http%',q:'%'+String(payload.search||'').slice(0,512)+'%',limit:limit+1,offset});
  return {more:rows.length>limit,rows:rows.slice(0,limit).map(r=>({id:r.getResultByName('id'),url:r.getResultByName('url'),title:r.getResultByName('title')||'',visited:r.getResultByName('visit_date')/1000,favicon:''}))};
 }
 if(operation==='open'){if(!/^https?:/.test(payload.url))throw Error('Invalid history URL');if(payload.newTab)openTrustedLinkIn(payload.url,'tab');else gBrowser.selectedBrowser.loadURI(Services.io.newURI(payload.url),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});return true;}
 if(operation==='remove'){
  const rows=await db.executeCached('SELECT p.url,h.visit_date FROM moz_historyvisits h JOIN moz_places p ON p.id=h.place_id WHERE h.id=:id',{id:Number(payload.id)});if(rows.length){const url=rows[0].getResultByName('url'),time=rows[0].getResultByName('visit_date')/1000;await PlacesUtils.history.removeVisitsByFilter({url,beginDate:new Date(Math.floor(time)),endDate:new Date(Math.ceil(time)+1)});}return true;
 }
 if(operation==='clear'){
  if((payload.sites||payload.cache)&&!payload.webAllTimeAcknowledged)throw Error('Подтвердите удаление данных сайтов за всё время.');
  if(payload.history){const spans={'15m':900e3,hour:3600e3,day:86400e3,week:604800e3,month:2419200e3};if(payload.range==='all')await PlacesUtils.history.clear();else{const span=spans[payload.range];if(!span)throw Error('Invalid history range');await PlacesUtils.history.removeVisitsByFilter({beginDate:new Date(Date.now()-span),endDate:new Date()});}}
  let flags=0;if(payload.sites)flags|=Ci.nsIClearDataService.CLEAR_COOKIES|Ci.nsIClearDataService.CLEAR_DOM_STORAGES;if(payload.cache)flags|=Ci.nsIClearDataService.CLEAR_ALL_CACHES;if(flags)await new Promise((resolve,reject)=>Services.clearData.deleteData(flags,failed=>failed?reject(Error('Не удалось очистить часть данных.')):resolve()));return {ok:true};
 }
 throw Error('Unknown history operation');
};
const base=Sona.dispatch;
Sona.dispatch=async(action,payload,source)=>{
 if(action.startsWith('browser.passwords.')){
  const op=action.slice('browser.passwords.'.length),all=await Services.logins.getAllLogins();
  if(op==='get')return all.filter(l=>!l.hostname.startsWith('chrome:')).map(l=>({id:l.guid,origin:l.hostname,username:l.username}));
  const login=all.find(l=>l.guid===payload||l.guid===payload?.id);
  if(op==='reveal'){if(!login)throw Error('Запись не найдена.');return login.password;}
  if(op==='copy'){if(!login)throw Error('Запись не найдена.');const value=payload.field==='password'?login.password:login.username;Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(value);return true;}
  if(op==='remove'){if(login)await Services.logins.removeLoginAsync(login);return Sona.dispatch('browser.passwords.get');}
  if(op==='add'){if(isPrivate)throw Error('Пароли не сохраняются в инкогнито.');const u=new URL(payload.origin);if(!['http:','https:'].includes(u.protocol)||!payload.password)throw Error('Invalid password record');const record=Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);record.init(u.origin,u.origin,null,payload.username,payload.password,'','');const prior=payload.id?all.find(l=>l.guid===payload.id):all.find(l=>l.hostname===u.origin&&l.username===payload.username);if(payload.id&&!prior)throw Error('Запись изменилась.');if(prior)await Services.logins.modifyLoginAsync(prior,record);else await Services.logins.addLoginAsync(record);return Sona.dispatch('browser.passwords.get');}
 }
 return base(action,payload,source);
};
Sona.storageReady=Promise.resolve();
})();
