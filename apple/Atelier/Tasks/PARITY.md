# Tasks — parity with the web app

The suite's PROGRESS surfaces — saying that something is taking time, with a
Cancel, never a modal: the web's `src/shared/tasks/` (`tasks.ts`,
`use-tasks.ts`, `tracked.ts`), `src/shared/ui/TaskPill.tsx` and
`TaskEdge.tsx`, and every place that registers a task
(`docs/progress-feedback.md`, the decisions in `docs/memory/tasks.md`, T1 →
T5) against this folder and its call sites. ✅ built · ⏳ deferred (why, and
what it waits on) · ≠ built differently on purpose (why). Nothing here has run
on a device: every ✅ is written and reasoned, compiled by CI; `TaskCenter`'s
behaviour is held by `AtelierTests/Tasks/TaskCenterTests.swift`.

Where things are:

| File | Holds |
| --- | --- |
| `TaskCenter.swift` | the ONE observable view of the kernel's `TaskRegistry` (`Tasks/Tasks.swift`): `running`, `visible` (≥ 400 ms), `anyVisible`, `cancelling`, `scoped(_:)`, `cancel(_:)`; `start` (any thread), `run` (a task tied to a Swift task, its Cancel cancelling it), `tracked` (the web's `trackedFetch` over `WinnowTransfer.$progress`) |
| `TaskPill.swift` | `TaskPill`, its popover `TaskList`, and `.taskPill()` — the toolbar item every stack root and every pushed screen with its own bar carries |
| `TaskEdge.swift` | `TaskEdge` (a media's hairline), `TaskBar` (the bar, for the edge and the list), `TaskCancelLink` (a sheet's own Cancel) |
| `TaskFixtures.swift` | the previews' three tasks |

Who registers a task today: the Develop roll's run (`Develop/Store/RollEditor+Run.swift`),
the stage opening a picture (`Develop/Store/RollEditor.swift`), the stage's
sensor decode (`Develop/Render/FullDevelopRenderPlan.swift`), the pack import
(`Look/PackManagerModel.swift`), the LUT studio's batch
(`Instruments/Lut/LutStudioModel.swift`) and the Composer's export
(`Instruments/Composer/ComposerModel.swift`) — all through `TaskCenter.start`.

## The registry — `tasks.ts`, `use-tasks.ts` (T1)

| Web | Native | |
| --- | --- | --- |
| Module state with a subscription, never a context: a task SURVIVES the screen that started it | the kernel's `TaskRegistry.shared` (lock-guarded, so a worker thread reports) under `TaskCenter.shared`, `@Observable @MainActor`, for the app's life | ✅ |
| `startTask({label, scope?, progress?, detail?, cancel?})` → a handle, `update` / `done` | `TaskCenter.start(_:scope:progress:detail:cancel:)` from any thread, the kernel's `TaskHandle` / `TaskPatch` | ✅ |
| `useTasks()` every task · `useTasks(scope)` one media's · `useTasks(null)` none | `visible` · `scoped(scope)` · `scoped(nil)` | ✅ |
| Nothing drawn under 400 ms; the hook wakes itself when the youngest hidden task is old enough (`visibleTasks`, `nextReveal`) | `refresh()` sets a timer at the kernel's `nextReveal` + 5 ms | ✅ |
| `overallProgress` nil the moment ANY task has no length | the kernel's, read by the bar and the pill's word | ✅ |
| `cancelTask` the only caller; a Cancel only where `cancel` exists | `TaskCenter.cancel(_:)` | ✅ |
| No ceiling; the list oldest first (his question 5) | ✅ | ✅ |
| — | a Cancel once pressed is SPENT: the row says `cancelling…` until the work reaches its safe point, and a second press asks nothing | ✅ native addition |
| `useSyncExternalStore` re-reads per render | a worker's burst of updates (a clip's frames) is coalesced into one main-actor refresh per turn; a toolbar reads `anyVisible`, so a bar moving never re-reads every screen's toolbar | ✅ |

