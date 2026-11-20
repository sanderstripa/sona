"""Exercise the saved logo setting through the settings UI and real Home actor."""
import json
def verify_home(m,check,wait):
    def actor(frame,code):
        return m.execute_async_script('const done=arguments[arguments.length-1];'+frame+'.browsingContext.currentWindowGlobal.getActor("SonaApp").sendQuery("testing",'+json.dumps(code)+').then(done,e=>done({error:String(e)}));')
    home=lambda code:actor('gBrowser.selectedBrowser',code)
    settings=lambda code:actor('document.getElementById("sona-settings-frame")',code)
    m.execute_script('Sona.dispatch("browser.newTab");return true;')
    wait(lambda:m.execute_script('return gBrowser.selectedBrowser.currentURI.spec.endsWith("/home.html")'))
    check('home_logo_default_visible',wait(lambda:home('return document.body.classList.contains("home-ready")&&!document.getElementById("logo").hidden;') is True))
    m.execute_script('Sona.dispatch("browser.settings.openWindow","startup");return true;')
    wait(lambda:settings('return !!window.sonaSettings?.loaded;') is True)
    check('logo_switch_at_bottom_of_startup',wait(lambda:settings('return !!document.querySelector("#sectionContent .card:last-child #homeShowLogo");') is True))
    settings('document.getElementById("homeShowLogo").click();await window.sonaSettings.flush();document.getElementById("closeSettings").click();')
    check('home_search_centered_with_logo_hidden',wait(lambda:home('const r=document.getElementById("search").getBoundingClientRect();return document.getElementById("logo").hidden&&Math.abs((r.top+r.bottom)/2-innerHeight/2)<1&&Math.abs((r.left+r.right)/2-innerWidth/2)<1;') is True))
    saved=m.execute_async_script('const done=arguments[arguments.length-1];Sona.backend.IOUtils.readJSON(Sona.backend.PathUtils.join(Sona.backend.profile,"sona-settings.json")).then(x=>done(x.settings.homeShowLogo));')
    check('home_logo_choice_saved',saved is False)
    def dispatch(action,payload=None):
        return m.execute_async_script(
            'const done=arguments[2];Sona.dispatch(arguments[0],arguments[1]).then(done,e=>done({error:String(e)}));',
            script_args=[action,payload])
    def click_home():
        return actor('document.getElementById("sona-shell-frame")',
                     'const button=document.querySelector(".classic-toolbar [data-home]");'
                     'if(!button.offsetWidth)return false;button.click();return true;')
    custom='https://example.org/sona-home-test'
    for mode,target in [('custom',custom),('blank','about:blank'),('sona','/home.html')]:
        result=dispatch('browser.settings.set',{'homeMode':mode,'homeUrl':custom,
            'showHome':True,'addressOpenMode':'newIfOccupied'})
        check('set_home_'+mode, result.get('ok'), result)
        tab=m.execute_script('return Sona.native.tabID(gBrowser.selectedTab)')
        check('visible_home_button_'+mode,wait(lambda:click_home() is True))
        check('home_button_'+mode,wait(lambda:m.execute_script(
            'const spec=gBrowser.selectedBrowser.currentURI.spec;return Sona.native.tabID(gBrowser.selectedTab)===arguments[0]&&'
            '(arguments[1]==="sona"?spec.endsWith(arguments[2]):spec===arguments[2]);',
            script_args=[tab,mode,target])))
    restored=dispatch('browser.settings.set',{'showHome':False,'addressOpenMode':'current','homeUrl':''})
    check('restore_default_home_settings',restored.get('ok'),restored)
    m.execute_script('gBrowser.removeTab(gBrowser.selectedTab,{animate:false});return true;')
