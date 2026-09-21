# Every file of one capture — the material ladder beyond the DNG

**Status (2026-09-21).** §2 is FACT, read in this repository and in
`CostardRouge/winnow` at its current `main`, with the file each claim comes
from named. §3 onwards is a PROPOSAL: nothing here has been agreed. It refines
`develop-originals.md` §7 (the two axes) and `photo-editor.md` P10 (the RAW
develop) rather than replacing either; the decisions those record still hold.

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

**What is still true: locally, the RAW half of a pair is not kept anywhere.**
Ask B has a local half, and it is `AssetParts.raw`.

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
- **R2 — the local half.** `AssetParts.raw`, filled by `buildAssets` from the
  sibling it drops today; `renditionsOf` reads it for a folder capture. *Verifies*:
  the pair tests in `assets.test.ts`.
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

## 9. The decisions to take

1. **Does a paired capture offer its RAW at all?** (The whole proposal. If
   yes, R1–R3.)
2. **Roles or formats?** `proxy | delivered | sensor` as §4.1, or keep saying
   "proxy / original / RAW" and accept a branch per source.
3. **Where the rung is offered**: the fidelity chip's menu only (the Develop
   tool, as today — the modal hosts keep the simple sheet), or also in Trips
   and the Studio.
4. **R2 at all**: does a local folder's RAW half need keeping, or is the
   instance the only place this matters in practice?
5. **§8.4**: is Sony's undocumented calibration worth a measurement pass, or
   does an ARW stop at `gain` for good?
