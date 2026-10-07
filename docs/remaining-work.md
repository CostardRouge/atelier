# What is left — by domain, and by who unblocks it

*2026-10-07. Written after PR #233 merged (the render-fidelity audit's
compromises, the tone engine and P1–P5 of `docs/develop-performance.md`),
from the maintainer's question «what remains for the project to be
perfect». An INDEX of the open work, one row per item, each pointing at the
brief or memory file that holds the detail and the measurements — nothing
here is reasoned a second time. Read `MEMORY.md` first (its open items are
the dated record), then the file a row names. Keep this current when a row
closes, or delete it when it is stale: `docs/run-sheet.md` is the precedent.*

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
| The Develop stage's swipe (A/B off) under a finger on the iPad and under his Mac's trackpad | Driven headless with a mouse, CDP touches and a synthetic wheel; a real trackpad's momentum after a page, and Chrome's wheel latch across the stage's remount, are reasoned, not seen | `develop-roll.md` «A swipe pages the roll when A/B is off» | Him |

## 2. Decisions that are his

| What | The choice | Where | Who |
| --- | --- | --- | --- |
| The audit's twelve decisions | CI gates with `playwright` (TEST-01); `eslint-plugin-react-hooks` (DX-01); a CSP (SEC-06); maplibre 6 (SEC-09); the ffmpeg core's integrity (SEC-04); two tabs on one document (DATA-02); a newer document's refusal and wording (DATA-01); byte units (SHR-01); text contrast, `muted` at 3 : 1 (A11Y-01); offline / a service worker (PERF-07); the GPS note (SEC-10); two folder moves (ARC-01/02) | `docs/audit-2026-10-02.md` «Decisions needed from the maintainer» | Him |
| Performance §4 | An IndexedDB cache of a Winnow picture's bytes (declined once); a second thumbnail size; P3 before or after P4 | `docs/develop-performance.md` §4 | Him |
| A DJI DNG | Whether a picture whose embedded render is 8.4× short opens on the sensor by itself; whether the file's own GainMap and Warp opcodes are applied (the measured calibration the lens profiles lack) | `MEMORY.md` open item 2026-09-20, `raw.md` | Him |
| Develop, parked by him | Wide gamut / P3, DCP and ICC, TIFF, content-aware remove, side-by-side | `docs/lightroom-gaps.md` §8, §11, §12 | Him, to reopen |
| Auto-develop §7 | The LLM assistant: a fourth network exception, and where the key lives (browser or a Winnow relay) | `docs/auto-develop.md` §7–§8 | Him |
| Trips, unified slides | Every slide the same kind of thing, none structural; the combined reel and an animated content slide wait for it | `MEMORY.md` «Only a deck's content slides reorder… Under revision», `docs/slide-capacities.md` §9 | Him |
| Trips, five questions of the renditions brief | The first being whether a paired capture offers its RAW at all; Sony's lens calibration worth applying or not | `docs/capture-renditions.md` §9 | Him |
| Trips, the map and Deduce | «Where the pictures were» (Q3), the replay (Q5), Deduce's thresholds on the trip or the device, V3/V4 of the camera plate | `roadtrip.md` «A MAP view of the overview», «The Deduce MODAL» | Him |
| HEIF and HLG | One `.HIF` of his, and whether his are HLG; HLG footage flattened in silence (a notice is the honest cheap half) | `media-pipeline.md` «A HEIF's 10 bits are NOT read yet», `MEMORY.md` open item 2026-08-21 | Him |
| Taste | The six film stocks' numbers on real photographs; the tone engine's knee rate and two-stop reach | `docs/film-simulation.md`, `docs/develop-tone.md` | Him |
| A SAM-family model | Only if Tolerance + Remove do not hold on his photographs; 14–28 MB of runtime before the weights | `docs/mask-ui-redesign.md`, `subject-model.md` | Him, after his photos |

## 3. Work that needs no decision

