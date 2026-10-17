import sys, pathlib
from playwright.sync_api import sync_playwright
src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
svg = pathlib.Path(src).read_text()
html = f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg style=\"width:{size}px;height:{size}px;display:block\" ",1)}</body></html>'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": size, "height": size})
    pg.set_content(html); pg.screenshot(path=out, omit_background=True, clip={"x":0,"y":0,"width":size,"height":size}); b.close()
