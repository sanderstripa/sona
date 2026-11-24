(() => {
  'use strict';
  const names={bookmarks:['Закладки и папки','Bookmarks and folders'],history:['История посещений','Browsing history'],passwords:['Сохранённые пароли','Saved passwords'],autofill:['Автозаполнение','Autofill'],tabs:['Открытые вкладки','Open tabs'],favicons:['Значки сайтов','Favicons'],preferences:['Настройки браузера','Browser preferences'],other:['Другие данные','Other data']};
  async function open({ui=window.souluSettings,api=window.browserShell,sourceHint='',currentProfileOnly=false}={}) {
    const {t,el,button,dialog}=ui;
    const call=(action,payload)=>api.browserImport(action,payload);
    const state=await api.getState();
    const targets=(state.profiles||[]).filter(p=>p.id!=='__incognito__');
    const activeTarget=ui.persisted?.profile||state.activeProfileId;
    let phase='form',closed=false,source=null,caps=null,pending=true,serial=0,timer=null,cancelRequested=false;
    let sourceOptions=[],extraSources=[],checks=new Map();
    const modal=document.getElementById('actionDialog'),closeButton=document.getElementById('closeAction');
    const previousClose=closeButton.onclick;
    const label=(ru,en)=>t(ru,en);
    const categoryNames={...names,bookmarks:['Закладки и избранное','Bookmarks and favorites'],history:['История','History'],extensions:['Расширения','Extensions']};
    const basicKeys=['bookmarks','history','passwords','autofill','tabs'];
    let box,form,categoryList,notice,execution,summary,footer,consentBox,consent,newName,createField,run,cancel,done,from,to;
    const error=message=>{if(!closed){notice.textContent=message?.message||message;notice.hidden=!notice.textContent;}};
    const wrap=fn=>async()=>{try{await fn();}catch(e){error(e);} };
    function dropdown(id,title,onChoose) {
      const row=el('label',undefined,'chromium-import-selector');
      const caption=el('span',title);
      const toggle=el('select',undefined,'md-select');
      toggle.id=id;
      toggle.setAttribute('aria-label',title);
      row.append(caption,toggle);
      let selected='',entries=[];
      toggle.onchange=wrap(async()=>{
        const entry=entries.find(item=>item.id===toggle.value);
        toggle.value=selected;
        if(entry)await onChoose(entry);
      });
      return {row,toggle,get value(){return selected;},
        setValue(value,text){
          selected=value;
          if(!toggle.options.length)toggle.add(new Option());
          if(!value)toggle.options[0].textContent=text;
          toggle.value=value;
        },
        setOptions(items){
          entries=items;
          const placeholder=new Option(label('Выберите источник','Choose a source'),'');
          placeholder.disabled=true;
          toggle.replaceChildren(placeholder,...items.map(item=>new Option(item.text,item.id)));
          toggle.value=selected;
        },
        disable(disabled){toggle.disabled=disabled;}
      };
    }
    function targetChoices(){
      const choices=targets.map(p=>({id:p.id,text:p.name+(p.id===activeTarget?label(' · текущий',' · current'):'')}));
      if(!currentProfileOnly)choices.push({id:'__new__',text:label('+ Новый профиль Sona Preview','+ New Sona Preview profile'),separator:true});
      to.setOptions(choices);
    }
    function sourceChoices(){from.setOptions([...sourceOptions,...extraSources,{id:'__html__',text:label('HTML-файл с закладками…','Bookmarks HTML file…'),separator:true},{id:'__tabs_html__',text:label('HTML-файл с вкладками…','Open tabs HTML file…')},{id:'__csv__',text:label('CSV-файл с паролями…','Passwords CSV file…')},{id:'__portable__',text:label('Другая папка профиля…','Other profile folder…')},{id:'__refresh__',text:label('Обновить список браузеров','Refresh browser list')}]);}
    function lock() {
      const busy=phase!=='form';
      from.disable(busy||pending==='picker'||pending==='discovery');to.disable(busy);
      newName.disabled=busy;consent.disabled=busy;
      for(const [key,check] of checks)check.disabled=busy||caps?.[key]?.status!=='available';
      const chosen=[...checks.values()].some(c=>c.checked&&!c.disabled);
      const destination=to.value==='__new__'?!!newName.value.trim():targets.some(p=>p.id===to.value);
      run.disabled=phase!=='form'||!!pending||!source||!chosen||!destination||(checks.get('passwords')?.checked&&!consent.checked);
      run.textContent=label(phase==='running'?'Импортируем…':phase==='creating'?'Создаём профиль…':'Импорт',phase==='running'?'Importing…':phase==='creating'?'Creating profile…':'Import');
      cancel.disabled=phase==='creating'||cancelRequested;
    }
    function shortReason(key,status) {
      if(status==='not_found')return label('В профиле не найдено','Not found in this profile');
      if(status==='blocked'&&key==='tabs'&&caps?.[key]?.reason?.includes('Encrypted'))return label('Защищённая сессия — выберите HTML-файл с вкладками','Protected session — choose Open tabs HTML');
      if(status==='blocked')return caps?.[key]?.reason?.startsWith('Close')?label('Закройте исходный браузер и обновите список','Close the source browser and refresh the list'):label('Нет доступа к файлу профиля','Cannot access the profile file');
      if(key==='passwords')return label('Через CSV-экспорт из браузера','Use a browser CSV export');
      if(key==='autofill')return label('Сохранённые значения форм не найдены','Saved form values not found');
      if(key==='tabs')return label('Формат сессии недоступен — используйте HTML-экспорт','Session unavailable — use an HTML export');
      return label('Перенос не поддерживается','Import is not supported');
    }
    function drawCategories() {
      categoryList.replaceChildren();checks=new Map();
      const keys=source?.kind?[source.kind]:[...basicKeys,...Object.keys(caps||{}).filter(k=>!basicKeys.includes(k)&&categoryNames[k]&&caps[k].status==='available')];
      for(const key of keys){const value=caps?.[key],available=value?.status==='available';
        const row=el('label',undefined,'import-category'),check=el('input'),text=el('span',undefined,'import-category-copy');
        check.type='checkbox';check.dataset.category=key;check.disabled=!available;check.checked=available&&key!=='passwords';check.setAttribute('aria-label',label(...categoryNames[key]));
        text.append(el('span',label(...categoryNames[key]),'import-category-name'));
        if(value&&!available)text.append(el('small',shortReason(key,value.status)));
        if(available&&key==='autofill')text.append(el('small',label('Адреса и значения форм · без карт','Addresses and form values · excludes cards')));
        if(available&&key==='tabs')text.append(el('small',label('Откроются в выбранном профиле','Will open in the selected profile')));
        if(available&&Number.isInteger(value.count))text.append(el('small',value.count.toLocaleString(),'import-count'));
        row.append(check,text);categoryList.append(row);checks.set(key,check);check.onchange=()=>{consentBox.hidden=!checks.get('passwords')?.checked;lock();};
      }
      consentBox.hidden=!checks.get('passwords')?.checked;consent.checked=false;
      createField.hidden=to.value!=='__new__';lock();
    }
    async function inspect(chosen) {
      const token=++serial;source=chosen;caps=null;pending='capabilities';notice.hidden=true;
      from.setValue(chosen.id,chosen.text);drawCategories();execution.hidden=false;execution.textContent=label('Проверяем доступные данные…','Checking available data…');
      try{const result=await call('capabilities',{source:chosen.id});if(closed||token!==serial)return;if(result.status==='error')throw Error(result.message);caps=result;}
      catch(e){if(closed||token!==serial)return;error(e);caps=Object.fromEntries(basicKeys.map(key=>[key,{status:'blocked'}]));}
      if(closed||token!==serial)return;pending=false;execution.hidden=true;drawCategories();
    }
    async function chooseSource(entry) {
      if(entry.id==='__refresh__')return discover();
      if(entry.needsFolder)return chooseSource({id:'__portable__'});
      if(!['__html__','__tabs_html__','__csv__','__portable__'].includes(entry.id))return entry.kind?selectFile(entry):inspect(entry);
      const token=++serial;pending='picker';notice.hidden=true;execution.hidden=true;lock();
      try{
        const portable=entry.id==='__portable__',kind=entry.id==='__html__'?'bookmarks':entry.id==='__tabs_html__'?'tabs':'passwords';
        const selected=await call(portable?'portable':'file',portable?undefined:{kind});
        if(closed||token!==serial)return;
        pending=false;if(!selected?.id){lock();if(source&&!caps)await inspect(source);return;}
        if(portable){const profiles=(selected.profiles?.length?selected.profiles:[selected]).map(p=>({...p,text:label('Папка профиля · ','Profile folder · ')+p.name}));extraSources.push(...profiles);sourceChoices();return inspect(profiles[0]);}
        if(selected.kind!==kind)throw Error(label('Формат файла не соответствует выбранному источнику.','The file does not match the selected source format.'));
        const chosen={id:selected.id,kind,name:selected.name,text:label(kind!=='passwords'?'HTML · ':'CSV · ',kind!=='passwords'?'HTML · ':'CSV · ')+selected.name};
        extraSources.push(chosen);sourceChoices();selectFile(chosen);
      }catch(e){if(closed||token!==serial)return;pending=false;error(e);lock();}
    }
    function selectFile(chosen){++serial;source=chosen;pending=false;from.setValue(chosen.id,chosen.text);caps={[chosen.kind]:{status:'available'}};
      notice.hidden=true;execution.hidden=true;drawCategories();
    }
    async function discover() {
      const token=++serial;pending='discovery';source=null;caps=null;from.setValue('',label('Ищем браузеры…','Finding browsers…'));notice.hidden=true;execution.hidden=true;drawCategories();
      try{const catalog=await call('catalog');if(closed||token!==serial)return;
        sourceOptions=catalog.flatMap(b=>b.profiles.length?b.profiles.map(p=>({...p,text:b.browser+' · '+p.name})): [{id:'unavailable:'+b.browser,text:b.browser+label(' · выбрать папку профиля…',' · choose profile folder…'),needsFolder:true}]);
        sourceChoices();from.setValue('',label('Выберите браузер или файл','Choose a browser or file'));
        if(!catalog.some(b=>b.profiles.length))error(label('Браузеры с доступными профилями не найдены. Выберите файл или папку профиля.','No accessible browser profiles found. Choose a file or profile folder.'));
      }catch(e){if(closed||token!==serial)return;sourceOptions=[];sourceChoices();from.setValue('',label('Выберите файл или папку профиля','Choose a file or profile folder'));error(e);}
      if(closed||token!==serial)return;pending=false;lock();
    }
    async function requestCancel(){if(phase==='running'){cancelRequested=true;lock();execution.textContent=label('Отменяем… Уже перенесённые записи сохранятся.','Cancelling… Entries already imported will remain.');try{await call('cancel');}catch(e){cancelRequested=false;lock();error(e);}}else if(phase!=='creating')modal.close();}
    async function execute() {
      if(run.disabled)return;notice.hidden=true;
      const selected=source,chosen=Object.fromEntries([...checks].map(([key,c])=>[key,c.checked&&!c.disabled]));
      const approved=consent.checked;let destination=to.value;
      if(destination==='__new__'){
        phase='creating';box.dataset.importState=phase;execution.hidden=false;execution.textContent=label('Создаём профиль Sona Preview…','Creating a Sona Preview profile…');lock();
        try{await ui.flush();const profile=await call('createProfile',{name:newName.value.trim()});if(!profile?.id)throw Error(label('Не удалось создать профиль.','Could not create a profile.'));
          if(closed)return;targets.push(profile);targetChoices();to.setValue(profile.id);destination=profile.id;createField.hidden=true;
        }catch(e){if(closed)return;phase='form';box.dataset.importState=phase;execution.hidden=true;error(e);lock();return;}
      }
      phase='running';box.dataset.importState=phase;box.setAttribute('aria-busy','true');execution.hidden=false;execution.textContent=label('Импортируем выбранные данные…','Importing selected data…');lock();
      const payload={source:selected.id,target:destination,...chosen,consent:approved};
      let pollPending=false;
      timer=setInterval(async()=>{if(pollPending)return;pollPending=true;try{const p=await call('progress');if(!closed&&phase==='running'&&!cancelRequested)execution.textContent=label(`Обработано записей: ${p.processed.toLocaleString()}`,`Entries processed: ${p.processed.toLocaleString()}`);}catch{}finally{pollPending=false;}},500);
      let result;try{result=await call('run',payload);}catch(e){result={status:'error',message:e.message};}finally{clearInterval(timer);box.removeAttribute('aria-busy');}
      if(!closed)finish(result);
    }
    function importMessage(message){
      if(/close .*retry|source .*busy|store is locked/i.test(message))return label('Закройте исходный браузер полностью, включая фоновые процессы, затем обновите список и повторите импорт. Закладки можно перенести отдельно.','Fully close the source browser, including background processes, then refresh and retry. Bookmarks can be imported separately.');
      if(/Protected or unsupported records/i.test(message))return label('Защищённые пароли не перенесены. Используйте штатный CSV-экспорт паролей исходного браузера.','Protected passwords were not imported. Use the source browser’s built-in password CSV export.');
      return message;
    }
    function finish(result) {
      phase='result';box.dataset.importState=phase;cancelRequested=false;lock();
      form.hidden=true;consentBox.hidden=true;createField.hidden=true;execution.hidden=true;
      const title=result.status==='ok'?label('Импорт завершён','Import complete'):result.status==='cancelled'?label('Импорт отменён','Import cancelled'):result.status==='partial'?label('Импорт завершён частично','Import partially completed'):label('Импорт завершён с ошибками','Import completed with errors');
      summary.replaceChildren(el('p',title,'import-result-title'));summary.hidden=false;
      const totals={imported:0,skipped:0,failed:0},reports=Object.entries(result.categories||{});
      for(const [key,r] of reports){totals.imported+=(key==='bookmarks'?r.bookmarksImported??r.imported:r.imported)||0;totals.skipped+=(key==='bookmarks'?r.bookmarksSkipped??r.skipped:r.skipped)||0;totals.failed+=r.failed||0;if(r.status==='error'&&!r.failed)++totals.failed;}
      if(result.status==='error'&&!reports.length)++totals.failed;
      const counts=el('dl',undefined,'import-totals');for(const [key,ru,en] of [['imported','Импортировано','Imported'],['skipped','Пропущено','Skipped'],['failed','Ошибки','Errors']]){const item=el('div');item.append(el('dt',label(ru,en)),el('dd',totals[key].toLocaleString()));counts.append(item);}summary.append(counts);
      for(const [key,r] of reports){
        const count=key==='bookmarks'&&Number.isInteger(r.bookmarksImported)
          ?label(`${r.bookmarksImported} закладок, ${r.foldersImported||0} папок добавлено; ${r.bookmarksSkipped||0} закладок уже есть`,`${r.bookmarksImported} bookmarks, ${r.foldersImported||0} folders added; ${r.bookmarksSkipped||0} bookmarks already present`)
          :label(`${r.imported||0} добавлено, ${r.skipped||0} пропущено`,`${r.imported||0} added, ${r.skipped||0} skipped`);
        summary.append(el('p',label(...(categoryNames[key]||[key,key]))+' · '+count,'import-result-line'));
        if(key==='bookmarks'&&r.status==='ok'&&r.bookmarksImported===0&&r.bookmarksSkipped===0)summary.append(el('p',label('В выбранном профиле не найдено закладок-ссылок. Пустые служебные папки не считаются закладками.','No bookmark links found in the selected profile. Empty permanent folders do not count as bookmarks.'),'note'));
        if(r.message&&r.status!=='ok')summary.append(el('p',importMessage(r.message),'note'));
      }
      if(result.message)error(importMessage(result.message));
      if(result.status==='cancelled')summary.append(el('p',label('Уже перенесённые данные сохранены.','Entries already imported remain saved.'),'note'));
      cancel.hidden=true;run.hidden=true;done.hidden=false;done.focus();
    }
    dialog(label('Импорт закладок и настроек','Import bookmarks and settings'),host=>{
      box=host;box.classList.add('browser-import');modal.classList.add('browser-import-dialog');box.dataset.importState='form';
      form=el('div',undefined,'import-form');from=dropdown('importFrom',label('Из','From'),chooseSource);to=dropdown('importTo',label('В','To'),async entry=>{to.setValue(entry.id);createField.hidden=entry.id!=='__new__';lock();if(entry.id==='__new__')newName.focus();});
      form.append(from.row);
      if(!currentProfileOnly)form.append(to.row);
      createField=el('label',undefined,'import-new-profile');createField.hidden=true;newName=el('input');newName.type='text';newName.maxLength=80;newName.placeholder=label('Название нового профиля','New profile name');newName.setAttribute('aria-label',label('Название нового профиля','New profile name'));newName.oninput=lock;createField.append(newName,el('small',label('Будет создан при запуске импорта','Created when you start the import')));form.append(createField);
      const section=el('section',undefined,'import-categories-section');section.append(el('p',label('Что импортировать','What to import'),'import-section-label'));categoryList=el('div');section.append(categoryList);form.append(section);
      consentBox=el('div',undefined,'import-csv-consent');consentBox.hidden=true;consentBox.append(el('p',label('Пароли сохраняются с защитой Windows. Для защищённых записей потребуется CSV-экспорт из браузера; CSV содержит открытый текст.','CSV contains unencrypted passwords. Existing credentials are preserved; the file is not deleted.'),'note'));
      const consentLabel=el('label',undefined,'import-consent');consent=el('input');consent.type='checkbox';consent.onchange=lock;consentLabel.append(consent,el('span',label('Разрешаю перенос паролей','Allow importing passwords')));consentBox.append(consentLabel);form.append(consentBox);
      notice=el('p',undefined,'import-notice');notice.hidden=true;notice.setAttribute('role','alert');execution=el('p',undefined,'import-execution');execution.hidden=true;execution.setAttribute('role','status');execution.setAttribute('aria-live','polite');summary=el('div',undefined,'import-summary');summary.hidden=true;summary.setAttribute('role','status');
      footer=el('div',undefined,'dialog-actions');cancel=button(label('Отмена','Cancel'),wrap(requestCancel),'import-cancel');run=button(label('Импорт','Import'),wrap(execute),'primary');done=button(label('Закрыть','Close'),()=>modal.close(),'primary');done.hidden=true;footer.append(cancel,run,done);box.append(form,notice,execution,summary,footer);
      targetChoices();to.setValue(targets.some(p=>p.id===activeTarget)?activeTarget:targets[0]?.id||'');
      drawCategories();
    });

    const escape=e=>{if(phase==='running'||phase==='creating'){e.preventDefault();if(phase==='running')requestCancel().catch(error);}};
    closeButton.onclick=wrap(requestCancel);modal.addEventListener('cancel',escape);
    const cleanup=()=>{closed=true;++serial;clearInterval(timer);if(phase==='running')call('cancel').catch(()=>{});box.classList.remove('browser-import');modal.classList.remove('browser-import-dialog');closeButton.onclick=previousClose;modal.removeEventListener('cancel',escape);modal.removeEventListener('close',cleanup);};modal.addEventListener('close',cleanup);
    await discover();
    if(!closed) {
      const choice=sourceOptions.find(p=>p.id===sourceHint)||sourceOptions.find(p=>!p.needsFolder);
      if(choice)await inspect(choice);
    }
    if(!closed)from.toggle.focus();
  }
  window.souluBrowserImport={open};
})();
