const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let source=fs.readFileSync('gecko/chrome/tab-drag.sys.mjs','utf8').replace(/^const \{.*ChromeUtils.importESModule.*;$/gm,'').replace(/export /g,'');
let pointer={x:40,y:20,down:true},windows=[],interval,events=[];
const make=(name,n=3,priv=false)=>{
 const w={name,closed:false,screenX:0,screenY:0,mozInnerScreenX:0,mozInnerScreenY:0,devicePixelRatio:1,windowState:0,STATE_MINIMIZED:2,STATE_MAXIMIZED:1,priv,focus(){},moveTo(x,y){this.screenX=this.mozInnerScreenX=x;this.screenY=this.mozInnerScreenY=y;},setTimeout(fn){fn();},document:{getElementById(){return {getBoundingClientRect:()=>({x:0,y:0})};}}};
 let id=1;w.gBrowser={tabs:Array.from({length:n},()=>({id:id++,pinned:false,closing:false})),moveTabBefore(t,a){this.tabs.splice(this.tabs.indexOf(t),1);this.tabs.splice(this.tabs.indexOf(a),0,t);},moveTabAfter(t,a){this.tabs.splice(this.tabs.indexOf(t),1);this.tabs.splice(this.tabs.indexOf(a)+1,0,t);},adoptTab(t,{tabIndex:i,selectTab}){assert.equal(selectTab,true);for(const s of windows){const at=s.gBrowser.tabs.indexOf(t);if(at>=0){s.gBrowser.tabs.splice(at,1);if(!s.gBrowser.tabs.length)s.closed=true;}}this.tabs.splice(i,0,t);return t;}};
 w.gBrowser.selectedTab=w.gBrowser.tabs[0];w.Sona={ready:true,notify(){},tabDragLayout:w.gBrowser.tabs.map((t,i)=>({id:t.id,x:i*100,y:0,width:96,height:40})),native:{tabID:t=>t.id,tabs:new Map(w.gBrowser.tabs.map(t=>[t.id,t])),send:(n,v)=>events.push([w,n,v])}};windows.push(w);return w;
};
const context={console,Services:{appinfo:{OS:'WINNT'},wm:{getEnumerator:()=>windows}},PrivateBrowsingUtils:{isWindowPrivate:w=>w.priv},tabDragPointer:()=>pointer,setInterval:fn=>(interval=fn,1),clearInterval:()=>{},Date};vm.createContext(context);vm.runInContext(source+';globalThis.api={begin,beginWindow,finish};',context);
let w=make('source');const tab=w.gBrowser.tabs[0];
context.api.begin(w,tab,{layout:w.Sona.tabDragLayout,offsetX:40,offsetY:20});
pointer={x:280,y:41,down:true};interval();assert.equal(w.gBrowser.tabs[0],tab);assert.equal(events.at(-1)[2].dx,240);assert.ok(events.at(-1)[2].shifts[2]<0);
pointer.down=false;interval();assert.equal(w.gBrowser.tabs.at(-1),tab,'reorder commits at release');
// The 26px deadzone extends beyond both boundaries, not the grab point.
windows=[];events=[];w=make('source');let detached=0;
w.gBrowser.replaceTabWithWindow=t=>{detached++;const next=make('detached',0);next.gBrowser.tabs=[t];next.gBrowser.selectedTab=t;next.Sona.tabDragLayout=[{id:t.id,x:0,y:0,width:96,height:40}];w.gBrowser.tabs.splice(w.gBrowser.tabs.indexOf(t),1);return next;};
pointer={x:40,y:20,down:true};context.api.begin(w,w.gBrowser.tabs[0],{layout:w.Sona.tabDragLayout,offsetX:40,offsetY:20});
pointer.y=66;interval();assert.equal(detached,0);pointer.y=67;interval();assert.equal(detached,1);const detachedWindow=windows.at(-1);assert.equal(detachedWindow.gBrowser.tabs.length,1);
pointer={x:40,y:20,down:true};interval();assert.equal(detachedWindow.closed,true,'empty detached window closes after adoption');assert.equal(w.gBrowser.tabs.length,3);
pointer.down=false;interval();
// Never merge private and ordinary windows; single-tab windows stay alive.
windows=[];w=make('single',1);const privateWindow=make('private',1,true);pointer={x:40,y:20,down:true};assert.equal(context.api.beginWindow(w),true);interval();assert.equal(w.closed,false);assert.equal(privateWindow.gBrowser.tabs.length,1);pointer.down=false;interval();
console.log('Tab drag: reorder, animated gap, deadzone, live detach, merge, privacy and last-tab checks passed');

// A background window at the same position must not steal in-bar drags.
windows=[];w=make('front');const back=make('back');pointer={x:40,y:20,down:true};context.api.begin(w,w.gBrowser.tabs[0],{layout:w.Sona.tabDragLayout,offsetX:40,offsetY:20});pointer.x=80;interval();assert.equal(w.gBrowser.tabs.length,3);assert.equal(back.gBrowser.tabs.length,3);pointer.down=false;interval();
