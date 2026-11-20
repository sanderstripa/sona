/* Install the unchanged signed Firefox VOT package in the user's profile. */
(()=>{
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const {shared,save,isPrivate}=Sona.backend;
const id='vot-ext@firefox',version='1.12.6',base=Sona.dispatch;

async function installed(){
 const addon=await AddonManager.getAddonByID(id);
 return addon?.isBuiltin?null:addon;
}

async function candidate(){
 const file=Services.dirsvc.get('GreD',Ci.nsIFile);
 for(const part of ['sona','optional','vot-'+version+'.xpi'])file.append(part);
 if(!file.exists())throw Error('Компонент VOT отсутствует в сборке.');
 const install=await AddonManager.getInstallForFile(file);
 const addon=install?.addon;
 if(addon?.id!==id||addon.version!==version||!(addon.signedState>=AddonManager.SIGNEDSTATE_SIGNED))
  throw Error('Подпись или версия VOT не прошла проверку Sona.');
 return install;
}

async function setEnabled(addon,enabled){
 if(enabled&&addon.userDisabled)await addon.enable();
 if(!enabled&&!addon.userDisabled)await addon.disable();
 if(enabled&&!addon.isActive)throw Error('Gecko не смог запустить расширение VOT.');
}

async function remember(addon){
 shared.config.settings.videoTranslationEnabled=!!addon?.isActive;
 await save();
}

Sona.votReady=shared.votReady??=(async()=>{
 await AddonManager.readyPromise;
 const addon=await AddonManager.getAddonByID(id);
 // Older builds registered the component on startup. Require explicit
 // consent before replacing that registration with the signed profile copy.
 if(addon?.isBuiltin&&!addon.userDisabled)await addon.disable();
 shared.config.settings.videoTranslationEnabled=!!addon&&!addon.isBuiltin&&addon.isActive;
})().catch(console.error);

Sona.dispatch=async(action,payload,source)=>{
 if(action.startsWith('browser.vot.')||action==='settings.save')await Sona.votReady;
 if(action==='browser.vot.status'){
  const addon=await installed();
  return {installed:!!addon,enabled:!!addon?.isActive,version:addon?.version||version,
   externalService:'Яндекс / серверы VOT',permissions:addon?.userPermissions||(await candidate()).addon.userPermissions};
 }
 if(action==='browser.vot.install'){
  if(isPrivate)throw Error('Установка выполняется в обычном окне.');
  if(payload?.consent!==true||!source?.gesture||Date.now()-source.gesture.at>2000)
   throw Error('Подтвердите разрешения VOT кнопкой установки.');
  if(!shared.votInstall){
   shared.votInstall=(async()=>{
    let addon=await installed();
    if(!addon){
     const install=await candidate();
     await install.install();
     addon=await installed();
    }
    if(!addon)throw Error('Gecko не зарегистрировал подписанное расширение VOT.');
    await setEnabled(addon,true);
    await remember(addon);
    return {installed:true,version:addon.version};
   })().finally(()=>{shared.votInstall=null;});
  }
  return shared.votInstall;
 }
 if(action==='browser.vot.setEnabled'){
  if(isPrivate)throw Error('Настройка VOT выполняется в обычном окне.');
  const addon=await installed();
  if(!addon)throw Error('Сначала установите VOT и подтвердите разрешения.');
  await setEnabled(addon,payload?.enabled===true);
  await remember(addon);
  return {enabled:addon.isActive};
 }
 if(action==='settings.save'&&typeof payload.settings?.videoTranslationEnabled==='boolean'){
  const addon=await installed();
  const enabled=payload.settings.videoTranslationEnabled;
  if(enabled&&!addon)throw Error('Сначала установите VOT через «Настройки перевода YouTube».');
  const changed=addon&&enabled!==addon.isActive;
  if(changed)await setEnabled(addon,enabled);
  try{
   const result=await base(action,payload,source);
   if(!result.ok&&changed)await setEnabled(addon,!enabled);
   return result;
  }catch(error){
   if(changed)await setEnabled(addon,!enabled);
   throw error;
  }
 }
 return base(action,payload,source);
};
})();
