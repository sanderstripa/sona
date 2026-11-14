"""Audit every product icon alias in the assembled runtime against the master."""
from pathlib import Path
import json,sys
root=Path(__file__).resolve().parents[2]
out=Path(sys.argv[1]);ui=out/'engine/sona/chrome/ui'
import re
shortcut_icon=re.search(r'"(sona-app-[0-9.]+\.ico)"',(root/'gecko/installer/adapter_windows.go').read_text()).group(1)
assert (ui/shortcut_icon).read_bytes()==(root/'ui/sona-icon.ico').read_bytes(),shortcut_icon
manifest=json.loads((root/'ui/branding/manifest.json').read_text())
for name in manifest['aliases']:
 assert (ui/name).read_bytes()==(root/'ui'/name).read_bytes(),name
for size in manifest['png_sizes']:
 name=f'branding/sona-{size}.png'
 assert (ui/name).read_bytes()==(root/'ui'/name).read_bytes(),name
for path in [*ui.glob('*.ico'),*(out/'engine/chrome/icons/default').glob('*.ico'),*(out/'engine/browser/chrome/icons/default').glob('*.ico')]:
 assert path.read_bytes()==(root/'ui/sona-icon.ico').read_bytes(),str(path)
print(json.dumps({'passed':True,'aliases':manifest['aliases'],'sizes':manifest['png_sizes']}))

# The homepage must ship its own transparent dome, never the app disc.
from PIL import Image
assert (ui/"sona-home.png").read_bytes()==(root/"ui/sona-home.png").read_bytes()
assert "sona-home.png" in (ui/"home.html").read_text(encoding="utf-8")
home=Image.open(ui/"sona-home.png").convert("RGBA")
assert home.width>home.height and home.getpixel((0,0))[3]==0
assert (ui/"sona-home.png").read_bytes()!=(ui/"browser-icon.png").read_bytes()
