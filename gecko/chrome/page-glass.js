/* Sample the visible page at the edges of the chrome. Keep the live viewport
 * below the toolbar and to the right of the bookmarks sidebar. */
(()=>{
 const root=document.documentElement;
 if(!Sona.backend.shared.pageGlassActorRegistered){
  ChromeUtils.registerWindowActor('SonaPageGlass',{
   parent:{esModuleURI:'chrome://sona/content/PageGlassParent.sys.mjs'},
   child:{esModuleURI:'chrome://sona/content/PageGlassChild.sys.mjs'},
   matches:['http://*/*','https://*/*'],remoteTypes:['web'],allFrames:false,safeForUntrustedWebProcess:true,
  });
  Sona.backend.shared.pageGlassActorRegistered=true;
 }
 const canvas=id=>{
  const node=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
  node.id=id;node.setAttribute('aria-hidden','true');root.append(node);
  return node;
 };
 const top=canvas('sona-page-glass');
 let timer=0,capturing=false,dirty=false,viewport=null,activeGlobal=null;
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
  const view=viewport;
  if(!eligible()||!global||!view||view.y<=0)return;
  const rect=browser.getBoundingClientRect(),scale=.2;
  if(!rect.width||!rect.height||!view.width||!view.height)return;
  capturing=true;
  try{
   const image=await browser.drawSnapshot(view.x,view.y,view.width,view.height,
    scale,root.hasAttribute('sona-dark')?'#08090b':'#f6f6f8');
   if(!image)return;
   try{
    if(global!==browser.browsingContext.currentWindowGlobal||
       browser!==gBrowser.selectedBrowser||!eligible())return;
    const draw=(node,width,height)=>{
     node.width=Math.max(1,Math.round(width*image.width/rect.width));
     node.height=Math.max(1,Math.round(height*image.height/rect.height));
     node.getContext('2d').drawImage(image,0,0,Math.min(node.width,image.width),
      Math.min(node.height,image.height),0,0,node.width,node.height);
     node.hidden=false;
    };
    if(viewport?.y>0)draw(top,rect.width,rect.top);
   }finally{image.close();}
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
   activeGlobal=global;viewport=null;clear(top);
  }
  if(enabled&&global){
   Promise.resolve().then(()=>global.getActor('SonaPageGlass').sendQuery('viewport')).then(value=>{
    if(global!==activeGlobal||!eligible())return;
    Sona.pageGlassScroll(browser,value);
   }).catch(()=>{});
  }
  Sona.native.send('pageGlass',enabled);
  Sona.notify();
 }
 Sona.pageGlassScroll=(browser,data)=>{
  if(browser!==gBrowser.selectedBrowser||!eligible()||!data)return;
  viewport=data;
  if(data.y<=0)clear(top);
  schedule();
 };
 const observer=new MutationObserver(()=>{
  if(!eligible()){clear(top);}
  else update();
 });
 observer.observe(root,{attributes:true,attributeFilter:['sona-bookmarks-open','sona-fullscreen','inDOMFullscreen','sona-desktop-glass']});
 clear(top);
 const refresh=Sona.refresh;
 Sona.refresh=()=>{refresh();update();};
 window.addEventListener('resize',update);
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
