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
  project.yml                 the Xcode project, generated from this — never edit the .xcodeproj
  Support/                    the macOS entitlements; the Info.plists are generated here too
  Packages/AtelierKit/        the KERNEL: pure Swift, no Apple framework, tested on Linux
    Sources/AtelierKit/       one file per web module (Transfer, Curves, Develop, CubeLut, LutStack,
                              Framing, Telemetry, Histogram, Roll, JSONValue)
    Tests/AtelierKitTests/    the web app's specs, ported one for one
  Atelier/                    the app, one source tree for both targets (#if os(...) where they differ)
    App/                      @main, the shell (tab bar on iOS, sidebar on the Mac), the four tools
    Theme/                    Studio Papier as SwiftUI tokens, and the darkroom
    Render/                   PictureRenderer — decode, crop, cap, the kernel's cube through Core Image, encode
    Develop/                  RollStore (the roll on disk + where each picture's bytes are), RollEditor,
                              RollsView, RollView (stage + filmstrip + inspector), the three panels
    Resources/                the app icon set, rasterised from ../public/icons/*.svg; the four brand
                              faces (OFL TTFs from google/fonts) registered at launch by `Brand`
```

## Run-sheet — what is built, in commits, and what comes next

One commit = one task, sized in commits and never in days (`../MEMORY.md`).
Everything below the line is what feature parity with the web app still needs,
in the order that pays first; stop the run wherever you want.

### Built

| # | Commit | Delivers | Verified by |
|---|---|---|---|
| 1 | Port the suite's kernel to Swift | `AtelierKit`: transfer curves, tone curves + levels, the develop maths, `.cube` parsing + trilinear/tetrahedral sampling, the LUT stack bake, the framing transform, DJI telemetry (SRT, motion, time scale), histogram + Auto, the roll document + file, `JSONValue` | the web's specs ported: `swift test` green on Linux and macOS |
| 2 | Apple CI | `swift test` on ubuntu (`swift:5.10`) and on macOS, `xcodebuild` for iOS and macOS unsigned | the workflow itself |
| 3 | Follow main's roll v6 | export targets (four size modes, a cap that never upscales), delivery states, words, variants, `pictureEdits`, fresh picture ids on import; mixer / mono / grading / rawWb CARRIED on the develop | specs |
| 4 | App skeleton | XcodeGen project, two targets, the shell, Studio Papier + darkroom tokens, the icon set, honest placeholders for Trips · Studio · Sources | both targets build on CI |
| 5 | Develop v0 | rolls (list, new, rename, delete), import from Photos and Files, the stage on a pixel budget, hold-to-compare, histogram + info stack under `I`, the eleven sliders written through, Auto tone / Auto colour, aspect + straighten + mirror, JPEG/HEIC export with the original's EXIF through the file exporter or into Photos | builds on CI; NOT yet run on a device |

### Next, in order

| # | Commit | Delivers | Why this order |
|---|---|---|---|
| 6 | First run on a device | what the simulator and the phone say about #5 — the RAW decode through `CIRAWFilter`, the export's EXIF read back in Lightroom / Preview, the Photos and Files paths, the darkroom at night | nothing above has been SEEN; every later commit builds on this one's findings |
| 7 | Port `mixer.ts`, `grading.ts`, `raw/white-balance.ts` | the four carried develop stages RENDERED, so a roll developed on the web looks the same here | today the stage says "not rendered here yet" on such a picture |
| 8 | Tetrahedral sampling | a Metal (or CIKernel) colour cube sampled the way the web's shader does | the one measured gap in "preview = the web" |
| 9 | The crop stage | the classic crop: the zone drawn over the whole picture under a veil, pinch/drag, `crop-rect.ts` ported | v0 has aspect + straighten + mirror only |
| 10 | The rest of the picture | border, keystone, lens (+ Lensfun profile), detail, vignette, repair, layers + masks, film texture — each a render pass, in the web's order (`picture-geometry.ts`) | today carried, not rendered; the biggest block, one pass per commit |
| 11 | Looks | the built-in LUTs (`../public/luts`, 37 MB — a picked subset or fetched on demand, a decision for the maintainer), the personal vault, film stocks; `RollGrade` rendered | `composeLutStack` already takes layers; only the sources are missing |
| 12 | Batch and undo | Shift/⌘-click selection, copy / paste / apply-to by sections, the preset book, a document undo stack | the web's time-savers |
| 13 | Export as the web does it | every target of the roll into sub-folders, the roll's export run with progress and Cancel, the metadata groups, the watermark, Ultra HDR from a RAW | v0 writes the first target of one picture |
| 14 | The partial hash | `partial-hash.ts` ported, so a picture matches across devices and a Winnow by CONTENT | today matched by name and size |
| 15 | Sources: a Winnow | connect, the document bucket with `If-Match`, rolls kept there and pulled here, pictures fetched by asset id | the web's `shared/sources/winnow` client, its wire shape already checked against Winnow's code |
| 16 | Background and the Live Activity | the export run as a `BGContinuedProcessingTask` with a Live Activity — the honest face of "background" from the design canvas | the reason the native app was asked for |
| 17 | Studio | AVFoundation decode/encode, the telemetry overlay engine (a large port: `shared/overlay/`), HEVC and 10-bit in and out | the capability leap the brief promised |
| 18 | Trips | the trip document, the calendar, the openers (a large port: `shared/roadtrip/`) — or never, both clients sharing Winnow documents | gains least from native, per the brief |

### Known gaps in what is built, recorded rather than left to be found

- `CIColorCubeWithColorSpace` samples the cube trilinearly; the web samples
  tetrahedrally. On a develop-only cube every grey stays grey either way; the
  difference is bounded by a lattice cell and shows only on an asymmetric look (#8).
- A develop carrying a mixer, black and white, grading or a RAW white balance is
  shown WITHOUT them, and the stage says so (#7). The export says it too.
- The RAW path is Apple's developer, not LibRaw: the sensor is demosaiced by
  `CIRAWFilter` with its own defaults, so a RAW's `base: gain` and `rawGain`
  from the web do not mean the same pixels here yet. Unmeasured (#6).
- A Photos pick has no persistent handle without library permission, so its
  bytes are COPIED into the app's container; a file picked in Files or the
  Finder is remembered by a security-scoped bookmark and never copied.
- Nothing has run on a device or in a simulator: the app was written from a
  Linux container with no Swift toolchain, and CI is its first compile.
