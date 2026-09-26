# Look — choosing a look, parity with the web

The LOOK family — `src/shared/lut/GradePanel.tsx`, `LutGalleryModal.tsx`,
`LookScene.tsx`, `LutThumb.tsx`, `FilmDials.tsx`, `FilmTextureDials.tsx`,
`LutPackImportModal.tsx`, `use-lut-favourites.ts`, `use-lut-interpolation.ts`,
`use-lut-packs.ts`, the vault's storage (`pack-store.ts`) and the stack's verbs
(`use-lut-stack.ts`, `use-roll-grade.ts`) — against `apple/Atelier/Look/`.
✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why). Nothing here has run on a device: written against the SDK,
compiled by CI alone.

Tool-agnostic on purpose: Develop's Look section draws it today
(`Develop/Look/DevelopLookSection.swift`), and Trips and the Studio bind the
same `GradeStackView` to their own `Binding<RollGrade?>` when they land.

Where things are:

| File | Holds |
| --- | --- |
| `LookLibrary.swift` | THE store, held once in the environment (`AtelierApp`): the `PackVault` actor over `FilePackStore`, the packs, ★, the interpolation preference, resolving a look / a whole grade (`resolve`), turning a pick into a layer, upload, import, forget, keep, adopt |
| `BuiltinLutFiles.swift` | the ONE reader of the bundled `luts/` (scanned through the kernel's `lutManifest`), `lut-thumbs/` and `reference/` |
| `FilePackStore.swift` | the vault on disk: `looks/packs/<id>.json` + `looks/lattices/<hash>.lattice` |
| `WinnowPackClient.swift` | `PackRemoteClient` over the app's `WinnowClient`; `ConnectionStore.packHostsNow` |
| `LookTiles.swift` | a tile read (bundle WebP, data URL), sampled, baked through the render graph's cube pass |
| `LookGalleryView.swift` + `LookGalleryModel.swift` | "Choose a look" |
| `LookSceneView.swift` | the scene and its view zoom (`SceneZoom`) |
| `LookTileView.swift` | one tile + ★ |
| `GradeStackView.swift` | the grade panel |
| `FilmLayerDials.swift`, `FilmTextureDialsView.swift` | a film layer's dials; grain and halation |
| `PackManagerView.swift` + `PackManagerModel.swift` + `PackRowView.swift` + `PackZip.swift` | "Your packs" |
| `LookFixtures.swift` | preview fixtures (an in-memory vault) |

Counts: **92 ✅ · 8 ≠ · 4 ⏳** — 104 rows.

## The grade panel — `GradePanel.tsx`, `use-lut-stack.ts`, `use-roll-grade.ts`

| Web | Native | |
| --- | --- | --- |
| "Add a look" — ONE select with optgroups: ★ FAVOURITES (only when something is starred), FILM, the built-ins at the root, one group per folder, each pack's tree written out as `PACK · CATEGORY · CAMERA` (hidden looks left out) | a `Menu` with the same sections in the same order (`library.favouriteItems`, `filmStocks`, `BuiltinLutFiles`, `flattenNodes` / `looksUnder` / `nodeLabelPath`) | ✅ |
| "Loading…" in the select while a look is fetched | "Loading…" on the menu's label while a pick is turned into a layer | ✅ |
| The grid button — "Browse every look on a real picture" — opens the gallery with the film stocks and the host's picture | ✅ `lookGallery` → `LookGalleryView(includeFilm: true, picture:)` | ✅ |
| A gallery pick lands at the strength it was judged at (`onPick(id, intensity)`) | ✅ `library.layer(forPick:intensity:)`, clamped where the layer is made (`lookLayerIntensity`) | ✅ |
| `.cube…` — "Load a .cube file from disk — kept in this browser’s vault, never written into the document" | ✅ Files (`.cube` or any data); "… kept in this device’s vault …" | ✅ |
| An upload goes into the VAULT as a look of the personal pack ("My looks", `pk_uploads`), deduped on the file's SHA-256; the layer stores a REFERENCE | ✅ the kernel's `uploadLookIntoVault`, the tile baked at upload | ✅ |
| A refused store refuses the upload with its sentence; never an inlined fallback | ✅ `PackVaultError` said in this device's words (`deviceWords`) | ✅ |
| The error line | ✅ | ✅ |
| "Stack — No look yet — the picture grades through untouched." | ✅ | ✅ |
| One block per layer: its switch (Bypass / Enable <name>), its name, ↑ Apply earlier, ↓ Apply later, ✕ Remove from the stack | ✅ a mini switch, three glyph buttons with the web's labels | ✅ |
| The accent rule down a live layer, the line and 60 % opacity down a bypassed one | ✅ | ✅ |
| Strength 0–300 %, step 5 %, disabled while bypassed | ✅ the develop's own slider row (`DevelopRangeSlider`, ↺ back to 100 %) | ✅ |
| A pack look this device does not hold STAYS and says why where its strength would be ("Missing") | ✅ `LookLibrary.resolve(_ grade:)` → `ResolvedLook.missing`, re-asked when the vault changes | ✅ |
| A built-in this build lacks is DROPPED by `restoreLayers` (and, on the next write, from the document) | ≠ kept in the look and said — "That look is no longer available." — opening a picture must never rewrite it | ≠ |
| A film layer's dials; "This film layer lost its settings — remove it and add the stock again." | ✅ `FilmLayerDials`; the same sentence | ✅ |
| Grain and halation (the grade's texture, between the stack and the delivery stage) | ✅ `FilmTextureDialsView` | ✅ |
| Output transform: None · Rec.709 2.4 → sRGB · Rec.709 2.4 → 2.2 · sRGB → Rec.709 2.4, with its hint | ✅ `OutputTransform.label` / `.hint` | ✅ |
| Interpolation: Tetrahedral / Trilinear, the two hints; a render PREFERENCE of this device (`atelier.lut.interpolation`) | ✅ `LookLibrary.setInterpolation` — the same key as the instrument's | ✅ |
| "N of M looks active" (more than one layer) + ⓘ "how looks combine" | ✅ the paragraph word for word | ✅ |
| Adding a film stock brings its grain and halation only where the look carries none | ✅ `RollGrade.addingFilm` (kernel, specced) | ✅ |
| An empty look is stored as null; a texture alone IS a look | ✅ `storedLook` (kernel, specced) | ✅ |
| The live stack's deferred bake (`useDeferredValue`), `composeWith` per develop | ≠ the panel edits the STORED look and bakes nothing; whoever draws resolves once per change (`ResolvedLook.cube(develop:interpolation:)`) | ≠ |
| A restore that lands after a newer one is dropped (`restoreSeq`) | ✅ `.task(id:)` cancels the older resolve | ✅ |

## The gallery — `LutGalleryModal.tsx`

| Web | Native | |
| --- | --- | --- |
| Title "Choose a look"; the line under it (scene: "Aim a look to see it on your picture — click it again to use it." / none: "Every look, on a real picture — click one to use it.") | ✅ (the line on a wide screen only, as on the web) | ✅ |
| "Packs…" in the header opens "Your packs" | ✅ a sheet over the gallery | ✅ |
| The RAIL: ★ Favourites, the film stocks, Built-in and its folders, one branch per pack, each with its count, depth indented, a hint's dot | ✅ `RailRow` over the kernel's `galleryNodes` | ✅ |
| On a phone the rail is ONE line of crumbs — roots, the open node, its ancestors, its siblings, its children — pinned above the grid, the open one scrolled into view | ✅ `LookGalleryModel.crumbs`, a horizontal strip, `scrollTo` on a change of node | ✅ |
| A filter — "Filter looks…" — matching names across every family that OWNS its looks (`matchingItems`) | ✅ | ✅ |
| "No look matches “…”." / "Nothing here yet." | ✅ | ✅ |
| The grid: tiles 88 pt and up, 74 pt tall (92 on a phone), the name under each | ✅ `LazyVGrid(.adaptive(minimum: 88))` | ✅ |
| Opening it costs nothing: built-in and film tiles SHIPPED (`public/lut-thumbs/`), a pack look's baked at import | ✅ the bundle's WebP files, a pack index's data URL | ✅ |
| Only what is on screen is resolved | ✅ the grid's `.task(id: bakeKey)` over the shown items without a tile | ✅ |
| A look with no tile is baked on the synthetic chart, one at a time with a turn given back between each | ✅ `LookGalleryModel.bake` (the kernel's `syntheticPreviewSample`, the render graph's cube pass) | ✅ |
| "failed" on a tile whose lattice could not be read | ✅ | ✅ |
| ★ in every tile's corner, at every width, two buttons side by side (never a button in a button); "Add … to favourites" / "Remove … from favourites" | ✅ `LookTileView` | ✅ |
| ★ is a `localStorage` list of pick ids (`atelier.lut.favourites`), appended at the end, 60 at most, a star whose look is gone kept | ✅ `UserDefaults`, the same key, the kernel's `toggledLutFavourite` / `readLutFavourites` (specced) | ✅ |
| "No look (original)" first where the host allows it; joining the open family's grid on a phone | ✅ | ✅ |
| A pack node's ⓘ: name — author · "where it came from", "Bought looks, kept in this browser — they never leave it." | ✅ "… kept on this device …", the link a `Link` | ✅ |
| A node's hint (the pack's "D-Log, not D-Log M") beside its heading | ✅ | ✅ |
| The heading drawn on a phone only where it says something the crumb does not | ✅ | ✅ |
| "What the tiles are shown on": Each look on its own reference frame / Tiles on their reference frames, so two looks stay comparable / Tiles on the open picture — one lattice per look / Tiles on “name” | ✅ `LookGalleryModel.sourceLine` | ✅ |
| Its verbs: "Tiles on my picture too" / "Preview on the open picture", "Preview on a photo…" / "Preview on “name”" / "Reading…", "Use the reference frames" — buttons on a wide screen, a ⋯ on a phone | ✅ | ✅ |
| "Preview on a photo…" picks a file | ≠ on a phone: Photos OR Files (a confirmation asks which); on a Mac, Files | ≠ |
| "Could not read “name” as a photo." | ✅ | ✅ |
| A tile baked on YOUR picture follows the strength; a shipped one does not | ✅ the bake key carries the strength only while baking live | ✅ |
| The sample thumbnail beside the line while the tiles are on a picture | ✅ | ✅ |
| Wide: as tall as the MEASURED screen, no rem cap; the scene a SHARE of it (28 % between 13 and 21 rem) | ✅ a Mac sheet sized to the window (ideal 1180 × 860), the full screen on an iPad; the band `clamp(208, 28 %, 336)` pt | ✅ |
| Phone: the scene a quarter of the height (8 rem floor) | ✅ | ✅ |
| Footer: "Baked from the same lattice the export uses — what you see here is what you get." + Close | ✅ | ✅ |
| Escape closes; Enter takes the aimed look | ✅ `.cancelAction` / `.defaultAction` | ✅ |
| Escape closes the credits first | ⏳ Escape closes the sheet; the ⓘ folds its credits | ⏳ |
| A 16 px field on a phone so iOS does not zoom | ≠ a native field does not zoom; kept at 16 pt for the thumb | ≠ |

## The scene — `LookScene.tsx`, `look-scene.ts`

| Web | Native | |
| --- | --- | --- |
| Only where a host handed its picture over; then a tap AIMS and the pick is the second tap / "Use this look" / Enter; without a scene a tap IS the pick, at 100 % | ✅ `LookGalleryModel.touch` | ✅ |
| ONE lattice resolved — the aimed look's; "Reading…" while it loads | ✅ | ✅ |
| The picture at 720p at most (`SCENE_PIXELS`, by area, the source's aspect) | ✅ the kernel's `sceneFrame` (ported, specced) | ✅ |
| Graded by the renderer every export uses, `mix(original, graded, strength)` | ✅ the render graph's `CubePass` (`FrameGrader`), tetrahedral unless asked | ✅ |
| Shown WHOLE in the band, on the dark of a light table | ✅ `containedSize` | ✅ |
| The look alone, WITHOUT the develop, and said: "<file> · the look alone, without your correction" | ✅ | ✅ |
| The wipe: the ORIGINAL left of the divider, "Original" / "Graded" on the picture's own halves while unzoomed | ✅ | ✅ |
| Compare switch (COMPARE) + a divider slider beside the picture; moving it turns the wipe on; a drag across the picture places it at the fit | ✅ | ✅ |
| STRENGTH 0–300 % step 5 % beside the picture, disabled (not hidden) with no look; double-click → 100 % | ≠ a tap on the percentage → 100 % (a slider has no double-click on a phone) | ≠ |
| Phone: ONE row under the picture — the strength (or the name when nothing is aimed), the note's dot, COMPARE | ✅ | ✅ |
| The note: "This conversion expects a log source. Yours is display-referred, which is why it comes out over-contrasted." | ✅ the kernel's `sceneNote` (ported, specced) | ✅ |
| Footer on a phone: the aimed name (· NN %) or "Tap a look to see it on your picture." + "Use this look" in the thumb's reach | ✅ | ✅ |
| "Use this look" + "One lattice read — and the strength goes with your pick." | ✅ | ✅ |
| Looked INTO: wheel, pinch, a drag that pans once zoomed, fit to 8× (the lightbox's ceiling), the point under the hand kept still | ✅ pinch, double tap, drag, the ± pill (`SceneZoom` over the kernel's `zoomAbout` / `clampView`) | ✅ |
| The ⌘/ctrl-wheel and a mouse wheel on the Mac | ⏳ the Mac's trackpad pinch works; a plain wheel over the scene waits on a `WheelCatcher` target for `SceneZoom` | ⏳ |
| Zoomed: only the divider's grab strip still wipes, with its ‹› handle | ✅ | ✅ |
| "Your browser does not expose WebGL2…" | ≠ no such state: Metal is always there; a look that cannot be read says its own reason | ≠ |

## The vault — `pack-store.ts`, `pack-vault.ts`, `use-lut-packs.ts`

| Web | Native | |
| --- | --- | --- |
| The vault's own storage (IndexedDB `atelier-lut-packs`: an index per pack, an ENCODED lattice per look keyed by the source `.cube`'s SHA-256) | ✅ `FilePackStore` (`Application Support/Atelier/looks/`), the kernel's codec | ✅ |
| Every storage call degrades, never throws; an empty hash is never stored | ✅ (a hash is also held to lowercase hex, being a file name here) | ✅ |
| Module state + subscribers, every picker reads the same packs | ✅ ONE `LookLibrary` in the environment over ONE `PackVault` actor | ✅ |
| Resolution cached by HASH, a miss never remembered | ✅ the kernel's `PackVault` | ✅ |
| A lattice this device lacks fetched from the instance the pack is kept on, under its `blob`, and kept | ✅ the vault's `hosts` read from `ConnectionStore.packHostsNow` (both buckets, `canKeepPack`) through `WinnowPackClient` | ✅ |
| Nothing of a pack in the build, a document or a shared file | ✅ | ✅ |

## Your packs — `LutPackImportModal.tsx`

| Web | Native | |
| --- | --- | --- |
| "Your packs" · "Looks you bought — kept in this browser, never in an exported file." | ✅ "… kept on this device …" | ✅ |
| "Choose a pack folder…" + "The folder the pack came in, with its categories inside. Everything that is not a .cube is left where it is." | ✅ a folder OR the zip it came as (Files) | ✅ |
| A ZIP | ≠ the web picks a folder only; here the archive is read in place (`PackZip`: stored + deflated entries, the one wrapping folder as the pack's root, `__MACOSX` and dot files left out) — ZIP64 and encrypted entries are refused with a sentence | ≠ |
| Two steps: what was read, BEFORE a byte is stored — "N looks in “root” · X to read", Pack / Author / Link, the per-folder counts (`importPreview`) | ✅ | ✅ |
| "Import N looks" · "Choose another folder" | ✅ | ✅ |
| "Reading i of N…" + the file; the import a TASK with no Cancel (the index is written last) | ✅ `TaskRegistry` ("Importing <pack>", "i of N") | ✅ |
| Report: "N looks in the vault · X written · Y already here." + "They are in the look picker now, under the pack’s name." | ✅ | ✅ |
| "N not taken" + each file's reason | ✅ | ✅ |
| Thumbnails baked at import on the family's reference | ✅ through the render graph's cube pass, on `public/reference/` (bundled) | ✅ |
| A tile written as WebP (PNG where the browser writes none) | ≠ JPEG — ImageIO reads WebP and cannot write it; ~5 KB a look, and the web's `<img>` reads it | ≠ |
| "In this browser" + the vault's total, here and on each instance, "N not weighed" — distinct lattices once (`vaultWeight`, `instanceWeights`) | ✅ "On this device", measured off the files | ✅ |
| A pack row: name · author, "N looks · X here · Y on host · N not weighed · N hidden" | ✅ `PackRowView` | ✅ |
| "Keep on <host>" / "Push" · "i/N" / "Checking…" · "N looks are not in this browser, so they were not sent." | ✅ (the device's words) | ✅ |
| "Looks…" / "Done" — hangs off the pack's LOOKS, so "My looks" is reachable | ✅ | ✅ |
| "What shows, and what it weighs" + ⓘ; a node's tick (count = what it HOLDS, its weight), a look's tick, its weight label (`1.6 MB there`), 🗑 Forget | ✅ `flattenPack`, `lookWeightLabel`, `lookWeightNote` as the help | ✅ |
| "Forget" — the question QUOTES what comes back, measured (`freedHashes`); the three paragraphs of the confirmation | ✅ an alert with the same sentences | ✅ |
| "Forgot “look” — <what came back>" | ✅ `forgotten` | ✅ |
| A pack kept on an instance forgotten THERE or not at all | ✅ the kernel's vault | ✅ |
| "On <host>": the packs an instance keeps that this device does not — "N looks · its looks download as you use them" · "Add here" / "Adding…" | ✅ `ElsewherePacks` | ✅ |
| "Stored in this browser, and on the instance you keep a pack on — nowhere else." · Done (disabled while importing) | ✅ | ✅ |
| Escape closes (not while importing) | ✅ the sheet's Done; swipe-to-dismiss refused while importing | ✅ |

## Develop's Look section — `DevelopLookSection` in `PictureWorkbench.tsx`

| Web | Native | |
| --- | --- | --- |
| The last block of the Adjust tab, "Look", marked when the picture wears one, ⓘ "This picture’s own look, applied AFTER its correction…" | ✅ `DevelopLookSection` (`LookSectionPlaceholder` is its name in `InspectorView`) | ✅ |
| The picture's OWN look (roll v5), following the filmstrip, written to that picture only | ✅ `RollEditor.gradeBinding` through the ONE updater (one undo step, merged per picture) | ✅ |
| `Apply look to…` at the head of the section (N selected / N other pictures), "done · …" said | ✅ `lookApplyVerbs` | ✅ |
| The gallery's scene on the picture on the stage (`picture.source`, its name) | ✅ `RollEditor.lookPicture` (the decoded source, before its develop) | ✅ |
| The texture's "a grain cell is N px here" measured on the stage's real height | ✅ `lookPreviewHeight` | ✅ |
| The stage DRAWS the look | ⏳ the Develop render plan's (`DevelopRenderPlan`); until then the stage says "not drawn here yet: look" and the texture's dials say the stage does not draw it — `LookLibrary.resolve(_ grade:)` + `ResolvedLook.cube(develop:interpolation:)` + `FilmPass.from(grade)` are what it reads | ⏳ |
| A preset "+ look" worn on the open picture | ✅ `wearPreset` (the shell's) | ✅ |

## Not yet

| Web | | |
| --- | --- | --- |
| Trips' and the Studio's Look tabs (the same panel on their own grade rungs) | ⏳ their screens; `GradeStackView(grade:picture:previewHeight:previewDraws:)` is the call | ⏳ |
