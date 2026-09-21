# Renditions — the build record, phase by phase

The rules each phase of `docs/capture-renditions.md` fixed, and what the
browser runs proved, R1b onwards. The vocabulary, the measurements and the
decisions are `renditions.md`; read that first. One section per phase; a rule
that stops being true is deleted here, not contradicted in a later section.

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

## R4 is BUILT: the export follows the picture, the door keeps one switch (2026-09-21)

His pick on §13.2: *"ok garde la case à cocher"* — B + C + D. What that is
in code, and the rules it fixes:

- **`RollExport.originals` is gone (roll v4, no block: the reader stops
  reading the key).** `RollOriginals` survives as the TYPE of an export-door
  mode for hosts with no pill — Trips and the Studio, until R5 — and
  `deliverySummary` takes a `DeliverySettings` (`longEdge` + the mode for
  THIS picture) instead of the roll's export.
- **Which pixels is the picture's, in this order**: on the sensor → its RAW
  (`sensorSourceFor`); a stored `delivered:<name>` → that file
  (`deliveredSourceFor`, the same four reaches by NAME, held under its own
  asset id — the stage's fetch is the export's fetch); else where it opens,
  where `Auto`'s arithmetic still fetches a proxy's original for a frame the
  proxy cannot fill. A picture set to its proxy is stored as null (the
  opening row), so "chose the proxy" and "chose nothing" are one case and
  both keep `Auto` — deliberate: nobody chose fewer pixels.
- **"Proxies only, for this run" is the EDITOR's state, reset with it, never
  on the roll**: every picture leaves from what is in hand, a RAW base is
  stripped (`withoutBase`) and SAID in the run's sentence, and the plan says
  how many bases it sets aside. It is the one thing the door still says.
- **The panel says the RUN before a byte moves** (`shared/develop/run-plan.ts`,
  pure): one sentence — `4 pictures · 1 from the sensor · 1 from the file
  chosen · 1 from the proxy · 1 not in hand · 69 MB to fetch · up to 8 MB more
  where a frame asks` — and a line per picture behind a `<details>`. READ-ONLY
  on purpose: editable it would be the choice above the photograph a second
  time. The bytes come from the session cache, so the plan subscribes to it
  (`subscribeHeld` / `heldVersion` in `original-cache.ts`, through
  `useSyncExternalStore`) — a `useMemo` on the roll alone went stale the
  moment the stage fetched a file and kept saying "to fetch".
- Driven against the stub instance: choosing the JPEG above the photograph
  makes the plan say `1 from the file chosen`, the run writes `DJI_0101.jpg`
  at the JPEG's 800 × 450 (the proxy is 640 × 360) with NO request to the
  instance (held from the stage), and the switch flips the sentence to
  `1 from the proxy · proxies only`.

## R5 is BUILT: one vocabulary — the three words are gone from every host (2026-09-21)

`Auto · Proxies · Originals` left Trips' Export tab and the Studio's stills
panel; what those hosts do is `Auto`'s arithmetic, unnamed — the original is
fetched only where the proxy could not fill the frame — and the *Delivers*
row is the only thing left to read. Rules:

- **`PixelsMode` is `'auto' | 'proxies'`, in `roll-export.ts`, and `'proxies'`
  exists for ONE control: Develop's *Proxies only, for this run*.** `RollOriginals`
  and the `'originals'` word are gone with the doors that spoke it; do not
  bring a "force the original" back on a host — forcing MORE pixels than the
  frame needs is what a picture's RENDITION is for (§13.2's one lost
  capability, accepted). `fixedFrameDelivery`, `deliveryFor` and
  `useDeliveryRow` take no mode at all; `deliverySummary` (the roll's, capped)
  takes `DeliverySettings.pixels`.
- **The *Delivers* row names the original by its FILE** (`originalLabel`):
  `DJI_0101.JPG 1688 px → 1920 · ×1.14 upscaled`, and `DJI_0101.DNG render`
  after a RAW's — the same word the fidelity chip's menu uses for that row,
  which is the "one vocabulary" R5 is named for. `Proxy`, `File` and `Camera
  render` stay for what has no name of its own; `Original` only where a source
  vouched for no name.
- **A clip's `renderFromProxy` is untouched** — its proxy is always the wrong
  thing to deliver, a still's often is not (`studio.md`).
- Driven in headless Chromium: a photo piece over a stub instance's 640 × 360
  proxy with a 3000 × 1688 original, the Export tab shows no *Pixels* row and
  reads `DJI_0101.JPG 1688 px → 1920 · ×1.14 upscaled · the proxy would be
  upscaled ×5.33`, with no fetch of the original for the row. The Studio's
  panel was not driven (same seam, same shape, the control removed).

## R6 is BUILT: the lightbox switches between a capture's files and writes nothing (2026-09-21)

His §13.4: *"la visionneuse n'écrit aucun choix, c'est juste de la
visualisation"*. Chips under the facts — `Proxy · DJI_0202.JPG · DJI_0202.DNG`
— switch which FILE of the capture the middle slot draws, in both sheets
(the Library's over a pool asset, `WinnowLightbox` over an instance's row
before it is fetched). Rules:

- **View state only, dropped with the sheet.** `useCaptureView`
  (`shared/develop/use-capture-view.ts`) owns the choice and the object URLs;
  `MediaLightbox` takes `files` / `viewing` / `onViewing` and never learns
  where the bytes come from. No document is touched by looking.
- **The VERB carries it.** `MediaAction.run(view?)` now takes a `MediaView`
  (`{ rendition }`, as a roll stores it — null for the opening row, through
  `viewedRendition`), and `RollEditor`'s `Develop` writes it on the picture it
  adds or finds, setting a RAW base aside exactly as the chip does. Driven:
  the DNG viewed in the Library → the roll's picture carries
  `delivered:dji_0101.dng` and the stage says `RAW · camera render`; the JPG
  viewed over a stub row → `delivered:dji_0202.jpg`, the stage says
  `JPEG · 8-bit · 800 × 450` with NO request, since the sheet's fetch was
  held under the asset id (`holdOriginal`) — the same cache the workbench and
  the export read. Trips' verbs ignore the view; a piece has no rendition.
- **One vocabulary**: `viewLabel` is the fidelity chip's word (`Proxy`, else
  the file's name); the sensor rows are left out, since a viewer draws files
  and a chip that could only say "open Develop" disappoints. A RAW is never
  handed to an `<img>`: `extractRawPreview` slices the render out, which is
  also what a LONE RAW in the Library now shows instead of "no browser
  decodes this here". A chip that will fetch wears `↓` until it has.
- **An instance's row is a capture too** (`rowCaptureInput`, pure, tested):
  the proxy it shows, the primary's file, the `raw_jpeg` companion — ids by
  name, so they match what `materialize` gives the workbench after the pick.
  No head is read before a click: the RAW's render stays unmeasured until
  looked at.
- **`useSiblingFacts`** is the one reader of a folder's siblings' heads
  (software mark, a RAW's two sizes), shared by the workbench and the sheet.
- Found on the way, fixed apart from the seam: `DevelopTool`'s loader
  re-read the store when the route's REFERENCE changed spelling — a link by
  the bare id, then the slugged path `onOpenPicture` writes — and handed
  back the copy the 800 ms debounced save had not written yet, so the picture
  just added vanished from the screen while the store held it. The same roll
  under another reference is not a reload (`rollFromRef(route.ref, [open])`).

Still to build: R9 (a ceiling on the session cache).
