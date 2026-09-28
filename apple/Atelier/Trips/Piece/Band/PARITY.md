# The band «Aiguille» — parity with the web app

The piece's deck and its transport as ONE band under the picture, against
`src/tools/roadtrip/DeckStrip.tsx`, the band's half of
`use-deck-transport.ts`, `use-hook-sound.ts` and the rail's
`use-rail-thumbs.ts` (map task tools-roadtrip-12). The clock itself —
two clocks never both, the loop, the derived time — is the landed
`PieceDeckClock` (`../PARITY.md`, «The clock and the keys»); this folder
drives it through the model's verbs and adds what the band draws, hears and
answers.

✅ built · ⏳ deferred (why, and what it waits on) · ≠ built differently on
purpose (why).

Every sentence on screen is the web's. Nothing here was run on a device —
this container has no Apple toolchain, so every view was written against the
SDK and compiled by CI alone; the sound in particular has never been heard.

Rows: 68 ✅ · 6 ≠ · 1 ⏳

## The row (`PieceTransportRow.swift`)

| Web (`DeckStrip.tsx`) | Native | |
|---|---|---|
| ▶ plays the WHOLE piece, slide after slide, and LOOPS; ❚❚ pauses | `togglePlay()` over `PieceDeckClock` | ✅ |
| While the cut is open ▶ plays the cut, looping its stretch | `togglePlay()` → `setClipPlaying` on `trimOpen` | ✅ |
| Its name: `Pause` / `Play the cut` / `Play this slide` / `Play the piece` | `accessibilityLabel` | ✅ |
| Its title: `Play the cut, looping (Space)` / `Play this slide, looping (Space)` / `Play the whole piece, slide after slide, looping (Space)` | `.help` | ✅ |
| A round ink button, accent under the pointer; 40 px on a phone, 32 beside a mouse | `Circle` in `ink`, `accent` on hover; 40 / 32 points | ✅ |
| The time where the band stands (the finger's while one holds it), `0:04.20`, `/ total` beside a mouse only | `formatTimecode(shown)`, `/ deck.seconds` unless compact | ✅ |
| The open slide's name — `Hook`, `Picture 2`, `Closing card` — and what it plays, truncated, the whole line as its title | `slideName` + `detail`, one `Text`, `.help(detail)` | ✅ |
| A clip: `5s · from 0:01.20` (`· 2× · no sound` re-timed); cutting: `0:01.00 → 0:03.00 · 2s on screen` (`· no sound`) | `detail` over `clipRange`, `screenSecondsOf` | ✅ |
| A still `3s · image` (or `· video` when it goes out as one); the closing card `3s` | `detail` | ✅ |
| The loop pill `↻ Piece` ⇄ `↻¹ Slide`, lit on Slide, icon-only on a phone | `repeat` / `repeat.1`, `toggleLoopScope()` | ✅ |
| Its titles `Looping this slide — click for the whole piece (L)` / `Looping the whole piece — click for this slide only (L)` and names | `.help`, `accessibilityLabel`, `isSelected` | ✅ |
| The loop pill hides while the cut is open (the cut loops its stretch whatever it says) | `if !model.trimOpen` | ✅ |
| A clip's speed pill: the Studio's steps, lit off 1×, a fixed 56 px on a phone; `Clip speed`; its title | a `Menu` over an inline `Picker` of `clipSpeeds` → `setClipSpeed`, 56 points wide when compact | ✅ |
| The speed is a `<select>` at 16 px on a phone so iOS does not zoom the page on focus | a native menu — there is no page to zoom | ≠ the trap belongs to a browser |
| Cut `✂ Cut` ⇄ `✓ Done`, lit while cutting, words folded on a phone; titles `Cut this clip: its in and out points (I · O at the playhead)` / `Back to the piece` | `setTrimming(!trimOpen)` (stops playback either way) | ✅ |
| The ticks pill, only for an opener with a score and never on a phone: `Hear the opener’s ticks` / `Mute the opener’s ticks`, titles with `(M)` | `speaker.wave.2.fill` / `speaker.slash.fill`, `soundOn` | ✅ |
| ⋯ `More for <slide>`: `Move earlier` / `Move later` on a content picture (disabled at its ends) | `moveSlide(from:to:)` | ✅ |
| ⋯ on a phone carries the ticks toggle | `hasSound && compact` | ✅ |
| ⋯ `Close with the call to action`, or `Edit the closing card…` (`Write the closing card…` while it says nothing) and `End on the last picture` | `setIncludeCta`, `editClosingCard()` | ✅ |
| ⋯ `Remove this picture`, in danger, on a content picture | `removeSlide()`, `role: .destructive` | ✅ |
| `+` `Add the active picture to this piece` | `addSlide()` — lands on it | ✅ |
| On a phone every control is a finger's target: a 40 px row, 34 px pills, ⋯ and + at `md` | 40-point row, 34-point pills and icons (32 / 28 beside a pointer) | ✅ |

## The strip (`PieceDeckStrip.swift`)

| Web | Native | |
|---|---|---|
| Every slide end to end on one clock: a clip as wide as its cut, a still its seconds, 42 px/s (30 on a phone), a 26 px floor, 2 px gaps | the kernel's `stripLayout` over `model.lengths` | ✅ |
| The needle never moves — an ink line with its head, in the middle; the piece slides under it | `PieceNeedle`; the cells offset by `xAtTime(shown)` | ✅ |
| The band's ends fade into its ground | two 32-point gradients over `paper2` | ✅ |
| A clip's cell on the frame's black, a still's on paper inside a dashed border | `PieceStripCell` | ✅ |
| Every cell TILES its thumbnail along its length — a clip's frames split by dark rules, a still's copies by paper — each tile at the piece's aspect on the cell's inner height (38, 36 inside the dashed border) | a `Canvas` per cell over `PieceRailThumbs` | ✅ |
| The label `Hook 5s` / `2 3s · 2×` / `End 3s`, mono, light ink with a shadow, truncated | `PieceStripCell.label`, `onMedia` | ✅ |
| The open slide's cell ringed in the accent | a 2-point ring outside the cell | ✅ |
| The repeat-one mark on the open cell while playback loops the slide | `repeat.1` on an accent disc | ✅ |
| The frames a slide's pictures are placed at, as accent diamonds along its bottom (the hook's measured after the opener) | `slideMotionMarks(slide, length, hook.seconds)`, kept 4 points inside | ✅ |
| A cell that did not change is not drawn again as the band slides | `PieceStripCell` is `Equatable`, `.equatable()` | ✅ |
| Drag scrubs the piece: the band draws where the FINGER is, the editor hears at most once a frame | `PieceStripDriver.held`; `scrubPiece` coalesced to one a turn of the run loop | ✅ |
| A press that travels under 5 px is a tap: it opens the slide under the finger on its start; a tap on the open slide leaves the piece where it is | `ended` → `deck.goTo(under, 0)` | ✅ |
| A flick keeps going and slows (×0.93 / 16 ms), stops at the ends, then lands on a slide's edge within 10 px | `glideOn` + the kernel's `snapToEdge` | ✅ |
| A finger that stopped (80 ms) before it lifted threw nothing; under reduced motion nothing glides | `stale`, `accessibilityReduceMotion` | ✅ |
| A cancelled pointer settles where it is, throwing nothing | a `GestureState` reset with the drag still open → `cancelled()` | ✅ |
| A tap during a glide leaves the band drawn where the glide was stopped | the band goes back to the editor's clock after the tap | ≠ the web keeps drawing the stopped glide's moment until the next drag — a stale needle |
| A horizontal wheel (a trackpad sweep, Shift + wheel) scrubs from the moment still on its way to the editor; a vertical one is the page's | the Mac: `PieceBandWheel`, claiming scroll events only | ✅ |
| The same sweep on an iPad's trackpad | no SwiftUI gesture receives a trackpad's scroll; a pointer DRAG scrubs | ≠ what iPadOS hands a view |
| The band claims only the horizontal axis (`touch-pan-y`), so a page that scrolls keeps its way in | the band sits in no scroll view; its drag takes both axes | ≠ there is no vertical scroll to hand back |
| `role="slider"`: `The piece — drag to move through it`, its value `Picture 2, 0:04.20 of 0:12.00` | one accessibility element, label and value; an adjustment steps a slide | ✅ |
| A focus ring only when the KEYBOARD brought the focus there | drawn when focused and no press put it there | ✅ |
| A click on the band puts the keyboard on it | a press sets the band's focus | ✅ |
| A click elsewhere takes the keyboard off the band | a press on a surface that takes no focus (the stage) leaves it on the band | ≠ a native click moves no focus; ← → keep stepping slides until another control takes the keyboard |