## The pill — `TaskPill.tsx` (T1)

| Web | Native | |
| --- | --- | --- |
| In the MASTHEAD at every width, before the source pill — the one row every screen keeps (his question 3) | the navigation bar is that row natively: `.taskPill()` on every stack root of the shell (`RootView`: the four tabs, More, the sidebar's detail) and on a PUSHED screen with its own bar (the Develop editor, an instrument opened from More); the Mac's window toolbar | ≠ no masthead in a native shell |
| Draws nothing when nothing runs, nothing under 400 ms | the toolbar ITEM is left out (`anyVisible`), so no empty button waits in the bar | ✅ |
| A pulsing accent dot and one word: `Working` · `N running` · `NN %` where every task is measured; mono, upper case | ✅ (`pillWord`, `overallProgress`) | ✅ |
| Compact shell: the dot alone | `horizontalSizeClass == .compact` (iOS); `TaskPill(compact:)` forces either | ✅ |
| The popover: per task its label (truncated), `NN %` where measured, a bar, the detail or `no length to measure`, `Cancel` where it can stop — 20rem | `TaskList` (320 pt), a native popover on the phone too (`presentationCompactAdaptation(.popover)`); past five rows it scrolls | ✅ |
| The popover goes with the last task | the item leaves the bar and takes its popover with it | ✅ |
| A mouse's hover opens it, a click pins it, Escape and a click outside close it; the panel clamped on screen | a tap toggles it, Escape and a click outside are the platform's, the system places it; on the Mac the sentence is the tooltip (the `SyncPill` precedent) | ≠ native popover |
| `aria-label` the sentence (`tasksSentence`), a polite live region | the accessibility label is the sentence; VoiceOver HEARS it when the pill appears and when a task joins or leaves — never on every percent | ✅ |
| (the pulse runs regardless) | under Reduce Motion the dot does not pulse | ✅ native addition |

## The edge — `TaskEdge.tsx`, `TaskBar` (T1–T2)

| Web | Native | |
| --- | --- | --- |
| A 2 px hairline along a media's bottom edge (top on request), for the tasks scoped to it; takes no pointer | `TaskEdge(scope:edge:)` | ✅ |
| A fill in the accent where the length is known, its width eased 200 ms linear | ✅ | ✅ |
| A sweeping quarter where it is not (`deck-load`: −110 % → 410 % of itself, 1.15 s ease-in-out, forever) | `TimelineView(.animation)` over the kernel's `in-out` easing | ✅ |
| The track: the accent at 18 % | ✅ | ✅ |
| `role="progressbar"`, its label (the task, or `N things running`), its value | an accessibility element with the same label and value (`no length to measure` for a sweep) | ✅ |
| (the sweep runs regardless) | under Reduce Motion a STILL quarter in the MIDDLE of the bar — never at its start, where it would read as a quarter done | ✅ native addition |
| On the Develop viewport's bottom edge, scoped to the picture | `DevelopStageView`, scoped to the open picture | ✅ |
| — | the same hairline on a filmstrip cell whose picture is being opened | ✅ native addition |
| On the lightbox's deck (`MediaLightbox`'s `taskScope`) | ⏳ the app has no lightbox yet — the Library task draws `TaskEdge` on its deck | ⏳ |
| On the Trips badge stage (`piece:<id>`) | ⏳ Trips is not built | ⏳ |
| A modal sheet carries its OWN cancel: the masthead is behind it | `TaskCancelLink(scope:)` — `cancel` while a task of that media can stop, `cancelling…` once pressed; a sheet with a bar of its own may carry `.taskPill()` instead | ✅ |

## Fetches — `tracked.ts` (T2)

