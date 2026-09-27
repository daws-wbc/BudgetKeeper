"""Generate the app icons (a fuel-gauge on a dark tile). Run: python tools/make_icons.py"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 4  # supersample for smooth edges


def draw_icon(size: int) -> Image.Image:
    s = size * SS
    img = Image.new("RGB", (s, s), (15, 23, 42))
    d = ImageDraw.Draw(img)

    cx, cy = s / 2, s * 0.62
    r = s * 0.34
    w = int(s * 0.085)
    box = [cx - r, cy - r, cx + r, cy + r]
    # PIL angles: 0 = 3 o'clock, increasing clockwise. Upper half = 180..360.
    d.arc(box, 180, 204, fill=(220, 38, 38), width=w)
    d.arc(box, 203, 238, fill=(245, 158, 11), width=w)
    d.arc(box, 237, 360, fill=(22, 163, 74), width=w)

    # Needle at ~65% full.
    ang = math.radians(180 - 0.65 * 180)
    L = r * 0.92
    tip = (cx + L * math.cos(ang), cy - L * math.sin(ang))
    perp = (math.sin(ang), math.cos(ang))
    bw = s * 0.035
    d.polygon(
        [(cx + perp[0] * bw, cy + perp[1] * bw), tip, (cx - perp[0] * bw, cy - perp[1] * bw)],
        fill=(248, 250, 252),
    )
    hub = s * 0.06
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=(248, 250, 252))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
        draw_icon(size).save(OUT / name)
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
