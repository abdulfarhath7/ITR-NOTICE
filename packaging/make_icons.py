"""Regenerate the placeholder app icon.

    python packaging/make_icons.py

A sheet of paper with a folded corner and one red deadline dot, on the
product's own gradient. Replace with real artwork before shipping - this exists
so the bundle has every size Tauri and NSIS ask for.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
SIZE = 1024
FROM, TO = (91, 99, 240), (139, 92, 246)     # the one gradient, 135deg


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def render(size: int = SIZE) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = (*lerp(FROM, TO, (x + y) / (2 * size - 2)), 255)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(img)
    u = size / 1024
    left, top, right, bottom = 300 * u, 232 * u, 724 * u, 792 * u
    fold = 132 * u
    draw.polygon(
        [(left, top), (right - fold, top), (right, top + fold),
         (right, bottom), (left, bottom)],
        fill=(255, 255, 255, 240))
    draw.polygon([(right - fold, top), (right, top + fold), (right - fold, top + fold)],
                 fill=(226, 228, 246, 255))
    for i, width in enumerate((0.62, 0.62, 0.36)):
        y = top + (196 + i * 96) * u
        draw.rounded_rectangle(
            [left + 64 * u, y, left + 64 * u + (right - left - 128 * u) * width, y + 34 * u],
            radius=17 * u, fill=(139, 141, 152, 255))
    draw.ellipse([right - 150 * u, bottom - 150 * u, right - 46 * u, bottom - 46 * u],
                 fill=(239, 68, 68, 255))
    return img


PNGS = {
    "32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512,
    "Square44x44Logo.png": 44, "Square71x71Logo.png": 71, "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150, "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310, "StoreLogo.png": 50,
}
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    base = render()
    for name, size in PNGS.items():
        base.resize((size, size), Image.LANCZOS).save(OUT / name)
    base.resize((256, 256), Image.LANCZOS).save(OUT / "icon.ico", sizes=ICO_SIZES)
    print(f"wrote {len(PNGS) + 1} icons to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
