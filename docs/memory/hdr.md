# HDR delivery — Ultra HDR JPEG, the gain map, what a display can show

Read before touching `src/shared/hdr/`, `RollExport.hdr`, the HDR section
of the Export tab, or before claiming anything about HDR on a still. The
video ruling is `media-pipeline.md` («HDR is not handled»); its reversal
for stills is `docs/photo-editor.md` §4.4; this is what was built for it
(P13, 2026-09-20).

## The file: an SDR JPEG carrying a gain map (2026-09-20)

An **Ultra HDR JPEG** is an ordinary JPEG — every decoder shows it — with a
second, small JPEG appended after its EOI, the **gain map**: per pixel, the
log2 ratio between an HDR rendition and the SDR one. A viewer that reads
gain maps (Android, Chrome and Safari on an HDR screen) lifts the picture
by as much of the map as the display has headroom for; everything else
shows the base. Three modules, all pure but the last:

- `gain-map.ts` — the arithmetic (ISO 21496-1 / Adobe's spec): `encodeGainMap`
  measures the map on LUMINANCE (one channel, the common form), the range
  the picture really uses becoming `GainMapMin..Max` so the 256 codes cover
  the lifts present; `applyGainMap` is the decoder's side, for the check;
  `hdrRendition` builds the HDR picture (below); `linearFromBytes` decodes
  sRGB bytes through a table. 6 specs, the round trip pinned to 2 decimals.
- `ultra-hdr.ts` — the container, by hand: the base gets an XMP `APP1`
  (a GContainer `Directory`: Primary + GainMap with its byte `Length`) and
  an MPF `APP2` (CIPA DC-007: a big-endian TIFF whose second MP entry gives
  the map's size and its offset FROM THE MP HEADER'S ENDIAN FIELD, not from
  the file's start); the map gets its own XMP with the `hdrgm:` numbers.
  `readUltraHdr` reads it back, by the MPF entry or, without one, by the
  directory's `Length` counted from the end. 5 specs over JPEG-shaped byte
  streams. `﻿` in the xpacket header must be written as an ESCAPE in
  the source: a literal BOM in a template literal trips ESLint's
  `no-irregular-whitespace`, and the Write tool turns the escape into the
  byte.
- `ultra-hdr-export.ts` — the DOM half: two delivered canvases in, the
  file out, and the CHECK that earns the name.

## Where the headroom comes from, and why a render is refused

**The HDR rendition is measured, never invented**: the picture is rendered
TWICE through the same passes — its own cube, and its cube with the
exposure lowered by the stops asked (`RollRenderOptions.hdr.lut`, composed
in `use-roll-export.ts`) — and `hdrRendition` takes, per pixel, the larger
of the SDR value and the darker render lifted back by `2^stops`. Where the
SDR had room the two agree and the map is flat; where the SDR ran out at
white, the darker render still holds what the sensor kept above it, and
that is what the map carries. An HDR display never shows a pixel darker
than the SDR file does (the `max`), and the midtones do not move.

**Only a picture developed on its RAW is offered it.** A cube's [0,1] on a
RAW is the sensor's range (`raw.md`), so the darker render reaches into real
highlights; an 8-bit render holds nothing above its white, and the darker
render of one only finds the develop's own clipping — a map from it would
lift a flat white to a brighter flat white, which is not information. So
`use-roll-export.ts` asks for the map only where `raw` is in hand, and the
run says which pictures left as plain JPEGs and why (`hdr` on `RollRun`).
Measured on the way: the direct API does make a map for a render whose
develop pushed white above white (0.49 stops on a +0.5 EV render); the rule
above is a product choice, not a limit of the maths.

**The claim comes after decoding back.** `checkUltraHdr` reads the written
bytes with `readUltraHdr`, requires the `hdrgm:` numbers to match the ones
written, decodes the base (its size must be the picture's) and the gain
map through `createImageBitmap` as a viewer would, holds the map's codes to
the ones given (JPEG rounding, in stops of the map's span) and the peak the
decoded map puts on the decoded base to the rendition's own peak; the worst
of the two must be under 0.1 stops or the plain JPEG leaves, with the
reason. Measured in headless Chromium on a synthetic underexposed DNG: the
patch clipped at 1.00 in the SDR reads 1.63 through the file's own map,
the mid ramp unchanged, read back within 0.03 stops, the map 160×120 at a
quarter of the picture (`GAIN_MAP_SCALE`, Android's default) in 2.4 KB.
Not compared pixel for pixel with the rendition: a quarter-size map softens
the edge of a clipped region by construction, and that is the format's.

## What a display can show — detected, and said (2026-09-20)

`hdr-display.ts` answers two questions apart: the DISPLAY, through the
`(dynamic-range: high)` media query; and the CANVAS, by asking a 2D
context for `rec2100-hlg` / `rec2100-pq` and reading back what it adopted —
no browser ships an HDR canvas without a flag in 2026, so the stage stays
the SDR base and the panel says so in one sentence rather than drawing a
preview that pretends. The day a browser honours the space, `canvas` turns
true on its own and an HDR stage becomes worth building; until then it is
deliberately not built. The probe is pure over an environment record and
has a spec; the DOM wrapper asks once per page.

**Where it lives**: `RollExport.hdr` + `hdrStops` (off by default, 1–4
stops, read through `readRollExport`'s limits), the Export tab's HDR
section (a switch with the support line as its hint, the reach, the last
run's line: "1 of 2 left as Ultra HDR · up to 0.7 stops above white · read
back within 0.03 stops"). The Develop tool only; Trips and the Studio
deliver stills as before.
