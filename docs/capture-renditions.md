# Every file of one capture — the material ladder beyond the DNG

**Status (2026-09-21).** §2 and §10 are FACT, read in this repository and in
`CostardRouge/winnow` at its current `main`, with the file each claim comes
from named. §3–§8 are a PROPOSAL. **§9 records what the maintainer decided the
same day** — companions yes, the proxy as the performance rendition, and the
pill widened to the camera's own JPEG or HEIF — which makes §4–§6 the shape to
build. **§12 is his answer to all thirty of §11's questions**, and **§13 is
what is still missing**: five things, of which one (§13.2) needs a single word
from him before R4 can be written. **§14 is FACT again** — his own ARW, HIF,
DNG and JPG read in the pane — and it kills the HEIF prerequisite, promotes
R3a, and finds a trap nothing had foreseen (§14.6).
It refines `develop-originals.md` §7 (the two axes) and `photo-editor.md` P10
(the RAW develop) rather than replacing either; the decisions those record
still hold.

Read it before touching `MediaOrigin`, `materialize.ts`, `PictureWorkbench`'s
`rawOffer`, `DevelopSettings.base`, or anything that decides WHICH FILE of a
capture the suite is working from.

---

## 1. What was asked

> The rungs — proxy, gain, gain map, gain map + warp — are made for DNG. Could
> the same work for my Sony `.ARW`? And more generally: on every kind of asset,
> could I reach the raw file directly, transparently and systematically, rather
> than by something hard-wired for the DNG? For a Sony shot I would choose
> between the HEIF and the DNG; for the drone, between the JPEG and the DNG.
> Winnow already detects the raw file behind a derivative.

Three asks, and they are not the same size:

- **A.** Make the ladder work on an ARW. (Almost free — §2.1.)
- **B.** Reach the RAW that is a SEPARATE FILE of the same capture. (The real
  one — §2.2, §2.3.)
- **C.** Say all of it in ONE vocabulary, on every asset and every tool.

---

## 2. What is true today

### 2.1 The ladder is not DNG-specific — except at its top two rungs

- `shared/exif/raw-probe.ts` walks **any TIFF-based RAW** (its own header says
  so) through the EXIF parser's reader: DNG, ARW, NEF, CR2. It finds the sensor
  plane by `PhotometricInterpretation` and the biggest embedded render by
  pixel count — no format branch anywhere.
- `shared/library/assets.ts` already knows `arw`, `cr2`, `cr3`, `nef`, `raf`,
  `rw2`, `orf`, `srw`, `pef`, `raw`, `dng`, and `canDecodeRaw`
  (`raw/raw-decoder.ts`) is exactly `isRawImage(file.name)`.
- `decodeRaw` hands the file to LibRaw with one settings object
  (`librawSettings`) that names no format, and `raw-image.ts` inverts dcraw's
  BT.709 curve — a property of the DECODER, not of the file.

**So `proxy` and `gain` already work on an ARW dropped into Develop today.**
Unverified: no ARW has been decoded here (no file in this container), and the
render inside an ARW has never been measured — see §8.

What IS DNG-only is `shared/exif/dng-opcodes.ts`: `OpcodeList3` (tag 51022) is
a DNG tag. `rungsFor` (`raw/calibration.ts`) offers `gainMap` / `gainMapWarp`
**only where the file carries the opcode**, so an ARW simply shows two rungs
instead of four. That is the P6 rule working, not a gap: a correction nobody
measured is worse than none.

### 2.2 What IS hard-wired: how the RAW is reached

`tools/develop/PictureWorkbench.tsx`:

```ts
const rawOffer: RawOffer | null =
  file && canDecodeRaw(file) ? 'file'
  : origin?.name && isRawImage(origin.name) && origin.fetchOriginal ? 'original'
  : null;
```

Two cases: the file in hand IS a RAW, or the proxy's OWN original is one.
**There is no third case** — and a capture whose RAW is a *separate file*
(Sony `.ARW` + `.HIF`, DJI `.DNG` + `.JPG`) is precisely the third case. The
picture on screen is the HEIF's or the JPEG's proxy, its original is that same
HEIF or JPEG, and the sensor's data is in a file nothing here can name.

That is the whole of ask B, and it is one branch.

### 2.3 Winnow already pairs them, and already tells us

Read in `CostardRouge/winnow`:

- **`db/migrations/0013_asset_groups.sql`** — `asset_groups(kind 'raw_jpeg')`
  plus `assets.group_id` / `group_role`. Its own words: *"Sony A7C II → .ARW +
  .HIF, DJI drones → .DNG + .JPG"*. The direct file is the **primary**, the
  RAW the **companion**.
- **`src/lib/pairing.ts`** — `reconcileGroupsForSession` pairs at scan time by
  basename within a session, only where a basename has exactly one RAW and one
  direct photo and neither is grouped; idempotent, and the second file may
  arrive in a later scan.
- **`src/lib/assetQuery.ts`** — `GRID_SELECT` sends, on every asset row,
  `companion_id`, `companion_ext`, `companion_media_type`,
  `companion_filename`, `companion_file_size`, `companion_width`,
  `companion_height` and `group_kind`. `GRID_FROM` pulls them through a
  LATERAL. Both `/api/assets` and `/api/assets/{id}` use that projection.

**Atelier already receives all of it and throws it away**: `WinnowAssetRow`
(`sources/winnow/client.ts`) does not declare those fields, and `client.json`
casts the body without stripping anything. **No change is needed on Winnow's
side for ask B** — which is rare enough to say out loud.

