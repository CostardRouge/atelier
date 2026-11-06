# Recap — a new instrument for recaps of captures (brief, 2026-11-04)

Status: **V1 built (2026-11-04)** — canvas lab 1, validated by him:
https://claude.ai/artifact/9jwFzpczK7jSA6QteE4KzM (catalogue, six V1 templates,
the Sheets carousel, the V2/V3 templates, the editor with its inspector). The
V1 is in `src/shared/recap/` and `src/tools/recap/` (`docs/memory/recap.md`);
V2 and V3 below are open.

## What he asked (2026-11-04)

An Instagram trend (a month calendar whose days hold the day's photo, over a
looping video) turned into an Atelier instrument named **Recap**: pick a
template in a catalogue, fill it with pictures and videos from a Winnow or
from imported files, style each picture with the Develop modal, arrange the
parts on a stage (click a part → the inspector shows its settings, drag to
move), export for social networks, and keep the project in a gallery, locally
or on his Winnow. The editor follows Develop's layout: a preview, tabs beside
it for the settings and the pictures used.

## The model: a template is a recipe over five axes

A template is not code per layout; it is a recipe that sets five independent
axes, each changeable in the inspector, so a new template costs no new editor:

1. **Selection rule** — which pictures. On this day (1 year / 1 month /
   1 week / N years ago), one a day for a month, one a day for a week, one a
   month, one a week, one second a day, photo dump (best of a period), a Trips
   trip, a subject (Winnow's Describe, people, place), **a device** (EXIF
   make/model for stills, the container's metadata for clips; his own aliases —
   "Sony", "Drone" — set once, shared by every project; a file without EXIF
   gets its device by hand), a colour (OKLab, from Mosaic), an hour of the day,
   statistics read from EXIF ("Wrapped"). Rules combine (a month × the drone).
   Every cell is chosen by the rule and corrected by hand (Storytelling's wall
   rule).
2. **Layout** — month calendar, year in 12 months / heat map, week, grid and
   bento, single picture, then & now, on-this-day ladder, carousel, the
   **Sheets** (below), pile / scrapbook, film strip, timeline, mosaic, map,
   colour wheel, clock, stats card, flipbook, magazine cover.
3. **Background** — paper, gradient, texture, a blurred picture, **a looping
   video** (in/out points, a crossfade at the seam, speed, veil, its own
   Develop look) — plus an optional **looping sound bed** (crossfade at the
   seam, fades, volume, "the export's length follows the loop", cells entering
   on the beat). The sound applies to VIDEO exports only: a still or a photo
   carousel on Instagram takes its music in the app.
4. **Overlays per cell** — day number or picture number (numbering invites
   "which is your favourite? 7" comments), a word or caption, EXIF line,
   device, place, time, shots that day, a video badge, how an empty day reads
   (number only, dashed, hidden), today marked with the accent; title and
   subtitle with counted variables (`{month}`, `{count}`, `{place}`).
5. **Motion** — the title's entrance (fade, type on, letters rise, mask), the
   cells' order (in order, random, wave from a corner, columns, spiral, on the
   beat) and entrance (fade, slide, pop, drop, flip, *Develop* — white to
   image, blur-in, Cut, Flicker), living cells (a mini carousel of the day,
   Ken Burns, a clip or Live Photo in its cell), a camera tour cell by cell,
   an ending (fold into a stats card or the next month).

## Videos inside a layout

Playback is a setting: **in turn** (default: one clip plays, the others show
their poster, the playing one is ringed; cheapest to decode on a phone and the
clearest for the eye), **zoom** (the playing clip leaves its cell, plays full
frame, returns), **together, muted** (small grids only; the editor plays
proxies), **posters only** (still export). Drone clips are often HEVC: read
through the existing opt-in ffmpeg.wasm, the editor on proxies as in the
Studio.

## The Sheets: a month in a carousel

An Instagram carousel holds 20 slides at most, so 30 pictures need several per
slide. **An output is a list of pages from V1**, so this never needs a rewrite:

- **Continuous panorama** — one sheet, the slides are cuts laid over it;
  pictures may straddle a cut (it makes people swipe); a rule keeps a face off
  a cut.
- **Editorial rhythm** — density changes slide to slide (cover, one + two, a
  full page, four, a week chapter, all videos); favourites get the big places;
  a picture is dragged from one slide to another.
- Film strip and week chapters as variants; the same sheet panned by a camera
  becomes the Reel.
- **Pointing at a video**: the engine knows which slide shows each clip, so a
  cell carries `▶ 4` (it plays on slide 4, renumbered when slides move), the
  cover can say "3 videos inside — swipe" (counted, never typed), and an
  optional last slide gathers the clips. A carousel slide may itself be an MP4.

## Phasing proposed (his to confirm)

- **V1**: month calendar, on this day + its ladder, photo dump carousel, grid /
  bento, single picture, week; the looping video background and sound bed if
  the video export is in V1 (recommended: it costs little more than a blurred
  background).
- **V2**: the Sheets, year in 12 months, one second a day, Wrapped, then & now
  variants, film strip, by device.
- **V3**: map, mosaic, colour wheel, clock, magazine.
- **Recurrence**: a recap duplicates onto the next month or week (same layout,
  new pictures), as a Storytelling post starts from the previous one.

## Bricks to reuse

The Develop modal on every picture; the one Winnow picker (days, Describe,
people, place) and `MediaIntake` for local files; the gallery kept locally or
on a Winnow (as Mosaic's `.mosaic.json` and its remote kind — Recap needs its
own kind on Winnow); Storytelling's stage of objects (picking, dragging, the
inspector following the selection, undo) and the wall's entrances; the
WebCodecs export and the sound bed; Mosaic's OKLab for the colour rule. New:
the date engine (rules over capture instants) and the calendar / sheet
layouts — pure modules with their tests, per CLAUDE.md.
