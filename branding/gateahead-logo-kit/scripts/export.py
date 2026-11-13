#!/usr/bin/env python3
"""Rebuild the portable GateAhead logo kit; use --sizes for additional exports."""
import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

from PIL import Image, ImageColor

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'export-config.json').read_text())


def find_browser(explicit):
    if explicit:
        found = shutil.which(explicit) or (explicit if Path(explicit).is_file() else None)
        if found:
            return str(found)
        raise SystemExit(f'Chromium not found: {explicit}')
    for name in ['chromium', 'chromium-browser', 'google-chrome', 'chrome']:
        found = shutil.which(name)
        if found:
            return found
    for base in [Path.home() / '.cache/ms-playwright', Path.home() / 'Library/Caches/ms-playwright']:
        for pattern in ['chromium*/**/chrome-headless-shell', 'chromium*/**/chrome']:
            for candidate in sorted(base.glob(pattern), reverse=True):
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    return str(candidate)
    raise SystemExit('Install Chromium/Chrome or pass --browser /path/to/chrome.')


def dimensions(name, longest):
    svg = ET.parse(ROOT / 'svg' / f'{name}.svg').getroot()
    _, _, width, height = map(float, svg.attrib['viewBox'].split())
    return max(1, round(longest * width / max(width, height))), max(1, round(longest * height / max(width, height)))


def png_path(name, longest):
    width, height = dimensions(name, longest)
    return ROOT / 'png' / name / f'{name}-{width}x{height}.png'


def opaque(image, background):
    result = Image.new('RGB', image.size, ImageColor.getrgb(background))
    result.paste(image, mask=image.getchannel('A'))
    return result


def copy_image(source, destination, rgb=False):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if rgb:
        with Image.open(source) as image:
            assert image.convert('RGBA').getchannel('A').getextrema() == (255, 255)
            image.convert('RGB').save(destination)
    else:
        shutil.copyfile(source, destination)


