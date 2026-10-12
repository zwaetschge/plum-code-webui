"""Render server-generated SVG frames offline, then encode a bounded local clip."""
import json, os, signal, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

def stop(_signal, _frame):
    raise SystemExit(143)
signal.signal(signal.SIGTERM, stop)
source, output = Path(sys.argv[1]), Path(sys.argv[2])
if source.stat().st_size > 8 * 1024 * 1024:
    raise ValueError('Animation input exceeds limit')
model = json.loads(source.read_text('utf-8'))
assert 240 <= model['width'] <= 1280 and 160 <= model['height'] <= 720
assert 1 <= model['fps'] <= 12 and 1 <= len(model['frames']) <= 120
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    try:
        context = browser.new_context(java_script_enabled=False, service_workers='block', viewport={'width':model['width'],'height':model['height']}, device_scale_factor=1)
        context.route('**/*', lambda route: route.abort())
        page = context.new_page(); page.set_default_timeout(15000)
        for index, svg in enumerate(model['frames']):
            document = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\';script-src \'none\'"><style>html,body{margin:0;overflow:hidden}</style>' + svg
            page.set_content(document, wait_until='load')
            page.screenshot(path=str(output if output.suffix == '.png' else source.parent / f'frame-{index:03d}.png'))
        context.close()
    finally:
        browser.close()
if output.suffix == '.mp4':
    command = ['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-framerate',str(model['fps']),'-i',str(source.parent/'frame-%03d.png'),'-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart',str(output)]
    encoder = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        _, error = encoder.communicate(timeout=30)
        if encoder.returncode: raise RuntimeError(error.decode('utf-8', errors='replace')[:1000])
    finally:
        if encoder.poll() is None:
            encoder.terminate()
            try: encoder.wait(timeout=3)
            except subprocess.TimeoutExpired: encoder.kill(); encoder.wait()
if output.stat().st_size > 32 * 1024 * 1024: raise ValueError('Animation output exceeds limit')
os.chmod(output, 0o600)
