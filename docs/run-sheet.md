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

Also built and not a commit: the **Rendition Inspector**
(https://claude.ai/artifact/Np2XfVEHxT7n1wrXo6rkU6), which reads a TIFF's
IFDs, an ISO-BMFF's item table, every embedded JPEG by a marker walk,
`OpcodeList3`, and the browser's own decoders.

## Renditions — `docs/capture-renditions.md`

| | id | task | what it delivers | verified by |
| --- | --- | --- | --- | --- |
| ✅ | **R1b** | Our exports say so | `Software: Atelier` written into a COPIED EXIF block too (in place where the camera's entry holds it, else IFD0 copied to the block's end), and a file marked as ours is excluded from its capture's renditions. Closes §14.6, whose case he confirmed: the `.jpg` beside his DNG was his own export. | specs on the block writer; the stamp read back |
| ✅ | **R2** | The local half | `AssetParts.siblings` — a folder's `.DNG` is kept beside its `.JPG`, its `.HIF` beside its `.ARW`, instead of dropped at the library's door (§2.4); the asset's files leave the pool together. | `assets.test.ts` |
| ◻ | **R3a** | The **delivered rung on screen** | The camera's own picture as a row of the pill: a drawable original, or the render inside a RAW. On his Sony this is `raw-probe.ts` over a file already in hand, and the whole ARW workflow stops being proxy-only. Carries the stored field and its migration (roll v2 → v3). | the pane, on a dropped ARW |
| ◻ | **R3b** | The **sensor rung** from a companion | `rawOffer: 'companion'`, the fetch held for the session, the weight said before the click, `pictureFidelity` naming the file. This is what makes a paired DJI capture developable from its DNG. | the pane, against a stub instance |
| ⛔ | **R4** | The export follows | Each picture delivered from its own rendition; `RollExport.originals` comes OFF the document and the three words come off every panel, replaced by one *Proxies only, this run* checkbox and a read-only summary (§13.2 B + C + D). Also carries §13.3's warning. **Waiting on his pick between the variants.** | the pane, two runs |
| ◻ | **R5** | One vocabulary everywhere | Trips' Export tab and the Studio's stills read the list through `useDeliveryRow`; the words match the pill's. | the pane |
| ◻ | **R6** | The lightbox switcher | The shell's media preview offers the capture's other files (his B7), as VIEW STATE only — it writes nothing (§13.4). The `Develop` verb under the picture hands the rendition being viewed to the tool it opens. | the pane |
| ◻ | **R9** | Bound the session cache | An LRU ceiling on `original-cache.ts` — it has none today, and a forty-picture roll at 74 MB each is an ended tab (his D16). | a spec on the eviction |
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
| ⛔ | **§13.2 — reframed**: the export door COLLAPSES into the pill. Variants A–D there; recommended **B + C + D** — the three words go from every host, one *Proxies only, this run* checkbox replaces them, the panel gains a read-only summary, and `Auto`'s arithmetic survives unnamed where there is no pill. Waiting on his pick. | R4 |
| ✅ | **§13.3 — decided**: warn when writing into the folder the pictures came from, and offer a suffix (the one exception to the exact name). Only on the File System Access path — a download is the browser's and the OS's to name. | folded into R4 |
| ✅ | **§13.4b — deferred on purpose**: no roll-wide default. The per-picture verb and the filmstrip batch only, for performance and for the measuring. His stated direction: RAW by default one day, the proxy chosen deliberately for speed, possibly at the roll's creation. | R3b is unblocked |
| ✅ | **§13.4 — decided**: the lightbox writes NOTHING. Looking is looking; the `Develop` verb under the picture carries the rendition being viewed into the tool it opens. | R6 is unblocked |
| ◻ | `progress-feedback.md` §4 — modal or pill (*recommended: pill*), what a cancelled export leaves behind, where the pill lives on a phone. | T1 |