One thing does need care: Atelier lists assets with **`collapse: 1`**
(`client.assets`), and Winnow's `buildFilter` turns that into
`a.group_role IS DISTINCT FROM 'companion'`. So the RAW never appears as a row
— by design, and rightly, since a capture is one tile. It also means the
companion cannot be fetched by listing its id: it is reached by
`originalUrl(companion_id)` (no row lookup needed — the primary's row already
carries its name and weight) or by the single-asset route, which does not
collapse.

`0014_live_photo_groups.sql` reuses the same machinery for Live Photos
(still + `.mov`, `kind 'live_photo'`). **A companion is therefore not always a
RAW**, and anything reading one must check.

### 2.4 A local folder pairs them too — and kept only one half

`buildAssets` groups by base name, so `DSC00123.ARW` + `DSC00123.HIF` is one
photo asset — and `AssetParts` has ONE image slot, so the other file is
dropped at the library's door. Two bugs came out of that while writing this,
both now fixed (`architecture.md`): `.hif` was not a recognised image at all,
and the slot went to "whichever half is not a RAW", which on a Sony pair is the
half most browsers cannot draw. The slot now goes by rank — drawable beats a
RAW beats a HEIF or TIFF.

**Built as R2 (2026-09-21)**: the half that loses the slot is kept in
`AssetParts.siblings` — a list, since on a Sony pair the loser is the HIF and
not the RAW — and leaves the pool with its asset (`assetFiles`).

### 2.5 The same question is asked in three vocabularies

| where | what it says | scope |
| --- | --- | --- |
| `DevelopSettings.base` | proxy / gain / gainMap / gainMapWarp | one picture, STORED |
| `RollOriginals` (`Auto · Proxies · Originals`) | which pixels leave | one export run, never stored |
| `MediaOrigin.fidelity` + `fetchOriginal` | proxy or capture, and how to get it | one file, in the identity registry |

Three views of *which bytes of this capture am I working from*. Ask C is: make
them one vocabulary. They should not become one CONTROL — `develop-originals.md`
§7 decision 1 (material in Develop, pixels at the export door) is right and is
not up for revision. One vocabulary, two controls.

---

## 3. Findings

1. **A is nearly done.** Making the ladder "work for ARW" needs no code: it
   needs one measurement on his own file (§8).
2. **B is one field and one branch.** `MediaOrigin` learns the companion;
   `rawOffer` learns a third case. Everything downstream already takes a
   `File` and is format-blind.
3. **B is bigger in what it unlocks than in what it costs.** Today his Sony
   and drone shoots ingested as RAW+JPEG pairs can be developed only from an
   8-bit proxy: no highlight recovery, no white balance worth the name. After,
   they climb the same ladder his lone DNGs already do.
4. **C is a naming job, not a rewrite** — but it is what stops a fourth
   vocabulary appearing the next time a source offers a fourth file.

---

## 4. The recommendation

### 4.1 One word: a capture has RENDITIONS

A pure module, `shared/media/renditions.ts`, that turns what is already known
about a capture into the list of files the suite could work from — ordered,
each saying what it IS and how to get it:

```ts
/** One file of a capture the suite could work from. */
export interface Rendition {
  /** The ROLE, never the format: what this file is FOR. */
  role: 'proxy' | 'delivered' | 'sensor';
  name: string;
  bytes: number | null;
  /** The file's own pixels where the source or a probe states them. */
  width: number | null;
  height: number | null;
  /** True where a browser draws it with no decoder of ours (`isDrawableImage`). */
  drawable: boolean;
  /** Absent for the file already in hand. */
  fetch?: () => Promise<File>;
}

export function renditionsOf(file: File, origin: MediaOrigin | null): Rendition[];
```

`role` is the load-bearing part. `proxy` is a source's editing rendition,
`delivered` is what the camera wrote for people to look at (a JPEG, a HEIF, the
render inside a RAW), `sensor` is the file a RAW decoder can read. Three roles
answer every camera in the house and leave the format out of it, which is
exactly what "transparent, systématique" has to mean in code.

The four-rung ladder is then DERIVED, not parallel: rung `proxy` is the best
drawable rendition; `gain` and above are the `sensor` one, at the calibration
its own file carries (`rungsFor`, unchanged).

### 4.2 What changes, seam by seam

- **`MediaOrigin` gains `sensor?: { assetId, name, bytes, width, height, fetch,
  fetchHead }`** — the one field. `materialize` fills it from `companion_*`
  when `group_kind === 'raw_jpeg'` **and** the companion's ext is a RAW (the
  Live Photo check of §2.3). Nothing else in the registry moves.
- **`AssetParts` gains `raw?: File`** — the local half, filled by
  `buildAssets` from the sibling it currently drops. Same field, two feeders.
- **`rawOffer` gains `'sensor'`**, reading the rendition list rather than
  testing `origin.name`. The fetch is `holdOriginal`-ed for the session exactly
  as a fetched original is (`develop-originals.md` decision 3).
- **`pictureFidelity` says WHICH FILE** when it is not the one in hand:
  `RAW · 16-bit linear · from DSC00123.ARW · 8640 × 5760`. It already names
  bits and pixels; the file is the third fact a person needs to trust what they
  are looking at.
- **`DevelopBaseMenu`** says the weight before the click (`companion_file_size`
  is on the row): *"opens DSC00123.ARW from its instance · 52 MB, held for this
  session"* — the sentence it already has for an original.
- **The export** resolves the sensor rendition the same way and climbs to
  `topRung` inside it, unchanged (`develop-roll.md`, «The export climbs the RAW
  ladder»).
- **The *Delivers* row** (`useDeliveryRow`) names the rendition rather than
  `proxy`/`original` alone — the one place ask C becomes visible in Trips and
  the Studio too.

### 4.3 What does NOT change, and must not

