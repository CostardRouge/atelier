# Develop on the original — proxy, full-size render, RAW

**Status (2026-09-15, rev. 2026-09-16): DECIDED — the maintainer accepted all
six recommendations of §7 the same day (*"je suis ok pour les
recommandations"*). O1 + O2 are BUILT in the Develop tool (D9 of
`develop-tool.md`: `MediaOrigin.name`/`bytes`, `pixelHeadroom`, the *Delivers*
line, `Auto · Proxies · Originals`, originals held for the session in
`shared/sources/original-cache.ts`) — not yet in Trips' Export tab or for
Studio stills, which still deliver from the proxy. O5 and O6 are BUILT in
the Develop tool on 2026-09-20 (P10 of `photo-editor.md`, rules in
`docs/memory/raw.md`): the Base section, `DevelopSettings.base` with its
measured `rawGain`, the decode in the stage at the pixel budget and at
export at the size the delivery needs, a proxy's RAW original fetched and
held for the session, and an unreachable RAW leaving from its render with
the run saying so. O3, O4 (his own files) and O7 are not built.**
Written from the
maintainer's question of the same day (*"c'est ok de jouer sur le proxy, mais
[…] le fichier RAW final — à quel moment ? bosser sur le proxy et à l'export
utiliser les mêmes réglages sur le RAW final ? […] pour les carrousels
d'images je pense qu'il sera plus avantageux d'utiliser le fichier RAW"*). §1
and §2 are traced to files in both repos and are fact; §3 onwards is the plan;
§7 records the six choices. The illustrated version (a pixel calculator, four
mockups) is the artifact linked from the session; this file is what outlives
it. It refines P5–P7 of `docs/photo-develop.md` and does not replace it —
read that first, and `media-pipeline.md` for the pixel budget.

## 1. What a picture is today (facts)

- **The proxy** is a WebP at quality 80, 2048 px long edge, no EXIF
  (`winnow/src/lib/config.ts` `PROXY_SIZE`, `PROXY_QUALITY`;
  `shared/sources/winnow/materialize.ts`). For a RAW, Winnow builds it from the
  file's **embedded JPEG** (`extractSourceJpeg`: `JpgFromRaw`, else
  `PreviewImage`, `winnow/src/lib/extract.ts`) — so a RAW's proxy is the
  CAMERA's render, not a small RAW. HEIC/HIF go through libheif first.
- **The original** is one `MediaOrigin.fetchOriginal()` away on every proxy.
  Winnow's `serve.ts` answers `Range` requests (disk storage), so a RAW's IFDs
  and embedded previews could be read without the whole file — CORS exposure
  of `Content-Range` unverified.
- **The develop** is the first stage of the one baked cube
  (`composeLutStack`): a per-pixel colour transform that knows nothing of
  resolution. The same numbers on the proxy and on the full-size render of the
  same capture give the same colours.
- **Trips' stills** render at a 1920 long edge (`use-post-exports.ts`): 4:5 is
  1536×1920, 9:16 is 1080×1920; framing zooms to ×8 (`MAX_FRAMING_SCALE`).
- **The Studio** already fetches a CLIP's original before export
  (`StudioEditor.tsx`, `proxyWithOriginal`); photos deliberately never do,
  *"a photo's original is often a RAW no browser decodes"*.
- `pictureFidelity` (`shared/develop/picture-fidelity.ts`) names only
  `proxy · 8-bit` or `<type> · 8-bit`; nothing knows the original's type
  before fetching it (`MediaOrigin` carries its size, not its extension).

## 2. Findings

**F1 — "more quality" is two questions.** *How many pixels* (proxy 2048 ↔
full size) and *which material* (an 8-bit render ↔ a 16-bit RAW). They have
different answers, different costs and different homes, and merging them into
one "HQ" switch is what would make the feature confusing.

**F2 — the pixels axis is exact.** Edit on the proxy, deliver from the
full-size render: same cube, same colours, more detail, no WebP artefacts.
The export can decide it alone.

**F3 — the proxy runs out sooner than it looks.** A landscape 4:3 proxy
(2048×1536) cropped to 4:5 keeps 1229 px of width for a 1536-px output: ×1.25
UPSCALED at zoom 1, ×2.0 at a framing zoom of ×1.6. The 48 MP original keeps
4838 px (×3.15 to spare). A portrait proxy in 4:5 is exactly 1:1. Carousels
of landscape pictures are where the proxy fails first.

**F4 — the material axis is NOT exact.** A RAW's "as shot" through LibRaw is
not the camera's render the proxy was made from (another tone curve, another
white balance path), and the same numbers act further on linear data
(highlights −40 recovers a sky the render cannot). "The same settings on the
RAW at export", applied blind, delivers a picture nobody has seen.

**F5 — a RAW may carry a full-size render.** DJI DNGs reportedly embed a
full-size JPEG; a Sony ARW's is ~1616 px. Where it is full-size, it is a
parity-exact "original render" for a RAW without decoding it — to measure in
the P5 spike.