def export_platforms():
    rounded, square = 'gateahead-icon-rounded', 'gateahead-icon-square'
    web = ROOT / 'platforms/web'
    web.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / f'svg/{rounded}.svg', web / 'favicon.svg')
    for size in [192, 512]:
        copy_image(png_path(square, size), web / f'icon-{size}.png', rgb=True)
    copy_image(png_path(square, 180), web / 'apple-touch-icon.png', rgb=True)

    # Each ICO entry is rendered directly from the SVG, including the tiny sizes.
    sizes = [16, 24, 32, 48, 64, 128, 256]
    payloads = [png_path(rounded, size).read_bytes() for size in sizes]
    offset = 6 + 16 * len(sizes)
    directory = []
    for size, payload in zip(sizes, payloads):
        directory.append(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(payload), offset))
        offset += len(payload)
    ico = struct.pack('<HHH', 0, 1, len(sizes)) + b''.join(directory) + b''.join(payloads)
    (web / 'favicon.ico').write_bytes(ico)
    desktop = ROOT / 'platforms/desktop'
    desktop.mkdir(parents=True, exist_ok=True)
    (desktop / 'gateahead.ico').write_bytes(ico)
    chunks = []
    for code, size in [('icp4', 16), ('icp5', 32), ('icp6', 64), ('ic07', 128), ('ic08', 256), ('ic09', 512), ('ic10', 1024)]:
        payload = png_path(rounded, size).read_bytes()
        chunks.append(code.encode() + struct.pack('>I', len(payload) + 8) + payload)
    body = b''.join(chunks)
    (desktop / 'gateahead.icns').write_bytes(b'icns' + struct.pack('>I', len(body) + 8) + body)
    copy_image(png_path(rounded, 512), desktop / 'gateahead-512.png')

    ios = ROOT / 'platforms/ios/AppIcon.appiconset'
    contents = json.loads((ios / 'Contents.json').read_text())
    for item in contents['images']:
        size = round(float(item['size'].split('x')[0]) * float(item['scale'][:-1]))
        copy_image(png_path(square, size), ios / item['filename'], rgb=True)
    for density, size in [('ldpi', 36), ('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
        copy_image(png_path(rounded, size), ROOT / f'platforms/android/res/mipmap-{density}/ic_launcher.png')
    copy_image(png_path(square, 512), ROOT / 'platforms/android/play-store-512.png', rgb=True)


def preview():
    cards = []
    for variant in CONFIG['variants']:
        name = variant['name']
        background = '#DAD5CC' if name.startswith('gateahead-icon-') else variant['background']
        cards.append(f'<article><div class="art" style="background:{background}"><img src="svg/{name}.svg" alt="{html.escape(variant["purpose"])}"></div><h2>{html.escape(variant["purpose"])}</h2><a href="svg/{name}.svg">SVG original</a></article>')
    document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GateAhead logo kit</title><style>*{box-sizing:border-box}body{margin:0;padding:40px;font:16px/1.5 system-ui,sans-serif;color:#14181b;background:#f4efe6}main{max-width:1100px;margin:auto}h1{font-size:38px;margin:0}p{max-width:760px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}article{overflow:hidden;border:1px solid #ccc5ba;border-radius:16px;background:#fff}h2{font-size:16px;margin:16px 20px 8px}a{display:inline-block;margin:0 20px 20px;color:#68501c}.art{height:260px;display:grid;place-items:center}.art img{height:190px;max-width:220px}code{font-family:monospace}footer{margin-top:24px}</style><main><h1>GateAhead</h1><p>Crossing Pin · approved concept 3. Editable vectors and exports for web, mobile, desktop, and print.</p><p>Amber <code>#E7A23A</code> · Charcoal <code>#14181B</code> · Ivory <code>#F4EFE6</code></p><section class="grid">'''
    (ROOT / 'preview.html').write_text(document + ''.join(cards) + '</section><footer>Open README.md for the format guide, size list, and export instructions.</footer></main></html>')


def manifest_and_zip():
    records = []
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file() or path.name == 'manifest.json' or '__pycache__' in path.parts:
            continue
        record = {'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size,
                  'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        if path.suffix.lower() in {'.png', '.webp', '.jpg', '.tiff', '.ico', '.icns'}:
            with Image.open(path) as image:
                record.update(width=image.width, height=image.height, mode=image.mode)
        records.append(record)
    manifest = {key: CONFIG[key] for key in ['name', 'version', 'selected_concept', 'colors']}
    manifest.update(size_measure='longest edge in pixels; aspect ratio preserved', files=records)
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = ROOT.parent / 'gateahead-logo-kit-v1.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(ROOT.rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts:
                bundle.write(path, path.relative_to(ROOT.parent))
    print(f'Saved {len(records) + 1} files; {archive.name}: {archive.stat().st_size / 1024 / 1024:.1f} MB', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', default=os.environ.get('CHROMIUM_PATH'))
    parser.add_argument('--sizes', help='Export only additional longest-edge sizes, e.g. 800,1600. Existing files are retained.')
    parser.add_argument('--package-only', action='store_true', help='Refresh preview, checksums, and ZIP without rendering.')
    args = parser.parse_args()
    if not args.package_only:
        try:
            sizes = sorted(set(map(int, args.sizes.split(',')))) if args.sizes else CONFIG['sizes']
        except ValueError:
            parser.error('--sizes must contain comma-separated integers')
        if not sizes or any(size < 1 or size > 16384 for size in sizes):
            parser.error('Sizes must be between 1 and 16384 pixels.')
        for tool in ['node'] + ([] if args.sizes else ['pdftops']):
            if not shutil.which(tool):
                raise SystemExit(f'Missing tool: {tool}. See README.md.')
        browser = find_browser(args.browser)
        jobs = []
        for variant in CONFIG['variants']:
            name = variant['name']
            for size in sizes:
                width, height = dimensions(name, size)
                jobs.append(dict(svg=str(ROOT / f'svg/{name}.svg'), out=str(png_path(name, size)), width=width, height=height, format='png'))
            if not args.sizes:
                width, height = dimensions(name, 1024)
                jobs.append(dict(svg=str(ROOT / f'svg/{name}.svg'), out=str(ROOT / f'pdf/{name}.pdf'), width=width, height=height, format='pdf', background=variant['background']))
        with tempfile.TemporaryDirectory(prefix='gateahead-logo-') as temporary:
            job_file = Path(temporary) / 'jobs.json'
            job_file.write_text(json.dumps(jobs))
            subprocess.run(['node', str(ROOT / 'scripts/render.mjs'), browser, str(job_file)], check=True)
        for variant in CONFIG['variants']:
            name = variant['name']
            for size in sizes:
                source = png_path(name, size)
                with Image.open(source) as original:
                    image = original.convert('RGBA')
                    for kind, suffix in [('webp', '.webp'), ('jpg', '.jpg')]:
                        target = ROOT / kind / name / (source.stem + suffix)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        if kind == 'webp':
                            image.save(target, lossless=True, method=4)
                        else:
                            opaque(image, variant['background']).save(target, quality=95, subsampling=0)
                    if size == 4096:
                        target = ROOT / 'tiff' / f'{name}-4096.tiff'
                        target.parent.mkdir(parents=True, exist_ok=True)
                        image.save(target, compression='tiff_deflate', dpi=(300, 300))
                    if name == 'gateahead-icon-square':
                        assert image.getchannel('A').getextrema() == (255, 255)
                        image.convert('RGB').save(source)
            if not args.sizes:
                target = ROOT / 'eps' / f'{name}.eps'
                target.parent.mkdir(parents=True, exist_ok=True)
                subprocess.run(['pdftops', '-eps', '-level3', str(ROOT / f'pdf/{name}.pdf'), str(target)], check=True)
                target.write_bytes(b'\n'.join(line.rstrip(b' \t') for line in target.read_bytes().split(b'\n')))
            print(f'Converted {name}', flush=True)
        if not args.sizes:
            export_platforms()
    preview()
    manifest_and_zip()


if __name__ == '__main__':
    main()
