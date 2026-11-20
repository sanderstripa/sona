/* Manage the unchanged signed VOT extension and its per-profile consent. */
(()=>{
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const {shared,save,isPrivate}=Sona.backend;
const id='vot-ext@firefox',version='1.12.6',base=Sona.dispatch;

async function installed(){
 const addon=await AddonManager.getAddonByID(id);
 return addon ?? null;
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
 if(enabled)await useManualTranslation(addon);
}

async function useManualTranslation(addon){
 const policy=WebExtensionPolicy.getByID(addon.id);
 await policy?.readyPromise;
 const extension=policy?.extension;
 if(!extension)throw Error('Gecko не загрузил настройки расширения VOT.');
 const {ExtensionStorageIDB}=ChromeUtils.importESModule('resource://gre/modules/ExtensionStorageIDB.sys.mjs');
 const {ExtensionStorage}=ChromeUtils.importESModule('resource://gre/modules/ExtensionStorage.sys.mjs');
 const defaults={autoTranslate:false,buttonPos:'default'};
 const backend=await ExtensionStorageIDB.selectBackend({extension});
 if(!backend.backendEnabled){
  await ExtensionStorage.set(addon.id,defaults);
  return;
 }
 const db=await ExtensionStorageIDB.open(ExtensionStorageIDB.getStoragePrincipal(extension),extension.hasPermission('unlimitedStorage'));
 const changes=await db.set(defaults);
 if(changes)ExtensionStorageIDB.notifyListeners(addon.id,changes);
}

async function installSigned(){
 const install=await candidate();
 try{await install.install();}
 catch(error){
  console.error('Sona VOT installation failed',install.error,error);
  const reason=install.error===AddonManager.ERROR_FILE_ACCESS
   ?'Gecko не смог записать расширение в профиль.'
   :'Gecko отклонил установку расширения.';
  throw Error(reason+' Код Gecko: '+install.error+'.');
 }
 return installed();
}

async function remember(addon){
 shared.config.settings.videoTranslationEnabled=!!addon?.isActive;
 await save();
}

Sona.votReady=shared.votReady??=(async()=>{
 await AddonManager.readyPromise;
 const addon=await AddonManager.getAddonByID(id);
 if(!addon){
  shared.config.settings.videoTranslationEnabled=false;
  return;
 }
 // Profile installs already passed the consent dialog in earlier releases.
 const consent=shared.config.votConsent??!addon.isBuiltin;
 const enabled=consent&&(shared.config.votConsent ? shared.config.settings.videoTranslationEnabled : !addon.userDisabled);
 await setEnabled(addon,enabled);
 shared.config.settings.videoTranslationEnabled=enabled;
})().catch(error=>console.error('Sona VOT startup',error));

Sona.dispatch=async(action,payload,source)=>{
 if(action.startsWith('browser.vot.')||action==='settings.save'||action==='settings.begin')await Sona.votReady;
 if(action==='browser.vot.status'){
  const registered=await installed();
  const addon=registered?.isBuiltin&&!shared.config.votConsent?null:registered;
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
    if(!addon)addon=await installSigned();
    else if(addon.isBuiltin)await candidate();
    if(!addon)throw Error('Gecko не зарегистрировал подписанное расширение VOT.');
    await setEnabled(addon,true);
    shared.config.votConsent=true;
    await remember(addon);
    return {installed:true,version:addon.version};
   })().finally(()=>{shared.votInstall=null;});
  }
  return shared.votInstall;
 }
 if(action==='browser.vot.setEnabled'){
  if(isPrivate)throw Error('Настройка VOT выполняется в обычном окне.');
  const addon=await installed();
  if(!addon||addon.isBuiltin&&!shared.config.votConsent)throw Error('Сначала установите VOT и подтвердите разрешения.');
  await setEnabled(addon,payload?.enabled===true);
  await remember(addon);
  return {enabled:addon.isActive};
 }
 if(action==='settings.save'&&typeof payload.settings?.videoTranslationEnabled==='boolean'){
  const addon=await installed();
  const enabled=payload.settings.videoTranslationEnabled;
  if(enabled&&(!addon||addon.isBuiltin&&!shared.config.votConsent))throw Error('Сначала установите VOT через «Настройки перевода YouTube».');
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
