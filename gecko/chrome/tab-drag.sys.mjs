/* One process-wide gesture owns a live Gecko tab, even across remote frames. */
const {setInterval,clearInterval}=ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
const {tabDragPointer}=ChromeUtils.importESModule('chrome://sona/content/window-controls.sys.mjs');
const {PrivateBrowsingUtils}=ChromeUtils.importESModule('resource://gre/modules/PrivateBrowsingUtils.sys.mjs');
export const DETACH_MARGIN=26;
let gesture=null;
function rows(win){return (win.Sona?.tabDragLayout||[]).filter(r=>Number.isFinite(r.x)&&r.width>0&&r.height>0);}
function emit(win,value){if(!win.closed)win.Sona?.native.send('tabDrag',value);}
function local(win,p){const f=win.document.getElementById('sona-shell-frame').getBoundingClientRect();return {x:p.x-win.mozInnerScreenX-f.x,y:p.y-win.mozInnerScreenY-f.y};}
function bounds(win){const list=rows(win);if(!list.length)return null;return {left:Math.min(...list.map(r=>r.x)),right:Math.max(win.innerWidth-140,...list.map(r=>r.x+r.width)),top:Math.min(...list.map(r=>r.y)),bottom:Math.max(...list.map(r=>r.y+r.height))};}
function compatible(a,b){return PrivateBrowsingUtils.isWindowPrivate(a)===PrivateBrowsingUtils.isWindowPrivate(b);}
function preview(d,p){
 const win=d.owner,list=rows(win),point=local(win,p),id=win.Sona.native.tabID(d.tab),own=list.find(r=>r.id===id);
 if(!own)return;
 const peers=list.filter(r=>r.id!==id&&win.Sona.native.tabs.get(r.id)?.pinned===d.tab.pinned);
 d.previewed=true;d.before=peers.find(r=>point.x<r.x+r.width/2)?.id??null;
 const order=list.map(r=>r.id),old=order.indexOf(id);order.splice(old,1);
 const at=d.before===null?Math.max(0,...peers.map(r=>order.indexOf(r.id)+1)):order.indexOf(d.before);order.splice(at,0,id);
 const shifts={};for(const r of peers){const i=list.findIndex(x=>x.id===r.id),j=order.indexOf(r.id);shifts[r.id]=j>i?own.width+4:j<i?-own.width-4:0;}
 emit(win,{id,dx:point.x-d.offsetX-own.x,shifts});
}
function commit(d){
 const win=d.owner;if(win.closed||d.tab.closing)return;
 const target=win.Sona.native.tabs.get(d.before);
 if(target&&!target.closing&&target!==d.tab)win.gBrowser.moveTabBefore(d.tab,target);
 else {const peers=[...win.gBrowser.tabs].filter(t=>t!==d.tab&&!t.closing&&t.pinned===d.tab.pinned);if(peers.length)win.gBrowser.moveTabAfter(d.tab,peers.at(-1));}
 win.Sona.notify();
}
function finish(commitOrder=true){const d=gesture;if(!d)return;gesture=null;clearInterval(d.timer);if(commitOrder&&d.active&&d.previewed&&!d.detached)commit(d);emit(d.owner,null);}
async function detach(d,p){
 if(d.pending)return;d.pending=true;emit(d.owner,null);
 // Gecko swaps the live browser, preserving history, forms and media state.
 const old=d.owner;
 if(old.gBrowser.tabs.length===1){d.detached=true;d.pending=false;return;}
 const win=old.gBrowser.replaceTabWithWindow(d.tab);
 if(!win){d.pending=false;throw Error('Tab detachment failed');}
 d.detached=true;
 const deadline=Date.now()+15000;
 const ready=()=>{
  if(gesture!==d||win.closed)return;
  if(Date.now()>deadline){finish(false);return;}
  if(!win.Sona?.native||!win.Sona?.ready||!rows(win).length){d.wait=win.setTimeout(ready,16);return;}
  d.owner=win;d.tab=win.gBrowser.selectedTab;d.pending=false;d.previewed=false;
  if(win.windowState===win.STATE_MAXIMIZED)win.restore();
  win.moveTo(p.x-d.windowOffsetX,p.y-d.windowOffsetY);win.focus();
 };
 ready();
}
function merge(d,target,p){
 const old=d.owner,point=local(target,p),list=rows(target),before=list.find(r=>point.x<r.x+r.width/2);
 const anchor=target.Sona.native.tabs.get(before?.id),index=anchor?anchor._tPos:target.gBrowser.tabs.length;
 // Do not close the source ourselves: adoptTab closes its empty window only
 // after the browser swap succeeds. Failed adoption leaves the source intact.
 const tab=target.gBrowser.adoptTab(d.tab,{tabIndex:index,selectTab:true});if(!tab)return;
 emit(old,null);d.owner=target;d.tab=tab;d.detached=false;d.before=null;
 target.focus();target.Sona.notify();if(!old.closed)old.Sona?.notify();preview(d,p);
}
function tick(d){
 if(gesture!==d)return;
 if(!d.pending&&(d.owner.closed||d.tab.closing)){finish(false);return;}
 const p=tabDragPointer(d.owner);
 if(!p.down||p.escape){finish(!p.escape);return;}
 if(d.pending)return;
 if(!d.active){if(Math.hypot(p.x-d.startX,p.y-d.startY)<6)return;d.active=true;}
 const ownerBounds=bounds(d.owner),ownerPoint=local(d.owner,p);
 const mayMerge=d.detached||ownerBounds&&(ownerPoint.y<ownerBounds.top-DETACH_MARGIN||ownerPoint.y>ownerBounds.bottom+DETACH_MARGIN);
 const candidates=Services.wm.getZOrderDOMWindowEnumerator?.('navigator:browser',true)||[...Services.wm.getEnumerator('navigator:browser')].reverse();
 for(const win of mayMerge?candidates:[]){
  if(win===d.owner||win.closed||!win.Sona?.ready||win.__sonaClosing||!compatible(d.owner,win)||win.windowState===win.STATE_MINIMIZED)continue;
  const b=bounds(win);if(!b)continue;const q=local(win,p);
  if(q.x>=b.left-12&&q.x<=b.right+40&&q.y>=b.top&&q.y<=b.bottom){merge(d,win,p);return;}
 }
 if(d.detached){d.owner.moveTo(p.x-d.windowOffsetX,p.y-d.windowOffsetY);return;}
 const b=bounds(d.owner),q=local(d.owner,p);if(!b)return;
 if(q.y<b.top-DETACH_MARGIN||q.y>b.bottom+DETACH_MARGIN){
  const own=rows(d.owner).find(r=>r.id===d.owner.Sona.native.tabID(d.tab));
  d.windowOffsetX=(own?.x||0)+d.offsetX;d.windowOffsetY=(own?.y||0)+d.offsetY;
  detach(d,p).catch(e=>{console.error(e);finish(false);});return;
 }
 preview(d,p);
}
export function begin(win,tab,payload){
 finish();if(Services.appinfo.OS!=='WINNT')return false;
 win.Sona.tabDragLayout=payload.layout;
 const p=tabDragPointer(win);if(!p.down)return false;
 const d=gesture={owner:win,tab,startX:p.x,startY:p.y,offsetX:payload.offsetX,offsetY:payload.offsetY,before:null,active:false,detached:false,pending:false};
 d.timer=setInterval(()=>{try{tick(d);}catch(error){console.error(error);finish(false);}},16);
 return true;
}
// Dragging the title area of a one-tab window uses the same merge session.
export function beginWindow(win){
 const tabs=[...win.gBrowser.tabs].filter(t=>!t.closing);if(tabs.length!==1||Services.appinfo.OS!=='WINNT')return false;
 finish();const p=tabDragPointer(win);if(!p.down)return false;
 if(win.windowState===win.STATE_MAXIMIZED)return false;
 const d=gesture={owner:win,tab:tabs[0],startX:p.x,startY:p.y,offsetX:20,offsetY:20,windowOffsetX:p.x-win.screenX,windowOffsetY:p.y-win.screenY,before:null,active:true,detached:true,pending:false};
 d.timer=setInterval(()=>{try{tick(d);}catch(error){console.error(error);finish(false);}},16);return true;
}
