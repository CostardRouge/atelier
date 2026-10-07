# What is left — by domain, and by who unblocks it

*2026-10-07. Written after PR #233 merged (the render-fidelity audit's
compromises, the tone engine and P1–P5 of `docs/develop-performance.md`),
from the maintainer's question «what remains for the project to be
perfect». An INDEX of the open work, one row per item, each pointing at the
brief or memory file that holds the detail and the measurements — nothing
here is reasoned a second time. Read `MEMORY.md` first (its open items are
the dated record), then the file a row names. Keep this current when a row
closes, or delete it when it is stale: `docs/run-sheet.md` is the precedent.
Completed the same day by a pass over every open item of `MEMORY.md`, every
brief's open-questions section and `docs/roadmap.md`: what a row here did not
carry was added, and the DJI DNG row, half answered since 2026-09-20, was
rewritten.*

**How to read the last column.** *Him* is a decision or a measurement only
the maintainer can make (his devices, his taste, his network exceptions);
*agent* is work that needs no decision and can start in any session; *Winnow*
is a change in `CostardRouge/winnow`.

## 1. Measurements that have never been made on his devices

Everything built in this container was driven headless on SwiftShader. None
of the following has been seen on his Mac or his iPhone, and each is the
precondition of the row that depends on it.

| What | Why it matters | Where | Who |
| --- | --- | --- | --- |
| A slider step, a ←/→ and a roll of hundreds in Develop on the phone | P1, P2 and P4 were measured headless only; P3 and P6 are built only if a drag still stutters after them | `docs/develop-performance.md` §2–§3, `testing.md` «The GPU-work bench» | Him |
| The band's stripes in the loupe on his Mac | Still uncaused; `check-bands.mjs` on his own GPU at the loupe's size is the thing to run | `render-core.md` «Bands», `MEMORY.md` open item 2026-09-20 | Him |
| A 48 MP export at full density on the iPhone (`source` × `source`, a halation) | The one still-expensive path left; the targets are banded, the source and the canvas are not | `MEMORY.md` open item 2026-09-09 (rev. 2026-09-28) | Him |
| The Winnow picker, Deduce, the LUT pack sync, the finals going home, against the REAL instance | All driven against a stub; the pack's first real push was refused 400 once already | `winnow-picker.md`, `roadtrip.md` «The itinerary is DEDUCED», `docs/lut-packs.md` | Him, on the deployed pair |
| H.264 encodes never made here: the making-of, the Studio's clips, Trips' hook clip | This Chromium has no H.264 encoder; VP9 stood in | `develop-roll.md` «The making-of», `studio.md`, `roadtrip.md` | Him |
| Ultra HDR on an HDR screen, the 16-bit PNG opened in Lightroom, the look picker on his Mac, press feedback on the iPad | Each claimed from a file read back or a headless drive, not from eyes | `hdr.md`, `develop-output.md`, `docs/look-picker-redesign.md`, `docs/press-feedback.md` | Him |
| A RAW on the phone: the decode verdict, a real ProRAW JPEG XL from his iPhone, his A7C II's ARW through LibRaw | Decision 5 of `develop-originals.md` §7 still needs the iPhone; the JXL path was measured on an uncompressed twin only; whether LibRaw reads the ARW at all is what R6 was for | `docs/photo-editor.md` §11.2 and §11.4, `raw.md` «ProRAW in JPEG XL», `device-memory.md`, `docs/capture-renditions.md` §14 | Him |
| Document sync: a network drop and a 401 mid-edit; the Studio project's §10 script on the deployed pair | Trips' sync was confirmed by him, but those two cases were never exercised; the Studio's was driven against a stub only | `docs/roadtrip-persistence.md` (status block, §10), `studio.md` | Him |
| Gestures never driven: a collage's hold-to-swap and a free print's drag, the Studio's scene cascade; the roll band (face D) and the mask UI on his Mac and iPhone; Snap's worth on hair | Built and specced, never seen under a hand or on his photographs | `roadtrip.md` «A slide holds SEVERAL pictures», `develop-roll.md` «The roll's pictures are a BAND», `subject-model.md` | Him |
| The real-device layout pass | The iOS-only half (toolbar, keyboard, zoom) is the one thing the headless sweep cannot see | `docs/audit-mobile-layout-2026-10-06.md` §6 | Him |
| The Develop stage's swipe (A/B off) under a finger on the iPad and under his Mac's trackpad | Driven headless with a mouse, CDP touches and a synthetic wheel; a real trackpad's momentum after a page, and Chrome's wheel latch across the stage's remount, are reasoned, not seen | `develop-roll.md` «A swipe pages the roll when A/B is off» | Him |

