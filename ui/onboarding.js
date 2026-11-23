(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const request=(action,payload=null)=>new Promise((resolve,reject)=>window.cefQuery({request:JSON.stringify({action,payload}),persistent:false,onSuccess:v=>resolve(v?JSON.parse(v):null),onFailure:(_,m)=>reject(Error(m))}));
  const invoke=(action,payload)=>request('onboarding.'+action,payload);
  let flow={},sources=[],busy=false,vpnDraft='',activeProfileId='';
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
  const image=(src,className)=>{const n=el('img',null,className);n.src=src;n.alt='';return n;};
  function symbol(kind){
    const paths={bookmark:'M6 3h12v18l-6-4-6 4V3Z',clock:'M12 7v5l4 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',key:'M14 3a7 7 0 1 1-4 13l-6 6H1v-3l6-6a7 7 0 0 1 7-10Z M16 7h.01',shield:'M12 2 21 6v6c0 5-5 8-9 10-4-2-9-5-9-10V6l9-4Z',lock:'M6 10h12v11H6V10Z M8 10V6a4 4 0 0 1 8 0v4'};
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('line-icon');
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[kind]);svg.append(path);return svg;
  }
  const report=e=>{$('message').textContent=e.message||String(e);};
  async function run(fn){if(busy)return;busy=true;document.querySelector('main').setAttribute('aria-busy','true');disable();try{await fn();}catch(e){report(e);}finally{busy=false;document.querySelector('main').setAttribute('aria-busy','false');disable();}}
  function disable(){document.querySelectorAll('button,input').forEach(n=>{n.disabled=busy||n.dataset.unavailable==='true';});}
  const persist=async patch=>{flow=await invoke('progress',{...patch,step:patch.step||flow.step||1});};
  const parseVpn=()=>window.souluParseVpnKey(vpnDraft);
  const go=async step=>{await persist({step});render();$('title').focus();};
  function button(text,fn,kind=''){const n=el('button',text,kind);n.type='button';n.onclick=()=>run(fn);return n;}
  function note(text){$('controls').append(el('p',text,'note'));}
  function check(parent,text,checked,onChange,options={}){
    const row=el('label',null,options.className||'row');
    if(options.icon)row.append(image(options.icon));
    if(options.symbol){const icon=el('span',null,'symbol');icon.append(symbol(options.symbol));row.append(icon);}
    const copy=el('span',null,'copy');copy.append(el('strong',text));if(options.detail)copy.append(el('small',options.detail));
    const input=el('input');input.type=options.radio?'radio':'checkbox';input.checked=checked;
    input.setAttribute('aria-label',text);if(options.radio)input.name='source';
    if(options.symbol==='shield'||options.symbol==='lock'){input.setAttribute('role','switch');input.setAttribute('aria-checked',String(checked));}
    input.dataset.unavailable=String(!!options.disabled);input.disabled=!!options.disabled;
    input.onchange=()=>run(async()=>{await onChange(input.checked);render(false);});
    row.append(copy,input);parent.append(row);
  }
  function art(step){const container=$('art');container.replaceChildren();
    if(step===4){container.append(el('div',null,'glass-shield'),el('div',null,'orbit'));return;}
    if(step===5){const tunnel=el('div',null,'tunnel');tunnel.append(el('div',null,'glass-shield'));container.append(tunnel);return;}
    container.append(image('branding/sona-512.png','hero-logo'));
    if(step===2||step===3){const data=el('div',null,'data-art');for(const kind of ['bookmark','clock','key']){const tile=el('span');tile.append(symbol(kind));data.append(tile);}container.append(data);}
  }
  function summary(){const ul=el('ul',null,'summary');
    const values=[flow.privacyApplied?'Приватность настроена':'Приватность: текущие настройки сохранены',flow.vpnAdded?'VPN добавлен':'VPN можно добавить позже'];
    const successes=[flow.privacyApplied,flow.vpnAdded];
    values.forEach((text,i)=>{const li=el('li',null,successes[i]?'':'pending');li.append(el('span',successes[i]?'✓':'—'),document.createTextNode(text));ul.append(li);});$('controls').append(ul);
  }
  function render(clearMessage=true){
    const focused=clearMessage?null:document.activeElement?.getAttribute('aria-label');
    const step=flow.step||1;art(step);$('counter').textContent=`${step} из 6`;
    $('controls').replaceChildren();$('actions').replaceChildren();if(clearMessage)$('message').textContent='';
    const titles=['Добро пожаловать в Sona Preview','Импортировать данные','Что перенести?','Приватность и защита','Встроенный VPN','Всё готово — добро пожаловать в Sona Preview'];
    const source=sources.find(s=>s.id===flow.source);
    const descriptions=['Спокойный браузер с чистым интерфейсом, вкладками, закладками и приватностью под твоим контролем.',sources.length?'Найдены браузеры на этом устройстве. Выбери, откуда перенести данные в Sona Preview.':'Поддерживаемые браузеры для импорта не найдены.',`Выбери, какие данные импортировать из ${source?.browser||'выбранного браузера'}.`,'Базовые настройки, которые можно изменить позже.','Добавь ключ подключения сейчас или настрой позже.','Базовые параметры настроены. Остальное можно изменить в настройках в любой момент.'];
    $('title').textContent=titles[step-1];$('description').textContent=descriptions[step-1];
    if(step===6&&!flow.privacyApplied)$('description').textContent='Первичная настройка завершена. Остальное можно изменить в настройках в любой момент.';
    const actions=$('actions'),controls=$('controls');
    const finish=skip=>invoke('finish',{skip});
    if(step===1){note('Первичная настройка займёт пару минут.');actions.append(button('Начать',()=>go(2),'primary'),button('Не сейчас',()=>finish(true)));}
    if(step===2){
      for(const s of sources)check(controls,`${s.browser} · ${s.name}`,flow.source===s.id,()=>persist({source:s.id}),{icon:s.icon,radio:true});
      if(sources.length)controls.append(button('Начать с чистого листа',()=>go(4),'link'));
      actions.append(button('Назад',()=>go(1)),button('Пропустить',()=>go(4)),button(sources.length?'Далее':'Выбрать файл',()=>go(3),'primary'));
    }
    if(step===3){
      if(source){
        const chip=el('div',null,'source-chip');
        if(source.icon)chip.append(image(source.icon));
        chip.append(document.createTextNode(`${source.browser} · ${source.name}`));
        controls.append(chip);
      }
      note('Можно выбрать профиль браузера или файл с данными.');
      actions.append(button('Назад',()=>go(2)),button('Продолжить',()=>go(4)),
        button('Открыть импорт',()=>openImport(source?.id),'primary'));
    }
    if(step===4){controls.className='privacy';
      check(controls,'Блокировать рекламу',flow.adblock,v=>persist({adblock:v}),{symbol:'shield',detail:'Скрывать рекламные элементы на сайтах.'});
      check(controls,'Проверять разрешения сайтов',flow.askPermissions,v=>persist({askPermissions:v}),{symbol:'lock',detail:'Показывать запросы на доступ к камере, микрофону и геолокации. Если выключено — запрещать доступ.'});
      note('Расширенные правила и исключения доступны в настройках.');
      actions.append(button('Назад',()=>go(3)),button('Пропустить',()=>go(5)),button('Продолжить',async()=>{await invoke('privacy');flow.privacyApplied=true;await go(5);},'primary'));
    }else controls.className='';
    if(step===5){const input=el('input',null,'vpn-input');input.id='vpnKey';input.type='password';input.autocomplete='off';input.placeholder='Вставь ключ или ссылку подключения';input.setAttribute('aria-label','Ключ подключения VPN');input.value=vpnDraft;input.maxLength=16384;input.oninput=()=>{vpnDraft=input.value;$('message').textContent='';};controls.append(input);
      note('Поддерживаются ключи Xray (VLESS) и Sudoku');
      controls.append(button('Проверить ключ',()=>{parseVpn();$('message').textContent='Формат ключа распознан. При добавлении его проверит VPN backend. Подключение не запускается.';},'link'));
      actions.append(button('Назад',()=>go(4)),button('Пропустить',()=>go(6)),button('Добавить',async()=>{const parsed=parseVpn();const result=await invoke('vpn',parsed);if(result?.ok===false)throw Error(result.error||'Ключ не сохранён');flow.vpnAdded=true;vpnDraft='';await go(6);},'primary'));
    }
    if(step===6){summary();note('Если хочешь, можно сразу сделать Sona Preview браузером по умолчанию.');controls.lastChild.classList.add('divider');
      actions.append(button('Не сейчас',()=>finish(false)),button('Сделать браузером по умолчанию',async()=>{const result=await invoke('default');if(!result.ok)throw Error('Не удалось открыть стандартные приложения Windows');$('message').textContent=result.message;},'primary'),button('Открыть Sona Preview',()=>finish(false),'link'));
    }
    disable();
    if(focused)for(const n of document.querySelectorAll('input'))if(n.getAttribute('aria-label')===focused)n.focus();
  }
  async function reload(){const state=await invoke('get');flow=state.flow;sources=state.sources;activeProfileId=state.activeProfileId;
    if(!sources.some(source=>source.id===flow.source))flow.source=sources[0]?.id||'';
    if(flow.adblock===undefined)flow.adblock=state.policy.blocking.enabled;
    if(flow.askPermissions===undefined)flow.askPermissions=['camera','microphone','geolocation','notifications'].every(k=>state.policy.defaults[k]===1);
  }
  function openImport(sourceHint){
    return window.souluBrowserImport.open({
      sourceHint,
      currentProfileOnly:true,
      api:{
        getState:async()=>({activeProfileId,profiles:[{id:activeProfileId,name:'Текущий профиль'}]}),
        browserImport:(action,payload)=>request('browser.import.'+action,payload)
      },
      ui:{
        t:ru=>ru,
        el,
        button:(text,fn,kind)=>{
          const control=el('button',text,kind);
          control.type='button';
          control.onclick=()=>Promise.resolve().then(fn).catch(report);
          return control;
        },
        dialog:(title,build)=>{
          $('actionTitle').textContent=title;
          $('actionContent').replaceChildren();
          build($('actionContent'));
          $('actionDialog').showModal();
        }
      }
    });
  }
  document.addEventListener('keydown',e=>{if($('actionDialog').open)return;if(e.key==='Escape'){e.preventDefault();return;}if(e.key==='Enter'&&e.target.tagName!=='BUTTON'&&!['checkbox','radio'].includes(e.target.type)){const primary=$('actions').querySelector('.primary');if(primary&&!primary.disabled){e.preventDefault();primary.click();}}});
  run(async()=>{await reload();await persist({source:flow.source||'',adblock:flow.adblock,askPermissions:flow.askPermissions});render();($('vpnKey')||$('actions').querySelector('.primary'))?.focus();}).catch(report);
})();
