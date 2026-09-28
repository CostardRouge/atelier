# A native app — Swift on iOS first, cross-platform later

**Written 2026-09-20.** The maintainer's question, in his own framing: a
**complete native rewrite** of Atelier — not a wrapper, not a migration of the
web app, a translation of its features into a native application. Swift on iOS
first, because his users are iPhone users. Cross-platform later, and if so
Flutter by preference. No service workers, no PWA, no browser tricks.

**A proposal, not a set of decisions.** §3 is measured in this repository and is
fact. §4 onwards is argument. Every claim about Apple's frameworks and about
App Store mechanics is marked **[verify]** — nothing here was run on an Apple
device, because this container has none. §11 is what is his alone.

A first pass at this question read it as *hosting the web app inside a native
shell*, concluded that a wrapper buys nothing, and in doing so **under-weighted
the native case**. That wrapper finding survives, narrowly, as §2. Read under
the right premise the case is considerably stronger: most of what the browser
costs this project is not slowness, it is whole subsystems that exist only to
make a browser do what a phone does by itself.

**The screens**: an interactive design canvas of the iOS app — thirteen
artboards, a playable path from Rolls to the Queue, and a spec sheet of the
native gestures and their haptics — is at
https://claude.ai/artifact/319gLru2h5urnpygvJrKKT (2026-09-20). Its decisions
are recorded in `MEMORY.md`'s open item.

---

## 1. The verdict

**A native Swift rewrite is the right long-term answer for Develop, a strong one
for Studio, and the weakest for Trips** — and the reason is not performance. It
is that roughly **24 000 lines of this codebase exist solely to fight the
browser**, and on iOS that code does not get ported. It gets deleted, and the
platform does the job.

The risk is not the rewrite's difficulty. The maths is 33 000 lines of DOM-free
TypeScript with 208 test files pinning it, which is the best possible position
from which to port anything. The risk is **the development loop**: this project
moves because an agent writes it in a Linux container, verifies it in headless
Chromium, and ships it to GitHub Pages in one push. None of that survives
contact with Xcode, and no amount of good architecture changes it.

So the recommendation (§7, §9) is a specific shape that keeps most of the loop:
**put the kernel in Rust, prove it inside the web app that already works, and
let Swift consume it.** That makes the first third of the port doable *here*,
provable against the existing test suite, and reusable by Flutter later.

---

## 2. Why not a wrapper (kept short, because it still rules out the middle)

Capacitor and Tauri draw an iOS app inside `WKWebView`. The React, the WebGL2
and the web content process's memory ceiling stay exactly as they are today, so
the RAW export fails behind an app icon instead of in a tab. A wrapper only
helps once each heavy stage is moved out of the webview into native plugins —
at which point the amount of Swift written approaches a rewrite, and the reward
is still a WKWebView interface.

**The middle is the worst position.** Either stay in the browser and fix what is
measured, or write the app. This document is about the second.

---

## 3. What the codebase actually is, measured

Counted in this session, `src/` only:

| | files | LOC |
| --- | --- | --- |
| everything, minus tests | | **116 206** |
| tests | 208 | 32 426 |
| `.tsx` (React UI), minus tests | | 49 321 |
| `.ts` (logic), minus tests | | 66 885 |
| **DOM-free, React-free modules in `shared/`** | **186** | **33 221** |

That last row is the one that matters. It is the project's intellectual content
— what a develop *is*, what a curve evaluates to, how an emulsion responds, how
a frame plan lays out, how an SRT parses, how a leg is cut, how a gain map is
measured — and it is already written with no DOM, no React and no canvas,
because `CLAUDE.md` has required that from the beginning. **It is also the part
covered by the 208 test files**, which makes it the safest 33 000 lines anyone
has ever been asked to port: the specification is executable and it already
exists.

The other two thirds split very differently:

- **~49 000 lines of React** — re-authored in SwiftUI. Not ported: rewritten,
  and mostly smaller, because a native list, sheet, drawer, segmented control
  and gesture recogniser are not things one builds. A large slice of
  `shared/ui` (7 133) and of `frontend.md`'s hard-won rules — `--app-h` measured
  instead of `100dvh`, the locked document, `blockNativeZoom`, the safe-area
  padding, `dvh` in modals, the bottom-bar band — **are browser defects with
  native non-equivalents.** They do not port because the bugs they fix do not
  exist.
- **~34 000 lines of browser glue** — the subject of §4.

---

## 4. What evaporates

This is the strongest argument and the one the previous document missed.

