# Device memory — what a phone's tab may hold, and how a RAW fits in it

Read before touching `shared/lib/device-class.ts`, `shared/raw/raw-budget.ts`,
`shared/raw/decoded-cache.ts`, `shared/sources/held-budget.ts`, the decoder's
lifecycle in `raw-decoder.ts`, or anything that allocates by the megabyte and
could run on a phone. What the decoder makes of a RAW's bytes is `raw.md`;
the stage's own pixel budget is `media-pipeline.md`, «The stage has a pixel
budget».

## The report, and the arithmetic under it (2026-09-23)

**The maintainer, on his iPhone 15 Pro Max: *"develop on mobile: crashes
when using dng, tab get killed, refreshes"*.** No error anywhere — iOS ends a
tab that grows past what it is given and reloads the page. Read from the
code, for his DJI DNG (8064 × 4536, 74 MB, opened on the sensor rung at the
stage):

| where | what | MB |
| --- | --- | --- |
| libraw-wasm's worker | the wasm heap: 256 MB at start (`INITIAL_MEMORY`), the file copied in, LibRaw's raw and image buffers, the output — never shrinks | ~330 |
| main thread | the 16-bit plane the worker hands over (4032 × 2268 × 6 B, transferred) | 55 |
| main thread | `linearFromLibRaw` — a FULL-SIZE Float32 picture, then `boxDownscale`, then `halfImageFromLinear`'s encoded Float32, then the packed half, then the bytes | 110 + 27 + 27 + 14 + 9 |
| the tab | the DNG itself when fetched from an instance, held for the session | 74 |

Close to a gigabyte for one picture, before the app, the GPU and the stage.
A JPEG never does this: the browser decodes it into a bitmap it manages.
**A RAW is the one source decoded in the tab's own memory**, which is why it
is where a phone dies and why the rules below are about RAWs first.

## Five rules, each measured

- **Nothing full-size is allocated after the decode** (`raw-image.ts`,
  `boxLinearRows`, `halfTableFromLibRaw`, `byteTableFromLibRaw`). Every
  step is a function of ONE 16-bit code or of a box of them, so the target
  picture is written straight from the plane, and a whole picture packs
  through two 65536-entry tables with no float picture at all. Bit-identical
  to the two-step path — the spec pins every sample — so no stored `rawGain`
  moved and preview = export holds. Measured in node on the DJI's half:
  stage post-processing **+170 MB → +22 MB** over the plane, whole **+262 MB
  → +88 MB** (+53 MB for an export, which asks no bytes), and faster (498 →
  352 ms; 1383 → 136 ms).
- **The plane is read in bands and the main thread is given back between
  them** (`yieldToMain`, 256 K output pixels a band): the task pill paints,
  and its Cancel lands between two bands and drops everything at once.
  "Split the work" — his words — is this, not a second worker: the decode
  itself is already off-thread, and a worker for the conversion would move
  the allocation without shrinking it.
- **A constrained device decodes to a LONG EDGE per purpose**
  (`raw-budget.ts`): stage and loupe 2560 px, export 4096 px, always under
  the GPU's own cap (`rawDecodeEdge` folds the two). And a picture the cap
  would box-average anyway is asked of LibRaw at HALF size up front
  (`wantsHalfSize` reads `maxEdge`): a third of the time, a quarter of the
  worker's image buffer. The DJI lands at 2016 × 1134 on a phone's stage —
  the same as a desktop, since LibRaw's half already box-averages to it —
  and at 4032 × 2268 in its export, said in the run's sentence (*"delivered
  at 4032×2268 from its 8064×4536 sensor — as far as this device's memory
  goes; a computer delivers it whole"*, `RollRendered.sensor` + `capped`).
  The loupe on a phone never decodes a RAW whole: the stage already stands at
  the device's ceiling, so it says `loupe · as close as this device goes`
  (`LoupeState` `'capped'`) instead of trying.
- **A phone lets the decoder GO** — after 8 s of rest, and the moment the tab
  is hidden (`decoderIdleMs`, `visibilitychange`), never under a decode in
  flight (`busy`). iOS reclaims background tabs by their memory, and 330 MB
  of idle heap is a tab killed while the person answers a message. The next
  decode loads the worker again from the browser's compiled-module cache. A
  roomy device keeps it, as before. The decode cache goes on hide too.
- **A decode is held for the session at the size it was asked**
  (`decoded-cache.ts`, `hold: true` from the stage and the loupe, never the
  export): 64 MiB on a phone (two DJI stage decodes), 256 MiB elsewhere,
  least recently used first and the newest never — `held-budget.ts`'s
  policy, reused. The key carries the file and everything that sizes the
  decode, never the gain: the stage stores the gain the first decode
  measured, so its second ask is the same picture. Media bytes are still
  never persisted (`local-first.md`); this is a session cache like the held
  originals.

**The held originals follow the same class**: a constrained device gets a
flat 192 MiB ceiling (`CONSTRAINED_HELD_CEILING`) whatever the browser
reports — Chrome on Android says 8 GiB of a phone whose tab is given far
less, and Safari says nothing, which used to hand an iPhone the desktop's
512 MiB.

## The device class is coarse on purpose (2026-09-23)

`deviceClass()` answers `constrained` or `roomy`, once per page: an iPhone or
iPad (`navigator.platform`, and a Mac platform WITH touch points for an iPad
that calls itself a Mac), Android (the user agent), or a `deviceMemory` of
4 GiB or less. Nothing finer exists to measure — no browser tells a page the
number a tab is killed at, and Safari reports no memory at all — so a rule
that pretends to more precision is a rule that is wrong on the one device it
matters on. **`localStorage['atelier.device']`** overrides it (`constrained`
/ `roomy`): that is how the phone path is driven on a desktop, and how a phone
can be told to stop holding back. A browser preference, never a document.

## What is verified, and what is not

Driven headless in Chromium against the dev server on a synthetic DNG LibRaw
really decodes (6000 × 4000 uncompressed CFA + a canvas JPEG render, built in
the page — the recipe is in `testing.md`), with the class forced each way:
constrained decoded the stage at 1500 × 1000 (half), the loupe read
`as close as this device goes`, the second open at the same size came from
the cache with no worker loaded, the worker was gone 9.5 s after the last
decode and gone at once on a hidden tab, and *Export this picture* wrote
3000 × 2000 with the device sentence in the run; roomy decoded the same file
whole on the loupe (`loupe · 6000 px`) and exported 6000 × 4000 with no note,
its worker kept. No console error either way.

**NOT measured: his phone.** The container has no iOS. The arithmetic above
says the peak dropped by hundreds of megabytes; whether an iPhone 15 Pro Max
now holds the whole of it — the app, the 74 MB file, the worker's heap for
the length of one decode, the GPU — is his to confirm on the real DNG, and
the first thing to do if it still reloads is to read the device class on
the phone (Safari's `platform` is `iPhone`) and try `roomy`'s opposite: a
smaller `CONSTRAINED_STAGE_EDGE`. What is left on the CPU side is the plane
itself (six bytes a pixel of LibRaw's half) and the worker's heap during the
decode; the way past those is a tiled decode through LibRaw's own `cropbox`
(`libraw-wasm` exposes it; each tile re-opens the file), which is the next
step if a measurement asks for it, and the honest way to a loupe at the
file's density on a phone.
