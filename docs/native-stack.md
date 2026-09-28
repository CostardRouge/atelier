# The native stack — Apple-only or cross-platform, and in what

**Written 2026-09-23**, the maintainer's follow-up to `docs/native-app.md`:
*evaluate the creation of a native app — Apple only (iOS and/or macOS), or
cross-platform: Flutter? Rust? Expo / React Native? something else?* That
brief settled **whether** (a real native app, not a wrapper) and **what goes
first** (Develop); this one settles **in what**. It is measured against this
codebase, not against the stacks in the abstract.

**A proposal, not a set of decisions.** §1 is fact about this repository; §2
onwards is argument; every claim about a vendor's toolchain or Apple's
frameworks is marked **[verify]** — none was run here, and toolchains move
faster than any brief. §7 is what is his.

---

## 1. The three facts every stack is measured against

**1. The pixel path is Swift in every option, and so is the "iOS" in it.**
Whatever draws the UI, the things a phone does better than a browser are
reached through Apple's frameworks and nothing else: `CIRAWFilter` for the
decode, Core Image / Metal for the full-density render, ImageIO for the gain
map, Vision for the subject, AVFoundation for the clip, `PHPhotoLibrary`,
ActivityKit for the Live Activity (a widget extension, Swift by
construction), `BGContinuedProcessingTask`, App Intents. **[verify each]**
Every cross-platform stack reaches them through a native module written in
Swift. So Swift is written in every option; the question is only **where the
UI lives and where the kernel lives**.

**2. The kernel is TypeScript, and it is already the shape a port needs.**
33 221 DOM-free lines in `shared/` under 208 test files (`native-app.md` §3):
what a develop is, what a curve evaluates to, the emulsion, the framing, the
frame plan, the SRT parser, the EXIF reader and writer, the gain-map
arithmetic, the collage layout, the stage ruler, the timeline diff. Every
option either **keeps it as it is** (a JavaScript runtime), **ports it** (Swift,
Dart, Kotlin — 33 000 lines and their specs rewritten), or **ports it once into
something every UI can consume** (Rust over a C ABI).

**3. The loop is what this project runs on.** It is written by an agent in a
Linux container, seen in headless Chromium, gated by CI, and deployed by a
push (`native-app.md` §6). A stack that keeps some of that keeps the
project's pace; one that moves every change to a Mac and a signing step
changes what the project is.

---

## 2. The candidates, one paragraph each

### Swift + SwiftUI — Apple only
One codebase for iOS, iPadOS and macOS (the frameworks in fact 1 are
identical on all three). The best possible product on the device, native
navigation, sheets, context menus, Pencil, keyboard, Shortcuts, EDR on the
display. The kernel is ported (to Swift, or to Rust). Nothing of it is built
or seen from this container; the kernel's tests run on Linux (open-source
Swift or `cargo test`), the app on a free macOS runner (public repo), the
screen on his Mac. **Android, Windows: never**, unless Flutter or another
stack is written later — in which case the SwiftUI is thrown away and only a
Rust kernel would survive.

### Expo / React Native — TypeScript UI over Swift modules
The UI is React in TypeScript, drawing **real UIKit views** (a `UITabBar`, a
`UINavigationController`, native sheets and menus through the usual libraries)
— which is why a well-made RN app on iOS reads as native where Flutter does
not. **[verify per library]** Three things fall out of it that no other stack
offers this codebase:

- **The kernel is not ported.** The 33 221 lines and the 208 test files move
  into the app **unchanged**, as a workspace package, still tested by Vitest
  in this container. Zero risk to the bit-identical rule, zero double
  maintenance with the web app while both exist.
- **The painting is close to a copy.** The overlay engine (9 955 lines), the
  badge, the Itinerary and Virée's car all draw on a canvas-2D API;
  `@shopify/react-native-skia` exposes a Skia canvas whose surface is the same
  shape (paths, fills, transforms, offscreen surfaces) and the same engine on
  every platform — so **preview = export** holds across devices by
  construction, which Core Graphics on one side and Skia on the other would
  not give. Its text layout is Skia's, not `fillText`'s: that is the one
  fidelity crossing to measure. **[verify]**
- **The loop survives.** JS-only changes ship **over the air** (`eas update`)
  to a development build already on his phone — a push puts the change on
  the device with no build and no signing; `react-native-web` renders the
  same components in headless Chromium here for a first look; and **EAS Build
  compiles the iOS app on Expo's own macOS machines**, driven from this
  container with an App Store Connect key in the environment's secrets — no
  Mac in the loop except to look. **[verify: EAS pricing tiers, the free
  build quota, and that a dev-client OTA covers what this app changes]** A
  native-module change still needs a cloud build; the kernel and the UI do
  not.

