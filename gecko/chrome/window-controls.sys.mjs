// Native Windows drag, identical to the existing CEF WM_NCLBUTTONDOWN path.
const {setTimeout:startupTimeout,clearTimeout:cancelStartupTimeout}=ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
const {ctypes}=ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
let native;
export function beginDrag(){if(Services.appinfo.OS!=='WINNT')return false;if(!native){const dll=ctypes.open('user32.dll'),abi=(ctypes.winapi_abi||ctypes.default_abi);native={dll,foreground:dll.declare('GetForegroundWindow',abi,ctypes.uintptr_t),pid:dll.declare('GetWindowThreadProcessId',abi,ctypes.uint32_t,ctypes.uintptr_t,ctypes.uint32_t.ptr),release:dll.declare('ReleaseCapture',abi,ctypes.bool),send:dll.declare('SendMessageW',abi,ctypes.intptr_t,ctypes.uintptr_t,ctypes.uint32_t,ctypes.uintptr_t,ctypes.intptr_t)};}const hwnd=native.foreground(),pid=ctypes.uint32_t();native.pid(hwnd,pid.address());if(pid.value!==Services.appinfo.processID)throw Error('The active window is not owned by Sona');native.release();native.send(hwnd,0xA1,2,0);return true;}

const libraries=new Map();
function library(name){if(!libraries.has(name))libraries.set(name,ctypes.open(name));return libraries.get(name);}
function handle(win){const raw=win.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;const value=String(raw);return ctypes.uintptr_t(ctypes.UInt64(/^0x/i.test(value)?value:'0x'+value));}
let iconHandles;
export function brand(win){
 if(Services.appinfo.OS!=='WINNT')return;
 const result=win.__sonaBrand={group:false,icons:false};
 try{Cc['@mozilla.org/windows-taskbar;1'].getService(Ci.nsIWinTaskbar).setGroupIdForWindow(win,'Sona.Preview');result.group=true;}catch(error){result.groupError=String(error);}
 try{
  const abi=(ctypes.winapi_abi||ctypes.default_abi),user=library('user32.dll'),hwnd=handle(win),path=Services.dirsvc.get('GreD',Ci.nsIFile);for(const part of ['sona','chrome','ui','sona-app-icon.ico'])path.append(part);
  const load=user.declare('LoadImageW',abi,ctypes.voidptr_t,ctypes.uintptr_t,(ctypes.char16_t||ctypes.jschar).ptr,ctypes.uint32_t,ctypes.int,ctypes.int,ctypes.uint32_t);
  const send=user.declare('SendMessageW',abi,ctypes.intptr_t,ctypes.uintptr_t,ctypes.uint32_t,ctypes.uintptr_t,ctypes.voidptr_t);
  iconHandles??=[load(0,path.path,1,16,16,0x10),load(0,path.path,1,32,32,0x10)];if(iconHandles.some(h=>h.isNull()))throw Error('Cannot load Sona icons');for(let i=0;i<2;i++)send(hwnd,0x80,i,iconHandles[i]);result.icons=true;
 }catch(error){result.iconError=String(error);}
 try{library('shell32.dll').declare('SetCurrentProcessExplicitAppUserModelID',(ctypes.winapi_abi||ctypes.default_abi),ctypes.long,(ctypes.char16_t||ctypes.jschar).ptr)('Sona.Preview');}catch(error){result.processError=String(error);}
 return result;
}
const backdropWindows=new WeakMap();
export function material(win,enabled){
 const root=win.document.documentElement;
 if(Services.appinfo.OS!=='WINNT')return {enabled:false,native:false};
 let state=backdropWindows.get(win);
 if(!state){
  const abi=ctypes.winapi_abi||ctypes.default_abi;
  const dwm=library('dwmapi.dll');
  const set=dwm.declare('DwmSetWindowAttribute',abi,ctypes.long,
   ctypes.uintptr_t,ctypes.uint32_t,ctypes.int.ptr,ctypes.uint32_t);
  const margins=ctypes.StructType('SonaAcrylicMargins',[
   {left:ctypes.int},{right:ctypes.int},{top:ctypes.int},{bottom:ctypes.int},
  ]);
  const extend=dwm.declare('DwmExtendFrameIntoClientArea',abi,ctypes.long,ctypes.uintptr_t,margins.ptr);
  const apply=()=>{
   if(win.closed)return;
   const hwnd=handle(win),type=ctypes.int(state.enabled?3:1);
   const result=Number(set(hwnd,38,type.address(),4));
   const edge=state.enabled&&result===0?-1:0;
   const frame=Number(extend(hwnd,margins(edge,edge,edge,edge).address()));
   state.dwm={result,frame};
   root.toggleAttribute('sona-desktop-glass',state.enabled&&result===0&&frame===0);
  };
  state={enabled:false,apply};backdropWindows.set(win,state);
  win.addEventListener('activate',()=>win.requestAnimationFrame(apply));
  win.addEventListener('sizemodechange',()=>win.requestAnimationFrame(apply));
 }
 state.enabled=!!enabled;
 root.toggleAttribute('windowsmica',state.enabled);
 root.removeAttribute('sona-matte');
 state.apply();
 win.requestAnimationFrame(()=>win.requestAnimationFrame(state.apply));
 return {enabled:!!enabled,native:true,desktop:root.hasAttribute('sona-desktop-glass'),dwm:state.dwm};
}