**F6 — HEIC/HIF is a decoder question of its own.** Safari decodes it, Chrome
does not. An iPhone or Sony HIF original stays on the proxy until a decoder is
chosen (libheif wasm, or the ffmpeg.wasm the suite already fetches on demand).

## 3. The recommendation

Two axes, two homes, one pipeline.

1. **Material is a property of the develop, chosen in the Develop sheet.**
   `DevelopSettings.base: 'render' | 'raw'` (absent = `render`). The sheet's
   fidelity chip becomes a button whose popover lists the three sources —
   *Proxy* (here), *Original render* (full size, same look, MB shown), *RAW*
   (16-bit, MB shown, "a different starting point") — the status-pill rule.
   Picking RAW fetches, decodes a half-size preview in a worker, and re-renders;
   if numbers were already set on the render, one line says they now act on
   another base. Hold-for-before shows the RAW as decoded.
2. **Pixels are chosen at export, per piece.** `Auto · Proxies · Originals`
   in Trips' Export tab (and the same choice for Studio stills). **Auto**
   fetches an original only for a slide whose proxy crop would upscale
   (`pixelHeadroom < 1`). A `render`-base slide delivers from the full-size
   render (or the proxy when it suffices); a `raw`-base slide from the RAW,
   decoded at the smallest size that exceeds the output. **The export never
   changes a base on its own.**
3. **The Picture tab says what the piece will deliver.** A *Delivers* row:
   `Proxy 768 px → 1536 · ×2.0 upscaled` / `Original 3024 px → 1536 · ×1.97
   to spare` — the calculator in one sentence, for this crop and this format.
   The export plan repeats it per slide, with the MB to fetch and a flag on a
   RAW never looked at in Develop.

Rules to keep: decode to a budget, never to density (half-size RAW preview; a
full 48 MP decode only when the output needs it, desktop until the iPhone is
measured); originals held in memory for the session, never persisted without a
decision (a byte cache was declined once, §7.3); nothing leaves the machine
except finals on request (P7); no second exporter.

## 4. Phases (one commit each)

- **O1 — know the original, and say it.** `MediaOrigin` gains the original's
  extension and byte size; pure `pixelHeadroom(source, framing, output)` with
  tests beside it (F3's cases); the *Delivers* row and the export plan's line.
  Nothing fetched.
- **O2 — deliver from the full-size render.** `Auto · Proxies · Originals` in
  Trips' Export tab and for Studio stills, for originals the browser decodes
  (JPEG, PNG, WebP, AVIF); reverses the Studio's "photos never take this path"
  note for those; originals held for the session. Verified: a 4:5 PNG from a
  ×1.6-zoomed landscape comes out at the original's sharpness, and one develop
  gives the same colour on a flat patch of proxy and original.
- **O3 — look at the original in Develop.** The chip's popover; the full-size
  render loaded at the stage budget, so the zoom ceiling (`pixelCeiling`)
  rises with it.
- **O4 — the RAW spike (= P5), with ranged reads.** His DJI DNG, ProRAW
  (lossless JPEG and JPEG XL) and ARW: IFDs over `Range`, embedded preview
  sizes (F5), `libraw-wasm` at half and full size, heap and time.
- **O5 — develop on the RAW (= P6, plus the base).** `DevelopSettings.base`
  (Trips v21, Studio v16), the popover's RAW row, the worker decode,
  `developedAtDecode`, the base-change line.
- **O6 — export from the RAW.** Delivery decode at the smallest sufficient
  size, the never-checked flag, the iPhone heap verdict recorded.
- **O7 — HEIC/HIF.** The decoder choice (F6), then O2's mechanics. May come
  before O4 if his carousels are mostly iPhone.

## 5. Weighed and declined (so they are not re-proposed)

- *One "high quality" switch* covering both axes: it hides F4 — the one
  change that alters the look would ride along with the one that does not.
- *Applying proxy-tuned numbers to the RAW at export without a look*: the
  maintainer's first sketch; F4 is why it is refused as a silent default.
- *Developing the RAW on the server* (Winnow serving a 16-bit rendition): kept
  as `photo-develop.md` §6.2 (c), later, behind the same decoder seam.

## 6. What only a real file can answer

Embedded preview sizes per camera (F5); whether Winnow exposes
`Content-Range` over CORS; LibRaw's "as shot" against each camera's own
render (how far apart the two bases really are); heap for a half-size and a
full-size decode on his iPhone.

## 7. Decisions (accepted 2026-09-15)

1. **Two axes**: material chosen in Develop, per picture (`DevelopSettings.base`);
   pixels chosen at export, per piece. Not one HQ switch.
2. **Export default: Auto** — an original is fetched only for a slide whose
   proxy crop would upscale. Proxies and Originals stay one click away.
3. **Fetched originals are held in memory for the session**, dropped on
   close; no persistent byte cache (the earlier refusal stands).
4. **A RAW never checked in Develop is flagged at export and delivered from
   its render** (full-size embedded preview, else the proxy) — never from
   the RAW with numbers nobody has seen on it.
5. **Phone: the full-size render yes; the RAW only once a decode has been
   measured on the iPhone.**
6. **Start with O1 + O2** (know the original, deliver from decodable
   originals), no new decoder.
