"""Exercise controls inside the installed Gecko shell through its test-only actor."""
import ctypes as C
import json


def verify_toolbar(m, check, wait):
    def shell(code):
        script = ('const done=arguments[arguments.length-1];'
                  'document.getElementById("sona-shell-frame").browsingContext.currentWindowGlobal'
                  '.getActor("SonaApp").sendQuery("testing",' + json.dumps(code) +
                  ').then(done,error=>done({error:String(error)}));')
        value = m.execute_async_script(script)
        if isinstance(value, dict) and 'error' in value:
            raise AssertionError(value['error'])
        return value

    user32 = C.windll.user32
    class Point(C.Structure):
        _fields_ = [('x', C.c_long), ('y', C.c_long)]

    def maximize_hit_test():
        geometry = m.execute_script("""
            const region=document.getElementById('sona-native-maximize');
            if(!region)return null;
            const r=region.getBoundingClientRect();
            return {x:r.x+r.width/2,y:r.y+r.height/2,scale:devicePixelRatio,
              hwnd:String(window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIBaseWindow).nativeHandle)};
        """)
        if not geometry:
            return None
        hwnd = C.c_void_p(int(geometry['hwnd'], 16))
        point = Point(round(geometry['x'] * geometry['scale']), round(geometry['y'] * geometry['scale']))
        if not user32.ClientToScreen(hwnd, C.byref(point)):
            return None
        coordinates = (point.x & 0xffff) | ((point.y & 0xffff) << 16)
        return user32.SendMessageW(hwnd, 0x84, 0, C.c_ssize_t(coordinates))

    check('windows_snap_maximize_hit_target', wait(lambda: maximize_hit_test() == 9))
    check('caption_highlight_covers_entire_button', shell("""
        return ['windowMinimize','windowMaximize','windowClose'].every(id=>{
          const button=document.getElementById(id), style=getComputedStyle(button,'::before');
          return style.borderRadius==='0px' && style.top==='0px' && style.right==='0px'
            && style.bottom==='0px' && style.left==='0px';
        });
    """))
    check('tab_overview_precedes_new_tab', shell("""
        const plus=document.getElementById('newTabButton'), overview=plus.previousElementSibling;
        return overview?.classList.contains('navigation-toolbar-button')
          && overview.getBoundingClientRect().right<=plus.getBoundingClientRect().left;
    """))

    count = "return document.querySelectorAll('#tabStrip > [data-tab-id]').length;"
    wait(lambda: shell(count) == 1)
    for expected in range(2, 5):
        shell("document.getElementById('newTabButton').click();")
        wait(lambda: shell(count) == expected)
    print('strip layout',shell("""
        await new Promise(r=>setTimeout(r,700));
        const nodes=[...document.querySelectorAll('.tabs-zone,#tabStrip,#tabStrip > [data-tab-id]')];
        return JSON.stringify({size:[innerWidth,innerHeight],expanded:document.body.dataset.adaptiveExpanded,
          nodes:nodes.map(n=>{const r=n.getBoundingClientRect(), s=getComputedStyle(n);
            return [n.className,r.toJSON(),s.visibility,s.opacity,s.pointerEvents,document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,200)]})});
    """),flush=True)
    check('four_visible_clickable_tabs', wait(lambda: shell("""
        return [...document.querySelectorAll('#tabStrip > [data-tab-id]')].every(tab=>{
          const r=tab.getBoundingClientRect();
          return r.width>0 && r.height>0 && tab.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        });
    """)))
    shell("document.querySelector('#tabStrip > [data-tab-id]').click();")
    check('select_first_tab_from_strip', wait(lambda: shell("return document.querySelector('#tabStrip > :first-child').classList.contains('active');")))
    def centered(selector):
        return shell("""
            const button=document.querySelector(%s), icon=button?.querySelector('svg');
            if(!icon)return false;
            const b=button.getBoundingClientRect(), i=icon.getBoundingClientRect();
            return i.width>0 && Math.abs((b.left+b.right-i.left-i.right)/2)<=0.75
                && Math.abs((b.top+b.bottom-i.top-i.bottom)/2)<=0.75;
        """ % json.dumps(selector))

    check('tab_close_glyph_centered', wait(lambda: centered('#tabStrip .active [data-close-tab]')))
    shell("document.querySelector('.classic-address-wrap .navigation-toolbar-button').click();")
    check('overview_close_glyph_centered', wait(lambda: centered('.overview-caption > button')))
    shell("await window.browserShell.setOverview(false);")
    for expected in [3, 2, 1]:
        shell("document.querySelector('#tabStrip > :last-child [data-close-tab]').click();")
        wait(lambda: shell(count) == expected)
    check('close_tabs_from_strip', m.execute_script('return gBrowser.tabs.length') == 1)
    sidebar_fill = "return getComputedStyle(document.querySelector('#sidebarButton .sidebar-icon-fill')).fill;"
    check('sidebar_icon_outline_when_closed', shell(sidebar_fill) == 'none')
    shell("document.getElementById('sidebarButton').click();")
    check('sidebar_icon_filled_when_open', wait(lambda: shell(sidebar_fill) != 'none'))
    check('bookmark_search_inside_panel_without_autofocus',wait(lambda: shell("""
        const panel=document.querySelector('.bookmarks-menu'), search=panel.querySelector('.navigation-search');
        const r=search.getBoundingClientRect(), p=panel.getBoundingClientRect();
        return !panel.hidden && r.width>0 && r.left>=p.left && r.right<=p.right && p.width<=276 && document.activeElement!==search;
    """)))
    geometry = shell("""
        const tree=document.querySelector('.bookmarks-menu .bookmark-tree');
        const thumb=tree.parentElement.querySelector('.bookmark-scroll-thumb');
        const sheet=new document.defaultView.CSSStyleSheet();
        sheet.replaceSync('.bookmarks-menu .bookmark-tree::after{content:"";display:block;height:3000px}');
        document.adoptedStyleSheets.push(sheet);
        try {
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            tree.scrollTop=tree.scrollHeight;
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            return JSON.stringify({size:thumb.offsetHeight,hidden:thumb.hidden,top:tree.scrollTop,
                radius:parseFloat(getComputedStyle(thumb,'::before').borderRadius),
                delta:tree.getBoundingClientRect().bottom-thumb.getBoundingClientRect().bottom});
        } finally { document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==sheet);tree.scrollTop=0; }
    """)
    g=json.loads(geometry)
    check('rounded_bookmark_thumb_tracks_scrolling', g['size']>=24 and not g['hidden'] and
          g['top']>0 and g['radius']>0 and abs(g['delta'])<=1, g)
    shell("document.getElementById('sidebarButton').click();")
    check('sidebar_icon_returns_to_outline', wait(lambda: shell(sidebar_fill) == 'none'))