- **Nothing new is stored on a document.** `base` stays the rung; WHERE the
  sensor's bytes are is re-derived from the source each session, like every
  other fact about this machine's tunnel. A document holds a reference, never
  bytes, and never a path.
- **The base still travels nowhere** (`withoutBase`): a preset, a paste and a
  batch verb keep each target's own material.
- **Crossing from the proxy to the sensor is never done at the export door.**
  A companion rung is the same gesture as today's RAW rung — the person clicks
  it and SEES it — so `raw.md`'s rule is inherited whole, not weakened.
- **Nothing is fetched on open.** A 25–80 MB RAW is behind a click, with its
  weight written on the click.
- **A rung a file cannot reach is never left standing**: a companion that has
  gone (unpaired, purged, offline) falls back to the render with the run saying
  so, which is the behaviour already built for an unreachable RAW.

---

## 5. What it means for each of his cameras

| capture | files | today | after |
| --- | --- | --- | --- |
| A7C II, RAW + HEIF | `DSC00123.ARW` + `.HIF` | the HIF is listed; its WebP proxy is all there is; **no RAW rung at all** | the ARW is a rung on that same picture |
| A7C II, RAW only | `DSC00123.ARW` | proxy over a RAW original → `gain` offered (§2.1, unmeasured) | unchanged |
| DJI, JPEG + DNG | `DJI_0001.JPG` + `.DNG` | the JPG is listed; **the DNG is invisible** | the DNG is a rung, with its gain map and warp (both measured, `raw.md`) |
| DJI, DNG only | `dji_fly_*.DNG` | works today — the measured case | unchanged |
| iPhone, HEIC | `IMG_1234.HEIC` | proxy, nothing above it | unchanged: there is no sensor file to offer |
| iPhone, ProRAW | `IMG_1234.DNG` | as the drone's lone DNG | unchanged |
| Live Photo | `IMG_1234.HEIC` + `.MOV` | the still is listed | unchanged — a `live_photo` companion is motion, never material |

---

## 6. Phases (one commit each)

- **R1 — `renditionsOf`, pure and tested.** The module, the three roles, and
  the reading of `companion_*`; `WinnowAssetRow` declares the fields it has
  been receiving all along. No UI, no fetch. *Verifies*: unit tests over the
  four shapes of row (unpaired, `raw_jpeg` with the RAW as companion,
  `live_photo`, a companion whose ext is not a RAW).
- **R2 — the local half.** `AssetParts.siblings` (built 2026-09-21), filled by
  `buildAssets` from the files it dropped before; `renditionsOf` reads them as
  `others` for a folder capture. *Verifies*: the pair tests in `assets.test.ts`.