export function isDefault(){
 if(Services.appinfo.OS!=='WINNT')return false;
 return ['http','https'].every(scheme=>{let key;try{key=Cc['@mozilla.org/windows-registry-key;1'].createInstance(Ci.nsIWindowsRegKey);key.open(Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,'Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\'+scheme+'\\UserChoice',Ci.nsIWindowsRegKey.ACCESS_READ);return key.readStringValue('ProgId')==='Sona.URL';}catch{return false;}finally{key?.close();}});
}

// Windows owns initial presentation and taskbar animations. The early chrome
// stylesheet paints the Sona surface while the content actor initializes.
function releaseStartup(win) {
 const state = win.__sonaStartupPresentation;
 if (!state) return;
 state.uncloak?.();
 state.uncloak = null;
 if(Services.appinfo.OS==='WINNT'){
  try{
   const abi=ctypes.winapi_abi||ctypes.default_abi;
   library('user32.dll').declare('ShowWindow',abi,ctypes.bool,ctypes.uintptr_t,ctypes.int)(handle(win),5);
  }catch(error){console.error('Sona window presentation',error);}
 }
 cancelStartupTimeout(state.timeout);
}
export function prepareStartup(win) {
 if (win.__sonaStartupPresentation) return;
 win.document.title = 'Sona';
 const state = win.__sonaStartupPresentation = {preparedAt: Date.now(), mode: 'native'};
 if (Services.appinfo.OS !== 'WINNT') return;

 const cloak = () => {
  if(win.closed || state.presentedAt || state.uncloak) return;
  try {
   const hwnd=handle(win);
   if(hwnd.isNull?.() || String(hwnd)==='0')throw Error('Window handle pending');
   const abi=ctypes.winapi_abi||ctypes.default_abi;

   const user=library('user32.dll');
   const get=user.declare('GetWindowLongW',abi,ctypes.long,ctypes.uintptr_t,ctypes.int);
   const style=user.declare('SetWindowLongW',abi,ctypes.long,ctypes.uintptr_t,ctypes.int,ctypes.long);
   const alpha=user.declare('SetLayeredWindowAttributes',abi,ctypes.bool,ctypes.uintptr_t,ctypes.uint32_t,ctypes.uint8_t,ctypes.uint32_t);
   const previous=get(hwnd,-20);
   style(hwnd,-20,previous|0x80000);
   if(!alpha(hwnd,0,0,2)){style(hwnd,-20,previous);throw Error('Window opacity pending');}
   state.uncloak=()=>{alpha(hwnd,0,255,2);style(hwnd,-20,previous);};

  } catch(error) {
   if(Date.now()-state.preparedAt<10000)startupTimeout(cloak,16);
  }
 };
 cloak();
 state.timeout=startupTimeout(()=>releaseStartup(win),3000);

}
export function revealStartup(win) {
 if (win.closed || win.__sonaStartupPresentation?.presentedAt) return;
 prepareStartup(win);
 ChromeUtils.importESModule('chrome://sona/content/lifecycle.sys.mjs').consolidateAutomaticStart(win);
 if (win.closed) return;
 win.__sonaStartupPresentation.presentedAt = Date.now();

 const flush = async () => {
  try {
   const frame=win.document.getElementById('sona-shell-frame');
   await frame?.browsingContext?.currentWindowGlobal?.getActor('SonaApp').sendQuery('preparePresentation');
   win.document.documentElement.getBoundingClientRect();
   win.windowUtils.updateLayerTree();
  } catch(error) { console.error('Sona initial paint',error); }
  if(win.closed)return;
  releaseStartup(win);
  win.dispatchEvent(new win.Event('SonaPresented'));
 };
 win.setTimeout(flush,0);
}

// Poll in the parent process: remote surface pointer capture ends on adoption.
let dragInput;
export function tabDragPointer(win) {
 if(!dragInput){
  const u=library('user32.dll'),abi=ctypes.winapi_abi||ctypes.default_abi;
  const Point=ctypes.StructType('SonaDragPoint',[{x:ctypes.long},{y:ctypes.long}]);
  const Rect=ctypes.StructType('SonaDragRect',[{left:ctypes.long},{top:ctypes.long},{right:ctypes.long},{bottom:ctypes.long}]);
  dragInput={Point,Rect,position:u.declare('GetCursorPos',abi,ctypes.bool,Point.ptr),rect:u.declare('GetWindowRect',abi,ctypes.bool,ctypes.uintptr_t,Rect.ptr),key:u.declare('GetAsyncKeyState',abi,ctypes.int16_t,ctypes.int),move:u.declare('SetWindowPos',abi,ctypes.bool,ctypes.uintptr_t,ctypes.uintptr_t,ctypes.int,ctypes.int,ctypes.int,ctypes.int,ctypes.uint32_t)};
 }
 const p=dragInput.Point(),r=dragInput.Rect();
 if(!dragInput.position(p.address())||!dragInput.rect(handle(win),r.address()))throw Error('Cannot read tab drag pointer');
 return {x:win.screenX+(p.x-r.left)/win.devicePixelRatio,y:win.screenY+(p.y-r.top)/win.devicePixelRatio,down:!!(dragInput.key(1)&0x8000),escape:!!(dragInput.key(27)&0x8000)};
}

// Position the detached HWND in native screen pixels. Gecko's moveTo clamps
// browser windows to the available desktop, unlike a held native window drag.
export function moveTabDragWindow(win,dx,dy){
 const hwnd=handle(win),r=dragInput.Rect();
 if(!dragInput.rect(hwnd,r.address()))throw Error('Cannot read detached window bounds');
 const x=Math.round(dx*win.devicePixelRatio),y=Math.round(dy*win.devicePixelRatio);
 if((x||y)&&!dragInput.move(hwnd,0,Number(r.left)+x,Number(r.top)+y,0,0,0x15))
  throw Error('Cannot position detached window');
}
