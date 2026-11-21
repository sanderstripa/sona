"""Exercise the Sona sidebar through the installed frontend and real Gecko Places."""
from pathlib import Path

harness = Path(__file__).with_name('preview4.py')
exec(compile(harness.read_text(encoding='utf-8').split('\ntry:\n start()', 1)[0], str(harness), 'exec'), globals())

def shell(script):
 return ui(script)

def click(selector):
 shell('document.querySelector('+json.dumps(selector)+').click();return true;')

def screenshot(name):
 m.set_context('chrome')
 (out / name).write_bytes(base64.b64decode(m.screenshot()))

def geometry():
 toolbar = shell('''const r=document.querySelector('.classic-toolbar').getBoundingClientRect();
 const a=document.getElementById('classicAddress').getBoundingClientRect();
 const b=document.getElementById('windowClose').getBoundingClientRect();
 return {left:r.left,right:r.right,address:a.left,addressWidth:a.width,caption:b.right};''')
 page = chrome('''const r=gBrowser.selectedBrowser.getBoundingClientRect();
 return {left:r.left,right:r.right,zoom:gBrowser.selectedBrowser.fullZoom};''')
 return {**toolbar, 'page': page}

def bridge(action, payload=None):
 return shell('''return await new Promise((resolve,reject)=>cefQuery({request:'''
  + json.dumps(json.dumps({'action': action, 'payload': payload}))
  + ''',onSuccess:data=>resolve(JSON.parse(data)),onFailure:(_,error)=>reject(Error(error))}));''')

def save_mark(title, folder=0):
 shell('document.getElementById("bookmarkTitle").value='+json.dumps(title)+';'
  'document.getElementById("bookmarkFolder").value='+json.dumps(str(folder))+';'
  + 'document.querySelector(".bookmark-editor").requestSubmit();return true;')
 wait(lambda: shell('return !document.querySelector(".bookmark-editor")||document.querySelector(".bookmark-editor-error:not([hidden])")?.textContent'))
 error = shell('return document.querySelector(".bookmark-editor-error:not([hidden])")?.textContent;')
 if error:
  raise AssertionError(error)
 return next(row for row in call('browser.bookmarks.get') if row['title']==title)

def open_actions():
 click('.bookmark-header-button[aria-expanded]')
 wait(lambda: shell('return !document.querySelector(".bookmark-action-menu").hidden'))

def folder(title, parent=0):
 open_actions()
 click('.bookmark-action-menu button:first-child')
 wait(lambda: shell('return !!document.getElementById("bookmarkTitle")'))
 return save_mark(title, parent)

def search(term):
 shell('const input=document.querySelector(".bookmarks-menu .navigation-search");input.value='
  +json.dumps(term)+';input.dispatchEvent(new Event("input"));return true;')

def drag_item(source, target):
 def point(id, fraction):
  selector='.bookmarks-menu [data-bookmark-id="'+str(id)+'"]'
  return shell('''const r=document.querySelector('''+json.dumps(selector)+''').getBoundingClientRect();
   return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height*'''+str(fraction)+')};')
 x, y = point(source, .5).values()
 tx, ty = point(target, .5).values()
 m.set_context('chrome')
 m._send_message('WebDriver:PerformActions', {'actions': [{
  'type': 'pointer', 'id': 'bookmark-drag', 'parameters': {'pointerType': 'mouse'},
  'actions': [
   {'type':'pointerMove','origin':'viewport','x':x,'y':y,'duration':0},
   {'type':'pointerDown','button':0},
   {'type':'pointerMove','origin':'viewport','x':tx,'y':ty,'duration':150},
   {'type':'pointerUp','button':0},
  ],
 }]})

def read_entries():
 return bridge('browser.readingList', {'kind': 'get'})

