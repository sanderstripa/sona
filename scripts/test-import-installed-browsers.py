"""Exercise Sona with profiles written by installed stable Chrome and Edge."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
from contextlib import closing
import subprocess
import sys
import tempfile
import threading

from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location("import_tests", Path(__file__).with_name("test-cef-browser-import.py"))
tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
s = tests.s


def main():
    exe = Path(sys.argv[1]).resolve()
    server = tests.http.server.ThreadingHTTPServer(("127.0.0.1", 0), tests.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work:
        local = Path(work) / "local"
        roaming = Path(work) / "roaming"
        roaming.mkdir()
        sources = {}
        with sync_playwright() as playwright:
            for name, channel, rel in [
                ("Chrome", "chrome", "Google/Chrome/User Data"),
                ("Edge", "msedge", "Microsoft/Edge/User Data"),
            ]:
                root = local / rel
                url = f"http://127.0.0.1:{server.server_port}/{channel}"
                browser = playwright.chromium.launch_persistent_context(
                    str(root), channel=channel, headless=False,
                    args=["--no-first-run", "--no-default-browser-check"],
                )
                try:
                    page = browser.pages[0]
                    page.goto(url)
                    manager = browser.new_page()
                    manager.goto("chrome://bookmarks/" if name == "Chrome" else "edge://favorites/")
                    manager.evaluate("""async url => {
                      const root = (await chrome.bookmarks.getTree())[0].children[0];
                      const folder = await chrome.bookmarks.create({parentId:root.id,title:'Sona import check'});
                      await chrome.bookmarks.create({parentId:folder.id,title:'Browser-created link',url});
                    }""", url)
                    manager.close()
                finally:
                    browser.close()
                sources[name] = (root, url, tests.digest(root))
        s.DEBUG_PORT = s.free_port()
        s.BASE = f"http://127.0.0.1:{s.DEBUG_PORT}"
        env = dict(os.environ, LOCALAPPDATA=str(local), APPDATA=str(roaming),
                   SOULU_UI_TEST_PORT=str(s.DEBUG_PORT), SOULU_REGRESSION_SKIP_FIRST_RUN="1")
        for first in [True, False]:
            proc = subprocess.Popen([str(exe), "--no-proxy-server"], env=env)
            sockets = []
            def connect(path):
                target = tests.wait(lambda: next((r for r in s.targets() if path in r.get("url", "")), None))
                ws = s.websocket.create_connection(target["webSocketDebuggerUrl"], origin=s.BASE, timeout=45)
                sockets.append(ws)
                return ws
            try:
                shell = connect("/ui/index.html")
                tests.wait(lambda: s.evaluate(shell, "typeof window.browserShell?.openSettingsWindow==='function'"))
                s.evaluate(shell, "browserShell.openSettingsWindow()")
                settings = connect("/ui/settings.html")
                tests.wait(lambda: s.evaluate(settings, "document.body?.classList.contains('ready')"))
                for name, (root, url, before) in sources.items():
                    if first:
                        s.evaluate(settings, "souluBrowserImport.open()")
                        choice=json.dumps(name+":Default")
                        s.evaluate(settings, f"(()=>{{const e=document.querySelector('#importFrom');e.value={choice};e.dispatchEvent(new Event('change'));}})()")
                        tests.wait(lambda: s.evaluate(settings, "Array.from(document.querySelectorAll('.import-category input:enabled')).some(e=>e.dataset.category==='history') && !document.querySelector('.import-execution:not([hidden])')"))
                        tests.wait(lambda: s.evaluate(settings, "!!document.querySelector('.import-category input[data-category=tabs]:enabled')"))
                        s.evaluate(settings, """(()=>{
                          for(const e of document.querySelectorAll('.import-category input:enabled')){
                            if(e.checked!==['bookmarks','history','tabs'].includes(e.dataset.category))e.click();
                          }
                          document.querySelector('.browser-import .dialog-actions .primary').click();
                        })()""")
                        tests.wait(lambda: s.evaluate(settings, "document.querySelector('.browser-import')?.dataset.importState==='result'"))
                        s.evaluate(settings, "document.querySelector('.browser-import .dialog-actions button:last-child').click()")
                        tests.wait(lambda: any(
                            tab.get("url") == url for tab in s.evaluate(shell, "browserShell.getState()")["tabs"]))
                    history=local/'Sona Preview/User Data/Profiles/personal/soulu-history.sqlite'
                    with closing(sqlite3.connect(history.as_uri()+'?mode=ro',uri=True)) as db:
                        assert db.execute('SELECT 1 FROM visits WHERE url=?',(url,)).fetchone(),name
                    marks = s.evaluate(settings, "browserShell.getBookmarks()")
                    link = next(r for r in marks if r.get("url") == url)
                    assert any(r["id"] == link["parentId"] and r["title"] == "Sona import check" for r in marks)
                    assert tests.digest(root) == before, name+" source changed"
                    print(name, "imported" if first else "persisted after restart", flush=True)
            finally:
                for ws in sockets:
                    ws.close()
                if proc.poll() is None:
                    s.close_normally(proc)
    server.shutdown()


if __name__ == "__main__":
    main()
