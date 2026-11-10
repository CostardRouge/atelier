"""A synthetic DNG in the SHAPE of a DJI Fly photo (raw.md, «What a DJI DNG actually holds»):

- IFD0      160x90 JPEG thumbnail
- SubIFD0   WxH CFA (RGGB), uncompressed 16-bit, black 4096, white 65472, OpcodeList3 = GainMap 32x32x3 + WarpRectilinear
- SubIFD1   960x540 JPEG — the only thing a browser can draw

The scene is procedural (no photograph in a public repo): fractal terrain, thin roads, text at several sizes,
resolution wedges. The sensor plane is the scene DIVIDED by the gain map (the lens's vignette), the render is
the camera's corrected picture: the centre 95.3 % of the frame, brought to 960x540.

usage: python3 scripts/gen-dji-shaped-dng.py out.DNG [width height]   (numpy + Pillow; ~73 MB at the default size — never commit the output)
"""
import io, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
W = int(sys.argv[2]) if len(sys.argv) > 2 else 8064
H = int(sys.argv[3]) if len(sys.argv) > 3 else 4536
rng = np.random.default_rng(7)

# ---- the scene, 8-bit sRGB, at the sensor's size ------------------------------------------
def octave(n):
    small = rng.random((H // n + 2, W // n + 2)).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0

height = np.zeros((H, W), np.float32)
for n, a in ((1024, 1.0), (384, 0.55), (128, 0.3), (48, 0.17), (16, 0.1), (6, 0.06), (2, 0.05)):
    height += a * octave(n)
height = (height - height.min()) / (height.max() - height.min())
rgb = np.zeros((H, W, 3), np.float32)
stops = [(0.0, (16, 44, 84)), (0.36, (28, 96, 130)), (0.42, (212, 196, 150)), (0.5, (96, 128, 62)), (0.72, (58, 84, 44)), (0.86, (122, 110, 96)), (1.0, (236, 236, 232))]
for (a, ca), (b, cb) in zip(stops, stops[1:]):
    m = (height >= a) & (height <= b)
    t = ((height - a) / (b - a))[m][:, None]
    rgb[m] = np.array(ca, np.float32) * (1 - t) + np.array(cb, np.float32) * t
# Fine grain so every level of the pyramid has something to lose.
rgb += (rng.random((H, W, 1)).astype(np.float32) - 0.5) * 18
scene = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
del rgb, height
d = ImageDraw.Draw(scene)
def font(px):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        try:
            return ImageFont.truetype(p, px)
        except OSError:
            pass
    return ImageFont.load_default()
# Roads: thin light lines, 3 px on the sensor — gone in a 960 px render.
for i in range(46):
    x0, y0 = rng.integers(0, W), rng.integers(0, H)
    pts = [(x0, y0)]
    for _ in range(14):
        x0 += int(rng.integers(-700, 700)); y0 += int(rng.integers(-420, 420))
        pts.append((x0, y0))
    d.line(pts, fill=(232, 226, 210), width=3, joint="curve")
# Fields of roofs: small rectangles.
for i in range(900):
    x, y = int(rng.integers(0, W)), int(rng.integers(0, H))
    w, h = int(rng.integers(10, 34)), int(rng.integers(10, 26))
    c = [(196, 92, 70), (214, 208, 196), (88, 96, 110), (230, 180, 90)][int(rng.integers(0, 4))]
    d.rectangle([x, y, x + w, y + h], fill=c)
# Text at several sizes, over the frame.
for row, px in enumerate((160, 96, 56, 32, 20, 14)):
    y = int(H * (0.12 + row * 0.13))
    for col in range(5):
        x = int(W * (0.06 + col * 0.19))
        d.text((x, y), f"SENSOR {W}x{H} · {px}px", font=font(px), fill=(250, 250, 244), stroke_width=max(1, px // 24), stroke_fill=(20, 20, 24))
# Resolution wedges: line pairs from 16 px down to 2 px a pair.
for k, (cx, cy) in enumerate(((0.5, 0.5), (0.14, 0.86), (0.86, 0.14), (0.86, 0.86), (0.14, 0.14))):
    x = int(W * cx) - 600; y = int(H * cy) - 150
    d.rectangle([x - 20, y - 20, x + 1220, y + 320], fill=(244, 240, 230))
    xx = x
    for pitch in (16, 12, 8, 6, 4, 3, 2):
        for j in range(0, 160, pitch):
            d.rectangle([xx + j, y, xx + j + pitch // 2 - (0 if pitch > 2 else 0), y + 300], fill=(18, 18, 22))
        xx += 172

srgb = np.asarray(scene, dtype=np.float32) / 255.0
lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4).astype(np.float32)
del srgb

# ---- the calibration: DJI's own numbers ----------------------------------------------------
corner = (5.93, 5.06, 4.97)
gy, gx = np.mgrid[0:32, 0:32].astype(np.float32)
r2 = (((gx / 31) - 0.5) ** 2 + ((gy / 31) - 0.5) ** 2) / 0.5
gains = np.stack([1 + (c - 1) * r2 ** 1.6 for c in corner], axis=-1).astype(np.float32)  # 32x32x3
def gain_full(plane):
    im = Image.fromarray(gains[:, :, plane]).resize((W, H), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32)

# ---- the sensor plane: RGGB, the scene under the lens's vignette, exposed a stop under -----
BLACK, WHITE = 4096, 65472
EXPOSURE = 0.5
cfa = np.zeros((H, W), np.uint16)
for (dy, dx, ch) in ((0, 0, 0), (0, 1, 1), (1, 0, 1), (1, 1, 2)):
    g = gain_full(ch)[dy::2, dx::2]
    v = lin[dy::2, dx::2, ch] * EXPOSURE / g
    cfa[dy::2, dx::2] = np.clip(BLACK + v * (WHITE - BLACK), 0, 65535).astype(np.uint16)
del lin

# ---- the camera's render: the corrected centre 95.3 %, 960x540 -----------------------------
K0 = 0.9530
cw, ch_ = int(W * K0), int(H * K0)
crop = scene.crop(((W - cw) // 2, (H - ch_) // 2, (W - cw) // 2 + cw, (H - ch_) // 2 + ch_))
def jpeg(im, q=90):
    b = io.BytesIO(); im.save(b, "JPEG", quality=q); return b.getvalue()
preview = jpeg(crop.resize((960, 540), Image.LANCZOS))
thumb = jpeg(crop.resize((160, 90), Image.LANCZOS), 80)
# The reference: what a perfect full-density render of the same frame would be (for the lab's comparison).
crop.save(out.rsplit(".", 1)[0] + ".reference.jpg", "JPEG", quality=95)

# ---- OpcodeList3, big-endian always --------------------------------------------------------
gm = struct.pack(">10I4dI", 0, 0, H, W, 0, 3, 1, 1, 32, 32, 1 / 31, 1 / 31, 0.0, 0.0, 3) + gains.astype(">f4").tobytes()
assert len(gm) == 12364
warp = struct.pack(">I", 3)
for k0, k1 in ((K0 + 0.00012, 0.00009), (K0, 0.0), (K0 - 0.00004, -0.00003)):
    warp += struct.pack(">6d", k0, k1, 0.0, 0.0, 0.0, 0.0)
warp += struct.pack(">2d", 0.5, 0.5)
assert len(warp) == 164
opcodes = struct.pack(">I", 2) + struct.pack(">4I", 9, 0x01030000, 1, len(gm)) + gm + struct.pack(">4I", 1, 0x01030000, 1, len(warp)) + warp

# ---- the TIFF ------------------------------------------------------------------------------
BYTE, ASCII, SHORT, LONG, RATIONAL, UNDEF, SRATIONAL = 1, 2, 3, 4, 5, 7, 10
SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8}
def pack(typ, vals):
    if typ in (BYTE, UNDEF): return bytes(vals)
    if typ == ASCII: return vals.encode() + b"\0"
    if typ == SHORT: return struct.pack(f"<{len(vals)}H", *vals)
    if typ == LONG: return struct.pack(f"<{len(vals)}I", *vals)
    if typ == RATIONAL: return b"".join(struct.pack("<II", int(round(v * 100000)), 100000) for v in vals)
    if typ == SRATIONAL: return b"".join(struct.pack("<ii", int(round(v * 100000)), 100000) for v in vals)

class Ifd:
    def __init__(self): self.tags = []
    def add(self, tag, typ, vals): self.tags.append((tag, typ, vals)); return self
    def size(self): return 2 + 12 * len(self.tags) + 4
    def write(self, at, extra_at, patch):
        """Entries at `at`; values too big for four bytes from `extra_at`. Returns (entry bytes, extra bytes)."""
        body, extra = struct.pack("<H", len(self.tags)), b""
        for tag, typ, vals in sorted(self.tags, key=lambda t: t[0]):
            vals = patch.get(tag, vals)
            data = pack(typ, vals)
            count = len(data) // SIZE[typ]
            if len(data) <= 4:
                body += struct.pack("<HHI", tag, typ, count) + data.ljust(4, b"\0")
            else:
                body += struct.pack("<HHII", tag, typ, count, extra_at + len(extra))
                extra += data + (b"\0" if len(data) % 2 else b"")
        return body + struct.pack("<I", 0), extra

XYZ_TO_SRGB = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252]
ifd0 = (Ifd().add(254, LONG, [1]).add(256, LONG, [160]).add(257, LONG, [90]).add(258, SHORT, [8, 8, 8]).add(259, SHORT, [7])
        .add(262, SHORT, [6]).add(271, ASCII, "Synthetic").add(272, ASCII, "DJI-shaped FC0000").add(273, LONG, [0]).add(274, SHORT, [1])
        .add(277, SHORT, [3]).add(278, LONG, [90]).add(279, LONG, [len(thumb)]).add(330, LONG, [0, 0])
        .add(50706, BYTE, [1, 4, 0, 0]).add(50707, BYTE, [1, 1, 0, 0]).add(50708, ASCII, "DJI-shaped FC0000")
        .add(50721, SRATIONAL, XYZ_TO_SRGB).add(50728, RATIONAL, [1.0, 1.0, 1.0]).add(50778, SHORT, [21]))
raw = (Ifd().add(254, LONG, [0]).add(256, LONG, [W]).add(257, LONG, [H]).add(258, SHORT, [16]).add(259, SHORT, [1])
       .add(262, SHORT, [32803]).add(273, LONG, [0]).add(277, SHORT, [1]).add(278, LONG, [H]).add(279, LONG, [W * H * 2])
       .add(284, SHORT, [1]).add(33421, SHORT, [2, 2]).add(33422, BYTE, [0, 1, 1, 2]).add(50710, BYTE, [0, 1, 2]).add(50711, SHORT, [1])
       .add(50713, SHORT, [1, 1]).add(50714, LONG, [BLACK]).add(50717, LONG, [WHITE]).add(51022, UNDEF, opcodes))
prev = (Ifd().add(254, LONG, [1]).add(256, LONG, [960]).add(257, LONG, [540]).add(258, SHORT, [8, 8, 8]).add(259, SHORT, [7])
        .add(262, SHORT, [6]).add(273, LONG, [0]).add(277, SHORT, [3]).add(278, LONG, [540]).add(279, LONG, [len(preview)]))

# Two passes: lay out with zero offsets to learn the sizes, then with the real ones.
def build(off):
    at0 = 8
    b0, e0 = ifd0.write(at0, at0 + ifd0.size(), {273: [off["thumb"]], 330: [off["raw"], off["prev"]]})
    at_raw = at0 + len(b0) + len(e0)
    b1, e1 = raw.write(at_raw, at_raw + raw.size(), {273: [off["cfa"]]})
    at_prev = at_raw + len(b1) + len(e1)
    b2, e2 = prev.write(at_prev, at_prev + prev.size(), {273: [off["preview"]]})
    at_thumb = at_prev + len(b2) + len(e2)
    at_preview = at_thumb + len(thumb)
    at_cfa = at_preview + len(preview)
    at_cfa += at_cfa % 2
    head = b"II*\0" + struct.pack("<I", at0) + b0 + e0 + b1 + e1 + b2 + e2
    return head, {"raw": at_raw, "prev": at_prev, "thumb": at_thumb, "preview": at_preview, "cfa": at_cfa}
_, off = build({"raw": 0, "prev": 0, "thumb": 0, "preview": 0, "cfa": 0})
head, off2 = build(off)
assert off == off2
with open(out, "wb") as f:
    f.write(head); f.write(thumb); f.write(preview)
    f.write(b"\0" * (off["cfa"] - f.tell()))
    f.write(cfa.astype("<u2").tobytes())
print(f"{out}: sensor {W}x{H}, render 960x540 ({len(preview)} bytes), head {len(head)} bytes")
