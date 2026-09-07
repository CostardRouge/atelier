# Roadmap — the next twelve features

> **Status (2026-09-07): a proposal, not a set of decisions.** Nothing here has
> been agreed with the maintainer. Every entry is derived from an existing open
> item, a decision taken but not built, or the suite's stated direction — the
> provenance is named on each one, so an entry can be checked against its source
> rather than taken on trust. An agent picking one of these up must still read
> the matching `docs/memory/<topic>.md` first, and must treat the "constraints"
> lines as the load-bearing half: they are the rules the feature would break if
> it were built naively.
>
> A visual version of this document (mockups per feature, mechanism diagrams)
> was published as an Artifact on 2026-09-07 — it holds the same content and
> adds the screens; this file is the durable half.

Sizes: **XS** under half a day · **S** about a day · **M** two to four days ·
**L** a week, and its own brief before any code.

| # | Feature | Tool | Size | Provenance |
| --- | --- | --- | --- | --- |
| 01 | Publishing queue | Road Trip | M | the tool's stated second question (`roadtrip.md`, "what the tool is for") |
| 02 | Export-reminder banner | Road Trip | XS | open, decided 2026-08-23, unbuilt (`roadtrip.md`) |
| 03 | HLG notice | Studio | XS | `MEMORY.md` open item 2026-08-21 |
| 04 | Timing lane under the TrimBar | Studio | M | `MEMORY.md` open item 2026-08-22 |
| 05 | Trip map | Road Trip | M | `docs/winnow-timeline.md` §7 "later" row |
| 06 | Sources sheet | Shell | S | `MEMORY.md` open item 2026-09-06 + the capabilities-snapshot trap |
| 07 | Closing-card stage | Studio | M | `MEMORY.md` open item 2026-08-25 |
| 08 | Per-slide grade | Road Trip | S | deferred in `docs/roadtrip-editor.md` |
| 09 | Pre-roll intro | Studio | L | `MEMORY.md` open item 2026-08-22, deferred not rejected |
| 10 | Retire the legacy pages | Shell | L | studio merge plan, phase 4 (`studio.md`) |
| 11 | Time Machine counter | Road Trip | S | wanted, "after the rest works" (`roadtrip.md`) |
| 12 | Winnow entry points | both repos | M | `docs/winnow-bridge.md` §10, deferred deliberately |

Suggested order: **01 → 02 → 03 → 04**, then 05–08 in any order, then a brief
each for 09 and 10. 11 waits until the rest works, as agreed. 12 waits for the
maintainer.

---

## Now

### 01 — Publishing queue: what goes out next

**What.** A week strip over the trip, at `#/roadtrip/<trip>/queue`: seven cells,
each holding the pieces sent, planned or proposed for that day, with the week's
cadence counted at the top. Below it, ranked proposals that each say *why* they
are proposed.

**Why.** `roadtrip.md` states the tool answers two questions — which day have I
never told, and **what goes out next**. The grid answers the first; nothing
answers the second. A post carries the `date` it tells and a `publishedAt`, but
no day it is *planned* for.

**The two proposers**, both already named in the sharing strategy: the "one year
ago today" spine (the editorial spine, because it supplies a ready-made
schedule), and the longest stretch of silence (which the grid already computes
and links to).

**Constraints from memory.** Cadence is three to five a week, never daily.
Out-of-order publishing is the plan, so ranking is by interest, never by trip
day. Re-telling a day is not penalised, so a day is scored by *how recently* it
was told, never flipped to "done". Nothing hangs off a filename. The proposal is
computed when Atelier opens — a browser cannot do reminders (`winnow-bridge.md`
§3.5), and for the real need (months must not pass unpublished) computing at
open is enough.