| Browser glue, today | LOC | What replaces it natively |
| --- | --- | --- |
| `shared/media` — WebCodecs pipeline, mp4box demux, mp4-muxer, trim-window arithmetic, audio plan, colour-tag guard, the ffmpeg.wasm HEVC transcode and its 31 MB fetch | 7 739 | `AVAssetReader` / `AVAssetWriter` / `AVMutableComposition` **[verify]** |
| `shared/lut` + `shared/render` — WebGL2 context lifetime, texture-upload traps (`UNPACK_FLIP_Y_WEBGL` on an `ImageBitmap`), context loss, `MAX_TEXTURE_SIZE` fitting, ping-pong targets, the pass cache, `holdGrades`' raster copy | 12 430 | Core Image / Metal — **the maths ports, the plumbing does not** |
| `shared/raw` — `libraw-wasm` in a worker, the inverted BT.709 table, gain metering, run serialisation | 581 | `CIRAWFilter` **[verify]** |
| `shared/hdr` — a hand-written XMP + MPF container, MPF offsets counted from the endian field, the read-back check that earns the name | 1 138 | ImageIO writing a gain map **[verify]** |
| `shared/segment` + **16.9 MB of MediaPipe WASM shipped in `public/`** | 342 | Vision's subject mask, **0 bytes shipped** **[verify]** |
| The File System Access half of `shared/sources`, and `develop-media`'s working previews — *the single exception ever granted to "media bytes are never persisted"* | ~1 500 | the file system; `PHPhotoLibrary` |

**And these open items close themselves**, without anyone deciding anything:

- the **~1 GB of GPU memory** a 48 MP RAW export asks for — Core Image builds a
  recipe, not pixels, and tiles the render itself **[verify at scale]**;
- the **`MAX_TEXTURE_SIZE` black picture** at 61 MP — not a failure mode of a
  tiled render;
- the **48 MP `ImageBitmap` held at full size** while a photo is open — a
  `CIImage` holds no pixels;
