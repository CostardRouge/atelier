# Atelier, native — iPhone, iPad and Mac

The same suite as the web app (`../src/`), the same documents, on Apple's own
frameworks: SwiftUI over a Swift port of the kernel (`Packages/AtelierKit`),
Core Image for the pixels, Photos and Files for the pictures. Why it exists,
and what a native app changes, is in `../docs/native-app.md`; why Swift and
not Expo or Flutter is in `../docs/native-stack.md`; the screens it builds to
are the design canvas linked from both.

**The rule that shapes every file: a document keeps meaning what it meant.** A
roll made here is the web app's `RollDoc` (v6), written as the same JSON, so it
opens in the browser and on a Winnow unchanged — and a field this app does not
yet interpret is carried through untouched, never dropped.

## Building

```
brew install xcodegen          # once
cd apple && xcodegen generate  # writes Atelier.xcodeproj (gitignored)
open Atelier.xcodeproj         # schemes: Atelier-iOS, Atelier-macOS
```

The kernel builds and tests without Xcode, on any machine with a Swift
toolchain — including Linux, which is where this project is written from:

```
swift test --package-path apple/Packages/AtelierKit
```

On a Linux box with no Swift and no way to reach swift.org (the cloud
sessions), `apple/Scripts/linux-toolchain.sh` pulls the official
`swift:5.10-jammy` image from Google's Docker Hub mirror, unpacks it into a
rootfs and installs `swift` / `swiftc` wrappers that chroot into it — the
same compiler as CI's Linux job, in about two minutes, for the kernel only.

CI (`.github/workflows/apple.yml`) does exactly that on ubuntu in the
`swift:5.10` image and on `macos-latest`, then generates the project and builds
both targets unsigned. It runs only when something under `apple/` changes.

Signing is the developer's: set your team in Xcode (or `DEVELOPMENT_TEAM` in
`project.yml`) before running on a device. The bundle id is
`website.steeve.atelier` for both targets.

### If Xcode refuses the project on your Mac

Three messages that show up together on a clone kept under `~/Documents` (or
`~/Desktop`, `~/Downloads`, iCloud Drive), and are ONE problem:

```
failed to read asset tags: The command `(cd …/apple && env -i …/actool
  --print-asset-tag-combinations --output-format xml1 …/Assets.xcassets)`
  exited with status 1. … "Contents.json" couldn't be opened because you
  don't have permission to view it. … Operation not permitted
Atelier.xcodeproj  Missing package product 'AtelierKit'
Resolving Package Graph Failed — the package at '…/apple/Packages/AtelierKit'
  cannot be accessed (encountered an I/O error (code: 1) while reading …)
```

None of them is XcodeGen's. The first is Xcode's own build system, which runs
`actool` over every asset catalog when it loads the project; the third is
SwiftPM inside Xcode, refused while LISTING the package directory — I/O error
code 1 is `EPERM`, `Operation not permitted`, and both are macOS's privacy
layer, never a POSIX permission (the files are `644`, CI reads them, and your
terminal lists them fine). The product is then reported *missing* because the
package could not be read at all. The spec is not the cause: CI generates and
builds both targets from it.

Why the project itself opens: double-clicking (or `open`-ing) the
`.xcodeproj` grants Xcode THAT bundle by user intent, and nothing beside it.
`Packages/AtelierKit` and `Atelier/Resources/Assets.xcassets` are siblings,
so they need the *Documents Folder* consent — which Xcode has been refused,
usually by a "Don't Allow" clicked once, long ago, on the first prompt.

1. Quit Xcode. **System Settings → Privacy & Security → Files and Folders**:
   turn on *Documents Folder* under **Xcode** (and under the terminal you
   generate from). If Xcode is not listed there, either add it under
   **Full Disk Access**, or make macOS ask again and answer *Allow*:
   `tccutil reset SystemPolicyDocumentsFolder com.apple.dt.Xcode`.
2. `rm -rf ~/Library/Developer/Xcode/DerivedData/Atelier-*`, run
   `xcodegen generate` again, reopen the project. If the package line
   survives alone: **File → Packages → Reset Package Caches**, then
   *Resolve Package Versions*.
3. Or keep the clone out of the protected folders — `~/Developer/atelier`
   is the conventional place, and none of the three can occur there.

To tell whose read is refused, run from the terminal:

