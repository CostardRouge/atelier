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

`shared/media/renditions.ts` (pure, DOM-free) turns what is known
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
  is unreachable and the ARW's own render is the same photograph. Since
  2026-09-26 a HEIF or JPEG XL is NOT blocked (a shipped decoder reads it,
  `reach: 'decoder'`, `media-pipeline.md`), but it is pruned by the same rule:
  beside a free row it costs seconds of wasm for the same picture. Where
  nothing else is drawable the row STAYS, blocked and saying why, because it
  is then the only thing between the person and their picture; and a blocked
  row with MEASURABLY more pixels than the drawable one also stays.
- **An id is `proxy` or `<role>:<lowercased file name>`** — storable and
  device-independent, since the name is what identifies a capture's file
  everywhere else in the suite (`findMedia`, Winnow's own pairing). A stored
  id that no longer resolves answers null and the caller falls back.
- **`pixels` is null until something MEASURED it.** The module never derives a
  render's size from a sensor's, because no rule predicts it.
- **A picture OPENS on the file in hand, not on the smallest render in hand**
  (2026-10-06). `openingRendition` is: the proxy, else the row marked `open`
  (the file `CaptureInput.open` names — what the stage draws when nothing was
  chosen), else the smallest row in hand. By size alone a local
  `DJI_0202.JPG` beside its `.DNG` opened on the DNG's 960 × 540 render: the
  menu marked a row the stage was not showing, and picking that render stored
  "where it opens" (null), which put the JPG back — the render could not be
  chosen at all. **How to apply**: a row's place in the sort is about the
  list, never about what is on screen; ask `open`.
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
- **A roll-wide default — deferred on 2026-09-21 (§13.4b), BUILT on 2026-10-02**,
  his pick «C + B» from the lab https://claude.ai/artifact/XdcJWppmzbmCU2EBNVH7Wc
  (*"que le choix soit appliqué automatiquement sur tous les autres médias"*,
  with every recommendation of its seven questions). Its rules are
  `roll-choice.md`.

## The build record lives beside this file

The STUDIO's stage is a consumer too since 2026-09-29: a clip or a still switches between its proxy and the capture's files (no sensor row), stored per media in the project — `studio.md`, «The stage switches between the capture's files». `canStageDraw` is how a VIDEO becomes a rendition: `renditionsOf`'s default `canDraw` knows pictures only.

What each phase of `docs/capture-renditions.md` built, the rules it fixed and
what the browser runs proved is `renditions-build.md` (R1b onwards, one
section per phase). This file keeps the vocabulary, the measurements and the
decisions; that one keeps what a later phase must not undo.

## Moved from the MEMORY.md index (2026-10-22)

The index outgrew its ~200-line budget, so its long entries were moved here verbatim on 2026-10-22; the index keeps a one-line pointer to this section. Fold an entry into the matching section above when you next touch it.

### Open items (were the index's "Open items")

- 2026-09-15 (rev. 2026-09-20) — **Delivering a still from its original is DECIDED, and O1 + O2 are BUILT — in the Develop tool, in Trips' Export tab and for Studio stills** (`docs/develop-originals.md` §7, all six recommendations accepted): two axes (material = `DevelopSettings.base` chosen in Develop; pixels = `Auto · Proxies · Originals` at export — a control retired from every host on 2026-09-21, the picture's RENDITION answering instead, `renditions.md`), originals held for the session only (`shared/sources/original-cache.ts`), a never-checked RAW delivered from its render, RAW on the phone only after measuring. O2 reached Trips and the Studio on 2026-09-20 over one shared seam (`shared/develop/delivery-source.ts` + `fixedFrameDelivery` + `useDeliveryRow`), which is also what reversed the Studio's "photos never take this path" note. Still open: **O3 alone** — O5 + O6 landed 2026-09-20 with the RAW ladder, and **O4 + O7 stopped being export items on 2026-09-21**, folded into the one format workstream `docs/capture-renditions.md` (the export asks «what can this file give?»; that brief answers it). Also open: decision 4 as written — corrected the same day, see the bullet above and §7.4. Measured argument: a landscape proxy cropped to 4:5 is already upscaled ×1.25 at a 1920 export. Never apply proxy-tuned numbers to a RAW at export without a look — the proxy of a RAW is the camera's embedded render, another base.
- 2026-09-21 — **Reaching a capture's RAW when the RAW is a SEPARATE FILE is designed and not built, and four decisions are taken** (`docs/capture-renditions.md` §9, from the maintainer's ask about ARW and "tous les types d'assets"): companions yes; **the proxy is a PERFORMANCE rendition** (the thumbnail, the preview, where a picture opens — never where it is trapped); **the pill also offers the camera's own delivered file**, the JPEG or the HIF, because there are days he wants neither the proxy nor the sensor; and the engine understands the container and the codec rather than branching per camera. So it is a LIST OF FILES with the calibration rungs nested under the sensor one, not a ladder. The cheapest row is the delivered one (`fetchOriginal` moved from the export door onto the stage); the dearest is HEIF, and what decides its cost is a measurement — whether his `.HIF` embeds a full-size JPEG, which Winnow's own `extract.ts` says most camera HEIFs do. **He answered all thirty questions the same day** (§12): the choice is STORED on the document (so a phone shows the same picture without re-picking), the Export tab's value is final at export (§13.2 says what that costs and needs one more word), a local folder's siblings are scanned and shown as a tuple, and the shell's LIGHTBOX gets the switcher too — which reaches past Develop. §13 is what is still missing, five items. **MEASURED on his own files the same day** (§14, tables in `raw.md`), and it reshapes the plan: a Sony **ARW carries a FULL-SIZE embedded render** (7008 × 4672 against a 7040 × 4688 sensor) and no opcodes, so it opens at full resolution today with no decoder and offers two rungs; his **HIF is a grid of six HEVC tiles whose only JPEG is 160 × 120**, so slicing a full-size JPEG out of a HEIF does not work on that body, and Chrome 152 in his desktop app refuses HEIC/HEIF/TIFF outright — which makes the **HIF row redundant** (the ARW gives the same picture) and `libheif.wasm` a later QUALITY choice, never a prerequisite. So **a RAW yields TWO rows, its camera render and its sensor**, differing by 8.4× on the DJI and 0.5 % on the Sony. And a trap nothing had foreseen: **a derivative you wrote is not a rendition** — an export named the way this suite names one sat beside his DNG and basename grouping cannot tell it from a camera's JPEG, nor can the EXIF, since `stamp-exif.ts` copies the original's block. The measuring page is the **Rendition Inspector** (https://claude.ai/artifact/Np2XfVEHxT7n1wrXo6rkU6): a TIFF's IFDs, an ISO-BMFF's item table, every embedded JPEG by a marker walk, `OpcodeList3`, and the browser's own decoders. Three findings settle the size of it: the ladder is already format-blind (`proxy` and `gain` work on an ARW today; only `gainMap`/`gainMapWarp` need a DNG's opcodes, and `rungsFor` already offers them only where the file carries them — `raw.md`); what is hard-wired is `rawOffer`, which knows the file in hand and the proxy's own original and nothing else; and **Winnow already pairs RAW with JPEG/HEIF and already sends the companion's id, name and weight on every row we read**, so the whole of it costs no change on that side. Six phases, R1–R3 being the useful slice; **R1, R1b, R2 and R3a are BUILT** (`renditions.md`, `docs/run-sheet.md`) — the vocabulary (`shared/media/renditions.ts`, pure, tested: three roles, a separate `reach`, a RAW yielding TWO rows, an injected `canDraw`) plus the Winnow companion fields and `MediaOrigin.companion`; our exports marked `Software: Atelier` in every account and never offered as a rendition; a folder keeping every image file of a capture (`AssetParts.siblings`); and, on screen, **the fidelity chip's menu is now the LIST OF THE CAPTURE'S FILES** — proxy, what the camera delivered, the sensor with its rungs nested — the choice stored per picture (`RollPicture.rendition`), a drawable original fetched onto the stage and held, a folder's DNG beside a JPEG reachable as the sensor with no fetch, driven in headless Chromium on a JPEG + DNG + export-of-ours drop. **R3b is BUILT too**: `shared/develop/sensor-source.ts` is the ONE answer to where the sensor's data comes from (`file · sibling · original · companion`), called by the workbench and the export alike, a fetched RAW held under its own asset id — driven against a stub instance. **R4 is BUILT** (his pick on §13.2: keep the checkbox): a roll's picture leaves from its own rendition, `RollExport.originals` is off the document (v4), the panel says the run (`run-plan.ts`), one *Proxies only, for this run* switch stays and never touches the roll — driven against the stub instance, the chosen JPEG's own pixels written with no request. **R5 is BUILT too**: the three words are gone from Trips and the Studio, `Auto`'s arithmetic runs unnamed and the *Delivers* row names the original's file (`renditions-build.md`). **R6 is BUILT**: both lightboxes switch between the capture's files as view state and the `Develop` verb carries the one on screen. **R9 is BUILT**: the session cache has a device-sized byte ceiling, least recently used first (`renditions-build.md`). The plan is complete; R7 and R6′ stay unscheduled by decision. Five decisions are his (§9), the first being whether a paired capture offers its RAW at all. Two bugs found on the way are FIXED, not open: `.hif` was not a recognised image, and the image slot of a local pair went to "whichever half is not a RAW" — which on a Sony pair is the half most browsers cannot draw. What no measurement here can answer, and R6 exists for: whether LibRaw reads his A7C II's ARW, how big the render inside one is, and whether Sony's undocumented lens calibration is ever worth applying (the bar being the one the DJI GainMap cleared).