## 2. Decisions that are his

| What | The choice | Where | Who |
| --- | --- | --- | --- |
| The audit's twelve decisions | CI gates with `playwright` (TEST-01 — now also carrying the phone layout sweep, step 7 of the mobile audit); `eslint-plugin-react-hooks` (DX-01); a CSP (SEC-06); maplibre 6 (SEC-09); the ffmpeg core's integrity (SEC-04); two tabs on one document (DATA-02); a newer document's refusal and wording (DATA-01); byte units (SHR-01); text contrast, `muted` at 3 : 1 (A11Y-01); offline / a service worker (PERF-07); the GPS note (SEC-10); two folder moves (ARC-01/02) | `docs/audit-2026-10-02.md` «Decisions needed from the maintainer» | Him |
| Performance §4 | An IndexedDB cache of a Winnow picture's bytes (declined once); a second thumbnail size; P3 before or after P4 | `docs/develop-performance.md` §4 | Him |
| RAW by default | His stated direction (§13.4b): «RAW by default one day, the proxy chosen deliberately for speed, possibly at the roll's creation». What exists: the opcodes as rungs (`gainMap`, `gainMapWarp`, 2026-09-20), the pixels said (`pictureFidelity`), a roll opening on the sensor by ROLE (`opensOn`, 2026-10-02). Still open: a roll's creation choosing it, and a picture whose render is 8.4× short (a DJI DNG) opening on the sensor by itself | `docs/capture-renditions.md` §13.4b, `roll-choice.md`, `raw.md` «The four rungs» | Him |
| Develop, parked by him | Wide gamut / P3, DCP and ICC, TIFF, content-aware remove, side-by-side | `docs/lightroom-gaps.md` §8, §11, §12 | Him, to reopen |
| Auto-develop §7 | The LLM assistant: a fourth network exception, and where the key lives (browser or a Winnow relay) | `docs/auto-develop.md` §7–§8 | Him |
| Trips, unified slides | Every slide the same kind of thing, none structural; the combined reel and an animated content slide wait for it | `MEMORY.md` «Only a deck's content slides reorder… Under revision» | Him |
| Trips, slide capacities §9 | Built on the brief's working answers, each his to overturn: a badge on more than one slide (the chapter mark); whether slide 1 keeps the name «hook»; two masked modes or more; a deck SHAPE in the new-piece defaults; which opener crosses the Studio bridge | `docs/slide-capacities.md` §9 | Him |
| Trips, collage and motion | What «step» means (a cut on its beat or a stepped curve); clips in cells; a collage under the hook's badge; whether exits ship; the `inside` entrance re-expressed on `framingAt` (changes existing collages, question 3 of the motion lab); continuity of direction between a reel's slides | `roadtrip.md` «A slide holds SEVERAL pictures», «A picture moves in its frame», `MEMORY.md` open items 2026-09-16, 2026-09-23 | Him |
| Trips, the overview on a phone §9 | Deduce / timeline import in the Stages sheet; `pellicule` as the default; what the strip's `+ Raconter` does; what the Voyage cell holds | `docs/roadtrip-overview-mobile.md` §9 | Him |
| Trips, a publishing queue | Roadmap 01 — a week strip answering «what goes out next», the tool's second founding question, which nothing answers today. A proposal never agreed | `docs/roadmap.md` 01 | Him, to agree |
| The look picker §7 | The develop under the scene (a look judged over the correction or without it); the wipe's slider back beside `A/B`; the rail's width | `docs/look-picker-redesign.md` §7 | Him |
| Answered by a brief's own recommendations, his to overrule | The filmstrip's six (§7), the making-of's eight (§6), the mask UI's (§6), picture motion's four (§7), the Winnow picker's five (§7.4), press feedback's four (§5); and what «pixel piping» meant (read as pixel PEEPING, the loupe) | `docs/develop-roll-browser.md`, `docs/develop-timelapse.md`, `docs/mask-ui-redesign.md`, `docs/picture-motion-ui.md`, `docs/winnow-day-sheet-verdicts.md`, `docs/press-feedback.md`, `docs/photo-editor.md` §11.1 | Him, only if he disagrees |
| Trips, five questions of the renditions brief | The first being whether a paired capture offers its RAW at all; Sony's lens calibration worth applying or not | `docs/capture-renditions.md` §9 | Him |
| Trips, the map and Deduce | «Where the pictures were» (Q3), the replay (Q5), Deduce's thresholds on the trip or the device, V3/V4 of the camera plate | `roadtrip.md` «A MAP view of the overview», «The Deduce MODAL» | Him |
| HEIF and HLG | One `.HIF` of his, and whether his are HLG; HLG footage flattened in silence (a notice is the honest cheap half) | `media-pipeline.md` «A HEIF's 10 bits are NOT read yet», `MEMORY.md` open item 2026-08-21 | Him |
| Taste | The six film stocks' numbers on real photographs; the tone engine's knee rate and cap, its two-stop reach, and whether the shadows band reaches black; the Auto verbs' constants — A1's thresholds, A2's confidence floor, Auto tone's gamma reach, Auto detail's per-stop amounts, Auto upright's floors — and the default recipe of the one `Auto` (tone, bands, detail) | `docs/film-simulation.md`, `docs/develop-tone.md` §5, `docs/auto-develop.md` §5, `develop-roll.md` | Him |
| A SAM-family model | Only if Tolerance + Remove do not hold on his photographs; 14–28 MB of runtime before the weights | `docs/mask-ui-redesign.md`, `subject-model.md` | Him, after his photos |

