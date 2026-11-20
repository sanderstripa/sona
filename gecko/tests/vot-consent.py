"""Check the bundled VOT against the real Gecko add-on manager."""

def verify_vot(m, check):
    result = m.execute_async_script('''
    const done=arguments[arguments.length-1];
    (async()=>{
        const {AddonManager}=ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
        const status=await Sona.dispatch("browser.vot.status");
        let rejected=false;
        try{await Sona.dispatch("browser.vot.install",{consent:true});}
        catch{rejected=true;}
        const install=await Sona.dispatch("browser.vot.install",{consent:true},{gesture:{at:Date.now()}});
        const addon=await AddonManager.getAddonByID("vot-ext@firefox");
        const policy=WebExtensionPolicy.getByID(addon.id);
        const active=addon.isActive&&policy?.canAccessURI(Services.io.newURI("https://www.youtube.com/watch?v=jNQXAC9IVRw"));
        const disabled=await Sona.dispatch("browser.vot.setEnabled",{enabled:false});
        const enabled=await Sona.dispatch("browser.vot.setEnabled",{enabled:true});
        return {initiallyInactive:!status.enabled,rejected,installed:install.installed,active,
            signed:addon.signedState>=AddonManager.SIGNEDSTATE_SIGNED,profileAddon:!addon.isBuiltin,
            disabled:!disabled.enabled,enabled:enabled.enabled};
    })().then(done,error=>done({error:String(error)}));
    ''')
    check('signed_vot_installs_with_consent_and_can_access_youtube',
          'error' not in result and all(result.values()), result)
