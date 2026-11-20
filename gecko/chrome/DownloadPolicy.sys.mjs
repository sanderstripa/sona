import {state} from 'chrome://sona/content/shared.sys.mjs';
import {Integration} from 'resource://gre/modules/Integration.sys.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
let installed=false;
export function install(){if(installed)return;installed=true;Integration.downloads.register(base=>({__proto__:base,async shouldBlockForParentalControls(download){
 if(await base.shouldBlockForParentalControls(download))return true;
 let host='';try{host=new URL(download.source.referrerInfo?.originalReferrer?.spec||download.source.url).hostname;}catch{}
 const value=state.config?.rules.sites[host]?.downloads??state.config?.rules.defaults.downloads??1;if(Number(value)===0)return false;if(Number(value)===2)return true;
 const win=[...Services.wm.getEnumerator('navigator:browser')].find(w=>!w.closed&&PrivateBrowsingUtils.isWindowPrivate(w)===!!download.source.isPrivate);if(!win)return true;
 const english=state.config?.settings.language==='en';
 const title=english?'Sona — File download':'Sona — загрузка файла';
 const message=host
  ? (english?'Allow this file download from '+host+'?':'Разрешить загрузку файла с сайта '+host+'?')
  : (english?'Allow this file download?':'Разрешить загрузку этого файла?');
 const prompt=Ci.nsIPromptService;
 const flags=prompt.BUTTON_POS_0*prompt.BUTTON_TITLE_IS_STRING+
  prompt.BUTTON_POS_1*prompt.BUTTON_TITLE_CANCEL;
 const confirm=english?'Allow download':'Разрешить';
 return Services.prompt.confirmEx(win,title,message,flags,confirm,null,null,null,{})!==0;
}}));}
