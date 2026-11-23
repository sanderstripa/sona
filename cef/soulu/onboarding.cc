#include "examples/soulu/browser_window.h"
#include "include/cef_parser.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_helpers.h"
#include <shellapi.h>
#include <shlobj.h>
#include <algorithm>
#include <functional>
#include <exception>

namespace soulu {
namespace {
class OnboardingTask final : public CefTask {
 public:
  explicit OnboardingTask(std::function<void()> fn):fn_(std::move(fn)){}
  void Execute() override {fn_();}
 private:
  std::function<void()> fn_;
  IMPLEMENT_REFCOUNTING(OnboardingTask);
};
CefRefPtr<CefValue> Value(CefRefPtr<CefDictionaryValue> d) {
  auto v=CefValue::Create();v->SetDictionary(d);return v;
}
bool RegisterDefaultBrowser() {
  wchar_t path[32768]={};if(!GetModuleFileNameW(nullptr,path,32768))return false;
  const std::wstring exe=path,command=L"\""+exe+L"\" \"%1\"";
  auto set=[](const wchar_t* key,const wchar_t* name,const std::wstring& value){
    HKEY handle=nullptr;
    if(RegCreateKeyExW(HKEY_CURRENT_USER,key,0,nullptr,0,KEY_SET_VALUE,nullptr,&handle,nullptr)!=ERROR_SUCCESS)return false;
    const bool ok=RegSetValueExW(handle,name,0,REG_SZ,reinterpret_cast<const BYTE*>(value.c_str()),static_cast<DWORD>((value.size()+1)*sizeof(wchar_t)))==ERROR_SUCCESS;
    RegCloseKey(handle);return ok;
  };
  return set(L"Software\\Classes\\SonaPreview.Url",nullptr,L"Sona Preview Web Link")&&
      set(L"Software\\Classes\\SonaPreview.Url",L"URL Protocol",L"")&&
      set(L"Software\\Classes\\SonaPreview.Url\\DefaultIcon",nullptr,exe+L",0")&&
      set(L"Software\\Classes\\SonaPreview.Url\\shell\\open\\command",nullptr,command)&&
      set(L"Software\\Sona Preview\\Capabilities",L"ApplicationName",L"Sona Preview")&&
      set(L"Software\\Sona Preview\\Capabilities",L"ApplicationDescription",L"Sona Preview browser")&&
      set(L"Software\\Sona Preview\\Capabilities",L"ApplicationIcon",exe+L",0")&&
      set(L"Software\\Sona Preview\\Capabilities\\URLAssociations",L"http",L"SonaPreview.Url")&&
      set(L"Software\\Sona Preview\\Capabilities\\URLAssociations",L"https",L"SonaPreview.Url")&&
      set(L"Software\\RegisteredApplications",L"Sona Preview",L"Software\\Sona Preview\\Capabilities");
}
}
void BrowserWindow::OpenExternal(const std::string& url) {
  if(!current_)return;
  CefURLParts parts;
  if(!CefParseURL(url,parts)||!((CefString(&parts.scheme)=="http")||(CefString(&parts.scheme)=="https"))||
      CefString(&parts.host).empty()||!CefString(&parts.username).empty()||!CefString(&parts.password).empty())return;
  if(current_->NeedsOnboarding())current_->pending_external_url_=url;
  else current_->NewTab(url);
  ShowWindow(current_->hwnd_,SW_RESTORE);SetForegroundWindow(current_->hwnd_);
}
bool BrowserWindow::OpenDefaultBrowserSettings() {
  if(!RegisterDefaultBrowser())return false;
  SHChangeNotify(SHCNE_ASSOCCHANGED,SHCNF_IDLIST,nullptr,nullptr);
  return reinterpret_cast<INT_PTR>(ShellExecuteW(hwnd_,L"open",
      L"ms-settings:defaultapps?registeredAppUser=Sona%20Preview",nullptr,nullptr,SW_SHOWNORMAL))>32;
}
bool BrowserWindow::IsOnboardingUi(const std::string& url) const {
  return url==InternalUrl("soulu://onboarding");
}
CefRefPtr<CefDictionaryValue> BrowserWindow::OnboardingState() const {
  auto flow=settings_->GetDictionary("onboarding");
  return flow?flow->Copy(false):CefDictionaryValue::Create();
}
bool BrowserWindow::NeedsOnboarding() const {
  return OnboardingState()->GetString("status")=="not_started";
}
bool BrowserWindow::SaveOnboarding(CefRefPtr<CefDictionaryValue> flow) {
  auto next=settings_->Copy(false);next->SetDictionary("onboarding",flow->Copy(false));
  if(!WriteJson(ProfileRoot(active_profile_id_)/L"soulu-settings.json",Value(next)))return false;
  settings_=next;return true;
}
void BrowserWindow::HandleOnboardingBridge(int id,const std::string& request,
    CefRefPtr<CefMessageRouterBrowserSide::Callback> callback) {
  CEF_REQUIRE_UI_THREAD();
  auto* tab=FindTab(id);
  if(!tab||!tab->browser||tab->incognito||tab->profile_id!=active_profile_id_||
      id!=active_tab_id_||!IsOnboardingUi(tab->browser->GetMainFrame()->GetURL())||!NeedsOnboarding()) {
    callback->Failure(403,"Active normal first-run document required");return;
  }
  auto json=CefParseJSON(request,JSON_PARSER_RFC);
  if(!json||json->GetType()!=VTYPE_DICTIONARY){callback->Failure(400,"Invalid request");return;}
  auto root=json->GetDictionary();const std::string action=root->GetString("action");
  auto payload=root->GetDictionary("payload");auto flow=OnboardingState();
  if(action=="browser.import.catalog"||action=="browser.import.capabilities"||
     action=="browser.import.file"||action=="browser.import.portable"||
     action=="browser.import.progress"||action=="browser.import.cancel"||
     action=="browser.import.run") {
    if(action=="browser.import.run"&&(!payload||payload->GetString("target")!=active_profile_id_)) {
      callback->Failure(403,"First-run import requires the active profile");return;
    }
    HandleBridge(request,callback,true);return;
  }
  auto save=[&](){if(!SaveOnboarding(flow)){callback->Failure(500,"Unable to save first-run progress");return false;}return true;};
  if(action=="onboarding.get") {
    auto result=CefDictionaryValue::Create();result->SetDictionary("flow",flow);
    result->SetString("activeProfileId",active_profile_id_);
    result->SetDictionary("policy",policies_[active_profile_id_]->Snapshot());
    CefRefPtr<BrowserWindow> self=this;
    CefPostTask(TID_FILE_BACKGROUND,new OnboardingTask([self,callback,result](){
      auto eligible=CefListValue::Create();
      try {
        auto browser_icons=DiscoverImportBrowsers();
        for(const auto& source:BrowserImportSources()){
          auto row=CefDictionaryValue::Create();
          row->SetString("id",source.id);
          row->SetString("name",source.name);
          row->SetString("browser",source.browser);
          for(size_t n=0;n<browser_icons->GetSize();++n){
            auto browser=browser_icons->GetDictionary(n);
            if(browser->GetString("browser")==source.browser){
              row->SetString("icon",browser->GetString("icon"));break;
            }
          }
          eligible->SetDictionary(eligible->GetSize(),row);
        }
      }catch(const std::exception&){
        // The file picker remains usable if profile discovery fails.
      }
      result->SetList("sources",eligible);
      CefPostTask(TID_UI,new OnboardingTask([self,callback,result](){self->Reply(callback,result);}));
    }));return;
  }
  if(action=="onboarding.progress") {
    if(!payload){callback->Failure(400,"Progress required");return;}
    const int step=payload->GetInt("step");
    if(step<1||step>6){callback->Failure(400,"Invalid step");return;}
    // Only draft choices are writable from JS; outcomes belong to native code.
    flow->SetInt("step",step);
    for(const auto* key:{"source","adblock","askPermissions"})
      if(payload->HasKey(key)){
        if((std::string(key)=="source"&&payload->GetType(key)!=VTYPE_STRING)||
           (std::string(key)!="source"&&payload->GetType(key)!=VTYPE_BOOL)){
          callback->Failure(400,"Invalid choice");return;
        }
        flow->SetValue(key,payload->GetValue(key)->Copy());
      }
    if(save())Reply(callback,flow);return;
  }
  if(importing_){callback->Failure(409,"Wait for import to finish");return;}
  if(action=="onboarding.privacy") {
    auto policy=policies_[active_profile_id_];
    bool ok=policy->SetBlocking("",flow->GetBool("adblock")?1:0);
    // Off means deny sensitive access, never blanket allow.
    for(const auto* name:{"camera","microphone","geolocation","notifications"})
      ok=policy->Set("",name,flow->GetBool("askPermissions")?1:2)&&ok;
    if(!ok){callback->Failure(500,"Some privacy settings could not be saved. Review Settings.");return;}
    flow->SetBool("privacyApplied",true);if(save())Reply(callback,flow);return;
  }
  if(action=="onboarding.vpn") {
    if(!payload||payload->GetString("link").empty()||payload->GetString("link").size()>16384){callback->Failure(400,"VPN key required");return;}
    auto native=CefDictionaryValue::Create();native->SetString("action","save_profile");
    native->SetString("id",flow->GetString("vpnId"));native->SetString("name","Connect VPN");
    native->SetString("url",payload->GetString("link"));
    // The existing helper is the authority for protocol validation and storage.
    auto saved=SendVpnHelper(native);
    if(!saved->GetBool("ok")){Reply(callback,saved);return;}
    std::string vpnId=saved->GetString("id");if(vpnId.empty())vpnId=saved->GetString("profileId");
    auto next=vpn_settings_->Copy(false);
    for(const auto* key:{"link","protocol","address","region"})next->SetString(key,payload->GetString(key));
    std::string error;if(!CommitVpnSettings(next,error)){callback->Failure(400,error);return;}
    vpnId=vpn_settings_->GetString("lastProfileId");flow->SetBool("vpnAdded",true);flow->SetString("vpnId",vpnId);
    if(save())Reply(callback,saved);return;
  }
  if(action=="onboarding.default") {
    auto result=CefDictionaryValue::Create();
    if(!RegisterDefaultBrowser()){callback->Failure(500,"Unable to register Sona Preview with Windows Default Apps");return;}
    SHChangeNotify(SHCNE_ASSOCCHANGED,SHCNF_IDLIST,nullptr,nullptr);
    const auto opened=reinterpret_cast<INT_PTR>(ShellExecuteW(hwnd_,L"open",L"ms-settings:defaultapps?registeredAppUser=Sona%20Preview",nullptr,nullptr,SW_SHOWNORMAL));
    result->SetBool("ok",opened>32);result->SetString("message","Выбери Sona Preview в стандартных приложениях Windows и назначь его для HTTP и HTTPS.");
    Reply(callback,result);return;
  }
  if(action=="onboarding.finish") {
    flow->SetString("status",payload&&payload->GetBool("skip")?"skipped":"completed");
    if(!save())return;
    const auto destination=pending_external_url_.empty()?PageUrl("startup",settings_):pending_external_url_;
    pending_external_url_.clear();
    tab->focus_home_on_load=id==active_tab_id_&&destination=="soulu://home";
    tab->browser->GetMainFrame()->LoadURL(InternalUrl(destination));EmitState();ReplyEmpty(callback);return;
  }
  callback->Failure(400,"Unknown onboarding action");
}
}