## The keys (`../PieceEditorModel+Keys.swift`)

| Web | Native | |
|---|---|---|
| The band's keys answer only while the keyboard is on it (a `role="slider"`): ← / → step to the previous / next slide, Shift ±0.5 s, Home, End | `handleBandKey`, bound by the strip's own `onKeyPress`; the editor-wide handler no longer answers them | ✅ |
| On the band Space plays the piece itself (a focused slider owns Space in the suite's key guard), never repeated | `handleBandKey(" ")` | ✅ |
| Everywhere else Space plays and pauses, never with Shift, never repeated; a control owns it only while the keyboard is on it | the editor's `handleKey`; a native control takes no focus from a click | ✅ |
| `⌘` / `Ctrl` / `Alt` presses are never the band's | ignored | ✅ |
| I / O, L, M while the keyboard is on the band | forwarded to `handleKey` | ✅ |

## The cut (`PieceDeckBand.swift`)

| Web | Native | |
|---|---|---|
| ✂ opens the Studio's own `TrimBar` IN the band, in its place | `StudioTrimBar` in a 56-point band | ✅ |
| Its handles write the in point and the screen time; the playhead seeks the clip; the shortest cut is `MIN_HOOK_SECONDS / 4`, a frame a step | `setClipRange`, `setPlayhead`, `PieceEditorModel.minCut`, `1 / 30` | ✅ |
| A scrub on the bar stops the clip playing | `onScrub(true)` → `setClipPlaying(false)` | ✅ |

## The thumbnails (`PieceRailThumbs.swift`, the web's `use-rail-thumbs.ts`)

| Web | Native | |
|---|---|---|
| Every slide drawn as DELIVERED — crop, caption, badge, grade — through the one renderer | `SlideRenderer.image` | ✅ |
| Drawn SETTLED: past the badge's entrances and the opener's seconds on the hook, past a collage's arrival | `deckStillSeconds(slide, aspect, max(settle, hook.seconds))` | ✅ |
| 192 px on the long edge; pictures decoded for it at 512 px wide | 192; decoded within 512² pixels | ✅ |
| A signature per slide: only a cell whose signature moved is drawn again | `RailInput`, compared whole — the hook re-signs on any change of the document | ✅ |
| After 350 ms of quiet, one slide at a time, the pass abandoned when its inputs change | a debounced `Task`, cancelled on a new ask | ✅ |
| One decoded source kept between passes; a clip at another moment is SEEKED | `held` | ✅ |
| A collage decodes its cells for the one draw, each graded with its own develop | `BadgeSources.loadCollage`; `SlideRenderer` grades per cell | ✅ |
| A cell the deck no longer has is forgotten | `refresh` | ✅ |
| An undecodable file costs its cell its picture, never the band, and is not retried on every pass | the signature is kept with no picture | ✅ |
| The opener's pictures and the camera credit reach the hook's cell | `hookPictures`, `hookExif` | ✅ |

## The opener's sound (`PieceHookSound.swift`, the web's `use-hook-sound.ts`)

| Web | Native | |
|---|---|---|
| The SAME voices the export renders (`scheduleScore` into the live context) | the kernel's `renderBed` over the same events, played by an `AVAudioPlayerNode` | ✅ |
| OFF by default; `M`, the ticks pill or ⋯ turns it on | `PieceEditorModel.soundOn` | ✅ |
| The audio context is made the first time sound is turned on | the engine is made on the first pass | ✅ |
| Heard while whichever transport drives the badge plays — the clip's own or the photo's | `isHook && stagePlaying && soundOn` | ✅ |
| A pass begins where the badge's clock is | the events from `badgeTime` on, shifted to 0 | ✅ |
| A loop coming round (the clock jumped back more than 0.25 s) starts the next pass | `update(_:running:time:)` | ✅ |
| Stopping mutes and drops the pass, so what was scheduled falls silent | `AVAudioPlayerNode.stop()` drops every scheduled buffer | ✅ |
| The pass's gain is 0.7 | `renderBed`'s master 0.7 (and its peak limit, so two ticks never clip) | ✅ |
| A 30 ms lead so a sound at `currentTime` is not dropped | the bed renders off the main actor and the time that took is cut from its head | ≠ nothing is dropped by a player node; the lead is spent keeping the ticks on the clock |
| The context is closed when the editor goes | `close()` on disappear | ✅ |
| — | iOS: plays through the ring switch, beside other audio (`.playback`, `.mixWithOthers`) — the author asked to hear it | ✅ |
| Heard, and in time with the stage, on a device | never run | ⏳ the first run on a device (run-sheet #6) |
