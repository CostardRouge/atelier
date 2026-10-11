# Agent autonomy — what an agent can do, what it cannot yet, what to build

2026-10-11. The maintainer drove the suite from Claude Desktop and Claude Code
at once, found he could not rename a roll, and asked: scan the MCP and the
project, find what is missing and what would be useful, how an agent gains
autonomy — *«je suis même prêt à rajouter des features»*.

This file is the answer: what was BUILT that day (§1), the gaps still open, by
tool, with the funnel each would call (§2), and the features worth adding for
an agent rather than for a person (§3). It is an index like `run-sheet.md`:
the rules live in `docs/memory/agent-commands.md`.

## 1. Built on 2026-10-11

An agent loop is **find → act → check → deliver**. Before that day it could
act and deliver inside Develop, but it found nothing by itself (it had to be
told a date), checked only by looking at one picture, and could not manage a
roll (rename, remove, clone, delete).

| Step | Commands |
| --- | --- |
| Find | `winnow.status`, `winnow.calendar`, `winnow.folders`, `winnow.assets` (EXIF, GPS, verdict, stars, label, tags, burst, paired file), `winnow.sheet` (thumbnails labelled by id); `library.assets`, `library.addFromWinnow`, `library.activate`; `app.status` now names the Library, Winnow, the bridge and the open command families |
| Act | `develop.renameRoll`, `.cloneRoll`, `.deleteRoll` (exact name to confirm), `.removePictures`, `.variant`, `.opensOn`, `.border`, `.exportSettings`, `.identity`, `.deletePreset`; `develop.addFromWinnow` by ids, folder, tag or label; `library.actions` / `library.runAction` — every tool's `MediaActions` (Trips' Reel, Carousel, Photo, Locate on a day; Develop's new roll) |
| Check | `develop.measure` (histogram as numbers), `develop.contactSheet` (the whole roll on one image) |
| Deliver | `develop.export` with `["changed"]` |
| MCP | `atelier_batch` (several commands, one call, stops at the first refusal), `atelier_commands {family}`, fuller `instructions` at `initialize` |

## 2. Still missing, by tool

Difficulty: **T** calls a funnel that exists, **M** needs a seam, **H** needs
a design decision or a capability the browser withholds.

### Develop

| Gap | Funnel | |
| --- | --- | --- |
| Layers and masks: add, remove, rename, opacity, invert, linear / radial / luminance / shade geometry, per-layer develop | `handleLayers` (`RollEditor.tsx`), helpers in `shared/develop/layer.ts` | M |
| Subject mask by points, colour-range mask | `tapSubject`, the colour sample (`PictureWorkbench.tsx`) | H — needs a pixel sample or the model's answer |
| Repair: place a heal or clone patch, heal the dust the scan proposes | `handleRepair`, `healSpot` / `healAllSpots` | M |
| Which file a picture is developed from, the RAW rung, re-meter | `handleRendition`, `onBase`, `onRemeter` | M (a decode follows) |
| Base curve, camera profile, white balance in kelvin | `onBaseCurve`, `chooseProfile`, `rawWb` | M |
| Lens profile from Lensfun | `onLensProfile` | M |
| Film grain and halation | `stack.setTexture` on the look stack | T |
| The making-of video (options, export) | `TimelapseSheet`, `useTimelapseExport` (no sink yet) | T options, H export |
| Move a roll to another source, export / import a roll file | `gallery.moveTo`, `toRollFile` / `rollDocFromFile` | M |
| Device settings (Auto plan, dither, bands, Lensfun consent) | the `localPref`s of `DevelopSettingsSheet.tsx` | T, but they are the person's device choices — offer read-only first |

### Trips (nothing yet)

Register in `RoadTripTool` (trip-level: list, open, create, rename, stages) and
`PostEditor` (piece-level), writing through `handleChange` / `updatePost` so
undo and save hold. Cheapest first: list / open trips and pieces (T), a
piece's opener variant and its options, badge text, counter mode (T, through
`switchHookVariant`, `patchBadge`), slides add / remove / reorder (M: a slide's
media is a ref the Library resolves by name), the look per rung
(`writeGrade`, M), Deduce "accept all" (M: `proposeDraft` → `applyDraft`).
Export: `exportPiece` / `exportDeck` / `exportHookClip` take no target; giving
them an optional `DeliveryTarget` as Develop's `exportPictures` has lets
`bridgeSink` deliver (M).

### Studio (nothing yet)

Its editor copies the document into local state at mount and saves on an
800 ms autosave, so commands must live INSIDE `StudioEditor` and write through
its setters (elements, trims, variants, scenes). Export is H: `deliver()`
writes to its own picked folder and never went through `deliver-files.ts` —
that seam comes first.

### Sources

Connecting an instance stays the person's act (a sign-in is a cookie login,
and a remote source is trust). An agent can be told to send the person to
`#/sources?instance=…`; nothing more.

## 3. Features worth adding for an agent

Ranked by what they unlock. None changes a document's shape except where said.

1. **A review loop on a VARIANT.** An agent's edit goes onto a `fresh` or
   `clone` variant, never the picture, and a contact sheet of
   original ↔ variant pairs is what the person reviews; *keep* swaps them,
   *drop* deletes the variant. Built from `develop.variant` and
   `develop.removePictures` today by convention; a `proposal` flag on the
   variant (one optional field on `RollPicture`) would let the band show it.
2. **A side-by-side snapshot**: `develop.snapshot {compare: true}` — as shot
   left, as delivered right, one image. Halves the round trips of every
   "is it better?" and is what a person would look at too. No document change.
3. **Learning from his own develops**: `develop.examples` — the N pictures of
   his rolls nearest to this one (same body, same light — from the `shots`
   store's stats, B1 of `auto-develop.md`) with their records, so an agent
   edits in HIS taste rather than its own. Read only, never leaves the device.
4. **Trips end to end**: the §2 commands plus a sink for its exports — the
   piece is the suite's finished product, and an agent that can build a day's
   reel from Winnow's picks is the case the whole bridge exists for.
5. **Progress for long runs**: an export of a roll can outlast an MCP call's
   patience. `app.tasks` (the `shared/tasks/` registry: label, progress,
   cancel) lets an agent start, poll and cancel instead of waiting blind.
6. **Writing culling back to Winnow** — deliberately NOT here: culling is
   Winnow's, and Winnow serves its own MCP (`winnow.*` there writes
   verdicts and stars). An agent holding both servers does both.