def enable_compositor_test_material():
 import ctypes as C
 from ctypes import wintypes as W
 import winreg
 path=r'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
 key=winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,path,0,winreg.KEY_QUERY_VALUE|winreg.KEY_SET_VALUE)
 try:
  previous=winreg.QueryValueEx(key,'EnableTransparency')
 except FileNotFoundError:
  previous=None
 notify=C.windll.user32.SendMessageTimeoutW
 notify.argtypes=[W.HWND,W.UINT,W.WPARAM,W.LPCWSTR,W.UINT,W.UINT,C.POINTER(C.c_size_t)]
 notify.restype=C.c_ssize_t
 def broadcast():
  result=C.c_size_t()
  notify(0xffff,0x1a,0,'ImmersiveColorSet',0x2,1000,C.byref(result))
 winreg.SetValueEx(key,'EnableTransparency',0,winreg.REG_DWORD,1)
 broadcast()
 print('Windows CI transparency mode', {'original':previous,'remote':C.windll.user32.GetSystemMetrics(0x1000)},flush=True)
 def restore():
  try:
   if previous is None:winreg.DeleteValue(key,'EnableTransparency')
   else:winreg.SetValueEx(key,'EnableTransparency',0,previous[1],previous[0])
   broadcast()
  finally:
   winreg.CloseKey(key)
 return restore

