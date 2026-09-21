# Renditions — the files one capture is made of

Read before touching `shared/media/renditions.ts`, `MediaOrigin.companion`,
`materialize.ts`, `AssetParts`, `PictureWorkbench`'s `rawOffer`, or anything
that decides WHICH FILE of a capture a tool is working from. The material
ladder those files feed is `raw.md`; the plan and what is still open is
`docs/capture-renditions.md`.

## The ladder is format-blind; REACHING the RAW is not (2026-09-21)

Established while evaluating the maintainer's ask — *"ce système de rungs est
fait pour le DNG; est-ce qu'on pourrait l'avoir pour mes ARW, et en général
sur tout type d'asset?"*. The brief is `docs/capture-renditions.md`; what a
later agent must not re-derive:

- **Nothing in the ladder is DNG-specific except `dng-opcodes.ts`.**
  `probeRaw` walks any TIFF-based RAW, `canDecodeRaw` IS `isRawImage`, and
  `librawSettings` names no format — so `proxy` and `gain` already work on an
  ARW, NEF or CR2 dropped into Develop. `rungsFor` offers `gainMap` /
  `gainMapWarp` only where `OpcodeList3` (a DNG tag) is there, so another
  format simply shows two rungs. **That is the P6 rule working, not a gap.**
  Unmeasured, and only his own files can settle it: whether LibRaw decodes his
  A7C II's ARW, and how big the render inside one is.
- **What IS hard-wired is `rawOffer`** (`PictureWorkbench`): the file in hand
  is a RAW, or the proxy's OWN original is one. A capture whose RAW is a
  SEPARATE FILE — Sony `.ARW` + `.HIF`, DJI `.DNG` + `.JPG` — is the third
  case, and there is none. So those captures develop from an 8-bit proxy with
  no rung above it, which is the whole of the maintainer's report.
- **Winnow already pairs them and already tells us** (read in its own repo,
  2026-09-21): `asset_groups` kind `raw_jpeg` since its migration 0013, the
  direct file `primary` and the RAW `companion`, paired at scan time by
  `lib/pairing.ts`; `GRID_SELECT` sends `companion_id/ext/filename/file_size/
  width/height` + `group_kind` on EVERY row of `/api/assets` and
  `/api/assets/{id}`. Atelier receives all of it and drops it —
  `WinnowAssetRow` does not declare the fields, and nothing strips them. **Ask
  B costs no Winnow change.** Two traps: the listing sends `collapse=1`, which
  Winnow reads as `group_role IS DISTINCT FROM 'companion'`, so the RAW is in
  no list and must be reached by `originalUrl(companion_id)` or the
  single-asset route; and `kind 'live_photo'` puts a `.MOV` in the same
  companion fields, so a reader that does not check the ext would offer a
  movie as the sensor's data.
- **A local folder has the same gap**: `buildAssets` keeps ONE image per base
  name, so the RAW half of a pair is dropped at the door (`architecture.md`).

**Decided the same day (the maintainer), and it widens the thing**: companions
yes; **the proxy is a PERFORMANCE rendition and nothing else** — the
thumbnail, the preview, where a picture opens and never where it is trapped;
and **the pill must also offer the camera's own delivered file**, the JPEG or
the HIF — *"il y a des cas où je ne veux pas me servir du proxy et je ne veux
pas non plus aller sur un fichier brut, je veux juste aller sur le fichier
JPEG ou juste sur le fichier HIF"*. So it is not a ladder but a LIST OF FILES
with the calibration rungs nested under the sensor one, and the engine must
understand the container and the codec rather than branch per camera. The
cheapest row of that list is the delivered one: it is `fetchOriginal` moved
from the export door onto the stage. The dearest is HEIF — and the measurement
that decides its cost is whether his `.HIF` embeds a full-size JPEG, because
**Winnow's own `extract.ts` says most camera HEIFs do** (*"Sony .hif and most
camera HEIFs ship one"*, pulled with exiftool's `PreviewImage`), which would
make it the `raw-probe.ts` trick over an ISO-BMFF walk instead of a 2 MB
`libheif.wasm`. Winnow makes only two derivatives, `thumb` and `proxy`, both
WebP — there is no full-size one to ask for.

