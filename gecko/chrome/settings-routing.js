/* Route the engine's preferences entry points into Sona's existing settings. */
(()=>{
 function section(value){if(/addons/.test(value||''))return 'extensions';if(/logins/.test(value||''))return 'passwords';return /privacy|permission/i.test(value||'')?'sites':/search/i.test(value||'')?'search':'general';}
 window.openPreferences=(pane)=>Sona.settings(section(pane));
 const switchTab=window.switchToTabHavingURI;
 if(switchTab)window.switchToTabHavingURI=function(uri,...args){if(/^about:(?:preferences|settings|logins)(?:[?#]|$)/i.test(typeof uri==='string'?uri:uri?.spec||'')){Sona.settings(section(String(uri)));return null;}return switchTab.call(this,uri,...args);};
 const original=window.openTrustedLinkIn;
 window.openTrustedLinkIn=function(url,where,params){if(/^about:(?:preferences|settings|logins)(?:[?#]|$)/i.test(String(url))){Sona.settings(section(String(url)));return;}return original.call(this,url,where,params);};
 gBrowser.addTabsProgressListener({onLocationChange(browser,_progress,_request,location){if(!/^about:(?:preferences|settings|logins)(?:[?#]|$)/i.test(location.spec))return;browser.stop();browser.loadURI(Services.io.newURI('about:blank'),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});Sona.settings(section(location.spec));}});

 // Settings' hidden browser is warmed with a 2.5s idle timeout. Start that
 // warmup promptly after the shell is ready so the first open does not wait
 // for an idle period; leave other callers' idle scheduling untouched.
 const requestIdle=window.requestIdleCallback;
 if(requestIdle)window.requestIdleCallback=function(callback,options){
  if(options?.timeout===2500)return window.setTimeout(()=>callback({didTimeout:true,timeRemaining:()=>0}),0);
  return requestIdle.call(this,callback,options);
 };

 const dispatch=Sona.dispatch;
 Sona.dispatch=async function(action,payload,source){
  if(action==='browser.home'){
   const settings=Sona.config?.settings;
   if(settings?.homeMode==='custom'&&/^https?:\/\//i.test(settings.homeUrl||''))return dispatch('browser.navigate',settings.homeUrl,source);
  }
  if(action==='browser.closeTab'){
   const wasSelected=Number(payload)===Sona.native?.tabID(gBrowser.selectedTab);
   const result=await dispatch(action,payload,source);
   if(wasSelected)window.setTimeout(()=>{if(!window.closed&&gBrowser.selectedBrowser&&!gBrowser.selectedTab?.closing)gBrowser.selectedBrowser.focus();},60);
   return result;
  }
  return dispatch(action,payload,source);
 };
})();
