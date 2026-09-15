# Develop — the workbench, its hosts, and the Develop tool

Read when you touch `src/shared/develop/`, the Develop modal in Trips or the
Studio, or the Develop tool. The engine (the develop stage in the cube) is in
`media-pipeline.md`; each host's storage rules are in `roadtrip.md` and
`studio.md`; the tool's plan is `docs/develop-tool.md`; delivering from an
original is `docs/develop-originals.md`.

## The Develop tool is the third editor, over a roll (2026-09-15)

**Decision (maintainer).** A third official tool beside the Studio and Trips,
"with about the same interface as the modal". Four choices, all his: it opens
a **roll** (a document of pictures, each with its develop and crop, plus the
roll's look and export — not a Library view, which would lose its numbers on
reload, and not a hash-keyed catalogue, which would break never-inherit);
**presets are one personal book** shared by the tool and both modals, synced
like a document, trips' lists merged in once and never written again; **v1**
has crop · straighten · flip, JPEG export + send home, filmstrip + batch, a
histogram; and **the shared foundations were built first**, the per-tool
document plumbing left for the roll's own phase (the third copy is where it
gets extracted). It reverses `photo-develop.md` §7.5 ("no ninth tool") and is
NOT the photo studio `studio.md` rejected in August. Plan, seams and phases:
`docs/develop-tool.md`.

## The workbench is shared blocks, and the modal is one layout of them (2026-09-15)

**Decision.** The maintainer wants a third official tool for developing
photographs "with the same interface as the modal", and asked that what the
two share be built once, before the tool exists. So `DevelopSheet.tsx` is now
a dialog that LAYS OUT blocks, and every block is usable by a full-screen
host:

- `use-develop-draft.ts` — `useDevelopDraft(value, stack)`: the numbers, riding
  the host's stack (`stack.setDevelop`) while mounted and put back on unmount;
  `result()` is null when as shot. `useTold()` is the fleeting status line.
- `use-develop-picture.ts` — `useDevelopPicture({file, videoTimeSeconds, cube})`:
  decode within the stage budget, ONE held grader, the paint with the split,
  `usePictureZoom`, and the wipe gesture as `handlers`. State only.
- `DevelopViewport.tsx` — draws that state; the HOST sizes it (`className`) and
  says what an empty frame means (`emptyText`). `DevelopCaption` is the line
  under it.
- `DevelopSliders.tsx` — Light · Tone · Colour and `DevelopSlider`.
- `DevelopSections.tsx` — `DevelopClipboardActions`, `DevelopPresetsSection`
  (owns its naming field, reports it through `onNaming` so Enter belongs to the
  field), `DevelopApplySection`, `DevelopLookSection`. Each reports what it did
  through `onTold`.
- `develop-host.ts` — the host contracts `DevelopPresets` (with `keptOn`, said
  in the ⓘ) and `DevelopApplyVerb`.

**Why**: the sheet held Trips' wording ("tick one in the Library", "kept on the
trip") and a tool would otherwise have copied 700 lines including the grader
lifetime and gesture traps. **How to apply**: a change to how a picture is
developed goes into a block, never into `DevelopSheet.tsx`; host words come in
as props; a host that shows another picture under a mounted workbench remounts
the draft with a `key` per picture (`value` is read once — the never-inherit
rule). Verified in the Browser pane on Trips after the split: eleven sliders,
the wipe, the zoom pill, Save current as… with Enter kept by the field, a
preset applied after As shot, Copy enabling Paste, Done writing `+0.7 EV` to
the Picture tab row.

## The inspector row is one component too (2026-09-15)

`DevelopSection.tsx` is the settled row every host draws (sentence · `↺` ·
`Develop…`); Trips' Picture tab and the Studio's Grade tab carried the same
markup twice and differed only in the id, the ⓘ and what opening does. A third
host (the tool's inspector, a lightbox verb) draws it rather than a copy.

## Writers that do not belong to a tool (2026-09-15)

The list rules for presets (a taken name replaced in place keeping id and
position; a blank name or an as-shot develop saves nothing and hands back the
SAME list) are `develop-presets.ts`'s `savePresetIn` / `removePresetFrom`;
Trips' `savePreset` / `removePreset` are wrappers over a trip. The personal
preset list the maintainer chose for all three hosts (`docs/develop-tool.md`)
is the same shape and must use them. The Studio's per-media map goes through
ONE writer, `media-develop.ts`'s `writeDevelop` (Done and the batch verb had
each a copy).

## The histogram is a strip of what is DELIVERED (2026-09-15, D1)

`histogram.ts` (pure, tested) + `DevelopHistogram.tsx`, read by
`useDevelopPicture` and drawn at the top of the column. Rules: it measures the
GRADED picture whole — never the split or "hold for before", which are ways of
looking, not what goes out — so it is keyed on the source and the cube, not the
wipe. It reads a 160 px copy (`HISTOGRAM_SAMPLE_EDGE`): the shape does not
change with pixel count and a stage-sized read-back would cost tens of MB per
slider step. Luma is Rec.709 on the ENCODED values (what a screen shows); a
pixel is clipped when ANY channel is at 254+, crushed only when ALL are at 1-;
the shape is scaled on the inner bins so a blown sky does not flatten the rest
— the end bins are capped and the marks say the share in words. **Trap**: the
read is scheduled on `requestAnimationFrame` so a slider paints first, but a
page that is not compositing (the desktop app's hidden Browser pane) never
fires rAF even while `visibilityState` says visible — a 120 ms `setTimeout`
races it, whichever comes first. The bars are a fixed light over `bg-frame`,
never a theme token: `paper` is dark in the darkroom. Verified in the Browser
pane on a PNG with a known 6.25 % white block: `whites 6.3 %` at as shot, 28 %
at +1.5 EV (over the hook's stored +0.7), none and `blacks 2.5 %` at −2 EV.

## The roll is read ONE way, wherever it comes from (2026-09-15, D3)

`roll-types.ts` (`RollDoc` v1), `roll-store.ts`, `roll-remote.ts`, `roll-file.ts`
— the trip's twins, built before any screen. Rules a later phase must keep:
(1) **one reader** — the store, the instance and the `.roll.json` all go
through `readRollDoc`, which drops a picture whose ref names nothing, keeps
the first of two entries with one id, and stores an as-shot develop, an
untouched framing and an empty look as `null` (one spelling each, so
"developed" and "has a look" are simple tests). (2) **a picture is added
once** — `addPictures` dedupes by source id → hash → name and size, so adding a
day again never duplicates what was already developed. (3) **the database is
`atelier-develop` v1 with FOUR stores from the start** (`rolls`, `thumbs` keyed
by PICTURE id, `sync`, `presets` for D4's book) so no later phase needs an
upgrade transaction; thumbnails are pruned by whoever removes a picture or
deletes a roll. (4) **a kind is asked for** — `remoteFor(sourceId, kind)` and
`rollRemoteFor` return null for an instance whose `documents.kinds` does not
name `roll` (`bucketHolds`; a bucket with no list is read as trip + project
only), so an instance without Winnow's `43f01e9` hides rolls instead of a 400
on the first push. The trip and project drivers still call `remoteFor(id)`
without a kind — unchanged, since every bucket keeps them. (5) the file is a
BACKUP (fresh id, importing source, refs and custom `.cube` text travel), the
trip file's rule, and a newer version is refused. Verified: 19 specs, and the
store round-tripped in the Browser pane (put/get/list, a thumbnail written and
pruned, a sync record, the four stores present). **Winnow's side was committed
without its typecheck**: that checkout has no `node_modules`.