**He answered all thirty questions the same day** (`docs/capture-renditions.md`
§12). The three that change the design: the choice is **stored on the
document**, so a phone shows the same picture without re-picking — which means
it names a ROLE and a file identity, never a path, and which needs the progress
work before a stored `ARW` may spend 52 MB on a phone unasked; the **Export
tab's value is final at export**, reversing the "material wins" recommendation
and needing one more word from him, because a `rawGain` measured on the sensor
applied to an 8-bit proxy is a visibly different picture (§13.2); and the
**media preview modal — the shell's lightbox — gets the switcher too**, which
reaches past Develop. A local folder's siblings are scanned and shown as a
tuple, like Winnow's pair. What is still missing is §13, five items.

**MEASURED on his own files, 2026-09-21** (`docs/capture-renditions.md` §14,
which carries the tables). The two bodies span the whole range the design has
to hold, and in opposite directions:

- **Sony A7C II `.ARW`** — sensor 7040 × 4688, 14-bit, Sony compression 32767;
  **embedded render 7008 × 4672, a full-size JPEG of 2.7 MB**; **no
  `OpcodeList3`**. So an ARW opens at full resolution in Develop TODAY, through
  `raw-probe.ts` and no decoder — the exact opposite of the DJI — and offers two
  rungs, `proxy` · `gain`, which is the correct answer and not a gap.
- **Sony `.HIF`** — the picture is a **grid of six HEVC tiles** (7008 × 4672),
  its previews are `hvc1`, and **the only JPEG inside is 160 × 120**. So
  slicing a full-size JPEG out of a HEIF — the trick that would have made the
  HEIF row free — **does not work on this body**, whatever Winnow's
  `extract.ts` says about cameras in general. And Chrome 152 in his desktop app
  **refuses `image/heic`, `image/heif` and `image/tiff`** (`ImageDecoder`), so
  the file cannot be drawn there at all.
- **Therefore the HIF row is REDUNDANT on his kit**: the ARW's own render is
  the same 7008 × 4672 picture, drawable with nothing. The HIF's only edge is
  quality — ~3 bits per pixel against the embedded JPEG's 0.66. **`libheif.wasm`
  is a later quality choice, never a prerequisite**, and a `.HIF` is not listed
  as an unavailable row where its own capture already offers a drawable
  full-size rendition.
- **A RAW therefore yields TWO rows, not one** — its camera render and its
  sensor — and those differ by 8.4× on the DJI and by 0.5 % on the Sony. A
  model that treats a RAW as one rendition cannot say that.
- **A derivative you wrote is not a rendition** (§14.6): a `.jpg` named exactly
  as this suite names an export sat beside his DNG at 7728 × 3896 — neither the
  sensor's aspect nor a scale of it. Basename grouping cannot tell it from a
  camera's own JPEG, and neither can the EXIF, since `stamp-exif.ts` copies the
  original's block into every export. Recommended: mark our own exports in
  their `Software` tag and never offer a file carrying it, with an aspect test
  as the fallback for files made elsewhere.