- **HDR video**, ruled out in `media-pipeline.md` as "out of reach in a browser"
  (8-bit canvas, no PQ/HLG in WebCodecs' enum, no High 10) — 10-bit HLG/PQ HEVC
  is an `AVAssetWriter` output setting **[verify]**;
- **HEVC that the browser cannot decode** — the whole transcode feature, its
  wasm, its queue, its cancel path and its 31 MB network exception disappear;
- **"No CI gate can see a broken shader"** — the worst structural blindness this
  repo has, because GLSL is a template literal nothing compiles and failure
  degrades silently to un-graded exports. **Metal shaders compile at build
  time.** `scripts/check-shader.mjs` stops needing to exist;
- **the 7-day storage eviction**, and the home-screen app's separate storage box;
- **Google Fonts fetched on every page load**, unconditionally;
- **iOS taking WebGL contexts back** under memory pressure;
- the **stage pixel budget** and the whole «a preview grades once and draws a
  raster copy» apparatus — that exists because drawing a WebGL canvas into a 2D
  canvas costs a copy per draw.

Not everything in that table vanishes — the *maths* inside it (the trim
arithmetic, the frame plan, the audio plan, the gain-map encode, the colour
transfer functions) is kernel and ports. What vanishes is the fighting.

---

## 5. What becomes possible that a browser forbids

- **Background work, properly.** `BGContinuedProcessingTask` for user-initiated
  long work that continues with system progress UI, a **Live Activity** for a
  running export, `BGProcessingTask` for the overnight roll **[verify — this is
  the newest of the APIs named here and the one to check first]**. This is the
  want that the browser answers with nothing at all.
- **Real concurrency.** A batch of forty RAWs becomes a `TaskGroup` with bounded
  concurrency, cancellation, pause and resume — against today's single `for`
  loop in `use-roll-export.ts:149` that dies with the tab.
- **An HDR photograph actually on the screen.** `hdr.md` has to print a sentence
  saying the canvas cannot show what the file contains, because no browser
  grants an HDR canvas without a flag. EDR on an iPhone display is not a flag.
- **The Neural Engine**, for the subject mask and anything after it.
- **ProRAW and ProRes** read by the framework that writes them — which settles
  P3's open JPEG XL question by not having it **[verify]**.
- **The system**: Photos, Files, the share sheet, AirDrop, App Intents and
  Shortcuts ("develop today's photographs"), Quick Look, drag and drop between
  apps on iPad.
- **Apple Pencil on an iPad** for painted masks and repair — the two features
  where a mouse was always the wrong instrument.
- **iOS + iPadOS + macOS from one codebase.** SwiftUI, Core Image, AVFoundation
  and Metal are the same frameworks on all three. The "you lose the desktop"
  objection against a native rewrite is much weaker than it looks: what is lost
  is Windows and Android, which is what Flutter would later be for.

---

## 6. What is lost, or at risk

**1. The development loop — the real cost, and it is not recoverable in full.**

Today: an agent writes TypeScript in a Linux container, runs `npm run dev`,
drives the real app in headless Chromium, runs `check-shader.mjs` and
`check-render.mjs` against a real GPU, opens a PR, CI runs four gates, a merge
deploys to every device in a minute. A Swift app cannot be built, run or seen
from this container.

What can be kept:

- **The kernel builds and tests on Linux.** Open-source Swift, or Rust —
  either way, `swift test` / `cargo test` runs *here*, and the maths is where
  the danger is.
- **CI on a Mac is free.** This repository is **public** (checked), and GitHub
  Actions' standard hosted runners — macOS included — are free for public
  repositories **[verify: billing policies change]**. So `xcodebuild` + tests +
  snapshot tests can gate every PR exactly as the four gates do now.
- **Snapshot tests are the honest substitute** for "I drove the app and looked
  at it". They are worse. They are not nothing.

What cannot be kept: seeing it work. Every UI judgement moves to his Mac or his
phone, and the turnaround goes from a push to a build-sign-install cycle, with
TestFlight builds that expire **[verify]**. For a project whose stated scarce
resource is *his instruction and his review*, that is the one cost that actually
bites.

**2. Two products, unless they are two clients.** The web app does not vanish
the day the iOS app ships. The graceful answer is already in the architecture:
**a document belongs to exactly one source**, and media resolves `id → hash →
name`. So the native app and the web app can be two clients of the same Winnow
documents — not a fork, and they can coexist indefinitely with a partial port.
That is what makes §9's staging safe.

**3. Flutter later throws the SwiftUI away.** Everything in §3's ~49 000-line
column is disposable the day a Flutter target exists; only the kernel survives.
That single fact is what decides §7.

**4. Pixel fidelity during the port.** The places where "preview = export" was
hard-won — the overlay engine's single-line text (9 955 lines), the badge, the
Virée car's face-sorted software renderer, `drawFramed`'s crop invariants — are
exactly where a second text engine (Core Text, not canvas `fillText`) silently
changes the output. Native is *safer* afterwards, because preview and export
both draw through Core Graphics. The danger is the crossing, and the remedy is
the same one this repo already uses: measure the two renders against each other
rather than reasoning about them.

**5. A stored document must keep meaning what it meant.** `develop.md`'s rule —
an untouched pixel comes back bit-identical — is not decoration. If the ported
maths differs by an ulp, every develop the maintainer has already written
changes. §7 is the answer to that.

---

## 7. The one structural decision: where the kernel lives

**Revised 2026-09-23 by `docs/native-stack.md`**, which weighs the stacks
themselves (Swift, Expo / React Native, Flutter, Rust, KMP): the three options
below assume a Swift UI. Under Expo the kernel needs **no port at all** and
option B buys nothing; under Swift or Flutter, B stands as written.

Three options for the 33 221 DOM-free lines.

**A — a Swift package.** Simplest, one language, tests run on Linux. Thrown away
entirely if Flutter happens.

**B — a Rust crate, consumed by Swift over its C ABI, and by Dart over FFI
later.** Survives the cross-platform move; the agent writes and tests it *in
this container*; it is also what a Tauri desktop build would have used.

**C — keep the TypeScript and run it in JavaScriptCore.** Rejected: a JS runtime
carried for arithmetic, a bridging cost at exactly the hot path, and the
debugging story of neither language.

**Recommended: B — and for a reason that is worth more than the cross-platform
argument.** A Rust kernel compiles to WASM. Which means the port can begin, and
be *proven*, **inside the web app that already works**: re-implement
`develop.ts` in Rust, compile it to WASM, drop it in behind a flag, and hold it
to `develop.test.ts` — the very specs that pin the bit-identical rule, the 33³
lattice errors, the monotone-cubic clamp and `sameDevelop`. If the twin passes
the existing suite, the maths is proven **before a single line of Swift is
written**, in this container, with no Mac and no risk to a shipped app.

That turns the most dangerous third of a rewrite into an ordinary, verifiable,
incremental piece of work that fits the way this project is actually built.

The cost is honest: an FFI boundary, a second toolchain, and a slower start than
writing Swift directly. Take A instead if iOS is genuinely the only target for
the next two years and Flutter is a maybe.

---

## 8. Tool by tool

**Develop — port first, and the case is decisive.** Everything expensive is
here, and almost all of it is a framework's job on iOS: `CIRAWFilter` for the
decode, Core Image's tiling for the memory, ImageIO for the gain map, Vision for
the mask, Metal for anything custom. The surface is the smallest of the three
(`tools/develop` 6 819), the workbench blocks are already factored
(`shared/develop` 12 375), and the tool's own open items — RAW on a phone, the
GPU arithmetic, originals versus proxies — are answered rather than fixed. On an
iPad with a Pencil it becomes something the web version can never be.

**Studio — second, and it is a capability leap, not a port.** AVFoundation
replaces the WebCodecs pipeline outright and brings what was explicitly ruled
out: HEVC decode with no ffmpeg, hardware encode, 10-bit, HLG and PQ. The
telemetry overlays are Core Graphics drawing over a video composition
(`AVVideoCompositing`), which is what `paintUnderOverlays` already is in shape.
The subtlety to respect is that `webcodecs-export.ts` encodes years of measured
behaviour — the B-frame lead, the AAC boundary, the 500 µs edge tolerance, the
frame-rate resample, the colour tag — and those measurements are *kernel*, not
glue. Port them with their tests; do not re-derive them from AVFoundation's
defaults.

**Trips — last, or never, and that is a legitimate end state.** It is the
largest (`tools/roadtrip` 18 493 + `shared/roadtrip` 32 666 ≈ 51 000), the most
product-shaped, and the one that gains least: its exports are painted frames and
short clips, not 48 MP stills. It is also the one that can stay on the web
longest without cost, because its documents live on a Winnow and the native app
would read the same ones. If the port stops after Studio, nothing is broken.

---

## 9. The plan, in stages

Each stage is verifiable on its own and the run can stop after any of them.
Stages **S0 and S1 need no Mac** and can be done entirely in this container,
against the existing test suite.

| | | Where it runs | What proves it |
| --- | --- | --- | --- |
| **S0** | The kernel spike: `develop.ts` + `curves.ts` in Rust → WASM, dropped into the web app behind a flag | here | the existing `develop.test.ts` / `lut-stack.test.ts`, unchanged, and a bit-identical render |
| **S1** | The rest of the kernel: emulsion, framing, crop-rect, frame-plan, stagger, SRT/telemetry, EXIF read + write, gain-map arithmetic, media-layout, stage-ruler, timeline and geo deduction | here | each module's own TS suite as the oracle |
| **S2** | Swift app skeleton + Core Image render graph + `CIRAWFilter`: open one picture, develop it, export it | macOS runner (free, public repo) | `xcodebuild test` in CI, a render held to the kernel's numbers |
| **S3** | Develop v1 at parity: roll, filmstrip, crop, layers, masks, detail, repair, HDR out; batch as a `TaskGroup` with `BGContinuedProcessingTask` + Live Activity | runner + his device | snapshot tests; his eye |
| **S4** | Winnow client + document sync — a thin HTTP layer over a reducer that is already pure | runner | the same etag/conflict specs |
| **S5** | Studio: AVFoundation export, overlays through `AVVideoCompositing`, HDR video | runner + his device | the ported export measurements |
| **S6** | Trips — or not. The web app keeps it, both clients share the Winnow documents | | |

A **macOS target** falls out of S2–S3 for close to nothing, and is worth taking:
it is where the heavy work actually happens today, and it removes the "the
native app cannot replace my desktop" objection entirely.

---

## 10. What it costs that is not code

**[verify — App Store mechanics change, and none of this was checked here]**

- **$99/year** for the Apple Developer Program; free provisioning rebuilds every
  7 days is not a way to live.
- **Distribution for one person**: TestFlight internal builds expire (on the
  order of 90 days) or ad-hoc signing (about a year, capped devices). Either
  way, re-installing is a recurring chore.
- **A Mac in the loop**, permanently, for anything visual.
- **CI**: free on public repositories, which this one is — but macOS runners are
  slow and the build will not be a 30-second gate.
- **The web app's fate** — frozen, retired, or kept as a second client (§6.2).
- **Flutter later** means the SwiftUI layer is written knowing it is disposable.

---

## 11. What is his to decide

1. **What happens to the web app?** Frozen, retired, or kept as a second client
   of the same Winnow documents. This is the biggest question in the document
   and everything else bends around it.
2. **Kernel in Rust or in Swift — or not ported at all?** `docs/native-stack.md`
   adds the third answer (Expo keeps it as TypeScript) and the stack question
   it belongs to. Rust only pays if Flutter is real — but it
   also buys the WASM twin that lets the port start here, today, provably
   (§7). That second argument stands even if Flutter never happens.
3. **How far does the port go?** Develop alone is a complete, defensible
   product. Develop + Studio is a suite. Trips is another 51 000 lines.
4. **Is a build-sign-install loop acceptable** in place of a push, for a project
   whose pace has come from the short loop?
5. **macOS target, yes or no?** Nearly free at S3, and it changes what the
   native app is allowed to replace.
6. **Which iPhone, and which file?** Every number about what fails today past
   the measured 12 MP decode is extrapolation. One real DNG exported on his own
   phone would tell us whether Develop's port is urgent or merely right.
