"""Run independent toolbar checks without changing the release acceptance gate."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import struct
import sys
import zipfile

archive, = Path('candidate').glob('*.exe')
metadata = json.loads(Path(str(archive)+'.build.json').read_text(encoding='utf-8-sig'))
raw = archive.read_bytes()
assert hashlib.sha256(raw).hexdigest() == metadata['installerSHA256'].lower()
for match in re.finditer(b'PK\x05\x06',raw):
    end = match.start()
    size, offset, comment = struct.unpack_from('<IIH',raw,end+12)
    start = end-size-offset
    if start < 0 or raw[start:start+4] != b'PK\x03\x04':
        continue
    with zipfile.ZipFile(io.BytesIO(raw[start:end+22+comment])) as payload:
        if 'engine/SonaEngine.exe' not in payload.namelist():
            continue
        for entry in payload.namelist():
            path = PurePosixPath(entry)
            assert not path.is_absolute() and '..' not in path.parts and ':' not in entry
        payload.extractall('candidate-runtime')
        break
else:
    raise RuntimeError('Candidate installer payload missing')

full_sidebar = '--sidebar' in sys.argv
sys.argv[1:] = ['candidate-runtime/engine/SonaEngine.exe','candidate-visual']
harness = Path(__file__).with_name('bookmarks-sidebar.py')
if full_sidebar:
    import runpy
    runpy.run_path(str(harness),run_name='__main__')
    raise SystemExit(0)
exec(compile(harness.read_text(encoding='utf-8').split('\nbaseline =',1)[0],
             str(harness),'exec'),globals())

from PIL import Image

try:
    start()
    call('browser.navigate',url)
    wait(lambda: content('return !!document.getElementById("v")'))
    call('browser.settings.set',{'theme':'light','mattePanel':True})
    chrome('window.resizeTo(1200,820)')
    wait(lambda: chrome('return innerWidth>=1100'))
    content("""const probe=document.createElement('div');probe.style.cssText=
      'position:absolute;inset:0 0 auto;height:3000px;z-index:9999;pointer-events:none;background:#f3237a';
      document.body.append(probe);return true;""")
    content('scrollTo(0,155);return true;')
    wait(lambda: chrome("return !document.getElementById('sona-page-glass').hidden"))
    screenshot('neutral-matte-scrolled.png')
    with Image.open(out/'neutral-matte-scrolled.png') as image:
        points=[image.getpixel((x,5))[:3] for x in range(55,image.width-55,80)]
    check('toolbar_pixels_neutral_with_bright_page_behind',
          max(max(pixel)-min(pixel) for pixel in points)<=3,points)
    content('scrollTo(0,0);return true;')
    wait(lambda: chrome("return document.getElementById('sona-page-glass').hidden"))
    screenshot('neutral-matte-top.png')
    call('browser.openTab',{'url':url+'second'})
    call('browser.openTab',{'url':url+'third'})
    call('browser.settings.set',{'layout':'compact'})
    row = wait(lambda: shell("""
      const bar=document.querySelector('.compact-toolbar');
      const tabs=[...bar.querySelectorAll('.compact-tab,.compact-active-tab')];
      if(getComputedStyle(bar).display==='none'||tabs.length!==3)return false;
      const center=r=>r.top+r.height/2,b=bar.getBoundingClientRect();
      return tabs.map(t=>Math.abs(center(t.getBoundingClientRect())-center(b)));
    """))
    check('compact_tabs_share_the_toolbar_axis',max(row)<=2,row)
    screenshot('compact-three-tabs.png')
    report['passed']=True
finally:
    try:
        stop()
    finally:
        (out/'candidate-visual.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        log.close()
        server.shutdown()
