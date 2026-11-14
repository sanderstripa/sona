"""Exercise the production controller with a held native mouse and live browsers."""
import ctypes as C,time

def verify_tab_drag(m,check,wait):
 u=C.windll.user32
 class Rect(C.Structure):_fields_=[('left',C.c_long),('top',C.c_long),('right',C.c_long),('bottom',C.c_long)]
 info=m.execute_script('''
 window.__dragSaved={layout:Sona.config.settings.layout};
 Sona.config.settings.layout='classic';Sona.notify();
 window.__dragTabs=[gBrowser.addTrustedTab('about:blank',{skipAnimation:true}),gBrowser.addTrustedTab('about:blank',{skipAnimation:true})];
 gBrowser.selectedTab=__dragTabs[0];Sona.notify();
 return {hwnd:String(window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle),scale:devicePixelRatio};
 ''')
 wait(lambda:m.execute_script('return Sona.tabDragLayout?.some(r=>r.id===Sona.native.tabID(__dragTabs[0]))'))
 rect=Rect();u.GetWindowRect(C.c_void_p(int(info['hwnd'],16)),C.byref(rect))
 def point(x,y):u.SetCursorPos(round(rect.left+x*info['scale']),round(rect.top+y*info['scale']))
 row=m.execute_script('return Sona.tabDragLayout.find(r=>r.id===Sona.native.tabID(__dragTabs[0]))')
 try:
  point(row['x']+20,row['y']+20);u.mouse_event(2,0,0,0,0)
  check('native_tab_drag_started',m.execute_async_script('const done=arguments[arguments.length-1];Sona.dispatch("browser.tabDrag.begin",{id:Sona.native.tabID(__dragTabs[0]),layout:Sona.tabDragLayout,offsetX:20,offsetY:20}).then(done,e=>done(String(e)));') is True)
  bottom=m.execute_script('return Math.max(...Sona.tabDragLayout.map(r=>r.y+r.height))')
  point(row['x']+30,bottom+25);time.sleep(.25)
  status=m.execute_script('''const t=__dragTabs[0];return {inSource:[...gBrowser.tabs].includes(t),closing:!!t.closing,windows:[...Services.wm.getEnumerator("navigator:browser")].length,pointer:ChromeUtils.importESModule("chrome://sona/content/window-controls.sys.mjs").tabDragPointer(window),rows:Sona.tabDragLayout,error:Sona.lastTabDragError||null};''')
  check('native_tab_drag_deadzone',status['inSource'] and not status['closing'] and not status['error'],status)
  m.execute_script('window.__dragContext=__dragTabs[0].linkedBrowser.browsingContext.id;')
  point(row['x']+30,bottom+50)
  wait(lambda:m.execute_script('if(Sona.lastTabDragError)throw Error(Sona.lastTabDragError);return [...Services.wm.getEnumerator("navigator:browser")].some(w=>w!==window&&w.Sona?.ready&&[...w.gBrowser.tabs].some(t=>t.linkedBrowser.browsingContext.id===__dragContext))'))
  check('native_detach_keeps_live_browsing_context',True)
  wait(lambda:m.execute_script('''const w=[...Services.wm.getEnumerator("navigator:browser")].find(w=>w!==window&&w.Sona?.ready);if(!w)return false;const t=[...w.gBrowser.tabs].find(t=>t.linkedBrowser.browsingContext.id===__dragContext),r=w.Sona.tabDragLayout?.find(r=>r.id===w.Sona.native.tabID(t));if(!r)return false;const p=ChromeUtils.importESModule("chrome://sona/content/window-controls.sys.mjs").tabDragPointer(w);return Math.abs(p.x-w.mozInnerScreenX-r.x-20)<4&&Math.abs(p.y-w.mozInnerScreenY-r.y-20)<4;'''))
  check('native_detach_preserves_cursor_grab_point',True)
  # Return to an existing source tab: the controller must adopt before release.
  row2=m.execute_script('return Sona.tabDragLayout[0]')
  point(row2['x']+20,row2['y']+20)
  wait(lambda:m.execute_script('return [...gBrowser.tabs].some(t=>t.linkedBrowser.browsingContext.id===__dragContext)'))
  check('native_reattach_before_mouseup',True)
 finally:
  u.mouse_event(4,0,0,0,0);time.sleep(.15)
  m.execute_script('''for(const w of [...Services.wm.getEnumerator('navigator:browser')])for(const t of [...w.gBrowser.tabs])if(t===__dragTabs[1]||t.linkedBrowser.browsingContext.id===window.__dragContext)w.gBrowser.removeTab(t,{animate:false});Sona.config.settings.layout=__dragSaved.layout;Sona.notify();''')
