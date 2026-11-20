/* Sample the visible page at the edges of the chrome. Keep the live viewport
 * below the toolbar and to the right of the bookmarks sidebar. */
(()=>{
 const root=document.documentElement;
 const {PageThumbs}=ChromeUtils.importESModule('resource://gre/modules/PageThumbs.sys.mjs');
 if(!Sona.backend.shared.pageGlassActorRegistered){
  ChromeUtils.registerWindowActor('SonaPageGlass',{
   parent:{esModuleURI:'chrome://sona/content/PageGlassParent.sys.mjs'},
   child:{esModuleURI:'chrome://sona/content/PageGlassChild.sys.mjs',events:{scroll:{capture:true}}},
   matches:['http://*/*','https://*/*'],remoteTypes:['web'],allFrames:false,safeForUntrustedWebProcess:true,
  });
  Sona.backend.shared.pageGlassActorRegistered=true;
 }
 const canvas=id=>{
  const node=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
  node.id=id;node.setAttribute('aria-hidden','true');root.append(node);
  return node;
 };
 const top=canvas('sona-page-glass'),left=canvas('sona-bookmarks-glass');
 let timer=0,capturing=false,dirty=false,atTop=true,activeGlobal=null;
 const clear=node=>{node.hidden=true;node.width=0;};
 const eligible=()=>root.hasAttribute('sona-page-glass')&&!root.hasAttribute('inDOMFullscreen')&&!root.hasAttribute('sona-fullscreen');
 const schedule=()=>{
  if(!eligible())return;
  dirty=true;
  if(!timer&&!capturing)timer=setTimeout(paint,140);
 };
 async function paint(){
  timer=0;dirty=false;
  const browser=gBrowser.selectedBrowser;
  const global=browser.browsingContext.currentWindowGlobal;
  const sidebar=root.hasAttribute('sona-bookmarks-open');
  if(!eligible()||!global||(!sidebar&&atTop))return;
  const rect=browser.getBoundingClientRect(),scale=.2;
  if(!rect.width||!rect.height)return;
  const sample=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
  sample.width=Math.ceil(rect.width*scale);
  sample.height=Math.ceil(rect.height*scale);
  capturing=true;
  try{
   await PageThumbs.captureToCanvas(browser,sample,{fullViewport:true,targetWidth:sample.width},true);
   if(global!==browser.browsingContext.currentWindowGlobal||browser!==gBrowser.selectedBrowser||!eligible())return;
   const draw=(node,width,height)=>{
    node.width=Math.max(1,Math.round(width*sample.width/rect.width));
    node.height=Math.max(1,Math.round(height*sample.height/rect.height));
    node.getContext('2d').drawImage(sample,0,0,Math.min(node.width,sample.width),
     Math.min(node.height,sample.height),0,0,node.width,node.height);
    node.hidden=false;
   };
   if(!atTop)draw(top,rect.width,rect.top);
   if(root.hasAttribute('sona-bookmarks-open'))draw(left,rect.left,rect.height);
  }catch(error){console.debug('Sona glass sample unavailable',String(error));}
  finally{capturing=false;if(dirty)schedule();}
 }
 function update(){
  const browser=gBrowser.selectedBrowser,uri=browser.currentURI;
  const enabled=!!Sona.config.settings.mattePanel&&['http','https'].includes(uri.scheme);
  root.toggleAttribute('sona-home',uri.spec===Sona.native.homeURL);
  root.toggleAttribute('sona-page-glass',enabled);
  const global=browser.browsingContext.currentWindowGlobal;
  if(!enabled||global!==activeGlobal){
   activeGlobal=global;atTop=true;clear(top);clear(left);
  }
  if(enabled&&global){
   Promise.resolve().then(()=>global.getActor('SonaPageGlass').sendQuery('atTop')).then(value=>{
    if(global!==activeGlobal||!eligible())return;
    atTop=value;if(atTop)clear(top);schedule();
   }).catch(()=>{});
  }
  Sona.native.send('pageGlass',enabled);
  Sona.notify();
 }
 Sona.pageGlassScroll=(browser,data)=>{
  if(browser!==gBrowser.selectedBrowser||!eligible())return;
  if(data.document)atTop=data.atTop;
  if(atTop)clear(top);
  schedule();
 };
 const observer=new MutationObserver(()=>{
  if(!root.hasAttribute('sona-bookmarks-open'))clear(left);
  if(!eligible()){clear(top);clear(left);}
  else schedule();
 });
 observer.observe(root,{attributes:true,attributeFilter:['sona-bookmarks-open','sona-fullscreen','inDOMFullscreen']});
 clear(top);clear(left);
 const refresh=Sona.refresh;
 Sona.refresh=()=>{refresh();update();};
 window.addEventListener('resize',schedule);
 window.addEventListener('unload',()=>{observer.disconnect();clearTimeout(timer);},{once:true});
 gBrowser.tabContainer.addEventListener('TabSelect',update);
 gBrowser.addTabsProgressListener({
  onLocationChange(browser,progress){if(browser===gBrowser.selectedBrowser&&progress.isTopLevel)update();},
  onStateChange(browser,progress,_request,flags){
   if(browser===gBrowser.selectedBrowser&&progress.isTopLevel&&(flags&Ci.nsIWebProgressListener.STATE_STOP))schedule();
  },
 });
 update();
})();