| Web | Native | |
| --- | --- | --- |
| `trackedFetch`: registered before the first byte; the bar against `content-length`, else the weight the caller knew (a row's `file_size`), else a sweep; `X of Y` / `X`; a Cancel that aborts the request; gone however it ends | `TaskCenter.tracked(_:scope:bytes:)` — `WinnowTransfer.$progress` set around the call (the transport reports both directions), its Cancel cancelling the Swift task and so the `URLSession` task | ✅ |
| A cancelled fetch rejects with an `AbortError` named `<label> was cancelled` (`isAbortError`) | `CancellationError`, Swift's own and what the transport already throws; `TaskCenter.cancelledSentence(label)` for the words | ≠ |
| An outer signal (an export's) ends the fetch too | a caller's own cancellation reaches the work (`withTaskCancellationHandler`) | ✅ |
| `quiet: true` for a caller that is a task already | by construction: a caller already under a task does not call `tracked` / `start` (the run's own RAW decode) | ✅ |
| Where a fetch task starts: `materialize`, `fetchSourceFile`, `deliveryFor`, `useCaptureView.load`, the roll export's original, the Studio's capture | ⏳ the app fetches no media from an instance yet — the Library's browser and a roll's own fetch call `tracked` when they land | ⏳ |

## Decodes — `use-develop-picture.ts`, `raw-decoder.ts` (T3)

| Web | Native | |
| --- | --- | --- |
| The stage's decode of a render: `Opening <file>`, a sweep, no Cancel (the browser's decode cannot stop), scoped to the picture | `RollEditor.startRender` while the stage holds no picture yet: the decode, a pack look's lattice and the first render as ONE task; a later render (a slider's step) is none | ✅ |
| `decodeRaw`: `Opening <file>` · `the sensor’s data`, a sweep, scoped | `FullDevelopRenderPlan.sensorDecode` on the stage's budget, once per decode it holds (an export's is under the run's task) | ✅ |
| Its Cancel drops the decoder's turn, takes the picture back to its render (`base: null`) and says so | no Cancel: `CIRAWFilter` cannot be stopped half-way, and a button that does nothing is worse than none — the chip's `decoding the sensor’s data…` and its proxy row stay the way back | ≠ |
| The loupe's decode, `Looking closer at <file>` · `the file at its own density`, with a Cancel | ⏳ the loupe is not built (Develop's `PARITY.md`: the stage says "the stage's pixels, magnified") | ⏳ |

## Exports — `use-roll-export.ts`, `use-post-exports.ts`, `StudioEditor.tsx` (T4)

| Web | Native | |
| --- | --- | --- |
| The roll's run is ONE task — `Exporting <file>` / `Exporting N pictures`, a picture at a time (`i/N · name`), a Cancel that stops BETWEEN two pictures and keeps what was rendered, said in the note | `RollRunState` + `RollExportRun`, now through `TaskCenter.start`; the pill says it wherever he walks | ✅ |
| Trips' three exports (`Exporting the piece`, `Exporting the slides`, `Encoding the hook`), scoped `piece:<id>` | ⏳ Trips is not built | ⏳ |
| The Studio's export beside its own bar and Cancel (`Exporting <name>`) | ⏳ the Studio is not built · the instruments' exports are tasks already: the LUT studio's batch (`Exporting graded clips`, `i of N`, Cancel) and the Composer's (`Exporting <clip>`, Cancel) | ⏳ |

## One-off surfaces (T5)

| Web | Native | |
| --- | --- | --- |
| The transcode (`Transcoding <clip> to H.264`, its ratio, the store's Cancel) | none: AVFoundation decodes HEVC, no transcode exists (`Instruments/PARITY.md`) | ≠ |
| The pack import: `Importing <pack>`, `i of N`, NO Cancel — the index is written last | `PackManagerModel.run`, the sheet keeping its own line | ✅ |
| A surface beside the VERB stays; one that only repeats the pill goes | the Develop Export tab's line and Cancel, the instruments' bars and Cancel stay beside their buttons; nothing here drew a private bar the pill now repeats | ✅ |

**Counts**: 44 rows — 33 ✅ (4 of them native additions), 6 ⏳, 5 ≠ (built differently on purpose).