baseline = os.environ.get('SONA_SIDEBAR_BASELINE')=='1'
report = {'passed': False, 'checks': {}}
restore_material=lambda:None
try:
 if os.name=='nt' and not baseline:restore_material=enable_compositor_test_material()
 start()
 if not baseline:
  chrome('Services.prefs.setIntPref("ui.prefersReducedMotion",0)')
  wait(lambda: shell('return !matchMedia("(prefers-reduced-motion:reduce)").matches'))
 call('browser.navigate', url)
 wait(lambda: content('return !!document.getElementById("v")'))
 call('browser.settings.set', {'theme': 'light'})
 chrome('window.resizeTo(1200,820)')
 wait(lambda: chrome('return innerWidth>=1100'))
 for i, suffix in enumerate(['', 'quick-start', 'release-notes']):
  call('browser.navigate', url+suffix)
  wait(lambda: content('return location.pathname')=='/'+suffix)
  if i:
   call('browser.bookmarks.add')
 call('browser.navigate', url)
 wait(lambda: content('return location.pathname==="/"'))
 before = geometry()
 identity = chrome('return gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.innerWindowId')
 click('#sidebarButton')
 wait(lambda: chrome('return gBrowser.selectedBrowser.getBoundingClientRect().left>260'))
 time.sleep(.28)
 after = geometry()
 if baseline:
  screenshot('sona-sidebar-before.png')
  check('baseline_page_moved_toolbar_did_not', abs(after['left']-before['left'])<2, after)
 else:
  screenshot('sona-sidebar-after.png')
  check('synchronous_layout_at_rest', abs(after['left']-after['page']['left'])<2 and after['address']>before['address'] and abs(after['caption']-before['caption'])<2, after)
  content("const probe=document.createElement('div');probe.id='matte-probe';probe.style.cssText='position:absolute;inset:0 0 auto;height:3000px;z-index:9999;pointer-events:none;background:repeating-linear-gradient(#fa3020 0 120px,#04b393 120px 240px)';document.body.append(probe);scrollTo(0,0);return true;")
  page_top = chrome('return gBrowser.selectedBrowser.getBoundingClientRect().top')
  call('browser.settings.set', {'mattePanel': True})
  check('matte_preserves_viewport_position_and_top_controls',
        wait(lambda: chrome(f"""return document.documentElement.hasAttribute('sona-page-glass')
           && Math.abs(gBrowser.selectedBrowser.getBoundingClientRect().top-{page_top})<1
           && document.getElementById('sona-page-glass').hidden""")))
  backdrop=chrome("""
    return {mica:document.documentElement.hasAttribute('windowsmica'),
      desktop:document.documentElement.hasAttribute('sona-desktop-glass'),
      background:getComputedStyle(document.documentElement).backgroundColor,
      appearance:getComputedStyle(document.documentElement).appearance,
      backdrop:Services.prefs.getIntPref('widget.windows.mica.toplevel-backdrop'),
      material:Sona.material};
  """)
  print('Windows acrylic state',backdrop,flush=True)
  check('sidebar_uses_windows_desktop_backdrop', wait(lambda: chrome("""
    return document.documentElement.hasAttribute('sona-desktop-glass') &&
      getComputedStyle(document.documentElement).backgroundColor==='rgba(0, 0, 0, 0)';
  """) and shell("""
    const style=getComputedStyle(document.querySelector('.sona-bookmarks-sidebar'));
    return document.body.hasAttribute('data-desktop-glass') &&
      style.backgroundColor.includes('0.43');
  """)),backdrop)
  # Windows compositor screenshots distinguish live desktop acrylic from a
  # transparent CSS layer painted over a solid application background.
  import ctypes as C
  from ctypes import wintypes as W
  from PIL import ImageGrab
  import tkinter as tk
  user32=C.windll.user32
  user32.SetProcessDpiAwarenessContext(C.c_void_p(-4))
  user32.ClientToScreen.argtypes=[W.HWND,C.POINTER(W.POINT)]
  user32.GetAncestor.argtypes=[W.HWND,W.UINT]
  user32.GetAncestor.restype=W.HWND
  user32.SetWindowPos.argtypes=[W.HWND,W.HWND,C.c_int,C.c_int,C.c_int,C.c_int,W.UINT]
  hwnd=int(chrome('return String(window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle)'),16)
  user32.SetForegroundWindow.argtypes=[W.HWND]
  user32.GetForegroundWindow.restype=W.HWND
  chrome('window.moveTo(80,55)')
  time.sleep(.25)
  origin=W.POINT()
  assert user32.ClientToScreen(hwnd,C.byref(origin))
  assert user32.SetWindowPos(hwnd,C.c_void_p(-1),0,0,0,0,0x43)
  backing=tk.Tk()
  try:
   backing.title('Sona Acrylic reference window')
   backing.configure(background='#000000')
   backing.geometry('270x480')
   backing.update()
   assert user32.SetWindowPos(user32.GetAncestor(backing.winfo_id(),2),hwnd,
                              origin.x-60,origin.y+95,490,560,0x50)
   backing.update()
   assert user32.SetCursorPos(origin.x+410,origin.y+85)
   user32.mouse_event(2,0,0,0,0)
   user32.mouse_event(4,0,0,0,0)
   if os.getenv('SONA_GLASS_PROBE') == 'force-frame':
    class Margins(C.Structure):
     _fields_=[(name,C.c_int) for name in ('left','right','top','bottom')]
    dwm=C.windll.dwmapi
    dwm.DwmExtendFrameIntoClientArea.argtypes=[W.HWND,C.POINTER(Margins)]
    assert dwm.DwmExtendFrameIntoClientArea(hwnd,C.byref(Margins(-1,-1,-1,-1)))==0
   time.sleep(.65)
   check('sona_foreground_for_desktop_acrylic',user32.GetForegroundWindow()==hwnd)
   point=(origin.x+130,origin.y+365)
   reference=(origin.x-14,origin.y+365)
   dwm=C.windll.dwmapi
   dwm.DwmGetWindowAttribute.argtypes=[W.HWND,W.DWORD,W.LPVOID,W.DWORD]
   kind=C.c_int()
   hr=dwm.DwmGetWindowAttribute(hwnd,38,C.byref(kind),C.sizeof(kind))
   print('Actual Sona HWND backdrop',{'result':hr,'kind':kind.value},flush=True)
   check('windows_hwnd_uses_desktop_acrylic',hr==0 and kind.value==3,kind.value)
   dark_frame=ImageGrab.grab()
   dark_frame.save(out/'native-backdrop-dark.png')
   dark_pixel=dark_frame.getpixel(point)
   dark_reference=dark_frame.getpixel(reference)
   backing.configure(background='#ffffff')
   backing.update()
   time.sleep(.65)
   light_frame=ImageGrab.grab()
   light_frame.save(out/'native-backdrop-light.png')
   light_pixel=light_frame.getpixel(point)
   light_reference=light_frame.getpixel(reference)
   check('reference_window_behind_sona_changes_brightness',
         sum(light_reference[:3])-sum(dark_reference[:3])>=480,
         {'dark':dark_reference,'light':light_reference})
   # Isolate the chrome iframe from the root Widget/WebRender path.
   chrome("""document.getElementById('sona-shell-frame').style.visibility='hidden';return true;""")
   for variant in ('native-root','force-transparent-widget'):
    if variant=='force-transparent-widget':
     chrome("""document.documentElement.style.setProperty('opacity','0.999','important');return true;""")
    measured=[]
    for color in ('#000000','#ffffff'):
     backing.configure(background=color)
     backing.update()
     time.sleep(.55)
     measured.append(ImageGrab.grab().getpixel(point))
    print('Sona backdrop layer comparison',variant,measured,flush=True)
   chrome("""document.documentElement.style.removeProperty('opacity');
      document.getElementById('sona-shell-frame').style.removeProperty('visibility');return true;""")
   class Accent(C.Structure):
    _fields_=[('state',C.c_int),('flags',W.DWORD),('color',W.DWORD),('animation',C.c_int)]
   class Composition(C.Structure):
    _fields_=[('attribute',C.c_int),('data',C.c_void_p),('size',C.c_size_t)]
   user32.SetWindowCompositionAttribute.argtypes=[W.HWND,C.POINTER(Composition)]
   dwm.DwmSetWindowAttribute.argtypes=[W.HWND,W.DWORD,W.LPVOID,W.DWORD]
   def request_accent(mode):
    policy=Accent(mode,0,0x4cf5f5f5,0)
    update=Composition(19,C.cast(C.pointer(policy),C.c_void_p),C.sizeof(policy))
    return user32.SetWindowCompositionAttribute(hwnd,C.byref(update))
   disabled=C.c_int(1)
   assert dwm.DwmSetWindowAttribute(hwnd,38,C.byref(disabled),C.sizeof(disabled))==0
   try:
    for mode in (3,4):
     accepted=request_accent(mode)
     measured=[]
     for color in ('#000000','#ffffff'):
      backing.configure(background=color)
      backing.update()
      time.sleep(.65)
      measured.append(ImageGrab.grab().getpixel(point))
     print('Alternative Windows accent',mode,accepted,measured,flush=True)
   finally:
    request_accent(0)
    dwm.DwmSetWindowAttribute(hwnd,38,C.byref(kind),C.sizeof(kind))
   check('sidebar_backdrop_tracks_window_behind_sona',
         sum(light_pixel[:3])-sum(dark_pixel[:3])>=24,
         {'dark':dark_pixel,'light':light_pixel})
  finally:
   backing.destroy()
   user32.SetWindowPos(hwnd,C.c_void_p(-2),0,0,0,0,0x43)
  screenshot('sona-sidebar-matte.png')
  content('scrollTo(0,140);return true;')
  check('page_fixture_scrolled',wait(lambda: content('return scrollY>=139')))
  check('matte_toolbar_samples_scrolled_contents', wait(lambda: chrome("""
    const glass=document.getElementById('sona-page-glass');
    if(!glass||glass.hidden||!glass.width||!glass.height)return false;
    const [r,g,b,a]=glass.getContext('2d').getImageData(4,4,1,1).data;
    return a===255&&r<100&&g>100&&b>90&&getComputedStyle(glass).filter.includes('grayscale(1)');
  """)))
  screenshot('sona-toolbar-matte-scrolled.png')
  content('scrollTo(0,0);return true;')
  check('matte_returns_to_neutral_at_top',
        wait(lambda: chrome("return document.getElementById('sona-page-glass').hidden")))
  call('browser.settings.set', {'mattePanel': False})
  content("document.getElementById('matte-probe').remove();return true;")
  call('browser.bookmarks.sidebar', False)
  wait(lambda: geometry()['left']<1 and geometry()['page']['left']<1)
  samples=run("""const actor=document.getElementById('sona-shell-frame').browsingContext.currentWindowGlobal.getActor('SonaApp');
  await Sona.dispatch('browser.bookmarks.sidebar',true);
  const started=performance.now(),samples=[];
  while(performance.now()-started<300){
    const toolbar=await actor.sendQuery('testing',"return document.querySelector('.classic-toolbar').getBoundingClientRect().left");
    samples.push([gBrowser.selectedBrowser.getBoundingClientRect().left,toolbar]);
    await new Promise(requestAnimationFrame);
  }
  return samples;""")
  check('animation_shares_workspace_geometry', any(0<page<after['page']['left'] and 0<toolbar<after['left'] and abs(page-toolbar)<12 for page,toolbar in samples), samples)
  check('document_and_zoom_preserved', identity==chrome('return gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.innerWindowId') and after['page']['zoom']==before['page']['zoom'])
  check('page_receives_hits_outside_sidebar', chrome('return document.elementFromPoint(innerWidth-10,innerHeight-10)?.id!=="sona-shell-frame"'))
  check('old_action_grid_hidden', shell('return getComputedStyle(document.querySelector(".bookmark-actions")).display==="none"'))
  check('scroll_thumb_tracks_tree_at_bottom', shell("""
  const tree=document.querySelector('.bookmark-tree'),thumb=tree.parentElement.querySelector('.bookmark-scroll-thumb');
  const sheet=new CSSStyleSheet();
  sheet.replaceSync('.bookmark-tree::after{content:"";display:block;height:3000px}');
  document.adoptedStyleSheets.push(sheet);
  try{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    tree.scrollTop=tree.scrollHeight;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return !thumb.hidden && thumb.offsetHeight>=24 && Math.abs(thumb.getBoundingClientRect().bottom-tree.getBoundingClientRect().bottom)<=1;
  }finally{
    document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==sheet);
    tree.scrollTop=0;
  }"""))
  open_actions()
  rows = shell("""const menu=document.querySelector('.bookmark-action-menu');
  return [...menu.children].map(button=>{
    const rect=button.getBoundingClientRect();
    return {width:rect.width,height:rect.height,top:rect.top,bottom:rect.bottom,
      menuWidth:menu.clientWidth,clipped:button.scrollHeight>button.clientHeight};
  });""")
  check('action_menu_labels_fit_distinct_full_width_rows', len(rows)>1 and all(
   row['width']>=row['menuWidth']-12 and row['height']>=28 and not row['clipped']
   and (i==0 or row['top']>=rows[i-1]['bottom']) for i,row in enumerate(rows)), rows)
  click('#bookmarkSettingsAction')
  wait(lambda: call('browser.state.get')['settingsOverlayReady'])
  check('bookmark_settings_targets_bookmarks_controls', wait(lambda: ui(
   'return document.querySelector("#control-settings-bookmarksBarMode")?.classList.contains("setting-highlight");', 'settings')))
  chrome('Sona.closeSettings()')
  wait(lambda: not call('browser.state.get')['settingsOverlayOpen'])
  click('.bookmark-header-button:first-of-type')
  wait(lambda: shell('return !!document.getElementById("bookmarkTitle")'))
  root_mark = save_mark('Начальная страница')
  parent = folder('Работа')
  nested = folder('Материалы', parent['id'])
  click('.bookmark-header-button:first-of-type')
  wait(lambda: shell('return document.getElementById("bookmarkTitle")?.value==="Начальная страница"'))
  moved = save_mark('Переименованная страница', nested['id'])
  check('duplicate_opens_existing_and_saves_same_places_guid', moved['guid']==root_mark['guid'] and moved['parentId']==nested['id'])
  search(url)
  check('searches_address', shell('return [...document.querySelectorAll(".bookmarks-menu .bookmark-label")].some(n=>n.textContent==="Переименованная страница")'))
  search('Переименованная')
  check('searches_title', shell('return document.querySelectorAll(".bookmarks-menu .bookmark-line").length===1'))
  search('')
  bridge('browser.bookmarks.change', {'kind': 'move', 'id': moved['id'], 'parentId': parent['id'], 'beforeId': nested['id']})
  rows = call('browser.bookmarks.get')
  keyed = {row['id']: row for row in rows}
  check('places_move_before', keyed[moved['id']]['parentId']==parent['id'] and keyed[moved['id']]['order']<keyed[nested['id']]['order'])
  bridge('browser.bookmarks.change', {'kind': 'move', 'id': moved['id'], 'parentId': parent['id'], 'afterId': nested['id']})
  keyed = {row['id']: row for row in call('browser.bookmarks.get')}
  check('places_move_after', keyed[moved['id']]['order']>keyed[nested['id']]['order'])
  wait(lambda: shell('const q=id=>[...document.querySelectorAll(".bookmarks-menu [data-bookmark-id]")].find(n=>Number(n.dataset.bookmarkId)===id);'
   'const source=q('+str(moved['id'])+'),target=q('+str(nested['id'])+');'
   'return source&&target&&source.getBoundingClientRect().top>target.getBoundingClientRect().top;'))
  drag_item(moved['id'], nested['id'])
  wait(lambda: any(row['id']==moved['id'] and row['parentId']==nested['id'] for row in call('browser.bookmarks.get')))
  check('pointer_drag_moves_to_folder', True)
  bridge('browser.bookmarks.change', {'kind': 'move', 'id': moved['id'], 'parentId': parent['id'], 'afterId': nested['id']})
  bridge('browser.bookmarks.change', {'kind': 'remove', 'id': nested['id']})
  check('places_remove_folder', not any(row['id']==nested['id'] for row in call('browser.bookmarks.get')))
  html = root / 'sidebar-import.html'
  html.write_text('<!DOCTYPE NETSCAPE-Bookmark-file-1><TITLE>Bookmarks</TITLE><DL><p><DT><H3>Imported folder</H3><DL><p><DT><A HREF="https://example.org/imported">Imported bookmark</A></DL><p></DL><p>',encoding='utf-8')
  run('return await Sona.importFile("bookmarks",'+json.dumps(str(html))+');')
  check('native_html_import', any(row['url']=='https://example.org/imported' and row['parentId'] for row in call('browser.bookmarks.get')))
  chromium = root / 'Bookmarks'
  chromium.write_text(json.dumps({'roots':{'bookmark_bar':{'type':'folder','name':'Chromium','children':[
   {'type':'url','name':'Imported from Chromium','url':'https://example.org/chromium'},
  ]}}}), encoding='utf-8')
  import_chromium = 'return await Sona.importFile("chromium-bookmarks",'+json.dumps(str(chromium))+');'
  check('native_chromium_import_and_duplicate_skip',run(import_chromium)['imported']==2 and run(import_chromium)['imported']==0)
  check('chromium_import_preserves_existing_places_items', keyed[moved['id']]['guid'] in
   [row['guid'] for row in call('browser.bookmarks.get')])
  call('browser.bookmarks.homeFavorite', {'id':moved['id'], 'selected':True})
  wait(lambda: shell('return [...document.querySelectorAll(".bookmark-group-label")].some(n=>n.textContent==="Избранное")'))
  call('browser.settings.set', {'theme':'dark'})
  wait(lambda: shell('return document.body.dataset.theme==="dark"'))
  screenshot('sona-sidebar-dark.png')
  click('.bookmark-sections button:last-child')
  click('.bookmark-header-button:first-of-type')
  wait(lambda: bool(read_entries()))
  wait(lambda: shell('return !!document.querySelector(".bookmark-line[data-unread]")'))
  click('.bookmark-line[data-unread] button:nth-child(2)')
  wait(lambda: read_entries()[0]['read'])
  screenshot('sona-reading-list.png')
  check('reading_list_add_and_mark', len(read_entries())==1)
  click('#sidebarButton')
  wait(lambda: geometry()['page']['left']<1 and geometry()['left']<1)
  check('closed_restores_width', abs(geometry()['address']-before['address'])<2)
  chrome('window.resizeTo(670,700)')
  wait(lambda: chrome('return innerWidth<800'))
  click('#sidebarButton')
  time.sleep(.35)
  narrow = geometry()
  check('narrow_caption_and_address_accessible', narrow['addressWidth']>20 and narrow['caption']<=narrow['right'] and abs(narrow['left']-narrow['page']['left'])<2,narrow)
  chrome('Services.prefs.setIntPref("ui.prefersReducedMotion",1)')
  wait(lambda: shell('return matchMedia("(prefers-reduced-motion:reduce)").matches'))
  click('#sidebarButton')
  wait(lambda: not call('browser.state.get')['bookmarksSidebarVisible'])
  check('reduced_motion_disables_sidebar_transition', call('browser.state.get')['bookmarksSidebarMotion']['duration']==0
   and shell('return !document.body.hasAttribute("data-bookmarks-moving")'))
  stop()
  start()
  check('reading_list_persists_after_restart', read_entries()[0]['read'])
  check('bookmark_persists_after_restart', any(row['guid']==moved['guid'] and row['parentId']==parent['id'] for row in call('browser.bookmarks.get')))
  click('#sidebarButton')
  click('.bookmark-sections button:last-child')
  wait(lambda: shell('return !!document.querySelector(".bookmark-line button:nth-child(3)")'))
  click('.bookmark-line button:nth-child(3)')
  wait(lambda: not read_entries())
  check('reading_list_removes_entry', True)
 report['passed'] = True
except Exception as error:
 report['error'] = str(error)
 try:
  screenshot('sidebar-failure.png')
  report['console'] = chrome('return Services.console.getMessageArray().map(x=>x.message).slice(-30)')
 except Exception:
  pass
 raise
finally:
 try:
  stop()
 finally:
  (out / 'bookmarks-sidebar.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
  log.close()
  server.shutdown()
  restore_material()
