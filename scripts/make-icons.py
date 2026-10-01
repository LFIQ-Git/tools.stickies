"""Draw the Stickies app icon (build/icon.png, 1024px) and tray icons (assets/).

Run: python3 scripts/make-icons.py   (needs Pillow). electron-builder turns
build/icon.png into the .icns and .ico it needs.
"""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024

def note(size, shadow=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    k = size / 1024
    pad, fold = 150 * k, 190 * k
    x0, y0, x1, y1 = pad, pad, size - pad, size - pad
    if shadow:
        sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        o = 22 * k
        ImageDraw.Draw(sh).polygon([(x0 + o / 2, y0 + o), (x1 + o / 2, y0 + o), (x1 + o / 2, y1 - fold + o), (x1 - fold + o / 2, y1 + o), (x0 + o / 2, y1 + o)], fill=(0, 0, 0, 90))
        img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(28 * k)))
    d = ImageDraw.Draw(img)
    body = [(x0, y0), (x1, y0), (x1, y1 - fold), (x1 - fold, y1), (x0, y1)]
    d.polygon(body, fill=(255, 226, 92, 255))
    d.rectangle([x0, y0, x1, y0 + 70 * k], fill=(246, 204, 56, 255))
    d.polygon([(x1, y1 - fold), (x1 - fold, y1 - fold), (x1 - fold, y1)], fill=(214, 176, 40, 255))
    lw = max(2, int(34 * k))
    for i, frac in enumerate((0.40, 0.55, 0.70)):
        y = y0 + (y1 - y0) * frac
        d.line([(x0 + 210 * k, y), (x1 - (240 if i == 2 else 110) * k, y)], fill=(120, 96, 20, 255), width=lw)
    # check box
    bs = 110 * k
    bx, by = x0 + 55 * k, y0 + (y1 - y0) * 0.40 - bs / 2
    d.rounded_rectangle([bx, by, bx + bs, by + bs], 18 * k, fill=(28, 122, 46, 255))
    cw = max(2, int(20 * k))
    d.line([(bx + 24 * k, by + 58 * k), (bx + 46 * k, by + 80 * k), (bx + 88 * k, by + 32 * k)], fill=(255, 255, 255, 255), width=cw, joint="curve")
    return img

note(S).save(os.path.join(ROOT, "build", "icon.png"))
for px in (16, 32):
    note(px * 8, shadow=False).resize((px, px), Image.LANCZOS).save(os.path.join(ROOT, "assets", f"tray{'' if px == 16 else '@2x'}.png"))
note(256).save(os.path.join(ROOT, "assets", "icon-256.png"))
print("icons written")
