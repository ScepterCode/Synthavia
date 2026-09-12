"""Regenerate the brand assets from a single source logo.

Usage:  python tools/make-brand-assets.py [path/to/source.(png|jpg)]
        Defaults to brand/logo-master.png.

Produces, in public/: logo.png (512), logo-192/64/32.png and share.png (1200x630).
The source may be a JPEG on a black ground — the black is keyed out using luminance as alpha, so
the mark keeps its outer glow instead of gaining a hard halo.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
MASTER = os.path.join(ROOT, 'brand', 'logo-master.png')
BG, INK, INK2, CYAN, VIOLET = (10, 11, 18), (244, 243, 237), (178, 179, 190), (67, 230, 220), (150, 130, 255)


def keyed(path):
    src = Image.open(path).convert('RGB')
    out = Image.new('RGBA', src.size)
    sp, dp = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b = sp[x, y]
            lum = max(r, g, b)
            if lum <= 8:
                dp[x, y] = (0, 0, 0, 0)
            else:
                k = 255 / lum
                dp[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), min(255, int(lum * 1.06)))
    return out.crop(out.getbbox())


def square(mark, size, pad=0.06):
    box = int(size * (1 - pad * 2))
    scale = min(box / mark.width, box / mark.height)
    small = mark.resize((max(1, round(mark.width * scale)), max(1, round(mark.height * scale))), Image.LANCZOS)
    # The circuit traces are hairlines: below ~96px a plain Lanczos downscale turns them to mush,
    # so favicon-scale copies get an unsharp pass to hold their edges.
    if size <= 96:
        small = small.filter(ImageFilter.UnsharpMask(radius=1.0, percent=190, threshold=2))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(small, ((size - small.width) // 2, (size - small.height) // 2), small)
    return canvas


def font(name, size):
    for candidate in (name, 'segoeuib.ttf', 'arialbd.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(f'C:/Windows/Fonts/{candidate}', size)
        except OSError:
            continue
    return ImageFont.load_default()


def share_card(mark):
    width, height = 1200, 630
    card = Image.new('RGB', (width, height), BG)
    draw = ImageDraw.Draw(card)
    for y in range(0, height, 26):
        for x in range(0, width, 26):
            draw.point((x, y), fill=(26, 28, 40))
    glow = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for radius in range(300, 0, -6):
        gd.ellipse([980 - radius, 250 - radius, 980 + radius, 250 + radius], fill=(133, 92, 255, 3))
    card = Image.alpha_composite(card.convert('RGBA'), glow).convert('RGB')
    draw = ImageDraw.Draw(card)

    big = square(mark, 300, pad=0)
    card.paste(big, (830, 165), big)
    small = square(mark, 54, pad=0)
    card.paste(small, (84, 74), small)

    brand = font('segoeuib.ttf', 27)
    draw.text((150, 86), 'SYNTHAVIA', font=brand, fill=INK)
    draw.text((150 + draw.textlength('SYNTHAVIA', font=brand), 86), '.AI', font=brand, fill=CYAN)
    draw.text((84, 250), "Building Africa's", font=font('segoeuib.ttf', 74), fill=INK)
    draw.text((84, 336), 'AI future from Abia.', font=font('segoeuib.ttf', 74), fill=VIOLET)
    draw.text((84, 456), 'We train the talent, run the research, and ship AI', font=font('segoeui.ttf', 26), fill=INK2)
    draw.text((84, 494), 'that works for African realities.', font=font('segoeui.ttf', 26), fill=INK2)
    draw.text((84, 560), 'ABA, ABIA STATE, NIGERIA', font=font('segoeuib.ttf', 18), fill=CYAN)
    return card


def main():
    # Default to the untouched master: re-running against public/logo.png would recrop and
    # resample an already-processed file, degrading it a little more each time.
    source = sys.argv[1] if len(sys.argv) > 1 else MASTER
    mark = keyed(source) if not source.lower().endswith('.png') else Image.open(source).convert('RGBA')
    if mark.getbbox() != (0, 0, mark.width, mark.height):
        mark = mark.crop(mark.getbbox())
    square(mark, 512).save(os.path.join(PUBLIC, 'logo.png'), optimize=True)
    for size in (192, 64, 32):
        square(mark, size).save(os.path.join(PUBLIC, f'logo-{size}.png'), optimize=True)
    share_card(mark).save(os.path.join(PUBLIC, 'share.png'), optimize=True)
    for name in ('logo.png', 'logo-192.png', 'logo-64.png', 'logo-32.png', 'share.png'):
        print(f'{name:14} {os.path.getsize(os.path.join(PUBLIC, name)) / 1024:6.1f} KB')


if __name__ == '__main__':
    main()