**Deliverables.** A brief (`docs/roadtrip-queue.md`: proposers, scoring, what
"vary the format" means in code) · `TripPost.plannedFor: IsoDate | null` with a
`TripDoc` version bump and a migration adding null · `shared/roadtrip/publish-plan.ts`,
pure and tested (today's date is an **input**, never `Date.now()` inside) ·
`tools/roadtrip/QueueView.tsx` and its route · a "planned" ring on the grid cell,
distinct from the five intensity rungs · README paragraph · memory entry.

**Open question for the maintainer.** Does `plannedFor` travel in
`.roadtrip.json`? The file is a backup, and this is editorial state like
`publishedAt`, so the answer is probably yes.

### 02 — Export-reminder banner

**What.** One discreet line above the trip overview: "Last backup of *Australia*
was 12 days ago · 14 pieces changed since · Export .roadtrip.json", dismissible
for a week.

**Why.** Decided 2026-08-23 and still listed as unbuilt in `roadtrip.md`: the
`.roadtrip.json` export exists, the nudge does not, and a cleared IndexedDB
would cost a year of tracking.

**Constraints.** Never a blocking prompt. It counts *changes since* the last
export, not days alone, so an untouched trip stays quiet. It shows only for
trips on the `local` source — a trip kept on a Winnow already has a remote copy.
The last-export timestamp is **bound** state: it lives in the trip store's own
record, never in the portable file (a backup that records when it was made would
change the document it is backing up).

**Deliverables.** `backup-nudge.ts` (pure: last export, edits since, snooze → show
or not) with tests · `BackupBanner.tsx` mounted by `TripOverview` · the snooze in
`localStorage`, never on the document · close the open bullet in `roadtrip.md`.

### 03 — HLG notice in the Studio

**What.** A chip in the Grade tab: "This clip is HLG (`color_md`). Atelier grades
and exports in 8-bit SDR; highlights will flatten. A log-to-Rec.709 LUT is the
usual answer."

**Why.** `MEMORY.md`'s open item of 2026-08-21: real HDR is ruled out, and the
honest cheap version is a notice. `telemetry-summary.colorProfile` already
carries the SRT's `color_md`.

**Constraints.** It *says*, it never transforms: auto-selecting a transform from
`color_md` was explicitly rejected (`media-pipeline.md`) — a hint may suggest,
the user confirms. It draws like the battery gauge draws "—": stating what it
does not know rather than inventing.

**Deliverables.** `colour-profile-notice.ts` (profile string → notice or null,
covering HLG, D-Log, none) with tests · the chip in `GradePanel`, which is
engine-level, so Road Trip's Look tab gets it for free · one README sentence ·
remove the open item.

### 04 — Timing lane under the TrimBar

**What.** One row per timed element under the trim bar, indented under its scene:
a draggable bar per element window, hatched at the ends for entrance and exit
durations, the scene's own bar moving its children.

**Why.** `MEMORY.md`'s open item of 2026-08-22 calls it "the first thing that
would make the studio feel like a timeline". It is also what makes an intro scene
legible: which elements share the window, where each entrance lands, whether an
exit has an end to land on.

**Constraints from memory.** The bar splits into **bands, never z-index** — the
handles and the playhead sit on top of each other constantly and neither must
become ungrabbable. Handles never cross. Every drag has a keyboard twin (arrows
step a frame, Shift a second). A still has no clock, so the lane is *hidden* over
a photograph, not drawn empty. And no timeline concepts enter `ProjectDoc`: a bar
edits `element.window`, nothing new is stored.

**Deliverables.** `shared/overlay/timing-lane.ts` (window ↔ pixel geometry, clamp
to the trim, keyboard steps, scene-drag propagation) with tests ·
`shared/overlay/TimingLane.tsx` mounted by the Studio under `TrimBar`; the legacy
overlay page stays untouched (it has no in-point to count from and dies in phase
4) · clicking a bar selects the element, as clicking it on the stage does ·
README paragraph under Trim · close the open item, keep the bands rule.

---

## Next

### 05 — Trip map: the legs drawn on the pane the suite already has

**What.** A third pane beside the grid and the ruler, at `#/roadtrip/<trip>/map`:
the stages' places joined in lived order, each leg in its ruler tint, each place
coloured by the grid's own coverage ramp. A hollow dot is a place never told.

**Why.** Places have carried coordinates since 2026-09-03, and
`docs/winnow-timeline.md` lists "a leg's route on the existing MapLibre pane" as
a later row. The ruler shows the trip in time; this shows it in space, and is the
second surface on which a hole becomes visible.

**Constraints.** The route draws **locally** from stored coordinates; the base map
stays the opt-in OpenStreetMap layer, off by default and stated where it is turned
on. MapLibre stays dynamically imported (it must not enter the main bundle). Place
search stays opt-in and never as-you-type. A place has no dates of its own, so its
colour comes from its stage's coverage, never from the place.

**Deliverables.** `shared/roadtrip/trip-route-geo.ts` (stages → per-leg polylines;
place → coverage rung, reusing `tripCoverage`) with tests · `TripMap.tsx` over
`shared/map/` · selection shared with the ruler (clicking a place opens that leg's
fields) · folded by default on narrow widths · README only if the network callout
needs new wording, which it should not.

### 06 — Sources sheet: several instances, and a way out

**What.** `#/sources`: every source in one list — this browser, and each connected
Winnow with its role, its capabilities, when they were last checked, and buttons
to re-check, make default, or forget.

**Why.** Two open bullets name the same gap (`MEMORY.md`, 2026-09-06):
`AssetSidebar` and the Road Trip day strip both read `connections[0]`, so a second
instance is unreachable from either, and no UI removes a connection. A third,
documented trap belongs on the same sheet: **the capabilities sheet is a snapshot
taken at connect time and nothing refreshes it**, so a feature that shipped on the
server stays hidden until `reconnect`.

**Constraints.** No request at boot — re-checking is the user's click, exactly as
connecting is. Forgetting an instance removes the local record only: documents
kept there stay there and reappear on reconnect, and the sheet must say so.

**Deliverables.** `winnow/store.ts` gains a `defaultId`, a `capabilitiesAt`
timestamp and `forget(id)` · `refreshCapabilities()`, the second caller of
`client.capabilities()` (it has exactly one today) · `SourcesScreen.tsx`, linked
from the sidebar's connection pill and from `#/connect` · both `connections[0]`
reads become `defaultConnection()` · close both bullets; keep the snapshot trap
as a rule.

### 07 — Closing-card stage: place elements on the outro by hand

**What.** A stage **mode** — Footage / Closing card — that paints the outro's flat
background instead of a frame, with the same drag, anchors and handles the
footage stage has.

**Why.** `MEMORY.md`'s open item of 2026-08-25: the outro edits its lines as text
inputs, and full intro parity was the agreed next step, deferred because the stage
cannot scrub past the clip. A mode answers that without a longer timeline.

**Constraints.** The card is ordinary overlay elements — no second element class,
no second panel (the same rejection as the "intro element" class). The outro rides
only variants carrying the overlays; a clean master stays clean. Road Trip's call
to action crosses the bridge into this same slot and never overwrites a card the
author composed, so the mode must show which of the two it is editing.

**Deliverables.** `stageMode: 'footage' | 'outro'` in the editor's UI state, never
in `ProjectDoc` · `use-overlay-stage.ts` takes a paint source (frame or flat card),
and the preview is painted by the export's own `outro-card.ts` renderer so the two
cannot drift · `OutroPanel` trades its text inputs for the element list and palette,
scoped to the card · README rewrite · close the open item.

### 08 — Per-slide grade

**What.** `PostSlide.grade: TripGrade | null`, resolved trip → post → slide, with
"Follows the post" and a Depart button in the Look tab when a content slide is
selected on the rail.

**Why.** Deferred in `docs/roadtrip-editor.md` ("v1 is one grade per post"), and a
carousel mixing a drone still with a phone photo needs one slide corrected alone.

**Constraints.** The cascade is the rule the post already follows: null means
*computed*, never blank. The hook is not a content slide and takes the post's
grade. No second grading engine — `makeFrameGrader` and `useLutStack` as today.

**Deliverables.** the field with a version bump · `resolveGrade(trip, post, slide)`,
pure and tested · preview and export both read the resolver, never the raw field ·
replace the "deferred" sentence in `roadtrip-editor.md`.

---

## Later

### 09 — Pre-roll intro: output longer than the source, at the front

**What.** N seconds before the footage — a title card on black, or a freeze of the
first kept frame — with every footage timestamp shifted by that length, video and
audio alike.

**Why.** `MEMORY.md`, 2026-08-22: deferred, not rejected. Half the mechanism
exists since 2026-08-25 — the outro's appended tail (`export-tail.ts`) proved the
encoder seam; what remains for a *pre*-roll is the timestamp shift.

**Constraints.** One shared WebCodecs pipeline; audio is copied and never
re-encoded, so the pre-roll is silent by construction and the panel must say so.
The trim is per clip and the cut happens inside that one pipeline. Export stats
must count the added seconds. Overlays read the **source** timeline, which is what
`originSeconds` already handles for Road Trip's hook.

**Deliverables.** A brief first (`docs/studio-preroll.md`: the shift, the audio
offset, the stats, what a freeze means over a trimmed in point) · `export-head.ts`
beside `export-tail.ts`, pure and tested · `ProjectDoc.preroll` in the portable
half, landing in **all four places** — `ProjectPortable`, `toProjectFile`,
`parseProjectFile`, `applyProjectFile` (the last was forgotten once and the gallery
import silently dropped intros) · one offset parameter on `exportProcessedVideo` ·
a muxer test on the shifted audio.

### 10 — Retire the legacy pages (studio merge, phase 4)

**What.** Absorb the seven remaining tool pages as Studio panels and redirect
their routes. One commit per row, in order of least gap.

| Legacy page | Where it lands | Gap to close |
| --- | --- | --- |
| Telemetry Overlay | Studio · Overlay tab | none — redirect only |
| DJI Telemetry | Studio · Info tab | a full-cue table synced to the playhead |
| Photo EXIF | Studio · Info tab, over a still | full-tag listing |
| LUT Studio | Studio · Grade tab | batch export over the library |
| Compare A/B | Studio · the A/B wipe | a second-media slot |
| Composer | Studio · layout presets in project settings | a layout template row |
| Flight Map | Studio · a **map overlay element** + a Map panel | the element type (the one real engine addition) |

**Constraints.** The transition is soft: a route goes only once its Studio
equivalent exists. A redirect from a route effect must check `isWithinRoute` first
— a mounted tool still observes the hash after it has changed to another tool's,
and redirecting then makes the switcher do nothing. Scopes and Cull are retired and
not to be re-proposed. Retiring is removing a registry entry, never editing the
router.

**Deliverables.** A brief (`docs/studio-phase-4.md`) holding that table with a
commit per row · per row: the panel or element type, the redirect, the registry
removal, and the README section moved under Studio · update the phase line in
`studio.md` as each route goes.

### 11 — Time Machine: a numeral that winds back

**What.** A new entrance kind, `count`, on the engine's animation model: the badge's
numeral eases from a real starting value (days elapsed, or the trip's total) down to
the day it tells, then the rest of the badge settles around it.

**Why.** `roadtrip.md` lists Time Machine as wanted and explicitly last ("after the
rest works").

**Constraints.** Never a fabricated number: it starts at a value the trip really
holds and ends at the real day. A still has no clock, so the PNG deck draws the
settled end value (`settleForStill`). The reference day is an input, so the start
value is right on the day the post goes out, not the day it was composed. The panel
shows the line it would really draw, or the reason it cannot.

**Deliverables.** `animation.ts` gains the kind with `from` and easing;
`draw-overlays.ts` formats the interpolated value through the element's own
template; tests on the integer path and on the settled still · the option in the
piece's animation panel, showing the real start value · nothing new on the bridge
(the animation is already an element field, so the Studio scene carries it).

### 12 — Winnow entry points into Atelier

**What.** Three verbs on Winnow, each landing on an Atelier route:

| Winnow surface | Verb | Atelier route |
| --- | --- | --- |
| an asset | "Open in Studio" | `#/studio/new?source=<host>&asset=<id>` — **to build** |
| a calendar day | "Tell this day" | `#/roadtrip/<trip>/<day>` — exists |
| a timeline leg | "Make a Road Trip from this leg" | `#/roadtrip/new?source=<host>&chapters=<id>` — built, stub-verified |

**Why.** `docs/winnow-bridge.md` §10 and `docs/winnow-timeline.md` §11 both leave
this open, and `MEMORY.md` records the reason: the maintainer wants to think about
the entry points properly rather than bolt a link on. So this is a proposal to react
to, not a plan to execute.

**Constraints.** A link names a **host the shell resolves**, never a URL it fetches,
and the person confirms on `#/connect`. Guards up front: a viewer role, a foreign
clip, no trip covering that date. Two localhosts are same-site, so the pair can be
exercised locally (recipe in `testing.md`) — the deployed pair is not required.

**Deliverables.** Extend `winnow-bridge.md` §10 with the three verbs and their
guards · the `#/studio/new?…` route on Atelier · three menu entries on Winnow,
handed over as a patch the way P2 was.

---

## Deliberately not proposed

Each of these was considered and left off, with the reason already in memory. Do
not re-propose them without a new decision from the maintainer.

| Idea | Why it is off the list |
| --- | --- |
| Real HDR (HLG/PQ) export | Ruled out 2026-08-21; only the notice (#03) is open |
| SD-card / DCIM import | Abandoned — it fights the folder-first workflow |
| The 8-bit LUT fallback clamp | Dead code on the maintainer's machine; the float path is always taken |
| Multi-clip timeline in a project | One clip per project; a future multi-clip is a *list of compositions*, not a rewrite |
| A byte cache for remote media | Offered and declined — the ref already says where the bytes live |
| Per-post badge style | Rejected — the badge's constancy is the whole sharing strategy |
| Self-hosting the Google Fonts | A product statement, the maintainer's call; needs a decision, not a design |
| Foreign-instance token auth | `winnow-bridge.md` §3.6: "when a foreign instance appears". None has |

---

## Working rules that apply to every entry above

One commit per feature (CLAUDE.md rule 1). `npm run typecheck`, `npm run lint`,
`npm test` and `npm run build` green before it is called done. The README updated
in the same commit whenever the feature is user-visible, and the memory entry
written in the same commit (rule 2) — including deleting the open item this
roadmap says it closes.
