"""
Generate the link-preview image, once, into public/og.png.

Run it when the wordmark or the strapline changes:

    python scripts/og.py

Deliberately a build-time script and not `next/og`. An ImageResponse route
renders on every request, needs the edge runtime, and has its own font-loading
problem on Windows - none of which is worth it for one picture that changes
about as often as the logo does.

Drawn in the site's own palette, with the site's own typeface: the woff2 that
ships in app/fonts is decompressed to a temporary TTF because PIL cannot read
woff2 directly. That keeps the preview and the page in the same face rather
than approximating it with whatever Arial the machine happens to have.
"""

import io
import os
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "app" / "fonts" / "archivo-latin-wght-normal.woff2"
MONO = ROOT / "app" / "fonts" / "jetbrains-mono-latin-wght-normal.woff2"
OUT = ROOT / "public" / "og.png"

INK = (22, 19, 14)
CREAM = (241, 234, 217)
ACCENT = (166, 50, 31)
ON_ACCENT = (246, 238, 222)
DIM = (167, 158, 139)
RULE = (53, 48, 42)

W, H = 1200, 630


def load(woff2: Path, size: int, weight: int):
    """A woff2 as a PIL font, at a chosen weight off the variable axis."""
    font = TTFont(str(woff2), fontNumber=0)
    if "wght" in {a.axisTag for a in font["fvar"].axes} if "fvar" in font else False:
        from fontTools.varLib.instancer import instantiateVariableFont

        font = instantiateVariableFont(font, {"wght": weight}, inplace=False)
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)

    # The hero's faint grid, same 96px rhythm as the site.
    for x in range(0, W, 96):
        d.line([(x, 0), (x, H)], fill=(28, 25, 20), width=1)
    for y in range(0, H, 96):
        d.line([(0, y), (W, y)], fill=(26, 23, 18), width=1)

    # The wax seal, right-hand side.
    cx, cy, r = 960, 315, 150
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)
    # The dashed inner ring, drawn as 52 marks like the 3D mark.
    import math

    for i in range(52):
        a = (i / 52) * math.tau
        rr = r * 0.78
        px, py = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        d.ellipse([px - 2.4, py - 2.4, px + 2.4, py + 2.4], fill=ON_ACCENT)
    mono_c = load(FONT, 150, 900)
    d.text((cx, cy - 6), "C", font=mono_c, fill=ON_ACCENT, anchor="mm")

    # Type, left-hand side.
    eyebrow = load(MONO, 20, 500)
    d.text((80, 96), "CACHET - SEALED PROPOSAL TENDERING", font=eyebrow, fill=DIM)

    title = load(FONT, 64, 800)
    d.text((80, 168), "Scored against", font=title, fill=CREAM)
    d.text((80, 240), "criteria published", font=title, fill=CREAM)
    d.text((80, 312), "before anyone bid.", font=title, fill=(232, 120, 94))

    body = load(FONT, 25, 400)
    d.text(
        (80, 412),
        "Criteria frozen on chain. Bids sealed with a hash.\nA full scorecard for every bidder, not only the winner.",
        font=body,
        fill=DIM,
        spacing=12,
    )

    d.line([(80, H - 96), (W - 80, H - 96)], fill=RULE, width=1)
    foot = load(MONO, 19, 400)
    d.text((80, H - 72), "GENLAYER - INTELLIGENT CONTRACT", font=foot, fill=DIM)

    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}  {os.path.getsize(OUT) // 1024} KB  {W}x{H}")


if __name__ == "__main__":
    main()