| What | Detail | Where | Who |
| --- | --- | --- | --- |
| Auto-develop §6, the collection | The as-shot vignette beside the record and the training dump — every day without it is dataset lost | `docs/auto-develop.md` §6 | Agent |
| Lightroom gaps, pass 5 | 29 a grid and reorder; 31 snapshots; 34 send a picture to Trips or the Studio | `docs/lightroom-gaps.md` §6 | Agent |
| Audit batches 6–7 (data) | DATA-03 the resume race, DATA-04 `beforeunload`, DATA-09 the version-change handler; DATA-05/06 the mark-and-sweep, DATA-10 the lattice cache's ceiling, DATA-07 the previews index | `docs/audit-2026-10-02.md` «Batches» | Agent (DATA-01/02 wait on §2) |
| Audit batch 12 (accessibility) | A11Y-03 `useModalFocus` over one `Modal` (24 modals trap no focus), A11Y-02 the menu's keyboard, A11Y-04 the switch, A11Y-06 reduced motion, UX-02 to UX-06 | `docs/audit-2026-10-02.md` «Batches» | Agent (A11Y-01 waits on §2) |
| Audit batches 9–10, 13 | FID-01 `graderFrom` over `picturePasses`; SHR-04 `media-ink.ts`, EXT-05's constants; ARC-04 the five god components export-hooks-first, TYPE-01/02, EXT-02 | `docs/audit-2026-10-02.md` | Agent (ARC-01/02 after his nod) |
| Performance, the two recorded next steps | An `updatedAt` index read with a key cursor for the Home doors (after DATA-09); the gazetteer as a columnar index, transferred, if its 130 ms clone shows on the phone | `docs/develop-performance.md` §2.4–§2.5 | Agent, each on a measurement |
| Trips, exports | The combined reel; `hookSeconds` not clamped to the clip until the bar is touched; the look crossing the bridge WHOLE (§8, his stated second step) | `docs/roadtrip-export.md`, `MEMORY.md` open item 2026-09-09 | Agent (the reel after unified slides) |
| Trips, left open by design | Clips inside collage cells; a per-cell entrance; dragging the camera plate freely (V3); a plate in the Studio or Develop (V4) | `roadtrip.md` | Agent, on request |
| Studio | A lane under the TrimBar per timed element; a pre-roll intro (the timestamp shift); free placement on the outro's own stage; the HLG notice; the legacy pill constants migrated to `Button` in `SourcesScreen`, `DayPanel`, `ComposerTool` and the instruments | `MEMORY.md` open items 2026-08-21/22/25, 2026-09-13 | Agent |
| Winnow, multi-instance | A tab per instance in the Library rail, `useWinnowSource(id)` replacing the one connection hook | `architecture.md`, `MEMORY.md` open item 2026-09-06 | Agent, deferred by him («on verra ça après») |
| Hygiene | `scripts/gen-luts.mjs`'s stale comment; the built-in looks' title-cased names in `builtin-luts.ts`; `docs/run-sheet.md` to keep current or delete | `MEMORY.md` open items 2026-08-20, 2026-10-01 | Agent, minutes each |

## 4. The other side of the bridge

| What | Why | Where | Who |
| --- | --- | --- | --- |
| Entry points into Atelier («Edit in Atelier» on an asset, a selection, a day) | The cheap half of the integration, undesigned on purpose | `MEMORY.md` open item 2026-09-02 | Him to design, Winnow to build |
| A deep link that opens ONE asset in Winnow's viewer | «Open in Winnow» can only land on a session grid today | `architecture.md` | Winnow |
| `original_asset_id` and `chapter_id` read by the upload route | The write half of the timeline bridge is still assumed | `docs/winnow-timeline.md` | Winnow |
| `Vary: Origin` on the derivative routes | The root fix for the poisoned cache entries Atelier now heals one by one | `architecture.md` «The cache entry that fails before the request leaves the machine» | Winnow |
| Winnow #277 merged and deployed, then `#/sources` re-read | A burst's picked frame listed without an unfold; the capabilities sheet is a snapshot | `winnow-picker.md` | Winnow, then him |

## 5. If the order is the agent's to pick

1. Auto-develop §6 (the dataset): the only item that loses value every day.
2. Lightroom pass 5 (29, 31, 34): three commits, no question open.
3. Audit batches 6–7 and 12 minus the two decisions: data safety and focus
   traps, each a small commit with a spec.
4. Hygiene, the same afternoon.

Everything else waits on a measurement on his phone or on one of his answers.
