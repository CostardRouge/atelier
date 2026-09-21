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

## R1b is BUILT: an export of ours says so, and is never a rendition (2026-09-21)

The §14.6 guard, by the `Software` marker — his confirmed case was his own
export beside his DNG. `shared/exif/software-mark.ts` holds the one word
(`Atelier`) and the predicate `isAtelierMade`; `stampExif` now writes it on
EVERY account, the copied block included (`retagExifBlock`'s `software`
option); and `renditionsOf` drops a file among `others` whose `software`
carries the mark, keeping the OPEN file whatever wrote it — that one is what
the person chose to work on. The aspect test and the mtime rule are NOT built:
they would guess about files made elsewhere, and he chose neither.

- **Writing an ASCII tag into a copied block is in place where the camera's
  entry can hold it, else IFD0 is COPIED to the end of the block** with the
  entry added in tag order and the header repointed at the copy. That is
  correct because every TIFF offset is absolute: the copied entries still point
  where they did, inline values travel inside their entry, and the old
  directory becomes dead bytes like the cut-loose thumbnail. Do not shift the
  block to insert an entry — every pointer in it would have to be rewritten,
  maker notes included, which is what the copy path exists to avoid. A block
  that grows past a segment still takes `stampExif`'s rebuild fallback, which
  writes the mark too.
- **The caller reads the sibling's EXIF; the module only compares.** A
  `CaptureFile.software` left undefined is "nobody looked", and the file is
  then offered — so R2/R3a must read the head of a local sibling (a few KB,
  `readExifBlock` + `parseExif`) before listing it, or the guard is silent.
- Two files whose names differ only by case share an id (`delivered:<name
  lowercased>`), exactly as `findMedia` resolves them; the guard runs BEFORE
  the id dedupe, so an export named `x.jpg` cannot shadow the camera's `x.JPG`.

## R2 is BUILT: a folder keeps every file of a capture (2026-09-21)

`AssetParts.siblings` — a LIST, not the `raw` field the brief first named,
because the file that loses the slot is not always the RAW: on a Sony pair the
ARW wins it and the HIF loses, and on a browser that draws HEIF (`canDraw`
injected) the HIF is a rendition worth listing. Filled by `buildAssets` in
listing order; the rule and the trap (`assetFiles`, and why `remove` must use
it) are in `architecture.md`. `renditionsOf` takes them as `others` —
`CaptureFile.software` still has to be READ by the caller from each
sibling's head before that (R1b above), and `photoFiles` in `roll-media.ts`
keeps handing a roll the `image` alone, so R3a is what makes a roll see them.

## R3a is BUILT: the chip's menu is the capture's files (2026-09-21)

`DevelopBaseMenu` no longer draws the four rungs: it draws `renditionsOf`'s
rows — the proxy, what the camera delivered, then the sensor with the
calibration rungs NESTED under the RAW's name (`DSC08463.ARW → Gain`, `→ Gain
map`, …), each row with its pixels and its weight, a blocked row disabled
and saying why, a row not in hand saying what fetching it costs. Driven in
headless Chromium on a JPEG + DNG + export-of-ours drop (`docs/run-sheet.md`).

- **The choice is `RollPicture.rendition`**, a rendition id, null for where
  the picture opens (the opening row is stored as nothing, one spelling), and
  an id the capture no longer offers falls back silently. No version bump:
  absent reads as null. `develop.base` stays the material rung ABOVE it;
  picking a file drops the base, picking a rung leaves the file choice stored
  under it. Neither travels with a preset, a paste or a batch verb.
- **`shared/develop/capture-files.ts` is the one place the workbench's facts
  become `CaptureFile`s** — the open file and what the stage measured of it,
  the origin's original (held? its render read?), the folder siblings once
  their heads are read. Pure and tested; the workbench only calls it.
- **A sibling is listed only once its head is READ** (its `Software`, a RAW's
  sizes) — the R1b rule; an unread sibling is not offered rather than offered
  and withdrawn a tick later. Siblings are a LOCAL picture's only: a file an
  instance handed over has its own `companion`, and pairing a Winnow proxy
  with a same-named file on disk would be a guess.
- **A folder's RAW beside a JPEG is the sensor in hand**: `rawOffer:
  'sibling'`, no fetch — the local half of R3b, and free.
- **The delivered fetch is keyed on the rendition's ID, not the row object**:
  the list is rebuilt whenever a sibling's head or a held original changes,
  and an effect depending on the row would cancel and restart a 9 MB fetch
  each time. `originalHeld` is state, bumped after the fetch, so the row's
  `here` and its hint follow.
- **Not built, on purpose**: the export following a stored rendition (R4,
  waiting on §13.2's Q1); the Winnow companion (R3b); the lightbox (R6).
  Until R4, a picture shown from its JPEG is still exported under `Auto ·
  Proxies · Originals` — same numbers, possibly different pixels.

## R3b is BUILT: the sensor from a Winnow companion, through ONE seam (2026-09-21)

`shared/develop/sensor-source.ts` is the one answer to "where does the
sensor's data come from" — `file` · `sibling` · `original` · `companion`, in
that order — and BOTH the workbench and the export call it (`sensorSourceFor`
+ `fetchSensorFile`), so a picture developed on a companion's RAW leaves the
export from that RAW. Rules a later phase must keep:

- **A fetched RAW is held under ITS OWN asset id** — the companion's, never
  the picture's — so the delivered row's `here`, the sensor row's hint and
  the export's `heldOriginal` all agree. `fetchSensorFile` holds; nothing
  else calls `holdOriginal` for a RAW.
- **The companion's render size is read from its HEAD before any click**
  (`rawRenderFrom(companion.fetchHead, companion.assetId)`, a megabyte with a
  `Range` the instance ignores and a cancelled body), so the row says its
  pixels, and `null` — read, none — is remembered like an original's.
- **The delivered fetch routes by NAME**: a row named like the companion
  fetches the companion; else the proxy's original. Two files of one capture
  never share a name.
- **The export takes the same seam WITH the siblings** (`siblingsOf`, from
  `RollEditor`): without it a picture developed on a folder's DNG beside its
  JPEG would leave from the render "not reachable here" — the workbench and
  the export must be handed the same files or they disagree.
- Driven against a STUB instance (`testing.md`'s recipe): the row with
  `raw_jpeg` companion fields lists `proxy · JPG · DNG render · DNG → Gain`
  with the companion's weight; choosing the JPG fetches `/download` of the
  primary and the chip says `JPEG · 8-bit`; choosing Gain reads the
  companion's head (`bytes=0-1048575`), then fetches it whole, holds both,
  and LibRaw honestly refuses the fake sensor plane — said on the row.

Two bugs found by that run, fixed apart from the seam: a fetched original
carries an EMPTY type (`materialize` hands it over with none) and
`pictureFidelity` called it a `clip` — it now reads the NAME before the type
(`develop.md`); and the stage released a bitmap it was still drawing when the
delivered file changed in the same commit as the RAW arrived (`develop.md`,
«A replaced source is released one commit later»).

Still to build: R4 (the export following a stored rendition — waiting on
§13.2's Q1), R5 (one vocabulary in Trips and the Studio), R6 (the lightbox).