Costs, honestly: the stage — the picture at pixel-budget, its passes, the
loupe — is a **native view** (a Swift `UIView` over Metal or Core Image,
exposed through the Expo Modules API), because the pixel arrays must never
enter the JS heap; RN's New Architecture is the one to build on and it has
churned; **macOS is the weak side** — `react-native-macos` is Microsoft's,
second-class, and the honest macOS story for an RN app is the same as for an
iPad app: it runs on an Apple-silicon Mac as *Designed for iPad*
**[verify]**, not as a Mac app. And it is a fourth runtime to know (Hermes)
beside the browser's.

### Flutter — Dart, its own renderer
One codebase for iOS, Android, macOS, Windows, Linux, web, with **desktop
first-class** — the widest reach of any candidate and the one the maintainer
named. Fragment shaders are compiled at build time **[verify]**, which is the
same cure for the shader blindness that Metal gives. Against it, for *this*
codebase: **the kernel is ported to Dart** (or to Rust, with Dart bindings)
— the whole 33 000 lines and their specs, a second time if Swift came first;
**the painting is ported too** (Flutter's `Canvas` is Skia-shaped as well, so
this port is the easier of the two); the UI **draws its own pixels** (Impeller),
so the tab bar, the sheet, the context menu and the text are Flutter's
imitation of iOS, not iOS — Cupertino widgets are good and are not the
platform, and on the device this app is *for* that is a real cost; the pixel
path is still Swift over platform channels; `flutter test` runs on Linux and
a web build is drivable in headless Chromium here, but there is no
over-the-air update and every iOS build is a Mac or a paid cloud
**[verify]**. Flutter is the right answer to *"one app on every screen"*; it
is the wrong first answer to *"the best app on an iPhone, written by an
agent, from a TypeScript kernel"*.

### Rust — a kernel, not an app
Rust does not draw this app: Tauri 2 mobile is a webview (ruled out in
`native-app.md` §2), and Dioxus, Slint and egui are not where a photo editor
with native sheets, a Pencil and a Live Activity gets built **[verify]**. Rust
is a **kernel language**: port the 33 221 lines once, prove the port as WASM
inside the web app against the existing suite, then consume it from Swift
over the C ABI and from Dart over FFI. It pays exactly when **two UIs** will
share the kernel (Swift now, Flutter later). It is **redundant with React
Native**, where the kernel needs no port at all.

### Kotlin Multiplatform + Compose Multiplatform
Kotlin shared logic, Compose UI on iOS through Skia, SwiftUI interop for what
must be native, JVM tests on Linux. Right when **Android** is the first or
equal target; here Android is not a target at all, the kernel would be ported
to Kotlin, and iOS is the second platform of a Google-shaped stack. Declined.

### .NET MAUI, Capacitor, Tauri, Ionic
MAUI: a Windows-shaped stack for an Apple-shaped ask. The other three are
webviews — the wrapper position `native-app.md` §2 rules out.

---

## 3. The matrix

| | Swift + SwiftUI | Expo / RN | Flutter | Rust kernel + Swift | KMP |
| --- | --- | --- | --- | --- | --- |
| Kernel (33 221 lines, 208 specs) | **ported** to Swift | **kept** | **ported** to Dart | ported once, reused | ported to Kotlin |
| Painting (overlay, badge, car, ~12 000 lines) | ported to Core Graphics | ported to Skia, near 1:1 | ported to Skia-shaped Canvas | as Swift | ported to Compose Canvas |
| Pixel path (RAW, render, HDR, video, Vision) | Swift | Swift modules | Swift over channels | Swift | Swift interop |
| iOS feel | native | native views | imitation | native | imitation |
| iPad + Pencil | native | native, via modules | supported | native | supported |
| macOS | **native**, same code | *Designed for iPad*, or a second-class port | native desktop | native | desktop via Compose |
| Android / Windows later | no | Android yes, Windows no | **all** | via Flutter | Android yes |
| Live Activity, Intents, BG tasks | native | Swift extension + module | Swift extension + channel | native | Swift |
| Shader blindness (`check-shader.mjs`) | cured: Metal compiles at build | native passes in Metal (cured); Skia effects at runtime (not) | cured for fragment shaders | cured | as Flutter |
| Written from this container | kernel tests only | **kernel, UI, tests, web preview, and the iOS build** | kernel tests, web preview | kernel + WASM twin | JVM tests |
| Ships a change to his phone | build → sign → install | **OTA on push** (JS), cloud build (native) | build → sign → install | as Swift | as Swift |
| CI | free macOS runner | Linux for JS, EAS for iOS | Linux + macOS runner | Linux + macOS runner | Linux + macOS |
| Runtimes he now knows | Swift | JS/TS (the same), Swift for modules | Dart, Swift | Rust, Swift | Kotlin, Swift |
| What Flutter-later throws away | the UI | the UI | — | the UI, kernel kept | the UI |