## 3. Work that needs no decision

| What | Detail | Where | Who |
| --- | --- | --- | --- |
| Auto-develop §6, the model | B1 and B2 are built (2026-10-07: the pairs kept, the training file written); B3 is a trainer OUTSIDE the repo and B4 its ONNX inference as a verb — both wait on a few hundred pairs of his | `docs/auto-develop.md` §6 | Him (the pairs), then agent |
| Lightroom gaps, pass 5 | 29 a grid and reorder; 31 snapshots; 34 send a picture to Trips or the Studio | `docs/lightroom-gaps.md` §6 | Agent |
| Audit batches 6–7 (data) | DATA-03 the resume race, DATA-04 `beforeunload`, DATA-09 the version-change handler; DATA-05/06 the mark-and-sweep, DATA-10 the lattice cache's ceiling, DATA-07 the previews index | `docs/audit-2026-10-02.md` «Batches» | Agent (DATA-01/02 wait on §2) |
| Audit batch 12 (accessibility) | A11Y-03 `useModalFocus` over one `Modal` (24 modals trap no focus), A11Y-02 the menu's keyboard, A11Y-04 the switch, A11Y-06 reduced motion, UX-02 to UX-06 | `docs/audit-2026-10-02.md` «Batches» | Agent (A11Y-01 waits on §2) |
| Audit batches 9–10, 13 | FID-01 `graderFrom` over `picturePasses`; SHR-04 `media-ink.ts`, EXT-05's constants; ARC-04 the five god components export-hooks-first, TYPE-01/02, EXT-02 | `docs/audit-2026-10-02.md` | Agent (ARC-01/02 after his nod) |
| Performance, the two recorded next steps | An `updatedAt` index read with a key cursor for the Home doors (after DATA-09); the gazetteer as a columnar index, transferred, if its 130 ms clone shows on the phone | `docs/develop-performance.md` §2.4–§2.5 | Agent, each on a measurement |
| Trips, exports | The combined reel; `hookSeconds` not clamped to the clip until the bar is touched; the look crossing the bridge WHOLE (§8, his stated second step) | `docs/roadtrip-export.md`, `MEMORY.md` open item 2026-09-09 | Agent (the reel after unified slides) |
| Phone layout audit, steps 4–6 | B-01 the Studio clip header (one unwrappable line, ≈ 435 px — needs a clip in the sweep); A-06/A-07 `overflow-clip` on the structural shells and the `90dvh` caps; C-01…C-03 the bottom and top rooms | `docs/audit-mobile-layout-2026-10-06.md` §5 | Agent (step 7 waits on TEST-01) |
| The optimisation pass's leftovers | Develop's mask overlay swapping passes between paint and histogram; Trips' openers' per-frame allocations (`scrub-paint.ts`, `drive-paint.ts`, `map-paint.ts`) and `pictureLine` in three copies; the Studio's glow scratch canvases that only grow, the legacy overlay page copying its element helpers; the shell's publishers that also subscribe, the sheet drag animating `height` | `MEMORY.md` open item 2026-09-22 | Agent, each when a measurement asks |
| Trips, small gaps on record | The Library's instance tab given a LEG's span, not only a day (`media-scope.tsx` takes any span; the overview publishes the day alone); the export-reminder banner he asked for («last export 12 days ago», never blocking); a chapter mark drawing every badge piece; another slide's opener flashing pictures in the hook's grade | `MEMORY.md` open item 2026-09-07, `roadtrip.md` (the reminder, «An opener, a badge and masked text on ANY slide») | Agent |
| Trips, left open by design | Clips inside collage cells; a per-cell entrance; dragging the camera plate freely (V3); a plate in the Studio or Develop (V4); the motion cards' draggable diamond on the band (§6.6); Time Machine, a numeral winding back (roadmap 11, «explicitly last») | `roadtrip.md`, `docs/picture-motion-ui.md` §6.6, `docs/roadmap.md` 11 | Agent, on request |
| Film texture where it does not reach | The Studio's stage previews no grain (its exports do); a painted clip's grain is frozen | `render-film.md`, `MEMORY.md` open item 2026-09-20 «Film simulation» | Agent, on request |
| Studio merge, phase 4 | The seven legacy pages (Overlay, Telemetry, EXIF, LUT, Compare, Composer, Flight Map) absorbed as Studio panels and their routes retired, one commit per page in order of least gap — agreed in principle, never scheduled | `studio.md` (phases), `docs/roadmap.md` 10 | Agent, on his go |
| Studio | A lane under the TrimBar per timed element; a pre-roll intro (the timestamp shift); free placement on the outro's own stage; the HLG notice; the legacy pill constants migrated to `Button` in `SourcesScreen`, `DayPanel`, `ComposerTool` and the instruments | `MEMORY.md` open items 2026-08-21/22/25, 2026-09-13 | Agent |
| Winnow, multi-instance | A tab per instance in the Library rail, `useWinnowSource(id)` replacing the one connection hook | `architecture.md`, `MEMORY.md` open item 2026-09-06 | Agent, deferred by him («on verra ça après») |
| Hygiene | `scripts/gen-luts.mjs`'s stale comment; the built-in looks' title-cased names in `builtin-luts.ts`; `docs/run-sheet.md` to keep current or delete | `MEMORY.md` open items 2026-08-20, 2026-10-01 | Agent, minutes each |

