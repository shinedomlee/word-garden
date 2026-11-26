"""Draw the Word Garden leaf icon as PNGs (standard library only). Run: python3 scripts/make-icons.py"""
import math, struct, zlib, pathlib

BG, LEAF, VEIN = (0x2b, 0x7a, 0x4b), (0xdc, 0xef, 0xe1), (0x2b, 0x7a, 0x4b)

def leaf_color(u, v, scale):
    dx, dy = (u - 0.5) / scale, (v - 0.5) / scale
    a = (dx - dy) / math.sqrt(2)   # along the leaf, bottom-left to top-right
    b = (dx + dy) / math.sqrt(2)   # across the leaf
    L, w = 0.30, 0.13
    R = (L * L + w * w) / (2 * w)
    c = R - w
    inside = a * a + (b - c) ** 2 <= R * R and a * a + (b + c) ** 2 <= R * R
    if inside:
        if abs(b) < 0.009 and -L * 0.8 < a < L * 0.75:
            return VEIN
        return LEAF
    if -L - 0.09 < a <= -L + 0.01 and abs(b) < 0.012:
        return LEAF
    return None

def in_rounded(u, v, r):
    x, y = min(u, 1 - u), min(v, 1 - v)
    if x >= r or y >= r:
        return True
    return (x - r) ** 2 + (y - r) ** 2 <= r * r

def render(size, rounded, scale, ss=3):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    u, v = (px + (sx + .5) / ss) / size, (py + (sy + .5) / ss) / size
                    if rounded and not in_rounded(u, v, 0.22):
                        continue
                    col = leaf_color(u, v, scale) or BG
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            n = ss * ss
            alpha = acc[3] // n
            if alpha:
                k = acc[3] / 255
                row += bytes([round(acc[0] / k), round(acc[1] / k), round(acc[2] / k), alpha])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')

out = pathlib.Path(__file__).resolve().parent.parent / 'public'
(out / 'icons').mkdir(parents=True, exist_ok=True)
(out / 'icons/icon-192.png').write_bytes(render(192, True, 1.0))
(out / 'icons/icon-512.png').write_bytes(render(512, True, 1.0))
(out / 'icons/icon-maskable-512.png').write_bytes(render(512, False, 0.78))
(out / 'apple-touch-icon.png').write_bytes(render(180, False, 0.9))
(out / 'favicon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2b7a4b"/>'
    '<g transform="rotate(-45 32 32)"><path d="M13 32 A25.9 25.9 0 0 1 51 32 A25.9 25.9 0 0 1 13 32 Z" fill="#dcefe1"/>'
    '<path d="M16 32 H48" stroke="#2b7a4b" stroke-width="1.6"/><path d="M7.5 32 H14" stroke="#dcefe1" stroke-width="2.6" stroke-linecap="round"/></g></svg>\n')
print('icons written')
