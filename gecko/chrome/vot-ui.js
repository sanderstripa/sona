/* Sona consent/settings; VOT itself owns the compact controls on videos. */
(()=>{
if(!location.pathname.endsWith('/settings.html'))return;
const invoke=(action,payload)=>new Promise((resolve,reject)=>cefQuery({request:JSON.stringify({action,payload}),onSuccess:s=>resolve(JSON.parse(s)),onFailure:(_,e)=>reject(Error(e))}));
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
window.sonaVideoSettings={open(){sonaSettings.dialog('Перевод YouTube · VOT',box=>{
 const status=el('p','Проверка расширения VOT…');status.setAttribute('role','status');
 const note=el('p','VOT передаёт адрес видео и данные запроса внешним серверам Яндекса/VOT. Это отдельная функция от локального перевода страниц Sona. Запустите видео и нажмите «Перевести» над плеером; громкость, язык и возврат оригинального звука регулируются там же.');note.className='note';
 const details=el('details'),summary=el('summary','Разрешения компонента');details.append(summary);const permissions=el('pre');permissions.style.cssText='white-space:pre-wrap;max-height:160px;overflow:auto;font:inherit';details.append(permissions);
 const consent=el('input');consent.type='checkbox';consent.id='gecko-vot-consent';const label=el('label');label.append(consent,document.createTextNode('Разрешаю установить VOT и обращаться к внешнему сервису перевода.'));
 const install=el('button','Установить VOT');install.type='button';install.id='gecko-vot-install';install.disabled=true;
 consent.onchange=()=>install.disabled=!consent.checked;install.onclick=async()=>{install.disabled=true;status.textContent='Проверка подписи расширения…';try{const r=await invoke('browser.vot.install',{consent:consent.checked});status.textContent='VOT '+r.version+' установлен. Откройте или обновите страницу видео.';await sonaSettings.reload();}catch(e){status.textContent=e.message;install.disabled=false;}};
 box.append(note,status,details,label,install);
 invoke('browser.vot.status').then(r=>{permissions.textContent=JSON.stringify(r.permissions,null,2);status.textContent=r.installed?'VOT '+r.version+(r.enabled?' включён.':' отключён.'):'Подписанный VOT готов к установке после согласия.';if(r.installed){label.hidden=install.hidden=true;const toggle=el('button',r.enabled?'Отключить VOT':'Включить VOT');toggle.type='button';toggle.onclick=async()=>{toggle.disabled=true;try{await invoke('browser.vot.setEnabled',{enabled:!r.enabled});await sonaSettings.reload();document.getElementById('actionDialog').close();}catch(e){status.textContent=e.message;toggle.disabled=false;}};box.append(toggle);}}).catch(e=>{status.textContent=e.message;install.disabled=true;});
 });}};
const watch=()=>{
 const toggle=document.getElementById('videoTranslationEnabled');
 if(!toggle)return;
 const change=toggle.onchange;
 toggle.disabled=true;
 const askForConsent=()=>{
  toggle.checked=false;
  window.sonaVideoSettings.open();
 };
 invoke('browser.vot.status').then(({installed,enabled})=>{
  toggle.checked=enabled;
  toggle.onchange=installed?change:askForConsent;
  toggle.title=installed?'Озвучка через VOT':'Установить VOT';
  toggle.disabled=false;
 }).catch(()=>{
  toggle.checked=false;
  toggle.onchange=askForConsent;
  toggle.disabled=false;
 });
};
new MutationObserver(watch).observe(document.getElementById('sectionContent'),{childList:true});
})();
