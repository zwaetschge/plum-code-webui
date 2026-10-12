"""Print a generated, script-free document using an isolated local browser context."""
import sys
import signal
import fitz
from pathlib import Path
from playwright.sync_api import sync_playwright
def stop(_signal, _frame):
    raise SystemExit(143)
signal.signal(signal.SIGTERM, stop)
source, output = Path(sys.argv[1]), Path(sys.argv[2])
html = source.read_text(encoding='utf-8')
if len(html.encode('utf-8')) > 4 * 1024 * 1024:
    raise ValueError('PDF input exceeds limit')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    try:
        context = browser.new_context(java_script_enabled=False, service_workers='block', viewport={'width': 1000, 'height': 800})
        context.route('**/*', lambda route: route.abort())
        page = context.new_page()
        page.set_default_timeout(20000)
        page.set_content(html, wait_until='load')
        page.emulate_media(media='print')
        # Chromium prints A4 at 96 CSS pixels/inch. Reject formulas that would
        # run beyond the printable page instead of silently clipping them.
        page.set_viewport_size({'width': 986 if len(sys.argv)>3 and sys.argv[3]=='landscape' else 658, 'height': 800})
        if page.locator('.katex-html').evaluate_all('(nodes) => nodes.some(node => node.scrollWidth > document.body.clientWidth + 1)'):
            raise ValueError('Formula exceeds printable width')
        page.pdf(path=str(output), format='A4', landscape=len(sys.argv)>3 and sys.argv[3]=='landscape', margin={'top':'18mm','right':'18mm','bottom':'18mm','left':'18mm'}, print_background=True, tagged=True, outline=True)
        context.close()
        if output.stat().st_size > 16 * 1024 * 1024:
            raise ValueError('PDF output exceeds limit')
        with fitz.open(output) as document:
            if len(document) > 100:
                raise ValueError('PDF has more than 100 pages')
    finally:
        browser.close()