---

## 4. What changes from the first brief

The first pass at the native question (the wrapper reading, since replaced by
`native-app.md`) declined React Native as *"the worst of both — rewrite the
UI and still write every native plugin, and lose the WebGL shaders"*. That
was wrong on two counts and this document corrects it: **the shaders are lost
in every option** — Swift rewrites them in Metal too, because the pixel path
is native whatever the UI — and **RN is the one stack that does not rewrite
the kernel**, which is the largest and most delicate third of the code. Its
§7 recommended a Rust kernel; that recommendation now holds **only if the UI
is Swift or Flutter**. With Expo the kernel needs no port and Rust buys
nothing.

---

## 5. Tool by tool, under each stack

- **Develop** — the best case for Swift (Core Image, Metal, EDR, Pencil in
  their own home) and a strong case for Expo (the workbench is sliders,
  lists, a sheet and one native stage view; the kernel that computes what the
  sliders mean is unchanged). Flutter: the stage is a `Texture` from Swift
  and the panels are Cupertino imitations.
- **Trips** — the strongest case for Expo of the three: it is almost
  entirely painting and documents, both of which cross to Skia and to the
  unchanged kernel; the map openers and the car keep their code shape. Under
  Swift it is the largest port (`native-app.md` §8). Under Flutter, the same
  port to a Skia-shaped canvas in Dart.
- **Studio** — AVFoundation under every stack; the trim bar, the instruments
  and the grade panel are UI over the unchanged telemetry kernel under Expo,
  ported under the others. Equal.

---

## 6. Recommendation

Two honest answers, because the question has two honest readings.

**If Apple is the whole of it — iPhone, iPad, Mac, and nothing else, for
years: Swift + SwiftUI.** It is the best product that can be made for that
device, macOS is the same code, and the loop cost is the price of that. Port
the kernel to Swift directly (Rust only if a second UI is a real plan, not a
preference). The order stays `native-app.md` §9.

**If cross-platform is a real intention, or if the loop matters as much as it
has so far: Expo / React Native, with Swift modules for the pixel path.** It
is the only stack in which the kernel, its tests and the web app's painting
survive; the only one in which a push still puts the change on his phone;
and the only one in which the iOS app can be built from this container. The
price is a weaker macOS and a native stage view written in Swift — which
Swift-the-app would have written anyway. Trips becomes the *easiest* tool to
port instead of the hardest.

**Flutter is advised against as the first move**, with respect for the
preference: for this codebase it rewrites both the kernel and the UI, gives
an iPhone user an imitation of iOS, and buys nothing on the loop — its case
is Windows and Android desktops, which are not on the list. It remains the
right second stack if those ever are, and a Rust kernel is what would make
that second stack cheap.

**Rust is not an app.** It is a kernel, and only worth its port when two UIs
will share it.

Between the two answers, one measurement decides more than any further
argument: **build the Develop stage as a native Metal view inside an Expo
dev client and put a real DNG on it.** If that view, its passes and the loupe
feel like the app in the design canvas, the rest of Expo is ordinary React
over a kernel that already exists. If the seam between the JS UI and the
native stage is where the app stops feeling native, that is the day to choose
Swift — and nothing built for the spike is wasted, because the Swift stage
view is the same code either way.

---

## 7. What is his to decide

1. **Is macOS a native target or a convenience?** Native → Swift. *Designed
   for iPad* on an Apple-silicon Mac is enough → Expo stays open.
2. **Is Flutter a plan or a preference?** A plan → a Rust kernel now, under
   Swift; a preference → Expo makes the question moot until it is a plan.
3. **How much does the loop weigh?** If "a push is on my phone" is worth a
   less native macOS, Expo; if the product on the device is worth a Mac in
   every loop, Swift.
4. **The spike in §6** — one native stage view in an Expo dev client, one
   real DNG — is the cheapest fact available and the one this document most
   wants before anything else is written.