- **R3 — the rung.** `MediaOrigin.sensor`, `materialize` filling it,
  `rawOffer: 'sensor'`, the fetch and its status line, `pictureFidelity` naming
  the file. **This is the commit that makes his Sony and drone pairs
  developable.** *Verifies*: the pane, against a stub instance serving a paired
  row (`testing.md`'s recipe).
- **R4 — the export.** `use-roll-export.ts` resolves the sensor rendition the
  same way; the *Delivers* row names it; the climb to `topRung` is unchanged.
- **R5 — one vocabulary everywhere.** Trips' Export tab and the Studio's stills
  read the rendition list through `useDeliveryRow`; the words match the menu's.
- **R6 — the measurement pass on his own files** (§8), recorded in `raw.md`
  beside the DJI numbers. Nothing ships on a guess about a body nobody here has
  a file from.

R1–R3 is the useful slice: after it, a paired capture develops from its sensor.
R4–R5 make the file that leaves match, and make the words one set.

**What §9 adds to that list.** The camera's own delivered file becomes a row of
the pill, which splits R3 in two and adds one phase:

- **R3a — the delivered rung where the browser already draws it**: the JPEG
  beside a DNG, and any drawable original. It is `fetchOriginal` on the stage
  rather than at the export door, so it is the cheapest row of the whole pill
  and it is what makes "je veux juste le JPEG" true on the drone. **Built
  2026-09-21** (`renditions.md`, «R3a is BUILT»): `DevelopBaseMenu` lists the
  rows, `RollPicture.rendition` stores the pick, `capture-files.ts` builds
  the input from what the workbench holds.
- **R3b — the sensor rung** (the companion RAW), as R3 above.
- **R7 — HEIF**, whichever of §11.C11 the measurement chooses. It is the only
  part that could add a dependency, and it is deliberately last: everything
  else ships without it, and a `.HIF` is drawn from the proxy until it lands.

---

## 7. Weighed and declined

- **Uncollapsing Winnow's listing** (two tiles per capture). That is what
  `collapse=1` exists to prevent, and it would put the RAW in the Library as a
  second picture with its own develop — the opposite of one capture, one
  picture.
- **Storing which rendition a picture was developed from.** It is a fact about
  this machine and this session, exactly like `Auto · Proxies · Originals`; the
  rung is what belongs on the document.
- **A persistent cache of fetched RAWs.** The standing refusal
  (`local-first.md`); held for the session, dropped on close.
- **A HEIF decoder in the bundle** (libheif.wasm, 1–2 MB). Winnow's proxy
  already answers for an instance's HEIF, and a Sony pair read from a card
  shows its ARW's render instead (§2.4). Worth revisiting only if he works from
  a card with no instance, and then as a dynamic import beside `libraw-wasm`.
- **Inventing a lens correction for a body whose file does not carry one.**
  §8.4 is the measurement that would change this; without it, the ARW shows two
  rungs and says so.

---

## 8. What only his own files can answer

1. **Does `libraw-wasm` decode an A7C II `.ARW`?** Expected yes (LibRaw's
   supported list covers ARW and the seam names no format), unverified here.
   One file, dropped into Develop, base → *Gain*.
2. **How big is the render inside an ARW?** `probeRaw` answers from a
   megabyte. It decides whether the `proxy` rung on a lone ARW looks sharp or
   looks like the DJI's 960 × 540 did.
3. **What does a `.HIF` weigh, and what are its pixels?** It is what the
   proxy stands in for in every browser but Safari.
4. **Does the ARW carry lens calibration we could read?** A DNG states it in
   the spec's own units; Sony writes its distortion / CA / vignetting
   parameters in MakerNotes, reverse-engineered rather than specified. The bar
   is the one the DJI GainMap cleared: measured against the camera's own JPEG,
   on patches, before a single coefficient is applied. Until then, no rung
   above `gain` on an ARW — and that is the correct answer, not a missing
   feature.
5. **The phone verdict** — still open from `develop-originals.md` decision 5,
   and a 52 MB fetch plus a 33 MP decode is exactly the case it is about.

---

## 9. The decisions taken (2026-09-21)

The maintainer answered the first two of the five questions this section
opened with, and widened the third. In his words:

> Oui, on va bien se servir des compagnons. Le proxy, c'est vraiment pour la
> performance et le côté pratique — au moins voir la miniature, la preview, le
> contenu. Ensuite on laisse l'utilisateur afficher le fichier RAW, comme on
> le fait déjà pour les opcodes DJI. […] Même dans cette pilule il faut aussi
> proposer le JPEG et le HIF : il y a des cas où je ne veux pas me servir du
> proxy et je ne veux pas non plus aller sur un fichier brut, je veux juste
> aller sur le fichier JPEG ou juste sur le fichier HIF.

1. **A paired capture offers its RAW.** Decided. R1–R3.
2. **The proxy is a PERFORMANCE rendition, and nothing else** — the thumbnail,
   the preview, the content. It is where a picture opens and never where it is
   trapped.
3. **The pill offers the camera's own delivered file too** — the JPEG, the
   HIF. This is the widening: the menu is not proxy-or-sensor, it is every
   file the capture has, and the calibration rungs live under the sensor one.
4. **The engine must UNDERSTAND what it is holding** — the container, the
   codec, and what this browser can do with each — rather than branch per
   camera. `.ARW` + `.HIF`, `.DNG` + `.JPG`, a lone `.DNG`, a lone `.HIF`:
   one mechanism, four answers.

Two of the original five remain open (R2's local half, §8.4's Sony
calibration) and are folded into §11 below.

### 9.1 What that makes the pill

Not a ladder but a **list of files, with the calibration rungs nested under
the sensor one**. For his two bodies:

```
DSC00123 (A7C II)                    DJI_0001 (drone)
  Proxy      WebP  2048   · 0.4 MB     Proxy      WebP  2048   · 0.4 MB
  HIF        HEIF  8640   ·  12 MB     JPEG       JPEG  8064   ·   9 MB
  ARW → Gain RAW   8640   ·  52 MB     DNG → Gain            RAW 8064 · 74 MB
                                           → + gain map
                                           → + gain map & warp
```

Three of those five kinds of row exist today. The JPEG row is `fetchOriginal`
— already built, already measured, already decodable. The HIF row is the one
that costs something, because most browsers do not decode HEIF at all (§11.C).

## 10. Two facts read in Winnow that shape the HEIF answer

- **Winnow makes exactly two derivatives per photo** (`lib/derivatives.ts`): a
  `thumb` and a `proxy`, both WebP, both capped by `config.proxySize`. **There
  is no full-size derivative**, so "give me the HIF's pixels" cannot be
  answered by an existing route.
- **But a camera HEIF usually carries a full-size JPEG inside it.** Winnow's
  own `extract.ts` says so in as many words — *"A full-size embedded preview
  is ideal: instant, no pixel decode at all (Sony .hif and most camera HEIFs
  ship one)"* — and pulls it with exiftool's `JpgFromRaw` / `PreviewImage` /
  `ThumbnailImage`, exactly the trick `raw-probe.ts` plays on a RAW.

So the HEIF question may not need a decoder at all: it may need an ISO-BMFF
walk to the same embedded JPEG. That is a measurement on one of his `.HIF`
files, not a judgement (§11.G).

## 11. The questions a complete plan needs answered

Grouped, with a recommendation on each so they can be answered by exception.

### A — the control and its vocabulary

1. **One flat list or two levels?** `Proxy · JPEG · HIF · RAW (gain) · RAW
   (+gain map) · RAW (+warp)` in one menu, or the files first with the
   calibration rungs nested under the sensor one.
   *Recommended*: **flat, with the RAW's rungs grouped under a separator** —
   the `OverflowMenu` already draws that, and a picture is one question.
2. **What the rows say: the role or the file?** "Camera render / Sensor", or
   `JPEG · 8064 px · 9 MB`.
   *Recommended*: **the file, with its pixels and its weight** — he asked for
   "le fichier JPEG", and a person choosing bytes wants to see the bytes. The
   role stays internal.
3. **Is the choice STORED on the document, or a fact about this machine?**
   Today `base` is stored (material) while `Auto · Proxies · Originals` is an
   export-door choice. "From the JPEG rather than the proxy" is the same
   material at more pixels, which argues for the door; but a person who picked
   the JPEG expects it again tomorrow, which argues for the document.
   *Recommended*: **stored**, one field replacing `base`, because preview =
   export must hold and because the alternative silently reverts his choice.
4. **Does it batch?** "Open these 30 from their RAW" over a filmstrip
   selection.
   *Recommended*: **yes for the FILE, never for the numbers** — the role is
   resolved per picture and each `rawGain` is measured on its own picture;
   the clipboard and the presets keep carrying nothing (`withoutBase`).
5. **Develop only, or Trips and the Studio too?**
   *Recommended*: **Develop only** at first (the modal hosts keep the simple
   sheet, today's rule), with the *Delivers* row naming the file everywhere.

### B — detection: what a capture has, and what this browser can do with it

6. **How many files per capture?** Winnow pairs exactly two; a folder can hold
   `.DNG` + `.JPG` + `.HIF`.
   *Recommended*: the list takes N, ranked; the sources fill what they know.
7. **Does a local folder keep every sibling, or only the RAW?**
   *Recommended*: `AssetParts.raw` plus a `siblings` list — the cost is a
   field, and it is what makes a card-only workflow work.
8. **Static list of drawable formats, or a runtime probe?** Safari decodes
   HEIF, Chromium does not; a static list lies to one of them.
   *Recommended*: **probe once per session** (`ImageDecoder.isTypeSupported`,
   else a real decode of the file with a stated fallback).
9. **Live Photo companions** (`kind 'live_photo'`, a `.MOV`): ignored as
   material — but ever offered as "the motion"?
   *Recommended*: out of scope, recorded.
10. **Do clips get the same pill?** The Studio already has "render from the
    proxy" for a rush.
    *Recommended*: same vocabulary, later phase (R5+), no second control.

### C — HEIF, the one real expense

11. **How is a `.HIF` opened where the browser does not decode it?** Four ways:
    (a) `libheif.wasm` by dynamic import (~2 MB, the exact twin of
    `libraw-wasm`); (b) read the full-size JPEG embedded in the HEIF ourselves
    (ISO-BMFF walk + the Exif item — §10); (c) ask Winnow for a full-size
    derivative it does not make today; (d) offer the HIF only where the
    browser decodes it.
    *Recommended*: **(d) + (b)** — (b) is the trick `raw-probe.ts` already
    plays and costs no megabyte; (a) only if (b) fails on his files; (c) makes
    Winnow pay for a browser's gap.
12. **If (b): what happens when a HEIF embeds no preview, or a small one?**
    *Recommended*: say it, fall back to the proxy, offer (a) as a later phase.
13. **If (c) ever: a stored third derivative, or rendered on demand?**
14. **16-bit TIFF originals: in the list or out?**
    *Recommended*: out — nothing in the house writes one.

### D — cost, cache and memory

15. **Fetched only on a click, with the weight on the click** — confirm.
16. **Several renditions held per picture** (proxy + a 9 MB JPEG + a 74 MB
    DNG): does `original-cache.ts` need a byte ceiling and an eviction?
    *Recommended*: **yes, an LRU with a stated ceiling** — a forty-picture
    roll at 74 MB is an ended tab, and today's cache has no bound.
17. **Prefetch the chosen rendition for the filmstrip's neighbours**, as the
    proxies are prefetched?
    *Recommended*: no.
18. **On reload, with a stored choice (A3)**: reopen on the proxy and fetch on
    demand, or fetch at once?
    *Recommended*: **open on the proxy**, the pill saying `ARW · not loaded`,
    one click to bring it back. The proxy is the performance rendition; that
    is what it is for.

### E — the export

19. **Do `Auto · Proxies · Originals` survive, or does the pixels axis fold
    into the renditions list?**
    *Recommended*: they survive; `Auto` becomes "the best drawable rendition
    this frame needs".
20. **If a picture is developed from the HIF, does `Proxies` still deliver
    from the proxy?**
    *Recommended*: **no — the chosen material wins**. `Proxies` chooses pixels
    at equal material, it never steps down a material a person chose.
21. **Whose EXIF does the delivered file carry, when a capture has two
    originals?**
    *Recommended*: **the primary's** (the JPEG/HIF) — it is what Winnow pairs
    on and what his Gallery folder is matched by.
22. **The name**: `DJI_0101.jpg` whether developed from the DNG or the JPG —
    so two deliveries of one capture from two materials collide and are
    numbered `-1`. Acceptable, or does the material belong in the name?
    *Recommended*: keep the name; the collision rule already exists.

### F — what the screen says

23. **How many facts before the chip is a paragraph?** Today: bits, rungs,
    pixels. Adding the file name and the weight makes five.
    *Recommended*: chip = `RAW · 16-bit · gain map · 8640 × 5760`; the file
    name goes in the menu row and in the `I` fact stack.
24. **A rendition that cannot be reached** (offline, unpaired, undecodable):
    does the stored choice fall, or stand and wait?
    *Recommended*: **stand, fall back to the best reachable, and say so** —
    today's rule for an unreachable rung, extended.

### G — what only his own files can answer (before deciding C and A3)

25. Does `libraw-wasm` decode an A7C II `.ARW`, and what does it cost?
26. How big is the render embedded in an ARW? (Decides whether a lone ARW
    looks sharp on the proxy rung.)
27. **Does his `.HIF` embed a full-size JPEG** (§10, the whole of C11b), and
    what does it weigh?
28. Does the Chromium in his desktop app decode HEIC at all? (One line.)
29. Is the DJI `.JPG` beside the DNG full size (8064 px)? — decides whether
    "just the JPEG" is worth a row on that body.
30. The phone budget: a 52 MB fetch plus a 33 MP decode on his iPhone.

**26–29 are answered by dropping the files into the Rendition Inspector**
(2026-09-21): https://claude.ai/artifact/Np2XfVEHxT7n1wrXo6rkU6 — a page that
walks a TIFF's IFDs and an ISO-BMFF's item table, finds every embedded JPEG by
a marker walk rather than by a vendor tag, decodes the biggest ones, reads
`OpcodeList3` big-endian and says which rungs the file can honestly offer, and
probes what the browser decodes. Everything is read in the tab; nothing is
uploaded. 25 and 30 need the app itself, not the page.

## 12. His answers (2026-09-21)

Answered by exception against §11's recommendations. What is not restated took
the recommendation.

| # | his answer | consequence |
| --- | --- | --- |
| A1 | flat list, for now | as recommended |
| A2 | the file, its weight | as recommended |
| A3 | **stored on the document** — *"comme ça sur mobile je peux voir la même chose sans avoir à reselect"* | the stored value must be device-independent: it names the ROLE and the file's identity, never a path or a held blob. And it collides with §11.D18 — see §13.1 |
| A4 | *"qu'est-ce qui se batche ?"* | the RENDITION over a filmstrip selection: "open these 30 from their RAW". Answered, still to decide |
| A5 | Develop first | as recommended — but B7 widens it, see §13.4 |
| B6 | the list shows the variants that exist: `proxy · hif · arw` | exactly §9.1 |
| B7 | **yes, scan the local folder for siblings and show a tuple like Winnow** — and the media preview modal gets a way to switch between the files / "raw layers" | the lightbox is shell-level, so this reaches past Develop |
| B8 | probe; and decode HEIF with a library if it comes to that | as recommended, with C11a kept open |
| B9 | later, maybe in Trips | recorded |
| B10 | yes, the same design for clips | a clip's list is proxy · original; there is no sensor rung |
| C11 | open to libheif — **and a person can always pick the JPEG row instead** | that sentence is the reason the phasing works: HEIF is last, and nothing waits on it |
| C12 | say it, fall back to the proxy | as recommended |
| C13 | rendered on demand, cached well (browser cache, IndexedDB) | for the day Winnow serves a full-size |
| C14 | *"why not? where does it come from?"* | from an ORIGINAL's extension, never from a RAW — a `.tif` capture. No camera in the house writes one, so no row; see §13.5 |
| D15 | download on click, weight shown in advance | as recommended |
| D16 | best judgement | a bounded LRU on `original-cache.ts` — it has no ceiling today |
| D17 | no prefetch | as recommended |
| D18 | *"maybe an explicit «load raw data» button, or we assume the loading"* | undecided — §13.1 resolves it with the progress work |
| E19 | yes, the three modes survive | as recommended |
| E20 | **no — the Export tab's choice is the final value at export** | reverses the recommendation, and it has a consequence: §13.2 |
| E21 | the primary's EXIF | as recommended |
| E22 | keep the name — **but he sometimes exports into the folder the originals are in, so there is an overwrite risk** | the guard already exists; §13.3 |
| F23 | *"tu veux dire que le nom de l'option est trop long ?"* | no — the CHIP above the photograph, which accumulates facts until it is a sentence. Recommendation stands: four facts on the chip, the file name in the menu row and the `I` stack |
| F24 | if it fails, warn and change nothing | as recommended |
| G25–G30 | analyse it in an artifact | built — §11's note |
| G29 | the DJI JPEG is 8064 × 4536 — **but it varies by drone, never hardcode it** | the list is read from the file, never from a table of bodies |

## 13. What is still missing

### 13.1 A stored choice, a phone, and a 52 MB fetch (A3 × D18)

A3 says the choice rides the document so a phone shows the same thing. D18
leaves open what happens when that phone opens the picture: the stored choice
says ARW, the file is 52 MB, and nothing is in memory. The two honest shapes:

- **an explicit row action** — the pill's row reads `ARW · not loaded`, a tap
  loads it. Predictable, one more gesture on every reopen.
- **load on open, visibly and cancellably** — which is exactly the progress
  work of `progress-feedback.md`: a hairline on the media's edge while it
  comes, a cancel that falls back to the proxy.

The second is better and depends on that brief. **Until it exists, the first
is the safe default** — a stored choice must never silently spend 52 MB of a
phone's data.

### 13.2 The door COLLAPSES into the pill (reframed 2026-09-21)

The question was which of three meanings `Proxies` takes over a picture
developed from its sensor. The maintainer's answer was better than the
question: *"le choix de la source de pixels sera fait dans chaque média […]
donc on pense qu'on peut le retirer de l'export final"*.

**He is right, and the reason is structural.** `develop-originals.md` §7
decision 1 split the question in two — MATERIAL per picture, PIXELS at the
export door — and that was correct **while they were two questions**: a base
rung said which bits, `Auto · Proxies · Originals` said which pixels. A
RENDITION names both at once: a file has its bits AND its frame. So the two
axes are now one, the door and the pill answer the same question, and §13.2 was
hard only because a duplicated control has no good answer.

**What the door still does that the pill does not**, and what must survive it:

- **"Not now, not on this connection."** The rendition is on the DOCUMENT
  (A3), the tunnel is about this machine. A roll stored on his desktop as
  `ARW` and exported from a phone must have one way to say *proxies, this
  once* — and changing the pill instead would write that haste into the
  document.
- **`Auto`'s arithmetic, which was never a preference.** It fetches a bigger
  rendition only where the proxy could not fill the frame asked for — the
  measured case being a landscape proxy cropped to 4:5, upscaled ×1.25 at
  1920. In a host WITH a pill that job is the person's; in Trips and the
  Studio, which by his own A5 have no pill, nothing else does it.

#### The variants

**A — nothing at the door.** Each picture is delivered from its own rendition;
the panel says what that means for the run. Purest, and it leaves no way to
say "not now" but the batch verb, which writes the document.

**B — nothing, plus ONE checkbox: *Proxies only, this run*.** Off by default,
never touches the document, and it is the ASSUMED override he described: a
picture developed from its sensor is delivered from its proxy with the base
STRIPPED and the run saying so in as many words. One control instead of three,
and it cannot be mistaken for a material choice.

**C — the export lists every picture and its source.** His own idea. As an
EDITABLE list it is the duplication again, one edit in two places. As a
READ-ONLY summary it is just the *Delivers* row grown to the whole run, and it
costs nothing: `6 photos · 2 depuis leur ARW (69 Mo à charger) · 4 depuis les
proxies`, one line per picture behind an ⓘ.

**D — keep `Auto` alone, wherever there is no pill.** Not as a word on a
segmented control but as the automatic behaviour: never deliver fewer pixels
than a reachable rendition would give. Invisible in Develop (the pill decides),
load-bearing in Trips and the Studio until the pill reaches them.

#### Recommended: B + C + D

Two controls become one checkbox, and the panel gains a sentence instead of a
mode. The three words go from every host — from Develop because the pill
answers, from Trips and the Studio because `Auto` was the only one of the three
doing real work there and it does not need a name. `RollExport.originals` comes
off the document (roll v2 → v3, the migration R3a already carries).

**The one capability this removes**: forcing ORIGINALS from a host that has no
pill. Today Trips can say "originals" on a piece; after, it delivers what the
rendition says and `Auto` stops an upscale, and forcing more waits for the pill
to reach Trips. Worth naming, since it is the only thing lost.

### 13.3 Exporting into the folder the originals live in (E22)

The guard exists and was measured (`develop-roll.md`): `RollExport.replace` is
off by default, the folder is asked about each name as its turn comes, the
probe reaches the real file system so a case-insensitive volume answers about
`DJI_0101.JPG` when asked about `DJI_0101.jpg`, and a taken name is numbered.
So **an original is never overwritten unless Replace is ticked**.

What renditions add: two deliveries of ONE capture from two materials now want
one name, and the second becomes `-1`.

**DECIDED 2026-09-21 (the maintainer): warn, and offer a suffix.** When the
folder being written into is the one the pictures came from, the export says so
before it runs and offers to add a suffix — his one exception to "named
EXACTLY after its picture" (`develop-roll.md`), which stays the default. It is
the only case where ticking Replace is destructive rather than idempotent.

**And it exists only on the File System Access path** — his own point, and it
is right: a plain download hands the file to the browser, which names and
de-duplicates it with the OS, so there is no folder to compare and nothing to
ask. The warning is drawn where `pickDeliveryTarget` returned a directory
handle, and nowhere else. The comparison itself is one call the roll can
already make: `FileSystemHandle.isSameEntry` against the handle the roll
remembers for its local pictures (`develop-media.md`) — no path, no string
match, and it answers false for a folder that merely looks alike.

### 13.4 Where the switcher lives — DECIDED 2026-09-21

**The lightbox writes nothing.** *"Pour moi la visionneuse n'écrit aucun
choix, c'est juste de la visualisation […] juste de la curiosité de la part de
l'user."* Looking at a capture's other file is looking; closing the lightbox
leaves the document exactly as it was.

**The verb is what carries it.** The sheet already draws a tool's
`MediaActions` under a picture looked at large, `Develop` among them
(`develop-roll.md`, D10). Pressing it while the ARW is on screen opens the
develop ON that rendition — an explicit gesture, an explicit intent. So the
choice is not lost, it is only never made by accident.

**How to apply**: the lightbox's switcher is view state, dropped on close; the
`MediaAction` reads the rendition being viewed and hands it to the tool it
opens. Nothing else in the shell learns about renditions.

### 13.4b The roll-wide default — DEFERRED on purpose, with its direction

He declined to answer now, and said where it is heading, which is worth more
than the answer: *"à terme il faudra absolument que l'on bosse sur le fichier
RAW, et le proxy serait plutôt le choix à sélectionner explicitement quand on
veut gagner du temps. Ce choix pourrait même être dans la modale de création du
rouleau. Mais pour l'instant je préfère que l'utilisateur choisisse
explicitement sur chacun des RAW."*

So: **R3b ships the per-picture verb and the filmstrip batch, and no roll
setting**, for performance and for the measuring. The eventual shape — RAW by
default, the proxy chosen deliberately for speed, possibly at the roll's
creation — is his to add when the measurements say it is affordable. Do not
build it early, and do not design against it: the batch verb and a future
default go down the same path.

### 13.5 Small and unanswered (before the measurement; §14 answers three)

- **A TIFF row** (C14): no camera here writes one; the answer is no row until
  one does.
- **A roll-wide default** — "develop everything from the RAW where there is
  one" as a roll setting, rather than a verb run over a selection.
- **A capture with no proxy at all** (a local folder, no instance): the list is
  `HIF · ARW` and the stage opens on… the biggest drawable rendition. Needs
  saying, since every pixel budget in the suite assumes a proxy-sized opening.
- **The field's name and its migration**: `DevelopSettings.base` becomes
  something that names a file, and roll v2 → v3 (`photo-editor.md`'s edit-stack
  migration wanted that number too — one of them has to move).

## 14. Measured on his own files (2026-09-21)

Read by the Rendition Inspector in the desktop app's browser pane. **This is
fact**, and it settles the HEIF question and reshapes §6.

### 14.1 The browser

Chrome 152 (Electron 44, the Claude desktop app) decodes **JPEG, PNG, WebP and
AVIF** through `ImageDecoder`, and **refuses HEIC, HEIF and TIFF**. So the
probe of §11.B8 is not a formality: on the machine he works on, a `.HIF` cannot
be drawn at all.

### 14.2 Sony A7C II — `DSC08463.ARW`, 34.6 MB

| | |
| --- | --- |
| sensor plane | **7040 × 4688**, 14-bit, Sony compression 32767 (lossless-compressed) |
| embedded render | **7008 × 4672 JPEG, 2.7 MB** — full size, 99.5 % of the sensor's long edge |
| `OpcodeList3` | **none** |

**The ARW opens at full resolution in Develop today**, with no decoder and no
dependency: `raw-probe.ts` finds that render and `extractRawPreview` slices it
out. That is the exact opposite of the DJI case, and it is why "the ladder is
format-blind" was worth establishing before building anything.

No opcodes, so **two rungs — `proxy` · `gain`** — which is the answer §11.C
predicted and not a gap. Sony's lens calibration, if it is anywhere, is in
MakerNotes no spec names (§8.4); the file states none in DNG's units.

### 14.3 Sony A7C II — `DSC07666.HIF`, 12.6 MB — **C11b is dead**

| item | type | pixels | bytes |
| --- | --- | --- | --- |
| 7 (primary) | `grid` | 7008 × 4672 | 8 B |
| 1–6 | `hvc1` | 3520 × 1600 each | 1.7–2.4 MB |
| 8 | `hvc1` | 1616 × 1080 | 228 KB |
| 9 | `hvc1` | 320 × 212 | 16 KB |
| 10 | `jpeg` | **160 × 120** | 8 KB |
| 11 / 12 | `Exif` / `mime` | — | 92 KB / 56 KB |

The picture is a **grid of six HEVC tiles**, and the only JPEG inside the file
is a **160 × 120 thumbnail**. So the trick §10 hoped for — slice the full-size
JPEG out of the HEIF the way `raw-probe.ts` slices one out of a RAW — **does
not work on this body**. Winnow's own note (*"Sony .hif and most camera HEIFs
ship one"*) is true of enough cameras to be worth the code path there; it is
false of his. Its own fallback is what runs: a full libheif decode, server-side,
where libheif exists.

**So the HIF can be reached only by shipping a decoder** (C11a) or by Winnow
serving a full-size derivative it does not make today (C11c).

### 14.4 …and that makes the HIF row REDUNDANT on his kit

Both files are 7008 × 4672. The ARW's embedded render is that picture, drawable
with nothing, out of a file he already has. The HIF's only real edge is
**quality**: 12.6 MB of HEVC against 2.7 MB of JPEG for 32.7 megapixels — about
3 bits per pixel against 0.66 — and weight through a tunnel.

**Recommendation, revised.** Do not ship a HEIF decoder for v1, and do not list
a `.HIF` as an unavailable row where its own capture already offers a drawable
full-size rendition. State it where it is the only delivered file, say the
browser cannot draw it, and let the ARW answer. `libheif.wasm` becomes what it
should have been all along: a quality choice, taken later, on a measurement of
what those extra bits are worth on a photograph — not a prerequisite.

### 14.5 DJI — the earlier measurement holds

`dji_fly_…_photo.DNG`, 70.6 MB: sensor **8064 × 4536** uncompressed 16-bit,
embedded render **960 × 540**, GainMap 32 × 32 × 3 asking **0.997–6.030×**
(**2.59 stops** at the corner), WarpRectilinear `k0 = 0.9530` with the green
plane's `k1..k3` at zero. Four rungs, and the pair of bodies now spans the whole
range the design has to hold: **one camera writes no usable render and all the
calibration; the other writes a perfect render and no calibration.**

### 14.6 The trap in the same drop: a derivative is not a rendition

`dji_fly_…_photo.jpg` sat beside `dji_fly_…_photo.DNG` — same base name, so the
inspector grouped them as one capture. It is **7728 × 3896**, against the DNG's
8064 × 4536: neither the sensor's aspect (1.98 : 1 against 1.78 : 1) nor a
scale of it, and named exactly the way this suite names an export
(`develop-roll.md` — the extension lowercased, no word added). It is almost
certainly **his own export, written into the folder the originals live in** —
which is §13.3 happening in the wild.

**The rule that follows**: basename grouping alone cannot tell a camera's own
delivered file from a derivative you wrote beside it, and the EXIF cannot
either, because `stamp-exif.ts` deliberately copies the original's block into
the export. Offering that JPEG as "the camera's render" would be a fabrication
of exactly the kind this repo's rules exist to stop. Three ways out, and the
choice is his: **(a)** a delivered rendition must share the sensor's aspect
within a tolerance — cheap, catches this case, misses an uncropped re-export;
**(b)** an export writes a marker into its own EXIF (a `Software` tag saying
Atelier) and a file carrying it is never offered as a rendition — honest and
exact, but only for files this suite made; **(c)** never group a local sibling
whose modification time is later than the RAW's by more than a session.
Recommended: **(b), with (a) as the fallback for files made elsewhere.**

**Built as R1b (2026-09-21): (b) alone.** `shared/exif/software-mark.ts`,
`retagExifBlock`'s `software` option, and `renditionsOf` dropping a sibling
whose `software` carries the mark. (a) and (c) are not built — both guess
about files made elsewhere, and he has not asked for either.

### 14.7 What this does to the phases

- **R3a is now the best first commit by a distance**: the delivered rung on a
  Sony is `raw-probe.ts` over a file already in hand, and the whole Sony
  workflow stops being proxy-only for the cost of one row.
- **R7 (HEIF) leaves the plan** as a prerequisite and becomes an optional
  quality pass, unscheduled.
- **The `viaEmbeddedRender` distinction becomes structural, not cosmetic**: a
  RAW yields TWO rows — its camera render (drawable now) and its sensor — and
  the pixel counts of those two rows differ by 8.4× on one body and by 0.5 % on
  the other. A design that treats a RAW as one row cannot say that.
