"""
Generate the brand assets, once, into public/brand/.

Run it when the mark or the wordmark changes:

    python scripts/brand.py

The mark is the wax seal the site opens on: a disc in the accent red, a dashed
bone ring inside it, and a C. Everything here is drawn from the same three
values the stylesheet uses, so an asset can never drift away from the site it
represents.

Written with Pillow rather than a headless browser because the shape is three
primitives and a letter. The one thing that needs care is the typeface: the
woff2 that ships in app/fonts is decompressed to a TTF in memory, at a chosen
weight off the variable axis, because PIL cannot read woff2 directly. That
keeps the mark and the page in the same face instead of approximating it with
whatever Arial the machine happens to have.

The SVGs are written by hand rather than traced from the PNGs. They are the
canonical form - a mark that has to survive a favicon and a conference banner
should not be a raster anywhere it does not have to be.
"""

import io
import math
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "app" / "fonts" / "archivo-latin-wght-normal.woff2"
OUT = ROOT / "public" / "brand"

# The site's own tokens, from app/globals.css. Changing one here without
# changing it there is how a logo stops matching the product.
ACCENT = (166, 50, 31)        # --accent
ON_ACCENT = (246, 238, 222)   # the bone that sits on it
INK = (18, 14, 11)            # --paper, dark theme
CREAM = (251, 246, 234)       # --paper, light theme

# Geometry, as fractions of the canvas. The viewBox is 100 wide in the SVG and
# these are the same numbers, so the two forms are the same drawing.
R_DISC = 48 / 100
R_RING = 37 / 100
RING_WIDTH = 1.6 / 100
DASH_ON = 2 / 100
DASH_OFF = 3.6 / 100
LETTER = "C"


def load(size: int, weight: int) -> ImageFont.FreeTypeFont:
    """A woff2 as a PIL font, at a chosen weight off the variable axis."""
    font = TTFont(str(FONT), fontNumber=0)
    if "fvar" in font and "wght" in {a.axisTag for a in font["fvar"].axes}:
        from fontTools.varLib.instancer import instantiateVariableFont

        font = instantiateVariableFont(font, {"wght": weight}, inplace=False)
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size)


def dashed_ring(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float,
                width: float, on: float, off: float, fill) -> None:
    """
    A dashed circle, drawn as short arcs.

    Pillow has no dash pattern, and approximating one with many tiny line
    segments leaves visible facets at 1024px. Arcs stay round at every size.
    The dash lengths are arc lengths, so the pattern reads the same whatever
    the radius.
    """
    circumference = 2 * math.pi * r
    period = on + off
    count = max(1, round(circumference / period))
    # Redistribute so the pattern closes exactly rather than leaving a stub.
    step = 360.0 / count
    on_deg = step * (on / period)
    box = (cx - r, cy - r, cx + r, cy + r)
    for i in range(count):
        start = i * step
        draw.arc(box, start, start + on_deg, fill=fill, width=max(1, round(width)))


def mark(size: int, background=None) -> Image.Image:
    """The seal, at any size, on a background or on transparency."""
    # Supersample and downscale: the arcs and the letter both antialias badly
    # at final size, and 4x is the point where the ring stops looking chewed.
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0) if background is None else (*background, 255))
    draw = ImageDraw.Draw(img)

    c = s / 2
    draw.ellipse(
        (c - R_DISC * s, c - R_DISC * s, c + R_DISC * s, c + R_DISC * s),
        fill=(*ACCENT, 255),
    )
    dashed_ring(
        draw, c, c, R_RING * s,
        width=RING_WIDTH * s, on=DASH_ON * s, off=DASH_OFF * s,
        fill=(*ON_ACCENT, 235),
    )

    # The letter, measured rather than guessed: its own bounding box is centred
    # on the disc, so a face with different side bearings still lands true.
    font = load(int(0.46 * s), 900)
    box = draw.textbbox((0, 0), LETTER, font=font)
    draw.text(
        (c - (box[0] + box[2]) / 2, c - (box[1] + box[3]) / 2),
        LETTER, font=font, fill=(*ON_ACCENT, 255),
    )

    return img.resize((size, size), Image.LANCZOS)