**The measurement is a page, not a guess**: the Rendition Inspector
(https://claude.ai/artifact/Np2XfVEHxT7n1wrXo6rkU6) walks a TIFF's IFDs and an
ISO-BMFF's item table, finds every embedded JPEG by a MARKER WALK rather than
by a vendor tag — which is what lets it answer for a HEIF whose preview no spec
names — decodes the biggest, reads `OpcodeList3` big-endian and says which
rungs a file can honestly offer, and probes the browser's own decoders. Drop
his ARW, HIF and DNG + JPG into it before writing R3 or choosing a HEIF path.


## R1 is BUILT: one pure module, and the fields that were already arriving (2026-09-21)

`shared/media/renditions.ts` (pure, DOM-free, 15 specs) turns what is known
about a capture's files into the ordered list the pill draws; the Winnow half
is `WinnowAssetRow`'s companion fields (declared at last) and
`MediaOrigin.companion`, filled by `materialize`'s `companionOf`. No UI, no
fetch, no decode — R1 deliberately stops at the vocabulary.

Rules a later phase must keep:

- **A RAW yields TWO rows, not one** — `delivered` reached by `embedded` (the
  render its camera wrote) and `sensor` reached by `sensor` (LibRaw). This is
  the measured shape, not a nicety: those two differ by 8.4× on a DJI and by
  0.5 % on a Sony, and one row cannot say that.
- **Roles, never formats**: `proxy` · `delivered` · `sensor`, and a separate
  `reach` saying HOW the pixels are got (`file` · `embedded` · `sensor` ·
  `decoder`). A branch per camera is exactly what the maintainer asked to be
  rid of.
- **`canDraw` is INJECTED**, defaulting to `isDrawableImage`. The answer
  differs by browser and must be probed: Chrome 152 refuses HEIC/HEIF/TIFF
  where WebKit draws all three, so a static list lies to one of them.
- **A blocked row is dropped only when the same capture already offers a
  drawable delivered row** (`pruneUndrawable`) — the Sony case, where the HIF
  is unreachable and the ARW's own render is the same photograph. Where
  nothing else is drawable the row STAYS, blocked and saying why, because it
  is then the only thing between the person and their picture; and a blocked
  row with MEASURABLY more pixels than the drawable one also stays.
- **An id is `proxy` or `<role>:<lowercased file name>`** — storable and
  device-independent, since the name is what identifies a capture's file
  everywhere else in the suite (`findMedia`, Winnow's own pairing). A stored
  id that no longer resolves answers null and the caller falls back.
- **`pixels` is null until something MEASURED it.** The module never derives a
  render's size from a sensor's, because no rule predicts it.
- **`companionOf` refuses a `live_photo`**, on the kind AND on the media type,
  so a Live Photo's `.mov` can never be offered as the sensor's data. It costs
  no request: the primary's row already carries the companion's id, name and
  weight.

## Three decisions of 2026-09-21, and why the export door is dying

- **The export DOOR collapses into the pill.** `develop-originals.md` §7
  decision 1 split the question in two — material per picture, pixels at the
  door — and that was right **while they were two questions**. A RENDITION
  names both at once (a file has its bits and its frame), so the two axes are
  one, and `Auto · Proxies · Originals` now answers the same question the pill
  does. The maintainer saw it first: *"le choix de la source de pixels sera
  fait dans chaque média, donc on peut le retirer de l'export final"*. Two
  things must survive it — a way to say **"proxies, this once"** without
  writing haste into the document, and `Auto`'s ARITHMETIC (never deliver
  fewer pixels than a reachable rendition would give), which was never a
  preference and is load-bearing exactly where there is no pill. The variants
  and the recommendation are `docs/capture-renditions.md` §13.2; the one
  capability the change removes is forcing ORIGINALS from a host without a
  pill.
- **The lightbox writes NOTHING** — *"c'est juste de la visualisation […]
  juste de la curiosité de la part de l'user"*. Its switcher is view state,
  dropped on close. What carries the choice is the VERB: the `MediaAction`
  sheet already draws `Develop` under a picture looked at large, and pressing
  it while the ARW is on screen opens the develop on that rendition. An
  explicit gesture, an explicit intent — and no document changed by looking.
- **No roll-wide default, deliberately** (§13.4b). The per-picture verb and the
  filmstrip batch only, for performance and for the measuring. His stated
  direction, which is worth more than the answer: RAW by default one day, the
  proxy chosen deliberately when speed matters, possibly at the roll's
  creation. Do not build it early; do not design against it.

Still to build: R2 (`AssetParts.raw` — a local folder's RAW half is still
dropped at the library's door), R3a/R3b (the rung on screen), R4 (the export),
R5 (one vocabulary in Trips and the Studio). The derivative guard of
`docs/capture-renditions.md` §14.6 is deliberately NOT in this module: the
maintainer has not chosen between the aspect test, the `Software` marker and
the mtime rule, and guessing would make the module fabricate a fact.
