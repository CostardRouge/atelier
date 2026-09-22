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

- **Nothing in the ladder is DNG-specific except `dng-opcodes.ts`**: `probeRaw`
  walks any TIFF-based RAW, `canDecodeRaw` IS `isRawImage`, and `rungsFor`
  offers the two top rungs only where `OpcodeList3` is there — another format
  shows two rungs, which is the P6 rule working, not a gap. What WAS
  hard-wired was reaching a RAW that is a SEPARATE FILE of the capture
  (`.ARW` + `.HIF`, `.DNG` + `.JPG`): `rawOffer` knew the file in hand and a
  proxy's own original, nothing else.
- **Winnow already pairs them and already tells us** (read in its repo):
  `asset_groups` kind `raw_jpeg` (migration 0013), `GRID_SELECT` sending
  `companion_id/ext/filename/file_size/width/height` + `group_kind` on every
  row — so the companion costs no Winnow change. Two traps: the listing's
  `collapse=1` hides the companion from every list (reach it by
  `originalUrl(companion_id)`), and `kind 'live_photo'` puts a `.MOV` in the
  same fields — check the kind AND the ext. Winnow makes only `thumb` and
  `proxy` derivatives, both WebP: there is no full-size one to ask for.

**Decided by the maintainer, and it widens the thing**: companions yes; **the
proxy is a PERFORMANCE rendition and nothing else** — where a picture opens,
never where it is trapped; **the pill must also offer the camera's own
delivered file** (*"je veux juste aller sur le fichier JPEG ou juste sur le
fichier HIF"*), so it is a LIST OF FILES with the calibration rungs nested
under the sensor one; and the engine understands the container and the codec
rather than branching per camera.

**His thirty answers** are `docs/capture-renditions.md` §12; the three that
shape the code: the choice is **stored on the document** (a role and a file
name, never a path — `RollPicture.rendition`), the **Export tab's value is
final at export** (§13.2, reframed: the door collapses into the pill), and the
**shell's lightbox gets the switcher too** (R6, view state only).

**MEASURED on his own files, 2026-09-21** — the tables are §14 of the brief
and `raw.md`; what a later agent must keep: a Sony **ARW carries a FULL-SIZE
embedded render** (7008 × 4672 of a 7040 × 4688 sensor, no `OpcodeList3`), so
it opens at full resolution through `raw-probe.ts` with no decoder and two
rungs are the correct answer; his **HIF is six HEVC tiles whose only JPEG is
160 × 120**, and Chrome 152 refuses HEIC/HEIF/TIFF outright, so the HIF row
is REDUNDANT beside the ARW and **`libheif.wasm` is a later quality choice,
never a prerequisite**; a RAW therefore yields TWO rows (render, sensor),
8.4× apart on the DJI and 0.5 % on the Sony; and a derivative you wrote is
not a rendition (§14.6 — R1b below). The measuring page is the Rendition
Inspector (https://claude.ai/artifact/Np2XfVEHxT7n1wrXo6rkU6): drop a new
body's files into it before choosing a path for that body.


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

## The build record lives beside this file

What each phase of `docs/capture-renditions.md` built, the rules it fixed and
what the browser runs proved is `renditions-build.md` (R1b onwards, one
section per phase). This file keeps the vocabulary, the measurements and the
decisions; that one keeps what a later phase must not undo.