def svg_mark(transparent: bool, background=None) -> str:
    """The canonical vector form. Same numbers as the raster above."""
    bg = ""
    if not transparent and background is not None:
        bg = f'  <rect width="100" height="100" fill="rgb{background}"/>\n'
    dash_on = DASH_ON * 100
    dash_off = DASH_OFF * 100
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
        'width="100" height="100" role="img" aria-label="Cachet">\n'
        f"{bg}"
        f'  <circle cx="50" cy="50" r="{R_DISC * 100:g}" fill="rgb{ACCENT}"/>\n'
        f'  <circle cx="50" cy="50" r="{R_RING * 100:g}" fill="none" '
        f'stroke="rgb{ON_ACCENT}" stroke-width="{RING_WIDTH * 100:g}" '
        f'stroke-dasharray="{dash_on:g} {dash_off:g}" opacity=".92"/>\n'
        '  <text x="50" y="53" text-anchor="middle" dominant-baseline="central" '
        'font-family="Archivo, Helvetica, Arial, sans-serif" font-weight="900" '
        f'font-size="46" fill="rgb{ON_ACCENT}">{LETTER}</text>\n'
        "</svg>\n"
    )


def svg_lockup(on_dark: bool) -> str:
    """Mark and wordmark, side by side, for a header or a slide."""
    word = ON_ACCENT if on_dark else (22, 19, 14)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 72" '
        'width="300" height="72" role="img" aria-label="Cachet">\n'
        '  <g transform="translate(4 4) scale(0.64)">\n'
        f'    <circle cx="50" cy="50" r="{R_DISC * 100:g}" fill="rgb{ACCENT}"/>\n'
        f'    <circle cx="50" cy="50" r="{R_RING * 100:g}" fill="none" '
        f'stroke="rgb{ON_ACCENT}" stroke-width="{RING_WIDTH * 100:g}" '
        f'stroke-dasharray="{DASH_ON * 100:g} {DASH_OFF * 100:g}" opacity=".92"/>\n'
        '    <text x="50" y="53" text-anchor="middle" dominant-baseline="central" '
        'font-family="Archivo, Helvetica, Arial, sans-serif" font-weight="900" '
        f'font-size="46" fill="rgb{ON_ACCENT}">{LETTER}</text>\n'
        "  </g>\n"
        '  <text x="82" y="36" dominant-baseline="central" '
        'font-family="Archivo, Helvetica, Arial, sans-serif" font-weight="600" '
        f'font-size="34" letter-spacing="-1" fill="rgb{word}">Cachet</text>\n'
        "</svg>\n"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    written = []

    # Transparent, for anywhere with its own ground.
    for size in (256, 512, 1024):
        p = OUT / f"mark-{size}.png"
        mark(size).save(p)
        written.append(p)

    # On the dark and light grounds, for avatars and anywhere that needs a
    # square that is not see-through.
    for size in (512, 1024):
        p = OUT / f"square-dark-{size}.png"
        mark(size, INK).save(p)
        written.append(p)
    p = OUT / "square-light-512.png"
    mark(512, CREAM).save(p)
    written.append(p)

    for name, text in (
        ("mark.svg", svg_mark(True)),
        ("mark-on-ink.svg", svg_mark(False, INK)),
        ("lockup-dark.svg", svg_lockup(True)),
        ("lockup-light.svg", svg_lockup(False)),
    ):
        p = OUT / name
        p.write_text(text, encoding="utf-8")
        written.append(p)

    for p in written:
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size:,} bytes")
    print(f"\n{len(written)} files in public/brand/")


if __name__ == "__main__":
    main()