```
xcrun actool --print-asset-tag-combinations --output-format xml1 \
  apple/Atelier/Resources/Assets.xcassets
```

XML back means the terminal may read the folder and Xcode may not: step 1
for Xcode alone. The same error back means the terminal is refused too, or
the file itself is (`ls -lO@` shows flags and attributes a copy may have
brought along).

## Layout

```
apple/
  project.yml                 the Xcode project, generated from this — never edit the .xcodeproj;
                              bundles the web's own public/luts, lut-thumbs, reference and geo/cities.json
                              as folder references (never a copy under apple/)
  Support/                    the entitlements; the Info.plists are generated here too
  Scripts/                    linux-toolchain.sh (the kernel's compiler in a Linux container),
                              check-test-names.sh (names only macOS would refuse — run before a push)
  Packages/AtelierKit/        the KERNEL: pure Swift, Foundation only, tested on Linux and macOS —
    Sources/AtelierKit/       every DOM-free module of ../src/shared and the tools' pure logic, one
                              file per web module, grouped as the web groups them (Develop, Lut, Film,
                              Render, Raw, Lens, HDR, Exif, Media, Library, Sources, Projects, Overlay,
                              Roadtrip, Roadtrip/Hooks, Audio, Telemetry, Tasks, History, UI, Lib)
    Tests/AtelierKitTests/    the web app's specs, ported one for one (4,300+)
  Atelier/                    the app, one source tree for both targets (#if os(...) where they differ)
    App/                      @main, the shell (tab bar + More on iOS, sidebar on the Mac), the tools
    Theme/                    Studio Papier as SwiftUI tokens, the darkroom, the four brand faces
    Render/                   the render GRAPH: Core Image kernels (Kernels/*.metal, compiled at build
                              time), the passes in the web's order, FrameGrader, PictureRenderer
    Paint/                    a canvas-2D API over Core Graphics + Core Text, and the overlay painter
    Video/                    the one AVFoundation export pipeline, thumbnails, stills from a clip
    Develop/                  the Develop tool — store, stage, inspector, every tab, the render plan
    Studio/                   the Studio — gallery, editor, stage, the overlay panels, export
    Trips/                    Trips — store, painters, gallery, overview, stages, settings, the piece editor
    Library/                  the shell's Library, its instance tab and the lightbox
    Look/                     looks: the vault on disk (SharedVault), the gallery, the grade panel
    Sources/                  Winnow connections, the transport, document store + sync, the pill
    Tasks/                    TaskCenter, the progress pill and a media's edge
    Instruments/              DJI Telemetry, Flight Map, Photo EXIF, Compare A/B, LUT studio, Composer
  AtelierTests/               the RENDER GATE: every Core Image kernel held to its kernel twin on a real
                              Metal device (CI's macOS runner), plus the painters, exports and stores
```

Every screen family carries a `PARITY.md` beside its views: the web's
behaviours one row each, ✅ built · ≠ built differently on purpose · ⏳ deferred
and why.

## Run-sheet — what is built, and what comes next

One commit = one task, sized in commits and never in days (`../MEMORY.md`);
`git log` on this branch is the detailed record. Stop the run wherever you want.

### Built

