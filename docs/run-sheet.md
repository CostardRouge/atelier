# Run sheet — renditions and progress

One line per commit, across the two briefs opened on 2026-09-21. **An index,
not a plan**: the reasoning lives in `capture-renditions.md` and
`progress-feedback.md`, and this file only says what is done, what is next and
what is waiting on the maintainer. Keep it current or delete it.

Legend — ✅ built · ◻ to do · ⛔ blocked · ⏸ deliberately unscheduled.

## Done this session

| | task | commit |
| --- | --- | --- |
| ✅ | Develop's Crop tab opens on **Free** | `0f1fd45` |
| ✅ | `.HIF` recognised as an image (Sony's HEIF) | `b1e37f5` |
| ✅ | The image slot goes to the half the browser can DRAW, by rank | `4c1671e` |
| ✅ | The renditions brief, and Winnow read for what it already sends | `37b4467` |
| ✅ | His thirty answers, what is missing, the progress brief | `257656e` |
| ✅ | **Measured** his ARW, HIF, DNG and JPG — HEIF leaves the prerequisites | `e3e455c` |
| ✅ | **R1** — the vocabulary: `renditions.ts`, the companion fields, `MediaOrigin.companion` | `3e5bbc4` |
| ✅ | **R1b** — our exports say `Software: Atelier`, the copied block included, and are never a rendition | `d8e0e9a` |
| ✅ | **R2** — a folder keeps every image file of a capture (`AssetParts.siblings`) | `5380091` |
| ✅ | **R3a** — the chip's menu is the capture's files; the choice stored per picture | `14a32f1` |
| ✅ | **R3b** — the sensor from a Winnow companion, one seam for the stage and the export | `5d41c3e` |
| ✅ | **R4** — the export follows the picture's rendition; the three words leave the roll | `f7b4dce` |
| ✅ | **R5** — the three words leave Trips and the Studio; the *Delivers* row names the file | `dfe5e89` |
| ✅ | **R6** — the lightbox switches between the capture's files; `Develop` carries the one viewed | `c618485` |
| ✅ | **R9** — a ceiling on the session cache, least recently used first | this commit |

Also built and not a commit: the **Rendition Inspector**
(https://claude.ai/artifact/Np2XfVEHxT7n1wrXo6rkU6), which reads a TIFF's
IFDs, an ISO-BMFF's item table, every embedded JPEG by a marker walk,
`OpcodeList3`, and the browser's own decoders.

## Renditions — `docs/capture-renditions.md`

| | id | task | what it delivers | verified by |
| --- | --- | --- | --- | --- |
| ✅ | **R1b** | Our exports say so | `Software: Atelier` written into a COPIED EXIF block too (in place where the camera's entry holds it, else IFD0 copied to the block's end), and a file marked as ours is excluded from its capture's renditions. Closes §14.6, whose case he confirmed: the `.jpg` beside his DNG was his own export. | specs on the block writer; the stamp read back |
| ✅ | **R2** | The local half | `AssetParts.siblings` — a folder's `.DNG` is kept beside its `.JPG`, its `.HIF` beside its `.ARW`, instead of dropped at the library's door (§2.4); the asset's files leave the pool together. | `assets.test.ts` |
| ✅ | **R3a** | The **delivered rung on screen** | The chip's menu is the capture's files: the proxy, what the camera delivered (a drawable original fetched onto the stage and held; the render inside a RAW), the sensor with its rungs nested under it. Stored per picture (`RollPicture.rendition`, no version bump). A folder's DNG beside a JPEG is the sensor in hand. **Not yet**: the export following a stored rendition (R4), a Winnow companion (R3b). | headless Chromium: a JPEG + DNG + export-of-ours drop lists JPG · DNG render · DNG → Gain, and leaves our export out |
| ✅ | **R3b** | The **sensor rung** from a companion | `sensor-source.ts` — one seam for the workbench AND the export (`file · sibling · original · companion`), the fetch held under the RAW's own asset id, the weight and the render's size said before the click. This is what makes a paired DJI or Sony capture developable from its RAW off a Winnow. | headless Chromium against a stub instance: the companion's head is read, the RAW fetched on Gain and held; the JPEG original fetched onto the stage |
| ✅ | **R4** | The export follows | Each picture delivered from its own rendition (`deliveredSourceFor`, one seam with the sensor's); `RollExport.originals` OFF the document (roll v4) and the three words off the Develop panel, replaced by *Proxies only, for this run* (never on the roll) and a read-only run summary with a line per picture (`run-plan.ts`). `Auto`'s arithmetic survives, unnamed, for a picture that chose nothing. §13.3's warning was already built (`793d162`). Trips and the Studio keep their three words until R5. | headless Chromium against the stub instance: the plan says the chosen JPEG, the run writes it at its own pixels with no request to the instance, "proxies only" flips the sentence |
| ✅ | **R5** | One vocabulary everywhere | `Auto · Proxies · Originals` gone from Trips' Export tab and the Studio's stills; `Auto`'s arithmetic runs unnamed (`fixedFrameDelivery` / `deliveryFor` / `useDeliveryRow` take no mode), `PixelsMode` is `auto | proxies` for Develop's one switch, and the *Delivers* row names the original by its FILE (`originalLabel`) — the pill's word. The one capability lost, forcing the original from a host without a pill, is §13.2's accepted cost. | headless Chromium: a photo piece over a stub proxy reads `DJI_0101.JPG 1688 px → 1920 · ×1.14 upscaled` with no *Pixels* row and no fetch for the row |
| ✅ | **R6** | The lightbox switcher | Chips under the facts in BOTH sheets (the Library's, the Winnow tab's) switch between the proxy, the camera's file and the render inside its RAW — view state only (`useCaptureView`), fetched on the click and held for the session, writing nothing (§13.4). `MediaAction.run(view)` hands the rendition being viewed to the `Develop` verb, which writes it on the picture. A lone RAW in the Library now shows its render instead of "no browser decodes this here". | headless Chromium: a local JPEG + DNG pair and a stub row with a DNG companion — the DNG chip draws the 640 × 360 render, the JPG chip fetches `/download` once, Develop stores `delivered:dji_0101.dng` / `delivered:dji_0202.jpg` and the stage opens on them with no second request |
| ✅ | **R9** | Bound the session cache | A byte ceiling on `original-cache.ts` sized from the device (a quarter of `navigator.deviceMemory`, 256 MiB – 1 GiB, 512 MiB by default — `held-budget.ts`), the least recently USED let go first when a hold crosses it, the file used last never; a read is a use; eviction drops the cache's reference only. The Export panel says the ceiling. | `held-budget.test.ts`, `original-cache.test.ts` |
| ⏸ | **R7** | HEIF decoder | `libheif.wasm`, ~2 MB. **Left the prerequisites**: his HIF is a grid of six HEVC tiles whose only JPEG is 160 × 120, and the ARW beside it already gives the same 7008 × 4672 picture. A later QUALITY choice (≈3 bpp against the embedded JPEG's 0.66), never a blocker. | — |
| ⏸ | **R6′** | Sony's lens calibration | Only if a measurement against the camera's own JPEG clears the bar the DJI GainMap cleared (§8.4). An ARW states none in DNG's units, so it stops at two rungs. | — |

## Progress feedback — `docs/progress-feedback.md`

| | id | task | what it delivers |
| --- | --- | --- | --- |
| ◻ | **T1** | The registry and its two surfaces | `shared/tasks/` (pure, tested), `TaskEdge` (a hairline on a media's edge — a fill when the length is known, a sweep when it is not) and `TaskPill` (the `SyncPill` family, naming the operation, carrying the Cancel). Nothing wired. |
| ◻ | **T2** | The fetches | `delivery-source.ts`, `original-cache.ts`, `resolve-media.ts`, the Winnow client. They already count their bytes, so determinate for free, and `AbortController` makes them the one thing cancellable today with no rework. |
| ◻ | **T3** | The RAW decode and the loupe | Indeterminate, cancel dropping the worker's turn rather than the worker. This is what makes a stored `ARW` choice safe to honour on a phone (§13.1). |
| ◻ | **T4** | The exports | Determinate per frame or per picture. **The real work**: a cancel has to reach inside the encoder loop, and nothing in the suite takes an `AbortSignal` today. |
| ◻ | **T5** | Retire the one-off surfaces | Trips' Export fill stays; the rest become the pill. |

## Waiting on the maintainer

| | question | blocks |
| --- | --- | --- |
| ✅ | **§13.2 — decided** (*"ok garde la case à cocher"*): the export door collapses into the pill, ONE *Proxies only, for this run* checkbox stays, the panel says the run, and `Auto`'s arithmetic survives unnamed. Built as R4 for Develop; Trips and the Studio follow in R5. | — |
| ✅ | **§13.3 — decided**: warn when writing into the folder the pictures came from, and offer a suffix (the one exception to the exact name). Only on the File System Access path — a download is the browser's and the OS's to name. | folded into R4 |
| ✅ | **§13.4b — deferred on purpose**: no roll-wide default. The per-picture verb and the filmstrip batch only, for performance and for the measuring. His stated direction: RAW by default one day, the proxy chosen deliberately for speed, possibly at the roll's creation. | R3b is unblocked |
| ✅ | **§13.4 — decided**: the lightbox writes NOTHING. Looking is looking; the `Develop` verb under the picture carries the rendition being viewed into the tool it opens. | R6 is unblocked |
| ◻ | `progress-feedback.md` §4 — modal or pill (*recommended: pill*), what a cancelled export leaves behind, where the pill lives on a phone. | T1 |
