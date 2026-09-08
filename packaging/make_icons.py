"""Regenerate the app icon.

    python packaging/make_icons.py

The LLC mark: the plasma hexagon from the header, sitting on ink, framed by
the same two corner brackets the live viewport draws around a frame. No text -
at 32px a wordmark is mud, and the hexagon is what the header shows anyway.
Replace with commissioned artwork before shipping; this exists so the bundle
has every size Tauri and NSIS ask for.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
SIZE = 1024

INK = (10, 12, 20, 255)          # the app's ground
STOPS = [(87, 101, 240), (139, 92, 246), (34, 211, 238)]   # the 120deg plasma


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def ramp(t: float):
    """The three-stop plasma, sampled at 0..1."""
    if t <= 0.5:
        return lerp(STOPS[0], STOPS[1], t / 0.5)
    return lerp(STOPS[1], STOPS[2], (t - 0.5) / 0.5)


def hexagon(cx, cy, r):
    """Flat-top-down hexagon, the same one the header mark is clipped to."""
    return [(cx + r * math.sin(math.radians(a)), cy - r * math.cos(math.radians(a)))
            for a in range(0, 360, 60)]


def render(size: int = SIZE) -> Image.Image:
    u = size / 1024

    # ink tile, rounded the way Windows likes it
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    plate = Image.new("RGBA", (size, size), INK)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    img.paste(plate, (0, 0), mask)

    # the bloom behind the mark, so the tile is lit rather than flat
    bloom = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bloom)
    bd.ellipse([size * .12, size * .04, size * .96, size * .88], fill=(87, 101, 240, 120))
    bloom = bloom.filter(ImageFilter.GaussianBlur(size * .13))
    img.alpha_composite(Image.composite(bloom, Image.new("RGBA", (size, size), (0, 0, 0, 0)), mask))

    # The plasma, painted once and cut to the hexagon. The ramp is sampled
    # across the hexagon's own box, not the tile's, so all three stops - the
    # cyan included - actually land inside the shape.
    r = 272 * u
    cx = cy = size / 2
    lo, span = cx - r, 2 * r
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = ((x - lo) * .62 + (y - lo) * .38) / span
            px[x, y] = (*ramp(min(1.0, max(0.0, t))), 255)
    hexmask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(hexmask).polygon(hexagon(cx, cy, r), fill=255)
    img.paste(grad, (0, 0), hexmask)

    # the two corner brackets, straight off the live viewport
    draw = ImageDraw.Draw(img)
    arm, w, pad, rad = 132 * u, 30 * u, 140 * u, 15 * u
    white = (255, 255, 255, 235)
    draw.rounded_rectangle([pad, pad, pad + arm, pad + w], radius=rad, fill=white)
    draw.rounded_rectangle([pad, pad, pad + w, pad + arm], radius=rad, fill=white)
    far = size - pad
    draw.rounded_rectangle([far - arm, far - w, far, far], radius=rad, fill=white)
    draw.rounded_rectangle([far - w, far - arm, far, far], radius=rad, fill=white)
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
