"""Apply the Gecko installer theme and isolate the CEF product identity."""
import json
from pathlib import Path
import shutil
import sys

core = Path(sys.argv[1])
project = Path(__file__).resolve().parents[1]
web = core / 'core/web'
adapter = core / 'adapters/soulu/adapter_windows.go'
source = adapter.read_text(encoding='utf-8')
# Keep package and payload identifiers intact. They are internal to the shared core.
source = source.replace('Soulu.exe', 'Sona Preview.exe')
source = source.replace('Soulu.Url', 'SonaPreview.Url').replace('Soulu', 'Sona Preview')
adapter.write_text(source, encoding='utf-8')
for test in adapter.parent.glob('*_test.go'):
    text = test.read_text(encoding='utf-8')
    test.write_text(text.replace('Soulu.exe', 'Sona Preview.exe'), encoding='utf-8')


product = core / 'products/soulu.json'
config = json.loads(product.read_text(encoding='utf-8'))
config.update(name='Sona Preview', repository='https://github.com/sanderstripa/sona', engine='CEF')
product.write_text(json.dumps(config, indent=2), encoding='utf-8')
shutil.copyfile(project / 'ui/sona-installer-icon.ico', core / 'products/soulu.ico')
shutil.copyfile(project / 'ui/branding/sona-128.png', web / 'assets/icon.png')
shutil.copyfile(project / 'installer/sona-theme.css', web / 'sona-theme.css')
index = web / 'index.html'
source = index.read_text(encoding='utf-8').replace('</head>', '<link rel="stylesheet" href="sona-theme.css"></head>')
for label, glyph, view, path in [
    ('Свернуть', '−', '0 0 24 24', 'M4.5 12h15'),
    ('Закрыть', '×', '0 0 16 16', 'm4 4 8 8m0-8-8 8'),
]:
    before = f'aria-label="{label}">{glyph}</button>'
    if before not in source:
        raise ValueError(f'Missing installer control: {label}')
    source = source.replace(before, f'aria-label="{label}"><svg viewBox="{view}" aria-hidden="true"><path d="{path}"/></svg></button>')
index.write_text(source, encoding='utf-8')
build = core / 'build.ps1'
source = build.read_text(encoding='utf-8').replace(r'\d+\.\d+\.\d+([+-]', r'\d+\.\d+\.\d+(\.\d+\.\d+)?([+-]')
build.write_text(source, encoding='utf-8')
