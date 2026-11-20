/* Manage the unchanged signed VOT extension and its per-profile consent. */
(()=>{
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const {ExtensionParent}=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
const {shared,save,isPrivate}=Sona.backend;
const id='vot-ext@firefox',version='1.12.6',base=Sona.dispatch;

async function installed(){
 const addon=await AddonManager.getAddonByID(id);
 return addon?.isBuiltin ? null : addon;
}

async function candidate(){
 const file=Services.dirsvc.get('GreD',Ci.nsIFile);
 for(const part of ['sona','optional','vot-'+version+'.xpi'])file.append(part);
 if(!file.isFile())throw Error('Компонент VOT отсутствует в сборке.');
 const install=await AddonManager.getInstallForFile(file);
 const addon=install?.addon;
 if(addon?.id!==id||addon.version!==version||!(addon.signedState>=AddonManager.SIGNEDSTATE_SIGNED)){
  if(install?.state===AddonManager.STATE_DOWNLOADED)await install.cancel();
  throw Error('Подпись или версия VOT не прошла проверку Sona.');
 }
 return install;
}

async function setEnabled(addon,enabled){
 if(enabled&&addon.userDisabled)await addon.enable();
 if(!enabled&&!addon.userDisabled)await addon.disable();
 if(enabled&&!addon.isActive)throw Error('Не удалось включить VOT в Sona.');
 if(enabled){
  try{await useManualTranslation(addon);}
  catch(error){console.error('Sona could not update VOT playback defaults',error);}
 }
}

async function useManualTranslation(addon){
 const policy=WebExtensionPolicy.getByID(addon.id);
 await policy?.readyPromise;
 const extension=ExtensionParent.GlobalManager.getExtension(addon.id);
 if(!extension)throw Error('VOT extension runtime is unavailable');
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
 let install;
 try{
  install=await candidate();
  await install.install();
  const addon=await installed();
  if(!addon)throw Error('The signed VOT profile registration is missing');
  return addon;
 }catch(error){
  console.error('Sona VOT setup',install?.error,error);
  if(install?.error===AddonManager.ERROR_FILE_ACCESS)
   throw Error('Не удалось записать VOT в профиль Sona.');
  throw Error('Не удалось установить VOT. Попробуйте ещё раз.');
 }
}

async function remember(addon){
 shared.config.settings.videoTranslationEnabled=!!addon?.isActive;
 await save();
}

Sona.votReady=shared.votReady??=(async()=>{
 await AddonManager.readyPromise;
 let addon=await AddonManager.getAddonByID(id);
 const consent=shared.config.votConsent??(!!addon&&!addon.isBuiltin);
 const enabled=consent&&(shared.config.votConsent
  ? shared.config.settings.videoTranslationEnabled===true
  : !!addon&&!addon.userDisabled);
 shared.config.settings.videoTranslationEnabled=false;
 if(addon?.isBuiltin){
  if(!addon.userDisabled)await addon.disable();
  addon=null;
 }
 // A legacy built-in registration can retain a resource URL from an old installation.
 // Keep the existing consent and install the signed profile package in its place.
 if(!addon&&enabled)addon=await installSigned();
 if(addon){
  await setEnabled(addon,enabled);
  shared.config.settings.videoTranslationEnabled=addon.isActive;
 }
})().catch(error=>console.error('Sona VOT startup',error));

Sona.dispatch=async(action,payload,source)=>{
 if(action.startsWith('browser.vot.')||action==='settings.save'||action==='settings.begin')await Sona.votReady;
 if(action==='browser.vot.status'){
  const addon=await installed();
  let permissions=addon?.userPermissions;
  if(!addon){
   try{
    const install=await candidate();
    permissions=install.addon.userPermissions;
    await install.cancel();
   }catch(error){
    console.error('Sona VOT package check',error);
    throw Error('Не удалось проверить пакет VOT в сборке Sona.');
   }
  }
  return {installed:!!addon,enabled:!!addon?.isActive,version:addon?.version||version,
   externalService:'Яндекс / серверы VOT',permissions};
 }
 if(action==='browser.vot.install'){
  if(isPrivate)throw Error('Установка выполняется в обычном окне.');
  if(payload?.consent!==true||!source?.gesture||Date.now()-source.gesture.at>2000)
   throw Error('Подтвердите разрешения VOT кнопкой установки.');
  if(!shared.votInstall){
   shared.votInstall=(async()=>{
    const addon=await installed()??await installSigned();
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
