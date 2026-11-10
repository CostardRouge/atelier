# The sensor outside Develop — what each phase built

Read with `sensor-outside-develop.md` (the decision, the audit, the plan)
before touching `raw-choice.ts`, `sensor-still.ts`, `use-sensor-file.ts`,
`MaterialMenu.tsx`, `recap-raw.ts`, `PostSlide.rawMaterial`, the Studio's
`sensor:` / `render` stored choices, or `offerWithSensor`.

- **S0 (2026-11-10) — the rule and the brick.** `shared/develop/raw-choice.ts`
  (pure): `autoMaterial` (sensor only for a RAW in hand whose render's long
  edge is under half the sensor's; unknown sizes keep the render),
  `materialOf` (own → document → Auto), `openOnSensor` — the develop a
  picture goes on its sensor with, now also what `use-roll-export.ts` calls in
  its two follower branches, so Develop and the others share one recipe.
  `shared/develop/sensor-still.ts`: `sensorStill(file, { edge, purpose })`
  meters, takes the top rung, renders through `renderRollPicture` and hands
  back a JPEG as taken; the last six are held per file and edge.
  `RollRenderOptions.rawMargin` (default 2): the brick passes 1, so a 2048 px
  print decodes at half size (measured headless: 8.7 s against 32 s whole
  under SwiftShader; the timings mean nothing on his Mac, the ratio does).
- **R1 (2026-11-10) — Recap's print and menu.** `RecapPicture.material`
  (own choice), `.renderEdge` (a local RAW's render long edge, read at add
  time with the SENSOR's size into `width`/`height`) and `RecapDoc.raw` (the
  recap's choice, null = Auto); `shared/recap/recap-raw.ts` (pure) resolves
  them — a LOCAL RAW counts as in hand even when its file is not handed over
  in this visit, so Auto answers the same on every visit, and a picture added
  before `renderEdge` existed stays on its render. The sensor's print is kept
  BESIDE the render's under `<key>#sensor` (the store's prune already strips
  `#…`), so switching back and forth never re-decodes; a sensor that cannot be
  reached or decoded falls back to the render's print, never stored as the
  sensor's. A Winnow RAW's original comes through `/download` and is held in
  `original-cache.ts` under the picture's key. The stage reloads a picture
  whose material changed (`use-recap-pictures.ts`, `loadedAs`); the Develop
  sheet opens on the SENSOR's print, never on the DNG in hand (whose render it
  would read). `shared/develop/MaterialMenu.tsx` is the chip: the name
  truncates, the material word stays — «Render» on the trigger, since «Camera
  render» left no room for the name in the 190 px column. Driven headless
  (1280 and 390, a synthetic DJI DNG dropped as a file): Auto opened it on the
  sensor, the line pairs sharp at the stage; *Render* gave the grey blur back.
- **R2 (2026-11-10) — Recap's exports.** `stillOriginal` (`RecapEditor.tsx`)
  reads a picture on its SENSOR again through the brick at 4096 (`purpose:
  'export'`, so a phone's 4096 ceiling); `originalStills` keeps an original
  only where `beatsPrint` (`recap-delivery.ts`, pure) says its pixels exceed
  the print's — the general rule that cured the defect the audit found (a
  Winnow DNG's 960 × 540 render replacing its 2048 px print). The film and the
  carousel paint from the same stills. Driven headless: a 4:5 Single page
  exported as PNG three ways — camera render, sensor print, sensor under
  *Originals* — side by side; the finest line pairs alias in the print and
  resolve under *Originals*. The MP4 path was not encoded here.
- **T (2026-11-10) — Trips.** `PostSlide.rawMaterial` (absent = Auto),
  carried into `DeckSlide` by `deckSlides` through `readMaterial` (a trip file
  is a stranger's JSON; the migrations spread a slide, so nothing else reads
  it). `shared/develop/use-sensor-file.ts`: a host's `File` read from its
  material — the file itself on its render, `sensorStillFile` (the brick at
  4096 on the stage budget: 2560 on a phone) on its sensor; the file stays on
  screen while the sensor is read and when it cannot be. `sensorReachable`
  offers the menu for a RAW in hand AND for a proxy whose original or
  companion is a RAW (`sensor-source.ts`); Auto never fetches. In
  `PostEditor.tsx` the stage (`stageFile`) and the Develop sheet draw it; a
  COLLAGE's cells keep their render (each cell is a fraction of the frame).
  The exports swap it in `use-post-exports.ts`'s `stillOf` (4096,
  `purpose: 'export'`): `pixelsForStills` before `deliveryFor`, the hook's
  still path, and `renderStill` — the last with the sensor swap ALONE, since it
  never fetched originals and must not start to. The menu sits BESIDE the
  door (`DevelopSection.aside`, `MaterialMenu.materialOnly`), never in it.
  EXIF for the camera credit is still read from the slide's own file (the
  sensor's JPEG carries none). Driven headless: a trip, a Single photo piece,
  the DNG from the Library — Auto on the sensor, *Camera render* blurred,
  «This slide as a PNG» on each side by side; the menu at 390 in the Picture
  drawer.
- **St (2026-11-10) — the Studio.** The stage chip (`StageRenditionMenu`)
  takes a `sensor` row beside the capture's files; the choice lives in the
  SAME per-media map, `ProjectMedia.renditions`: `sensor:<name>` (the
  renditions' own id) or `render` — needed because storing nothing means Auto,
  and Auto reads a local DJI DNG from its sensor, so picking the file it opens
  on must be remembered (`chooseRendition` in `StudioEditor.tsx`).
  `readRenditions` keeps the two; `stageChoice` still fetches only a
  `delivered:` row, so a stored sensor is never taken for a file to fetch.
  `storedMaterial` (pure) maps the map to a material for `useSensorFile`. The
  export decodes `sensorStillFile` at 4096 and SKIPS `deliveryFor` on the
  sensor — a proxy's original would be read through its 960 px render.
  Found, not changed: the chip's row for a RAW's own render shows the
  LIBRARY's size (the sensor's 8064 × 4536, from `useAssetMeta`), not the
  render's. Driven headless at 1280 and 390: Auto on the sensor (4096 × 2304),
  *DNG render* back to 960 × 540, «Export the JPEG» from the sensor.
- **D (2026-11-10) — a sensor develop taken by Trips and the Studio.**
  `offerWithSensor` (pure, `carried-edit.ts`) lifts `SENSOR_REFUSAL` for a
  host that reaches the sensor (`FromDevelopRow.sensorReach`: Trips' single
  picture, the Studio's photo). The host keeps the RAW develop AS the
  picture's develop and its material on the sensor; the brick renders it
  WHOLE (`SensorStillOptions.develop`: its rung where the file still carries
  it, its stored gain, white, profile, curve and numbers — Develop's own cube)
  and the host's cube LEAVES IT OUT (`use-trip-grade.ts` `lutFor`, the
  Studio's `lut`), adding the look and the passes only — else the gain would
  apply twice. The host's Develop sheet edits the NUMBERS (`numbersHalf`) over
  the material alone (`materialHalf`, a second sensor still while the sheet is
  open) and Done writes them back onto it (`withMaterialOf`), so the picture
  stays rendered from the sensor in float; the sheet's preview is those
  numbers on 8 bits, the delivery is not. Not covered: a collage cell, the
  rail's thumbnails (they draw the render with no develop). Driven at the
  brick only (+1 EV brighter, −1 EV darker, a stored `gain` rung kept); the
  take from a real roll was not driven headless.
