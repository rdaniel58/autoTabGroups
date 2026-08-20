"""Regenerates test/fixtures/*.png. Pure stdlib, no dependencies."""

import zlib, struct, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(OUT, exist_ok=True)
S = 64


def write(path, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)


def make(name, fn):
    rows = []
    for y in range(S):
        row = bytearray()
        for x in range(S):
            row += bytes(fn(x, y))
        rows.append(row)
    write(os.path.join(OUT, name), rows)
    print(name)


C = (S - 1) / 2
T = (0, 0, 0, 0)


def in_circle(x, y, r):
    return math.hypot(x - C, y - C) <= r


# 1. brand background with a white glyph punched out (YouTube-style)
make("red-bg-white-glyph.png",
     lambda x, y: (255, 255, 255, 255) if in_circle(x, y, 14) else (255, 0, 0, 255))

# 2. brand glyph on transparency (Spotify-style)
make("green-glyph-transparent.png",
     lambda x, y: (0x1D, 0xB9, 0x54, 255) if in_circle(x, y, 26) else T)

# 3. monochrome black glyph on transparency (GitHub-style)
make("black-glyph-transparent.png",
     lambda x, y: (0x18, 0x17, 0x17, 255) if in_circle(x, y, 26) else T)

# 4. brand colour on a white page background (favicon with white padding)
make("blue-on-white.png",
     lambda x, y: (0x18, 0x77, 0xF2, 255) if 12 <= x < 52 and 12 <= y < 52
     else (255, 255, 255, 255))

# 5. mostly white with a small orange accent -- white must not win
make("white-with-orange-accent.png",
     lambda x, y: (0xFF, 0x66, 0x00, 255) if 26 <= y < 38 else (255, 255, 255, 255))

# 6. solid dark purple
make("purple-solid.png", lambda x, y: (0x63, 0x2C, 0xA6, 255))

# 7. entirely white -- nothing to read, must land on grey not a hue
make("all-white.png", lambda x, y: (255, 255, 255, 255))

# 8. two brand colours, cyan covering more area than pink
make("cyan-over-pink.png",
     lambda x, y: (0x0A, 0xBA, 0xB5, 255) if y < 44 else (0xD0, 0x18, 0x84, 255))

# 9. antialiased edges: green disc fading into white (blend artefacts)
def blend(x, y):
    d = math.hypot(x - C, y - C)
    t = max(0.0, min(1.0, (24 - d)))
    g = (0x1D, 0xB9, 0x54)
    w = (255, 255, 255)
    return tuple(round(g[i] * t + w[i] * (1 - t)) for i in range(3)) + (255,)
make("green-antialiased.png", blend)

# 10. fully transparent -- no pixels at all
make("empty-transparent.png", lambda x, y: T)


# 11. A white glyph on transparency, at a large declared size. This is the shape
# of a web app manifest icon with "purpose": "monochrome" -- it decodes fine and
# reports pure white, and because it is the biggest icon on offer it used to
# outrank every branded icon and turn the group grey. Rendered bigger than the
# rest on purpose so the ranking puts it first.
def make_large(name, fn, size):
    global S
    previous, S = S, size
    try:
        make(name, fn)
    finally:
        S = previous


def _white_spokes(x, y):
    # centre coordinates for the 512px canvas
    c = (512 - 1) / 2
    dx, dy = x - c, y - c
    r = math.hypot(dx, dy)
    if r > 190 or r < 1:
        return (255, 255, 255, 255) if r <= 190 else T
    angle = math.degrees(math.atan2(dy, dx)) % 45
    return (255, 255, 255, 255) if angle < 14 else T


make_large("mono-white-512.png", _white_spokes, 512)
