#!/usr/bin/env python3
"""Generate placeholder PWA icons (pure stdlib, no deps).
Warm terracotta square + white play triangle. Replace with real art later."""
import zlib, struct, os, math

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (199, 91, 57)      # terracotta
FG = (255, 255, 255)    # white glyph

def png(path, size, pad_frac, opaque=False):
    # rounded-rect background + centered right-pointing play triangle
    px = bytearray()
    cx, cy = size / 2, size / 2
    r = size * 0.18                      # corner radius
    safe = size * (1 - 2 * pad_frac)     # glyph bounding box (maskable safe zone)
    # triangle vertices (right-pointing), centered, sized to ~0.42 of icon
    t = safe * 0.42
    ax, ay = cx - t * 0.5, cy - t * 0.62
    bx, by = cx - t * 0.5, cy + t * 0.62
    cxr, cyr = cx + t * 0.72, cy

    def inside_tri(x, y):
        def sign(px_, py_, x1, y1, x2, y2):
            return (px_ - x2) * (y1 - y2) - (x1 - x2) * (py_ - y2)
        d1 = sign(x, y, ax, ay, bx, by)
        d2 = sign(x, y, bx, by, cxr, cyr)
        d3 = sign(x, y, cxr, cyr, ax, ay)
        neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
        pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
        return not (neg and pos)

    def in_rounded(x, y):
        # inside square minus rounded corners
        dx = max(r - x, x - (size - r), 0)
        dy = max(r - y, y - (size - r), 0)
        return dx * dx + dy * dy <= r * r

    for y in range(size):
        px.append(0)  # PNG filter byte per row
        for x in range(size):
            xc, yc = x + 0.5, y + 0.5
            if not in_rounded(xc, yc):
                px += bytes((*BG, 255)) if opaque else bytes((0, 0, 0, 0))  # opaque sq for iOS
            elif inside_tri(xc, yc):
                px += bytes((*FG, 255))
            else:
                px += bytes((*BG, 255))

    raw = bytes(px)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA
    idat = zlib.compress(raw, 9)
    with open(os.path.join(OUT, path), "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))
    print("wrote", path, size)

png("icon-192.png", 192, 0.10)
png("icon-512.png", 512, 0.10)
png("icon-512-maskable.png", 512, 0.22)   # extra padding for Android mask
png("apple-touch-icon.png", 180, 0.10, opaque=True)   # iOS: no alpha