| Area | Delivers | Verified by |
|---|---|---|
| Kernel | every DOM-free module of the web ported with its spec: develop, curves, levels, mixer, grading, B&W, presence, detail, repair, layers + masks, crop, border, keystone, lens + Lensfun, RAW calibration, HDR gain map + Ultra HDR, film stocks + grain, LUTs + packs + vault, EXIF read/write, renditions, the roll, the Studio project, the trip (v1→v28), the openers' plans, the overlay engine, telemetry, audio voices, the Winnow client, document sync, history | 4,300+ specs green on Linux and macOS on every push |
| Render graph | the web's float16 multi-pass graph as Core Image kernels: tetrahedral cube, gain map, camera warp, lens, keystone, repair, chroma, denoise, defringe, presence, sharpen, layers, subject masks (Vision), post-crop vignette, film, clipping | the render gate: each kernel against its twin on a real Metal device |
| Develop | rolls, filmstrip + batch, every Adjust section, Crop (zone, borders, perspective, lens), Layers + masks, Repair + dust, the Look tab, the loupe past 1:1 (never the whole file on an iPhone or iPad), the border drawn on the stage, the full pixel path (RAW through `CIRAWFilter` on the web's calibration ladder), the export run (targets, metadata, watermark, Ultra HDR, Photos or a folder), rolls + presets + pictures on a Winnow | builds; the render plan's order and the export path in the gate |
| Studio | gallery, editor, stage (preview = export), transport, trim, every overlay panel, the develop sheet on the Develop tool's own stage (`Develop/Sheet/`, shared with Trips), the Library's media, lost instance media fetched back, the Export tab through the one video pipeline, finals home | builds; two real H.264 exports in the gate |
| Trips | the trip store + sync + thumbnails, every opener painter (Défilé, the Itinerary, Virée's software-3D car), the badge, the deliveries, the gallery, the new-trip / dates / cover sheets, the overview (calendar of months, year map, day strip, adjust on the calendar), the stages and the itinerary from a Winnow, ⚙ Trip and the garage, the piece editor (stage, the band «Aiguille», Content · Look · Picture · Export, the openers' panels and picture chooser, the Studio bridge) | builds; each opener and the badge painted at two sizes in the gate |
| Library, Sources, Tasks | local files by bookmark, an instance's day as a live view, drag into a tool, one lightbox; Winnow connections, `If-Match` sync, the sync pill; the progress pill and a media's edge | builds; the transport and stores in the gate |
| Instruments | DJI Telemetry, Flight Map (MapKit opt-in), Photo EXIF, Compare A/B, LUT studio, Composer, the legacy overlay page as a pointer | builds |
| Links | the web's hash routes as `atelier://` (a project handed to the Studio, a trip's day and piece, a roll's picture, an instrument, `connect?instance=…&return=…`); Winnow's timeline links parsed and kept off, as on the web | the kernel's link parser specced; the app builds |

### Next, in order

| # | Commit(s) | Delivers | Why |
|---|---|---|---|
| 1 | First run on a device | what the simulator, the iPhone and the Mac say: the RAW decode through `CIRAWFilter`, the export's EXIF read back in Lightroom / Preview, the Photos and Files paths, the darkroom at night, every SwiftUI API marked "guessed" in the `PARITY.md` files and the agents' reports | nothing above has been SEEN; everything after builds on this one's findings |
| 2 | Measure against the web | the same roll, trip and project opened in both apps, pixels compared (the render gate compares kernels, not whole pictures); `rawGain` on the system's demosaic | preview = the web is claimed kernel by kernel only |
| 3 | Background and the Live Activity — BUILT, not seen | the export keeps running when he leaves the app (`Tasks/BackgroundRun.swift`: a `BGContinuedProcessingTask` on iOS 26, `beginBackgroundTask`'s ~30 s before it, no App Nap on the Mac) and says so on the Lock Screen and the Dynamic Island (`Widgets/`) | the first thing to measure on the phone: whether Core Image and `AVAssetWriter` keep working in the background without the GPU grant |
| 4 | The ⏳ rows | what each `PARITY.md` still lists, each with its reason | mostly SwiftUI limits (a pinch's live centre) and web-first items |
| 5 | HDR video — DEFERRED by him (« plus tard », 2026-09-28) | 10-bit HEVC keeping HLG/PQ end to end instead of converting to Rec.709 | within reach natively, ruled out on the web only because of the browser; tried after row 1 |

### Known gaps in what is built, recorded rather than left to be found

- **Nothing has run on a device or a simulator.** The app is written from a
  Linux container; CI's macOS runner is its only compiler and the render gate its
  only eye.
- The RAW path is Apple's developer, not LibRaw: the sensor is demosaiced by
  `CIRAWFilter` at its plainest, the graph applying the DNG's own opcodes, so a
  web develop's `rawGain` lands on other pixels here. Unmeasured.
- Colour management is OFF in the render context (as in Chrome): a Display P3
  photo is read as sRGB codes and looks slightly flatter than a colour-managed
  viewer shows it.
- A Photos pick has no persistent handle without library permission, so its
  bytes are COPIED into the app's container; a file picked in Files or the Finder
  is remembered by a security-scoped bookmark and never copied.
- The audio bed is rendered at time zero (`AVAssetWriter` records the AAC
  priming in its edit list, which the web's muxer cannot), and sync is claimed
  only once a native export is decoded back — not yet done.