## 4. The other side of the bridge

| What | Why | Where | Who |
| --- | --- | --- | --- |
| Entry points into Atelier («Edit in Atelier» on an asset, a selection, a day) | The cheap half of the integration, undesigned on purpose | `MEMORY.md` open item 2026-09-02 | Him to design, Winnow to build |
| A deep link that opens ONE asset in Winnow's viewer | «Open in Winnow» can only land on a session grid today | `architecture.md` | Winnow |
| `original_asset_id` and `chapter_id` read by the upload route, and a final filed into a finals root | The write half of the timeline bridge is still assumed; and Develop's send home is UNPLUGGED until Winnow can receive a final (an upload lands in the incoming today, and his Gallery volume is mounted read-only) — re-plugging is one element in `ExportPanel` | `docs/winnow-timeline.md`, `develop-roll.md` «Sending a roll home is UNPLUGGED» | Winnow, then him |
| A «Make a Road Trip from this leg» verb | Opens `#/roadtrip/new?source=<host>&chapters=<id>`, which Atelier already reads | `MEMORY.md` open item 2026-09-03, `docs/winnow-timeline.md` | Winnow |
| `Vary: Origin` on the derivative routes | The root fix for the poisoned cache entries Atelier now heals one by one | `architecture.md` «The cache entry that fails before the request leaves the machine» | Winnow |
| Winnow #277 merged and deployed, then `#/sources` re-read | A burst's picked frame listed without an unfold; the capabilities sheet is a snapshot | `winnow-picker.md` | Winnow, then him |

## 5. If the order is the agent's to pick

1. ~~Auto-develop §6 (the dataset)~~ — built 2026-10-07; the pairs now accrue by themselves.
2. Lightroom pass 5 (29, 31, 34): three commits, no question open.
3. Audit batches 6–7 and 12 minus the two decisions: data safety and focus
   traps, each a small commit with a spec.
4. The phone layout audit's steps 4–6: the next commits of a plan already
   under way, each swept at 360 and 390.
5. Hygiene, the same afternoon.

Everything else waits on a measurement on his phone or on one of his answers.
