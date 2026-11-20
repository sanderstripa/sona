(() => {
  'use strict';
  const api=window.browserShell;
  if(!api) return;
  const gecko=Boolean(api.changeBookmark);
  let barSignature='',overviewSignature='',state={}, rows=[], parent=0, query='', drag=0, busy=false, manage=false, pane='list';
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
  const button=(text,fn)=>{const b=el('button','nav-action',text);b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(error=>alert(error.message));return b;};
  const bar=el('nav','bookmarks-bar');bar.setAttribute('aria-label','Панель закладок');document.body.append(bar);
  const menu=el('section','bookmarks-menu');menu.hidden=true;document.body.append(menu);
  const shield=el('div','navigation-shield');shield.hidden=true;document.body.append(shield);
  const overview=el('section','tab-overview');overview.hidden=true;document.body.append(overview);
  const head=el('div','overview-head'), search=el('input','navigation-search');search.placeholder='Поиск вкладок';search.setAttribute('aria-label','Поиск вкладок');
  const closeOverview=button('×',()=>api.setOverview(false));closeOverview.classList.add('overview-close');closeOverview.setAttribute('aria-label','Закрыть обзор вкладок');head.append(el('h1','','Обзор вкладок'),search,closeOverview);overview.append(head);
  const grid=el('div','overview-grid');overview.append(grid);search.oninput=renderOverview;
  const menuSearch=el('input','navigation-search');menuSearch.placeholder='Поиск закладок';menuSearch.setAttribute('aria-label','Поиск закладок');menuSearch.oninput=()=>{pane='list';query=menuSearch.value;renderMenu();};
  const contents=el('div','bookmark-tree'), actions=el('div','bookmark-actions');
  const menuHeading=el('div','bookmarks-heading');menuHeading.append(el('strong','','Закладки'));
  menu.append(menuHeading,menuSearch,contents,actions);
  if(gecko){
    document.body.classList.add('sona-bookmarks-layout');
    menu.classList.add('sona-bookmarks-sidebar');
    contents.tabIndex=-1;
    actions.hidden=true;
  }
  const nextId=()=>rows.reduce((n,r)=>Math.max(n,Number(r.id)||0),0)+1;
  const children=id=>rows.filter(r=>(r.parentId||0)===id).sort((a,b)=>(a.order||0)-(b.order||0));
  const descendants=id=>{const found=new Set([id]);let changed=true;while(changed){changed=false;for(const r of rows)if(found.has(r.parentId)&&!found.has(r.id)){found.add(r.id);changed=true;}}return found;};
  const bookmarkProfile=()=>state.incognito?'__incognito__':state.activeProfileId;
  async function persist(next,profile=bookmarkProfile()){if(busy)throw Error('Дождитесь сохранения');busy=true;try{const saved=await api.replaceBookmarks(next,profile);if(bookmarkProfile()===profile){rows=saved;render();}return saved;}finally{busy=false;}}
  const updatePopover=()=>{const open=Boolean(document.querySelector('.bookmark-context'));shield.hidden=!(open||editor);return api.setPopover(open,'bookmarks');};
  async function change(payload){
    const result=await api.changeBookmark(payload);
    rows=result.rows;
    render();
    return result.id;
  }
  let menuEpoch=0;
  async function closeMenu(){
    const epoch=++menuEpoch;
    if(!gecko&&!menu.hidden){
      const motion=menu.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-10px)'}],{duration:matchMedia('(prefers-reduced-motion:reduce)').matches?0:150,easing:'ease-out'});
      await motion.finished.catch(()=>{});
      if(epoch!==menuEpoch)return;
    }
    if(gecko){
      closeActions(false);
      if(menu.contains(document.activeElement)){
        [...document.querySelectorAll('#sidebarButton,#compactSidebarButton')].find(b=>b.getClientRects().length)?.focus({preventScroll:true});
      }
    }else menu.hidden=true;
    pane='list';
    const current=await api.setBookmarksSidebar(false);
    if(gecko&&epoch===menuEpoch)setSidebar(false,current?.bookmarksSidebarMotion);
    if(!gecko){updatePopover();api.setSuggestionsHeight(0);}
  }
  async function openMenu(id=0,editor=false){
    const epoch=++menuEpoch;
    if(state.overviewVisible)await api.setOverview(false);
    if(epoch!==menuEpoch)return;
    parent=id;manage=editor;pane='list';query='';menuSearch.value='';
    if(gecko){
      section='bookmarks';
      const current=await api.setBookmarksSidebar(true);
      if(epoch===menuEpoch)setSidebar(Boolean(current?.bookmarksSidebarVisible),current?.bookmarksSidebarMotion);
      renderMenu();
      return;
    }
    rows=await api.getBookmarks();
    if(epoch!==menuEpoch)return;
    menu.hidden=false;
    menu.animate([{opacity:0,transform:'translateX(-10px)'},{opacity:1,transform:'translateX(0)'}],{duration:matchMedia('(prefers-reduced-motion:reduce)').matches?0:180,easing:'cubic-bezier(.22,1,.36,1)'});
    await api.setBookmarksSidebar(true);
    await updatePopover();
    renderMenu();
    menuSearch.focus();
  }
  function icon(row){
    const n=el('span','bookmark-icon',gecko?'':row.type==='folder'?'▱':(row.title||row.url||'•').trim().slice(0,1).toLocaleUpperCase());
    if(gecko){
      n.setAttribute('aria-hidden','true');
      n.innerHTML=row.type==='folder'
        ? '<svg viewBox="0 0 16 16"><path d="M1.5 4.5h5l1.5 1.7h6.5v6.3h-13z"/></svg>'
        : '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2a9 9 0 0 1 0 12 9 9 0 0 1 0-12z"/></svg>';
    }
    if(row.type==='folder')return n;
    let source=row.favicon;try{if(!gecko&&!source&&/^https?:/.test(row.url))source=new URL('/favicon.ico',row.url).href;}catch{}
    if(source){const im=el('img');im.src=source;im.alt='';im.referrerPolicy='no-referrer';im.onerror=()=>im.remove();n.append(im);}
    return n;
  }
  function item(row,compact=false){const b=button('',()=>row.type==='folder'?openMenu(row.id,manage):api.openBookmark(row.url));b.classList.add('bookmark-item');b.title=row.title||row.url;b.setAttribute('aria-label',b.title);b.append(icon(row),el('span','bookmark-label',row.title||row.url));if(compact&&(state.settings?.bookmarksIconsOnly||row.hideTitle))b.classList.add('icons-only');b.dataset.bookmarkId=String(row.id);b.draggable=!gecko&&!!window.cefQuery&&location.protocol==='file:';b.onpointerdown=e=>{if(!b.draggable&&e.button===0){gesture={id:row.id,x:e.clientX,y:e.clientY,pointer:e.pointerId,node:b,active:false};b.setPointerCapture(e.pointerId);}};b.ondragstart=e=>{drag=row.id;e.dataTransfer.setData('application/x-sona-bookmark',String(row.id));e.dataTransfer.setData('text/plain',String(row.id));};b.ondragend=()=>{drag=0;};b.ondragover=e=>{if(drag)e.preventDefault();};b.ondrop=e=>{e.preventDefault();e.stopPropagation();move(drag,row).catch(err=>alert(err.message));};b.oncontextmenu=e=>{e.preventDefault();context(row,e);};return b;}
  // Internal pointer dragging also works in the native OSR shell, which does
  // not implement the operating system's HTML drag/drop protocol.
  let gesture=null, ghost=null, consumeClick=false, dropTarget=null;
  function dropPosition(node,y){
    if(!gecko)return 'inside';
    const rect=node.getBoundingClientRect();
    const fraction=(y-rect.top)/rect.height;
    const folder=rows.find(row=>row.id===Number(node.dataset.bookmarkId))?.type==='folder';
    if(folder&&fraction>.22&&fraction<.78)return 'inside';
    return fraction<.5?'before':'after';
  }
  async function moveToFolder(id,folder){
    if(!id||descendants(id).has(folder))return;
    if(gecko){sort='manual';await change({kind:'move',id,parentId:folder});return;}
    await persist(rows.map(r=>r.id===id?{...r,parentId:folder,order:rows.length}:r));
  }
  const finishDrag=()=>{
    if(gecko&&!gesture)return;
    dropTarget?.removeAttribute('data-drop');
    dropTarget=null;
    ghost?.remove();
    ghost=null;
    gesture=null;
    drag=0;
    if(gecko)requestAnimationFrame(render);
    else api.setSuggestionsHeight(0);
  };
  document.addEventListener('pointermove',e=>{
    if(!gesture||e.pointerId!==gesture.pointer)return;
    if(!gesture.active&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>6){
      gesture.active=true;drag=gesture.id;ghost=gesture.node.cloneNode(true);ghost.classList.add('bookmark-drag-ghost');ghost.removeAttribute('data-bookmark-id');document.body.append(ghost);if(!gecko)api.setSuggestionsHeight(innerHeight);
    }
    if(ghost){
      if(gecko){
        dropTarget?.removeAttribute('data-drop');
        dropTarget=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-bookmark-id]')||null;
        if(dropTarget)dropTarget.dataset.drop=dropPosition(dropTarget,e.clientY);
      }
      ghost.style.left=(e.clientX+12)+'px';ghost.style.top=(e.clientY+12)+'px';e.preventDefault();}
  });
  document.addEventListener('pointerup',e=>{
    if(!gesture||e.pointerId!==gesture.pointer)return;
    if(gesture.active){
      consumeClick=true;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-bookmark-id]');const id=gesture.id;
      if(target){const row=rows.find(r=>r.id===Number(target.dataset.bookmarkId));if(row)move(id,row,dropPosition(target,e.clientY)).catch(report);}
      else {
        const landing=document.elementFromPoint(e.clientX,e.clientY);
        if(landing?.closest('.bookmarks-bar'))moveToFolder(id,0).catch(report);
        else if(gecko&&landing?.closest('.bookmark-tree'))moveToFolder(id,parent).catch(report);
      }
      setTimeout(()=>{consumeClick=false;},0);
    }
    finishDrag();
  });
  document.addEventListener('pointercancel',finishDrag);
  document.addEventListener('click',e=>{if(consumeClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  async function move(id,target,position='inside'){if(!id||id===target.id)return;
    if(gecko){
      if(descendants(id).has(target.id))return;
      if(position==='inside'&&target.type==='folder')return moveToFolder(id,target.id);
      sort='manual';
      await change({kind:'move',id,parentId:target.parentId||0,[position==='after'?'afterId':'beforeId']:target.id});
      return;
    }const moving=rows.find(r=>r.id===id);if(!moving||descendants(id).has(target.id))return;const next=rows.map(r=>({...r})), copy=next.find(r=>r.id===id);copy.parentId=target.type==='folder'?target.id:(target.parentId||0);const siblings=next.filter(r=>r.id!==id&&(r.parentId||0)===copy.parentId).sort((a,b)=>(a.order||0)-(b.order||0));const index=target.type==='folder'?siblings.length:siblings.findIndex(r=>r.id===target.id);siblings.splice(index,0,copy);siblings.forEach((r,i)=>r.order=i);await persist(next);}
  async function context(row,event){
    const en=state.settings?.language==='en',commands=[],items=[];
    const add=(ru,english,run)=>{commands.push(run);items.push({command:commands.length,label:en?english:ru});};
    add(row.type==='folder'?'Перейти в папку':'Открыть',row.type==='folder'?'Open folder':'Open',()=>row.type==='folder'?openMenu(row.id):api.openBookmark(row.url));
    if(row.type!=='folder'){
      add('Открыть в новой вкладке','Open in new tab',()=>api.openTab(row.url));
      add('Открыть в фоновой вкладке','Open in background tab',()=>api.openTab(row.url,true));
    }
    add('Редактировать','Edit',()=>edit(row));
    if(!gecko)add(row.hideTitle?'Показать подпись':'Скрыть подпись',row.hideTitle?'Show label':'Hide label',()=>persist(rows.map(r=>r.id===row.id?{...r,hideTitle:!r.hideTitle}:r)));
    add('Переместить в корень','Move to root',()=>moveToFolder(row.id,0));
    add('Удалить','Delete',async()=>{
      const ids=descendants(row.id);
      if(row.type==='folder'&&ids.size>1){
        const accepted=gecko&&window.sonaConfirmBookmarkDelete
          ? await window.sonaConfirmBookmarkDelete(row.title)
          : confirm(en?'Delete folder and its bookmarks?':'Удалить папку со всеми закладками?');
        if(!accepted)return;
      }
      return gecko?change({kind:'remove',id:row.id}):persist(rows.filter(r=>!ids.has(r.id)));
    });
    const rect=event.currentTarget?.getBoundingClientRect();
    const keyboard=event.keyboard===true;
    const command=await api.showMenu(items,event.clientX||rect?.left||0,event.clientY||rect?.bottom||document.querySelector(".browser-toolbar:not([hidden])")?.getBoundingClientRect().bottom||0,keyboard);
    if(command>0&&commands[command-1])await commands[command-1]();
  }

  let editor=null, editorReturn=null, editorGeneration=0;
  const profileKey=()=>String(state.activeProfileId)+':'+String(state.incognito);
  function closeEditor(restore=true){++editorGeneration;if(!editor)return;editor.remove();editor=null;api.setPopover(false,'bookmark-editor');updatePopover();if(restore&&editorReturn?.isConnected)editorReturn.focus();editorReturn=null;}
  async function edit(row=null,newFolder=false){
    closeEditor(false);
    const requestGeneration=editorGeneration,current=await api.getState();if(requestGeneration!==editorGeneration)return;state=current;
    const key=profileKey(),profile=state.incognito?'__incognito__':state.activeProfileId,generation=editorGeneration;
    rows=await api.getBookmarks();
    if(profileKey()!==key||generation!==editorGeneration)return;
    const page={...state.page};
    if(!row&&!newFolder){
      if(!/^https?:\/\//i.test(page.url||'')){if(!gecko)await openMenu();return;}
      row=rows.find(mark=>mark.type!=='folder'&&mark.url===page.url)||null;
    }
    const isFolder=newFolder||row?.type==='folder';let existing=row;
    const en=state.settings?.language==='en',t=(ru,english)=>en?english:ru;
    editorReturn=document.activeElement;
    const box=el('form','bookmark-editor');editor=box;
    box.setAttribute('role','dialog');box.setAttribute('aria-label',t(existing?'Изменить закладку':isFolder?'Новая папка':'Сохранить закладку',existing?'Edit bookmark':isFolder?'New folder':'Save bookmark'));
    const top=el('div','bookmark-editor-head');top.append(el('strong','',box.getAttribute('aria-label')),button('×',()=>closeEditor()));top.lastChild.setAttribute('aria-label',t('Закрыть','Close'));box.append(top);
    function field(label,id,value){const wrap=el('label','bookmark-editor-field',label),input=el('input');input.id=id;input.value=value||'';input.required=true;wrap.append(input);box.append(wrap);return input;}
    const title=field(t('Название','Name'),'bookmarkTitle',existing?.title||(isFolder?'':page.title));
    const url=isFolder?null:field(t('Адрес','Address'),'bookmarkUrl',existing?.url||page.url);
    const place=el('label','bookmark-editor-field',t('Сохранить в','Save in')),select=el('select');select.id='bookmarkFolder';
    select.append(new Option(t('Панель закладок','Bookmarks bar'),'0'));
    const excluded=existing?descendants(existing.id):new Set();
    const path=mark=>{const names=[mark.title];let id=mark.parentId,depth=0;while(id&&depth++<64){const folder=rows.find(r=>r.id===id);if(!folder)break;names.unshift(folder.title);id=folder.parentId;}return names.join(' / ');};
    for(const mark of rows.filter(r=>r.type==='folder'&&!excluded.has(r.id)))select.append(new Option(path(mark),String(mark.id)));
    select.value=String(existing?.parentId??parent??0);if(select.selectedIndex<0)select.value='0';place.append(select);box.append(place);
    const favorite=el('input');favorite.type='checkbox';favorite.id='bookmarkHomeFavorite';favorite.checked=!!existing&&(state.settings?.homeFavoriteIds||[]).includes(existing.id);
    if(!isFolder){const label=el('label','bookmark-editor-favorite');label.append(favorite,document.createTextNode(t('Избранное на Home','Home favorites')));box.append(label);}
    const error=el('p','bookmark-editor-error');error.setAttribute('role','alert');error.hidden=true;box.append(error);
    const footer=el('div','bookmark-editor-footer'),cancel=button(t('Отмена','Cancel'),()=>closeEditor()),save=button(t('Сохранить','Save'),()=>{});save.type='submit';footer.append(cancel,save);box.append(footer);
    box.onsubmit=async e=>{e.preventDefault();if(save.disabled)return;error.hidden=true;let address=url?.value.trim();
      if(url&&(!gecko||address!==existing?.url)){try{const parsed=new URL(address);if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password)throw Error();address=parsed.href;}catch{error.textContent=t('Введите адрес HTTP или HTTPS.','Enter an HTTP or HTTPS address.');error.hidden=false;url.focus();return;}}
      if(!title.value.trim()){title.focus();return;}save.disabled=true;cancel.disabled=true;
      try{
        if(profileKey()!==key)throw Error(t('Профиль изменился. Откройте редактор заново.','The profile changed. Open the editor again.'));
        rows=await api.getBookmarks();
        if(profileKey()!==key)throw Error(t('Профиль изменился. Откройте редактор заново.','The profile changed. Open the editor again.'));
        const mark=existing?rows.find(r=>r.id===existing.id):null;
        if(existing&&!mark)throw Error(t('Закладка уже удалена.','This bookmark was deleted.'));
        const next=mark?{...mark}:{id:nextId(),type:isFolder?'folder':'url',createdAt:Date.now(),order:rows.length};
        Object.assign(next,{title:title.value.trim(),parentId:Number(select.value),updatedAt:Date.now()});if(url){if(mark&&address!==mark.url)next.favicon="";next.url=address;if(!mark&&address===page.url)next.favicon=page.favicon;}
        if(gecko){
          if(Number(select.value)&&!rows.some(r=>r.id===Number(select.value)&&r.type==='folder'))throw Error(t('Папка была удалена. Выберите другую.','This folder was deleted. Choose another folder.'));
          next.id=await change({kind:'save',id:mark?.id,parentId:next.parentId,title:next.title,url:next.url,folder:isFolder});
        }else await persist(mark?rows.map(r=>r.id===mark.id?next:r):[...rows,next],profile);
        existing=next;
        if(gecko&&isFolder&&next.parentId)expanded.add(next.parentId);
        if(profileKey()!==key)throw Error(t('Профиль изменился.','The profile changed.'));
        if(!isFolder&&(!gecko||favorite.checked!==Boolean((state.settings?.homeFavoriteIds||[]).includes(next.id))))await api.setHomeFavorite(next.id,favorite.checked,profile);
        if(editor===box){closeEditor();if(gecko){menuSignature='';renderMenu();}}
      }catch(reason){error.textContent=reason.message;error.hidden=false;save.disabled=false;cancel.disabled=false;}
    };
    document.body.append(box);await api.setPopover(true,'bookmark-editor');updatePopover();
    if(editor!==box)return;
    const anchor=(gecko&&menu.contains(editorReturn)?menuHeading:document.querySelector(['classic','adaptive'].includes(state.settings?.layout)?'#favoritesButton':'.compact-toolbar [data-favorites]'))?.getBoundingClientRect();
    const toolbar=document.querySelector(['classic','adaptive'].includes(state.settings?.layout)?'.classic-toolbar':'.compact-toolbar');
    const width=box.getBoundingClientRect().width;box.style.left=Math.max(12,Math.min(innerWidth-width-12,(anchor?.right||innerWidth)-width))+'px';box.style.top=(anchor?.bottom||toolbar?.getBoundingClientRect().bottom||0)+10+'px';title.focus();title.select();
    box.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeEditor();}else if(e.key==='Tab'){const focusable=[...box.querySelectorAll('button,input,select')].filter(n=>!n.disabled);if(e.shiftKey&&document.activeElement===focusable[0]){e.preventDefault();focusable.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===focusable.at(-1)){e.preventDefault();focusable[0].focus();}}};
  }
  async function folder(){await edit(null,true);}
  async function add(){await edit();}
  function setupLegacyActions(){
    actions.append(button('Все закладки',()=>{pane='list';parent=0;query='';menuSearch.value='';manage=false;renderMenu();}),button('Управление закладками',()=>{pane='list';manage=true;renderMenu();}),button('Добавить текущую страницу',add),button('Создать папку',folder),button('Импортировать закладки…',importMenu));
  const options=el('div','bookmark-options');
  const settingsAction=button('Настройки закладок',()=>{closeMenu();api.openSettingsWindow();});
  settingsAction.id='bookmarkSettingsAction';options.append(settingsAction);menu.append(options);
  }
  function renderLegacyMenu(){if(pane==='import')return;contents.replaceChildren();if(parent){const current=rows.find(r=>r.id===parent);if(!current){parent=0;return renderLegacyMenu();}contents.append(button('‹ '+current.title,()=>{parent=current.parentId||0;renderMenu();}));}const matches=query?rows.filter(r=>(r.title+' '+(r.url||'')).toLocaleLowerCase().includes(query.toLocaleLowerCase())):children(parent);for(const r of matches){const line=el('div','bookmark-line');line.append(item(r));if(manage){line.append(button('Изменить',()=>edit(r)));}contents.append(line);}if(!matches.length)contents.append(el('p','','Закладок пока нет'));}
  let section='bookmarks',sort='manual',menuSignature='',reading=[],readingEpoch=0;
  const expanded=new Set(), t=(ru,en)=>state.settings?.language==='en'?en:ru;
  let more, plus, popup, tabs, bookmarkTab, readingTab, settingsAction, status;
  function report(error){
    if(status&&!menu.inert)status.textContent=error.message;
    else alert(error.message);
  }
  let sidebarAnimation=null, lastMotion=-1;
  function setSidebar(open,motion){
    if(motion&&motion.startAt<lastMotion)return;
    document.body.toggleAttribute('data-bookmarks-sidebar',open);
    menu.inert=!open;
    menu.setAttribute('aria-hidden',String(!open));
    menu.hidden=false;
    if(!open)closeActions(false);
    if(!motion||motion.startAt===lastMotion)return;
    lastMotion=motion.startAt;
    sidebarAnimation?.cancel();
    sidebarAnimation=null;
    const body=document.body;
    body.removeAttribute('data-bookmarks-moving');
    if(!motion.duration||motion.open!==open)return;
    const to=getComputedStyle(body).getPropertyValue('--sona-bookmarks-width').trim();
    const animation=body.animate([{'--sona-bookmarks-width':motion.from},{'--sona-bookmarks-width':to}],
      {duration:motion.duration,easing:'cubic-bezier(.22,1,.36,1)',fill:'backwards'});
    animation.startTime=motion.startAt-performance.timeOrigin;
    sidebarAnimation=animation;
    body.setAttribute('data-bookmarks-moving','');
    animation.finished.then(()=>{
      if(sidebarAnimation!==animation)return;
      sidebarAnimation=null;
      body.removeAttribute('data-bookmarks-moving');
    },()=>{});
  }
  async function refreshReading(kind='get',payload){
    const epoch=++readingEpoch;
    const result=await api.readingList(kind,payload);
    if(epoch!==readingEpoch)return;
    reading=result;
    renderMenu();
  }
  function selectSection(value){
    section=value;
    pane='list';
    parent=0;
    query=menuSearch.value='';
    status.textContent='';
    renderMenu();
    if(value==='reading')refreshReading().catch(report);
  }
  function closeActions(focus=true){
    if(!popup||popup.hidden)return;
    popup.hidden=true;
    more.setAttribute('aria-expanded','false');
    if(focus)more.focus({preventScroll:true});
  }
  function action(ru,en,run){
    return button(t(ru,en),async()=>{closeActions();await run();});
  }
  function showActions(sorting=false){
    const sortAction=action('Сортировка ›','Sort ›',()=>showActions(true));
    const list=sorting?[
      action('‹ Все действия','‹ All actions',()=>showActions()),
      ...[['manual','Вручную','Manually'],['title','По названию','By title'],['date','По дате добавления','By date added']].map(([value,ru,en])=>{
        const b=action(ru,en,()=>{sort=value;renderMenu();});
        b.setAttribute('aria-pressed',String(sort===value));
        return b;
      })
    ]:[
      action('Создать папку','New folder',()=>{section='bookmarks';pane='list';renderMenu();return folder();}),
      action('Управление закладками','Manage bookmarks',()=>api.manageBookmarks()),
      action('Все закладки','All bookmarks',()=>selectSection('bookmarks')),
      action('Импортировать закладки…','Import bookmarks…',()=>showImport()),
      sortAction,
      settingsAction=action('Настройки закладок','Bookmark settings',()=>api.openSettingsWindow('bookmarks'))
    ];
    if(!sorting)settingsAction.id='bookmarkSettingsAction';
    popup.replaceChildren(...list);
    popup.hidden=false;
    more.setAttribute('aria-expanded','true');
    list[0].focus();
  }
  function showImport(){
    section='bookmarks';
    pane='import';
    menuSignature='';
    async function importFile(kind){
      try{
        const result=await api.browserImport('filePicker',kind);
        if(!result.canceled){
          selectSection('bookmarks');
          status.textContent=result.imported===0?t('Новых закладок нет.','No new bookmarks.'):t('Закладки импортированы.','Bookmarks imported.');
        }
      }catch(error){report(error);}
    }
    const html=button(t('Закладки из HTML…','Bookmarks from HTML…'),()=>importFile('bookmarks'));
    const json=button(t('Закладки из Chromium JSON…','Bookmarks from Chromium JSON…'),()=>importFile('chromium-bookmarks'));
    const back=button(t('‹ Все закладки','‹ All bookmarks'),()=>selectSection('bookmarks'));
    contents.replaceChildren(back,html,json);
    html.focus();
  }
  function setupSidebar(){
    menuHeading.classList.add('bookmarks-heading-compact');
    plus=button('+',async()=>{
      status.textContent='';
      try{
        if(section==='reading')await refreshReading('add');
        else await add();
      }catch(error){report(error);}
    });
    plus.classList.add('bookmark-header-button');
    plus.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10"/></svg>';
    more=button('⋯',()=>popup.hidden?showActions():closeActions());
    more.classList.add('bookmark-header-button');
    more.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h.01M8 8h.01M13 8h.01" stroke-width="2.4"/></svg>';
    more.setAttribute('aria-expanded','false');
    popup=el('div','bookmark-action-menu');
    popup.hidden=true;
    popup.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeActions();return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
      e.preventDefault();
      const items=[...popup.children],index=items.indexOf(document.activeElement);
      const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:items.length-1))%items.length;
      items[next].focus();
    };
    menuHeading.append(plus,more,popup);
    status=el('p','bookmark-status');
    status.setAttribute('role','status');
    tabs=el('nav','bookmark-sections');
    bookmarkTab=button('',()=>selectSection('bookmarks'));
    readingTab=button('',()=>selectSection('reading'));
    tabs.append(bookmarkTab,readingTab);
    menu.append(status,tabs);
    setSidebar(false);
    api.onBookmarksMotion(motion=>{
      setSidebar(motion.open,motion);
      if(motion.open)renderMenu();
    });
    api.onReadingListChanged(()=>{if(section==='reading'&&!menu.inert)refreshReading().catch(report);});
    document.addEventListener('pointerdown',e=>{if(!menuHeading.contains(e.target))closeActions(false);});
    menu.addEventListener('focusout',e=>{
      if(!menuHeading.contains(e.relatedTarget))closeActions(false);
    });
    contents.onkeydown=e=>{
      const row=e.target.closest('.bookmark-item');
      if(!row)return;
      if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){
        e.preventDefault();
        const entry=rows.find(mark=>mark.id===Number(row.dataset.bookmarkId));
        if(entry)context(entry,{currentTarget:row,keyboard:true}).catch(report);
        return;
      }
      if(!['ArrowDown','ArrowUp','Home','End','ArrowLeft','ArrowRight'].includes(e.key))return;
      const id=Number(row.dataset.bookmarkId);
      const entry=rows.find(mark=>mark.id===id);
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
        if(entry?.type==='folder'&&!query){
          e.preventDefault();
          if(e.key==='ArrowLeft'&&expanded.has(id))expanded.delete(id);
          else if(e.key==='ArrowRight'&&!expanded.has(id))expanded.add(id);
          else if(e.key==='ArrowRight')row.closest('li')?.querySelector('ul .bookmark-item')?.focus();
          else contents.querySelector('[data-bookmark-id="'+entry.parentId+'"]')?.focus();
          renderMenu();
        }else if(e.key==='ArrowLeft'&&entry?.parentId){
          e.preventDefault();
          contents.querySelector('[data-bookmark-id="'+entry.parentId+'"]')?.focus();
        }
        return;
      }
      e.preventDefault();
      const items=[...contents.querySelectorAll('.bookmark-item')],index=items.indexOf(row);
      const next=e.key==='Home'?0:e.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,index+(e.key==='ArrowDown'?1:-1)));
      items[next]?.focus();
    };
  }

  function readingItems(term){
    const scroll=el('ul','bookmark-branches');
    for(const entry of reading){
      if(!(entry.title+' '+entry.url).toLocaleLowerCase().includes(term))continue;
      const label=entry.title||entry.url;
      const open=button('',async()=>{
        await api.openBookmark(entry.url);
        if(!entry.read)await refreshReading('mark',{url:entry.url,read:true});
      });
      open.classList.add('bookmark-item');
      open.dataset.focusKey='reading:'+entry.url;
      open.title=entry.url;
      open.append(icon(entry),el('span','bookmark-label',label));
      const line=el('li','bookmark-line');
      line.toggleAttribute('data-unread',!entry.read);
      const toggle=button(entry.read?'○':'●',()=>refreshReading('mark',{url:entry.url,read:!entry.read}));
      toggle.dataset.focusKey='mark:'+entry.url;
      toggle.title=t(entry.read?'Отметить как непрочитанное':'Отметить как прочитанное',entry.read?'Mark as unread':'Mark as read');
      toggle.setAttribute('aria-label',toggle.title+' — '+label);
      const remove=button('×',()=>refreshReading('remove',{url:entry.url}));
      remove.title=t('Удалить','Remove');
      remove.setAttribute('aria-label',remove.title+' — '+label);
      line.append(open,toggle,remove);
      scroll.append(line);
    }
    return scroll;
  }

  function bookmarkBranch(items,byParent,nested=true){
    const branch=el('ul','bookmark-branches');
    for(const row of items){
      const entry=el('li');
      const line=el('div','bookmark-line');
      const control=item(row);
      control.dataset.focusKey='bookmark:'+row.id;
      if(row.type==='folder'){
        const open=expanded.has(row.id)&&nested;
        control.setAttribute('aria-expanded',String(open));
        control.prepend(el('span','bookmark-disclosure',open?'⌄':'›'));
        control.onclick=()=>{
          if(!nested)return openMenu(row.id);
          if(open)expanded.delete(row.id);else expanded.add(row.id);
          renderMenu();
        };
      }else{
        control.onclick=e=>e.ctrlKey||e.metaKey?api.openTab(row.url).catch(report):api.openBookmark(row.url).catch(report);
        control.onauxclick=e=>{if(e.button===1)api.openTab(row.url,true).catch(report);};
        if(row.url===state.page?.url)control.setAttribute('aria-current','page');
      }
      control.oncontextmenu=e=>{e.preventDefault();context(row,e).catch(report);};
      line.append(control);
      entry.append(line);
      if(nested&&row.type==='folder'&&expanded.has(row.id))
        entry.append(bookmarkBranch(byParent.get(row.id)||[],byParent));
      branch.append(entry);
    }
    return branch;
  }

  function renderMenu(){
    if(!gecko)return renderLegacyMenu();
    if(menu.inert||pane==='import'||gesture)return;
    const lang=state.settings?.language;
    const readingView=section==='reading';
    const signature=JSON.stringify([section,query,rows,reading,parent,[...expanded],sort,lang,state.page?.url,state.settings?.homeFavoriteIds,state.incognito]);
    plus.disabled=!(state.page?.url||'').match(/^https?:\/\//i)||readingView&&state.incognito;
    if(signature===menuSignature)return;
    menuSignature=signature;
    menuHeading.firstChild.textContent=readingView?t('Список для чтения','Reading list'):t('Закладки','Bookmarks');
    plus.title=readingView?t('Добавить в список для чтения','Add to Reading List'):t('Добавить текущую страницу','Add current page');
    plus.setAttribute('aria-label',plus.title);
    more.title=t('Действия с закладками','Bookmark actions');
    more.setAttribute('aria-label',more.title);
    menuSearch.placeholder=readingView?t('Поиск в списке','Search reading list'):t('Поиск закладок','Search bookmarks');
    menuSearch.setAttribute('aria-label',menuSearch.placeholder);
    bookmarkTab.textContent=t('Закладки','Bookmarks');
    readingTab.textContent=t('Список для чтения','Reading list');
    bookmarkTab.setAttribute('aria-pressed',String(!readingView));
    readingTab.setAttribute('aria-pressed',String(readingView));

    const active=document.activeElement;
    const focused=contents.contains(active),focusKey=focused&&active.dataset.focusKey;
    const scroll=contents.scrollTop;
    const term=query.trim().toLocaleLowerCase();
    contents.replaceChildren();
    if(readingView){
      const list=readingItems(term);
      if(list.childElementCount)contents.append(list);
      else contents.append(el('p','bookmark-empty',state.incognito?t('Откройте обычное окно','Open a regular window'):term?t('Ничего не найдено','No results'):t('Список пока пуст','Your reading list is empty')));
    }else{
      const ordered=rows.slice().sort((a,b)=>sort==='title'
        ? a.title.localeCompare(b.title,lang==='en'?'en':'ru')
        : sort==='date'?b.createdAt-a.createdAt:(a.order||0)-(b.order||0));
      const byParent=new Map(), byId=new Map(rows.map(row=>[row.id,row]));
      for(const row of ordered){
        const key=row.parentId||0;
        if(!byParent.has(key))byParent.set(key,[]);
        byParent.get(key).push(row);
      }
      const current=byId.get(parent);
      if(parent&&!current)parent=0;
      if(current&&!term)contents.append(button('‹ '+current.title,()=>{parent=current.parentId||0;renderMenu();contents.querySelector('.bookmark-item')?.focus();}));
      if(!term&&!parent){
        const favorites=(state.settings?.homeFavoriteIds||[]).map(id=>byId.get(id)).filter(Boolean);
        if(favorites.length){
          contents.append(el('h2','bookmark-group-label',t('Избранное','Favorites')),bookmarkBranch(favorites,byParent,false));
        }
        contents.append(el('h2','bookmark-group-label',t('Все закладки','All bookmarks')));
      }
      const matches=term?ordered.filter(row=>(row.title+' '+row.url).toLocaleLowerCase().includes(term)):byParent.get(parent)||[];
      if(matches.length)contents.append(bookmarkBranch(matches,byParent,!term));
      else contents.append(el('p','bookmark-empty',term?t('Ничего не найдено','No results'):t('Закладок пока нет','No bookmarks yet')));
    }
    contents.scrollTop=scroll;
    if(focused){
      const target=[...contents.querySelectorAll('[data-focus-key]')].find(node=>node.dataset.focusKey===focusKey);
      (target||contents.querySelector('button')||menuSearch).focus({preventScroll:true});
    }
  }
  if(gecko)setupSidebar();else setupLegacyActions();
  function renderBar(){if(gecko&&gesture)return;const signature=JSON.stringify([state.settings?.layout,state.settings?.bookmarksIconsOnly,state.settings?.bookmarksBarPosition,state.bookmarksBarVisible,innerWidth,rows]);if(signature===barSignature)return;barSignature=signature;const host=document.querySelector(['classic','adaptive'].includes(state.settings?.layout)?'.classic-toolbar':'.compact-toolbar');if(host&&bar.parentElement!==host)host.append(bar);bar.replaceChildren();bar.hidden=!state.bookmarksBarVisible;document.body.dataset.bookmarksBar=String(!bar.hidden);document.body.dataset.bookmarksPosition=state.settings?.bookmarksBarPosition||'above';if(bar.hidden)return;const list=children(0);for(const row of list)bar.append(item(row,true));const more=button('»',()=>openMenu());more.classList.add('bookmarks-overflow');bar.append(more);requestAnimationFrame(()=>{if(bar.hidden)return;let limit=bar.clientWidth-42,used=12,hidden=false;for(const node of [...bar.children].slice(0,-1)){node.hidden=false;used+=node.getBoundingClientRect().width+4;if(used>limit){node.hidden=true;hidden=true;}}more.hidden=!hidden;});bar.ondragover=e=>{if(drag)e.preventDefault();};bar.ondrop=e=>{e.preventDefault();if(drag)persist(rows.map(r=>r.id===drag?{...r,parentId:0,order:rows.length}:r)).catch(err=>alert(err.message));};}
  function renderOverview(){if(overview.hidden)return;const q=search.value.toLocaleLowerCase();const signature=JSON.stringify([q,(state.tabs||[]).map(t=>[t.id,t.title,t.url,t.favicon,t.active,t.thumbnail])]);if(signature===overviewSignature)return;overviewSignature=signature;grid.replaceChildren();for(const tab of state.tabs||[]){if(!(tab.title+' '+tab.url).toLocaleLowerCase().includes(q))continue;const card=el('article','overview-card'+(tab.active?' active':''));const preview=button('',async()=>{await api.switchTab(tab.id);await api.setOverview(false);});preview.classList.add('overview-preview');preview.setAttribute('aria-label',tab.title||'Новая вкладка');if(tab.thumbnail){const im=el('img');im.src=tab.thumbnail;im.alt='';preview.append(im);}else{preview.append(el('span','preview-placeholder',tab.url?'Превью появится после просмотра вкладки':'Новая вкладка'));}const caption=el('div','overview-caption');caption.append(icon(tab),el('span','',tab.title||'Новая вкладка'),button('×',()=>api.closeTab(tab.id)));caption.lastChild.setAttribute('aria-label','Закрыть '+tab.title);card.append(preview,caption);grid.append(card);}const addTile=button('+ Новая вкладка',async()=>{await api.newTab();await api.setOverview(false);});addTile.classList.add('overview-new');grid.append(addTile);}
  function render(){renderBar();if(!menu.hidden)renderMenu();overview.hidden=!state.overviewVisible;renderOverview();}
  async function importMenu(){pane='import';contents.replaceChildren(el('p','','Chrome / Edge / Brave / другие Chromium: файл Bookmarks (JSON) или экспорт HTML. Firefox: экспорт закладок HTML. Пароли не импортируются.'));const input=el('input');input.type='file';input.setAttribute('aria-label','Файл закладок Chromium JSON или HTML-экспорт');contents.append(input);input.onchange=async()=>{try{const file=input.files[0];if(!file)return;const profile=String(state.activeProfileId)+':'+String(state.incognito);if(file.size>20*1024*1024)throw Error('Файл превышает 20 МБ');const text=await file.text();if(menu.hidden||pane!=='import')return;if(profile!==String(state.activeProfileId)+':'+String(state.incognito))throw Error('Профиль изменился. Откройте импорт заново.');let nodes=[];if(text.trim().startsWith('{')){const data=JSON.parse(text);if(!data.roots)throw Error('Нужен стандартный Chromium Bookmarks JSON');nodes=Object.values(data.roots);}else{const doc=new DOMParser().parseFromString(text,'text/html');if(!doc.querySelector('dl'))throw Error('Нужен экспорт закладок HTML');const parse=dl=>[...dl.children].filter(n=>n.tagName==='DT').map(dt=>{const a=dt.querySelector(':scope > a'),h=dt.querySelector(':scope > h3');if(a)return {type:'url',name:a.textContent,url:a.getAttribute('href')};const nested=dt.querySelector(':scope > dl');return h?{type:'folder',name:h.textContent,children:nested?parse(nested):[]}:null;}).filter(Boolean);nodes=parse(doc.querySelector('dl'));}const next=rows.map(r=>({...r}));let id=nextId(),added=0;const walk=(ns,p,depth=0)=>{if(depth>64)throw Error('Слишком глубокая вложенность');for(const n of ns){if(next.length>=20000)throw Error('Слишком много закладок');if(n.type==='folder'||n.children){let existing=next.find(r=>r.type==='folder'&&(r.parentId||0)===p&&r.title===(n.name||'Импорт'));if(!existing){existing={id:id++,type:'folder',title:n.name||'Импорт',parentId:p,order:next.length,createdAt:Date.now()};next.push(existing);added++;}walk(n.children||[],existing.id,depth+1);}else if(/^https?:\/\//i.test(n.url||'')&&!next.some(r=>r.type==='url'&&(r.parentId||0)===p&&r.title===(n.name||n.url)&&r.url===n.url)){next.push({id:id++,type:'url',title:n.name||n.url,url:n.url,parentId:p,order:next.length,createdAt:Date.now()});added++;}}};walk(nodes,0);if(!added){alert('Новых закладок нет. Дубликаты пропущены.');return;}if(!confirm('Добавить '+added+' элементов из '+file.name+'? Совпадающие элементы в той же папке будут пропущены.'))return;pane='list';await persist(next);alert('Импорт завершён');}catch(error){alert(error.message);}};}
  for(const selector of ['#newTabButton','#compactNewTabButton']){const anchor=document.querySelector(selector);if(!anchor)continue;const tabs=button('',async()=>{closeMenu();await api.setOverview(!state.overviewVisible);});tabs.classList.add('navigation-toolbar-button',selector==='#newTabButton'?'toolbar-button':'compact-control');tabs.title='Обзор вкладок';tabs.setAttribute('aria-label','Обзор вкладок');tabs.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/><rect x="7" y="7" width="14" height="14" rx="1.8"/></svg>';anchor.before(tabs);}
  document.addEventListener('click',e=>{if(e.target.closest('#favoritesButton,[data-favorites]')){e.preventDefault();e.stopImmediatePropagation();edit();}else if(e.target.closest('#sidebarButton,#compactSidebarButton')){e.preventDefault();e.stopImmediatePropagation();closeEditor(false);if(gecko?menu.inert:menu.hidden)openMenu();else closeMenu();}},true);
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.bookmark-context')){document.querySelector('.bookmark-context')?.remove();updatePopover();}});
  shield.addEventListener('pointerdown',()=>closeEditor());
  document.addEventListener('keydown',e=>{if(e.defaultPrevented)return;if(e.key==='Escape'){if(editor){closeEditor();return;}if(!gecko||menu.contains(e.target))closeMenu();if(state.overviewVisible)api.setOverview(false);}if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='b'){e.preventDefault();api.setBookmarksAuto(!state.bookmarksBarVisible);}});
  let autoTimer=0;
  for(const header of document.querySelectorAll('.browser-toolbar')){header.addEventListener('pointerenter',()=>{clearTimeout(autoTimer);if(state.settings?.bookmarksBarMode==='auto'&&!state.bookmarksBarVisible)api.setBookmarksAuto(true);});header.addEventListener('pointerleave',()=>{autoTimer=setTimeout(()=>{if(state.settings?.bookmarksBarMode==='auto'&&(gecko?menu.inert:menu.hidden)&&!bar.matches(':hover'))api.setBookmarksAuto(false);},500);});}
  bar.addEventListener('pointerenter',()=>clearTimeout(autoTimer));bar.addEventListener('pointerleave',()=>{if(state.settings?.bookmarksBarMode==='auto'&&(gecko?menu.inert:menu.hidden))api.setBookmarksAuto(false);});
  window.addEventListener('resize',renderBar);
  if(gecko)new ResizeObserver(()=>{barSignature='';renderBar();}).observe(document.querySelector('.classic-toolbar'));
  window.sonaNavigation={openBookmarks:openMenu,animateOverviewClose:async()=>{
    if(overview.hidden)return;const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
    await overview.animate([{opacity:1,transform:'none'},{opacity:0,transform:reduced?'none':'translateY(6px)'}],{duration:reduced?60:240,easing:'cubic-bezier(.4,0,.6,1)'}).finished.catch(()=>{});
  }};
  api.onEditBookmark?.(async id=>{rows=await api.getBookmarks();const row=rows.find(r=>r.id===id);if(row)edit(row);});
  const apply=s=>{const changed=profileKey()!==String(s.activeProfileId)+':'+String(s.incognito),entered=s.overviewVisible&&!state.overviewVisible;state=s;if(changed)closeEditor(false);rows=s.bookmarks||rows;if(gecko)setSidebar(!!s.bookmarksSidebarVisible&&!s.fullscreen,s.bookmarksSidebarMotion);else menu.hidden=!s.bookmarksSidebarVisible;if(entered){closeEditor(false);closeMenu();}render();document.querySelectorAll('#sidebarButton,#compactSidebarButton').forEach(n=>{n.title=s.settings?.language==='en'?'Bookmarks':'Закладки';n.setAttribute('aria-label',n.title);n.setAttribute('aria-expanded',String(!!s.bookmarksSidebarVisible&&!s.fullscreen));});document.querySelectorAll('#favoritesButton,[data-favorites]').forEach(n=>{n.title=s.settings?.language==='en'?'Save bookmark':'Сохранить закладку';const saved=rows.some(r=>r.url===s.page?.url);n.classList.toggle('bookmark-saved',saved);n.setAttribute('aria-pressed',String(saved));});if(entered){search.value='';renderOverview();search.focus();const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;overview.animate([{opacity:0,transform:reduced?'none':'translateY(8px)'},{opacity:1,transform:'none'}],{duration:reduced?60:320,easing:'cubic-bezier(.22,1,.36,1)'});}};api.onState(apply);api.getState().then(apply);
})();
