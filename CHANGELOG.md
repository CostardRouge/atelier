# Changelog

What each release of Atelier brings to the person using it. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); `.github/workflows/release.yml` turns each section into a
tag and a GitHub Release once it reaches `main` (COMMON-PROJECT-SPEC C13 in `second-brain`). Written in English, like
the code. Codenames are pigments, in alphabetical order. Versions 0.1.0 to 0.12.0 were given after the fact to the
history's turning points. The agent bridge keeps its own number (v1, v2…), apart from this one.

## [Unreleased]

### Added

- Develop: Delete or Backspace takes the open picture, or every selected one, off the roll — on a computer, and on an
  iPad or phone with a keyboard. A card (a sheet from the bottom on a touch screen) shows what leaves and asks;
  Delete or Enter again removes, Escape keeps, and Ctrl/⌘+Z brings them back.

### Changed

- Develop: moving to another picture leaves the inspector where it was — the same section in view, and the colour
  mixer and the curve on the channel last used — so the same setting is under your hand on the next picture.
- Develop: presets are a list of rows — click one to apply it, read what it does under its name, and see which one the
  open picture wears. Its ⋯ updates it with the open picture, renames, clones or removes it, and a removal can be undone
  for a few seconds. The same list in the Develop sheets of Trips and the Studio.
- Develop on a computer: the settings button is now the rightmost one of the header, after Add.

- Develop on a computer: the zoom level above the picture is plain text with its ▾, like the file it is developed
  from, instead of a box taller than the buttons beside it; a click opens the same zoom menu.

### Fixed

- Develop: a picture just added from Winnow, still showing the instance's thumbnail, can be dragged to another place
  on the roll like any other.
- Develop: dragging pictures in the band pulled up into a grid, or standing beside the picture, now slides the band at
  its edges, so a picture can be carried past the rows on screen, as it already could in the single row.
- The Winnow picker: an unfolded burst shows its frames whole, focus ring included, instead of cut at the top and
  bottom.

## [1.3.0] - 2026-10-22 — Viridian

### Added

- An `llms.txt` at the site's root describes the suite and links every tool, the agent guide and the legal
  notice, so an AI assistant asked about Atelier finds what it is and where each tool lives.

## [1.2.0] - 2026-10-21 — Ultramarine

### Changed

- Develop on a phone: the picture sits on black from edge to edge, under the Dynamic Island too, with no margin or
  rounded card around it, so a photograph is judged against the most contrast the screen has.
- Develop on a phone: the band of pictures now lies on the bottom bar and the editing buttons sit on the band, so no
  strip of picture is lost between them; the header, the band and the zoom button have squarer corners that match the
  buttons they hold.
- Develop on a phone: the band's header is a ruler of the roll, one mark per picture with the open one in red; drag a
  finger along it to travel the roll and lift to open the picture under it. The filter, Select and the contact sheet
  are icons beside it, and the filter in use is named next to the count. A thin frame on the ruler shows which
  pictures the band has on screen.
- Develop: when the open picture leaves the band's view, the band brings it back to the middle instead of the edge,
  so a jump lands with the pictures on both sides of it; stepping between pictures in view leaves the band still.

## [1.1.0] - 2026-10-21 — Tyrian

### Added

- Trips: a ＋ on every Library picture (local or from Winnow) adds it as a new slide of the open piece and keeps the
  Library open, so a day can be gone through picture by picture; the ＋ becomes the slide's number, which takes it
  back on a second press. On a phone the Library's sheet shows the piece growing at its head.
- Trips: a picture looked at large offers **Add as slide N** and **Add and next**, and the `A` key adds it, so a day can
  be paged through and kept one picture at a time.
- Trips: drag a Library picture into a gap of the band under the stage to insert it there as a new slide.
- Trips: **Select** in the Library ticks several pictures, each showing the slide number it will become, and adds them
  in one step — in tick or capture order, at the end or after the open slide, or as one collage of 2 to 9.
- Trips: **Suggest** ticks a few pictures of the day from Winnow's picks, stars and bursts, spread over the day, each
  with the reason it was chosen; nothing is added until you press the verb.
- Trips: the band's `+` opens the **Audition** — the day's pictures one at a time, each drawn cropped to the piece's
  frame and through its look, kept with Add (A, or a swipe up) or passed with Skip, the piece growing at the foot.
- Develop: press and hold the picture still to see it as shot, until you lift — on a phone, a tablet or with a mouse.
  A press that moves is still a swipe to the next picture, and a quick tap still hides the controls. On a touch
  screen the "hold for before" button is gone; a computer keeps it, and the \\ key.
- Develop: drag pictures along the roll or the contact sheet to reorder them (⌥←/→ moves the open one), and sort the
  roll by name, by date, or reversed.
- Develop: each picture's history — its steps and named snapshots — opens from a glyph beside undo and redo (no extra
  tab); a click goes back to one, and ⌘Z undoes it. Undo can step back the whole roll (the default) or only the open
  photo, a choice kept on the device; ⌥⌘Z always steps the open photo, even after a reload, through its saved
  history. A snapshot can be taken of every picture at
  once and brought back in one step.
- Trips and the Studio take a Develop picture's whole edit — its develop, its look (Trips) and its perspective, lens,
  detail, repair, layers and vignette — from a **From Develop** row, and offer an update when it changes in Develop.
- Visits are counted lightly with the author's own Umami, cookie-free: the home page and which tool was opened, never
  a document or a file; a browser that says no (Do Not Track, Global Privacy Control) is never counted.
- A link to Atelier unfurls with its own card in a chat, a feed or a search result, and the site tells crawlers its
  address: a canonical address, a sitemap and a `robots.txt` that allows everyone.
- A legal notice, from the home page's footer: who publishes and hosts Atelier, what stays on your device, which
  requests may leave it and when, how visits are counted — with a switch to stop counting them in this browser — and
  the licence.

### Changed

- Trips: the band's `+` no longer copies the open picture into a new slide; **Duplicate this slide** in ⋯ copies the
  whole slide instead.

- Every slider's orange value line is drawn whole again; it only opens where it would run through the setting's
  name, its reset arrow or its value.
- The home page on a phone opens on the same one-line header as every other screen: the wordmark and a ⋯ with the
  editors, the sources, the theme and GitHub.
- Trips' gallery on a phone drops the masthead too: one header line (the way back to every tool, Trips and its count
  of trips, a ⋯ with New trip, Import and the rest of Atelier).
- The Studio's gallery on a phone drops the masthead too: one header line (the way back to every tool, Studio and its
  count of projects, a ⋯ with New project, Import and the rest of Atelier).
- Develop's gallery on a phone drops the masthead too: one header line (the way back to every tool, Develop and its
  count of rolls, a ⋯ with New roll, Import and the rest of Atelier).
- Trips' overview on a phone drops the masthead too: one header line holds the trip's name over its figures and the jump
  to its longest silence, undo/redo, and a ⋯ with the views, Trip settings and the rest of Atelier. The calendar starts
  a line higher.
- The Studio on a phone gives a clip the screen, as Develop does: no masthead, one header line (back, the project over
  the clip, undo/redo, the save dot, ⋯ with project settings and the rest of Atelier), and the header, the transport and
  the bottom bar float over the stage. A tap on the frame around the picture hides them.
- Trips on a phone gives a piece the screen, as Develop does: no masthead, one header line (back, the piece over its
  day, undo/redo, Export as its glyph, ⋯ with Trip settings and the rest of Atelier), and the header, the band and the
  bottom bar float over the frame's margins. A tap on the paper around the frame hides them; with the Picture or Look
  drawer up they keep their rows.
- Develop: the Auto row no longer wraps onto two or three lines — it is one bar, **Auto** with the names of the
  verbs still on beside it, and a ▾ that opens Tone, Colour, Bands, My own and Pick grey, each a switch on its own line.
- Develop on a phone gives the photograph the screen: no masthead, one header line (back, the roll over the file,
  undo, redo, history, ⋯), and while you browse the header, the band, the verbs and the bottom bar float over the
  picture in frosted paper. A tap on the picture hides them all and another brings them back. With a panel open the
  verbs sit in the panel's head instead of taking a row of their own. The masthead's links (other tools, sources,
  theme, GitHub) and Develop's settings are in the ⋯.
- Develop: the second ⚙ beside A/B is gone — *Apply or reset sections…* is now the last item of the ▾ beside Paste,
  under what ⌘V carries, so the only ⚙ left is Develop's own settings. On a phone the file's name keeps its words and
  its quality chip gives way first.
- Develop: the zoom percentage opens a tidier panel — zoom out, Fit, 1:1 and zoom in, then smooth or pixel-exact drawing past 100 %, as
  icons with the current choice named, a separator, and *Crop to this view* with its shortcut.
- Develop: the gallery lists the rolls kept on a Winnow by a small summary, so it opens without downloading every roll;
  a roll is fetched when you open it.

### Fixed

- On a phone, the Studio's inspector panels no longer slide sideways and cut their left edge after the Develop
  sheet closes.
- On a phone, the Studio's Develop sheet opens over the Grade panel instead of under it.
- On a phone, the Develop sheet's footer gives its message a line of its own above Cancel and Done instead of
  squeezing it into a column one word wide.
- Escape in a menu opened inside a sheet (the Develop sheet's Auto verbs, its file list) closes the menu only; it
  no longer cancels the sheet and its changes with it.
- Winnow thumbnails on a phone no longer go missing at random, in the picker and the Library alike: a tile asks for
  its picture itself when it comes near the screen, treats a request the network dropped as a failure after
  twelve seconds, retries more patiently (a second, three, eight), and one that gave up tries again on a tap, when
  the device comes back online, or when it scrolls back into view.
- Trips: Cancel stops an export at once, whatever the slide in hand was waiting on (a frame, a map tile, the encoder),
  instead of hanging at "Cancelling…"; a slide that stops answering for two minutes is given up and named in the
  closing note while the run moves on; and a second export cannot start over a running one.

- Develop: a roll kept on a Winnow no longer stops saving once it passes the instance's 1 MB document cap. The saved
  copy sheds the finest steps of the making-of histories to fit; this device keeps them all.
- Trips: Virée's vehicle no longer trembles. It stays on the road through each place instead of running past it and
  back, and rounds a hairpin instead of reversing in it. Under a following camera the dashes stay on the ground, the
  place names keep their side, and the map no longer jolts.
- A `.cube` with a damaged row is refused instead of drawing black where that row lands, and a `.cube` written with
  explicit `+` signs is read. Sizes just under a unit read `1.0 MB` rather than `1000 KB`, and a playhead at 0.57 s
  reads `0:00.57`.
- Sources: an instance whose capabilities lack a section no longer breaks the Sources screen, a connection forgotten
  while it was being checked stays forgotten, and checking two instances no longer swaps which one the Library uses.
- Winnow: a clip whose flight log is unreachable comes in without it instead of stopping the whole fetch; a RAW whose
  first head read failed is read again rather than treated as carrying no render for the rest of the visit.
- Develop: an export into a folder whose permission lapsed says so once, instead of reporting 999 files of the same
  name for every picture.
- Trips, Studio and Develop documents kept on a Winnow: a tab closed while saving no longer leaves the document stuck
  on "saving…" for good; an edit made while the instance's copy arrives on opening is kept and offered as a conflict
  instead of vanishing; an edit made during a long save is sent after it; saving resumes when the network comes back;
  and a late save of the previous document no longer marks the open one as changed.
- Develop: moving a roll to another source (Keep on…) keeps its thumbnails, working previews and export marks instead
  of losing them all. Matching exposure onto an untouched picture no longer exports it black.
- Develop: a 16-bit PNG or a resized JPEG of a big picture drawn in bands is no longer smeared.
- Phone sheets in Trips stay at the height you dragged them to when you tap inside them.
- A cancelled H.264 transcode that is retried can be cancelled again; a failed HEIF decoder load no longer keeps its
  memory for the rest of the visit.
- Faster sliders: a develop step no longer re-bakes a look held under 100 % or re-uploads it to the GPU, colour
  grading wheels bake quicker, and downloads and video exports no longer redraw every progress bar hundreds of times a
  second. A RAW exported on a phone is decoded at half size where the whole decode gave no more pixels.
- Studio: a grabbed frame carries the look's grain and halation, as the clip's export does.
- Winnow: a picture whose capture time carries its zone shows and exports the hour where it was taken, not UTC.
- The Winnow picker: in a span of days, filtering by device or type no longer unticks everything.
- Develop: moving the preset book to a Winnow is no longer undone by another open tab, and a capped still export
  sharpens and denoises at the same strength as the stage.

## [1.0.0] - 2026-10-17 — Sepia

The first numbered release: Atelier as it is deployed today.

### Added

- Develop is graded at half size while a slider moves, and whole again once the hand lets go.
- Flight Atlas: an intro before the flights and an outro after them, overlay pieces dragged on the stage, a size for
  every element, a gallery of atlases kept on this device, and an atlas's logs fetched back from Winnow.
- One tab edits a document at a time; another tab shows it read only, with **Edit here**.
- A trip older than the water rule is asked once whether it sails.
- The home page shows the version.

## [0.12.0] - 2026-10-14 — Prussian
<!-- commit: 842fa489647cf8a5e7c073448aa75f9ed336588e -->

### Added

- One Trip settings sheet everywhere, a List view of the trip, the vehicle steered along the road, and a choice of how
  it drives it (the ribbon by default).
- An agent can drive the suite through commands and an MCP bridge: Develop end to end, finding media, Trips, curating
  and batch developing.
- Flight Atlas (experimental): every drone flight on one map, animated; flights and their logs straight from Winnow.
- *My own*: a model of your own editing style, learned on your machine, offered among Develop's Auto verbs.
- The openers' inspector as numbered chapters, and the opener picker as a grid of tiles.

### Changed

- Every slider is one bar across its row, and every small target is grabbed on 44 px under a finger.
- A slide's length is made of parts with an owner: the opener at a pace then a hold, or fixed seconds.

## [0.11.0] - 2026-10-09 — Ochre
<!-- commit: d85ef6f9c774b0e611f940471ff224b80f559814 -->

### Added

- Develop: a settings sheet for the device, everything that can be automatic in one Auto, a swipe to the next picture,
  base tone curves and camera colour profiles for a RAW, and a 16-bit PNG target.
- Map openers: finer OpenStreetMap tiles along the road, a camera that follows, stops that learn their state and can
  be dragged, and grouped nearby places.
- Virée: the trip recap with its counters and summary card, a Renault Trafic and a Zoé, and a fleet of vehicles that
  changes along the road, by boat or ferry on water.
- Vitrine, an opener that shows the vehicle on its own in a place.
- A trip's road from its GPS track or a GPX, a Polarsteps export read in Deduce, and trips, projects, rolls and
  presets cloned from their cards.

### Changed

- Exports keep more of the picture: dithered output, the develop applied per pixel, and the colour a JPEG keeps said
  at its quality.

### Fixed

- Phone layouts no longer move under a finger or leave a ghost band.

## [0.10.0] - 2026-10-03 — Naples
<!-- commit: b3a2080e63e02a25d400cdd2fc4fd1dbfe978e9f -->

### Added

- Develop: clips in a roll, played and switched to the rush; a making-of video replaying a picture's edit steps; the
  roll as a band, a column or a contact sheet; one file choice for the whole roll; masks that can be taken back and
  refined; ⌘C / ⌘V for a whole picture.
- Trips: any slide may hold an opener, a badge, shades and text; a Map view of the overview; places that keep their
  state and codes; a Kadjar and four boats.
- One Winnow picker for the whole suite, and a look picker laid out as a workbench on a desktop.
- The Studio switches a media between its proxy and the capture's files, and takes Trips' shades.

### Changed

- Exports are followed picture by picture, and a press answers under a finger in Develop, Trips and the Studio.

## [0.9.0] - 2026-09-25 — Madder
<!-- commit: 387cca9bc75564d86bba869fcbd0dfb1c28ba7f4 -->

### Added

- Every tool and both lightboxes switch between a capture's files.
- Progress for long work, with a cancel, in one pill.
- Develop: the colour mixer, texture, clarity and dehaze, colour grading, black and white, combined masks, kelvin on a
  RAW, export targets and Lensfun lens profiles.
- Trips: the overview as a calendar of months that works on a phone, a picture's pan and zoom edited as cards, shades
  with a falloff, and the camera credited on the badge.
- A look's strength chosen as it is picked.

### Changed

- The same zoom gestures everywhere.

## [0.8.0] - 2026-09-21 — Lapis
<!-- commit: 4cab4feed11d8d15dde6b30235145d9c89890467 -->

### Added

- The photo editor: a float render core, RAW develop, keystone and lens corrections, adjustment layers and masks,
  subject selection, denoise, sharpen, heal and clone, a loupe, and Ultra HDR JPEG.
- Film simulation, with grain and halation.
- Purchased LUT packs in a private vault, kept on a Winnow.
- A classic crop with borders in Develop, and an export named after the original.
- Deduce a trip's itinerary from where the pictures were, and locate one picture.
- A capture's files under one chip in Develop: the proxy, what the camera delivered and the sensor.

## [0.7.0] - 2026-09-16 — Kermes
<!-- commit: dac5c1800770769974694ac93d55a8fc73f0ea07 -->

### Added

- Trips' openers: Défilé, the Itinerary and Virée, a cartoon Prado driving the trip's map, dressed in a garage.
- Shades over a slide, and collage slides with staggered motion.
- A develop sheet in Trips and the Studio, and Develop, the third editor, with its rolls.
- Undo and redo in the three editors.

## [0.6.0] - 2026-09-12 — Indigo
<!-- commit: 9bb1b164f8e13147fa65ebb5a7034f82db416154 -->

### Added

- Trips and Studio projects kept on a Winnow, a trip seeded from Winnow's timeline, and a piece offered the day's
  pictures from it.
- Trips: the stages on a ruler under the calendar, a trip cover, and a piece editor in four tabs.
- One screen to connect and manage Winnow instances, and a media preview that zooms.
- A shell that works on a phone, and a home-screen icon set.

## [0.5.0] - 2026-09-03 — Gamboge
<!-- commit: e3187e91025a8acbcac765cff5fc976c1e868e11 -->

### Added

- Road Trip: track a journey by day and tell it as decks of slides, with a day badge.
- The Studio takes photos and closes on an outro card.
- Connect a Winnow: browse its media by day or folder, edit on the proxy and deliver from the capture.

## [0.4.0] - 2026-08-22 — Emerald
<!-- commit: 15975d62c22339aa92a76583e41975a9d96b4983 -->

### Added

- The Studio, one editor for grade and overlays: a grade stack, an overlay palette, instruments, an intro, a trim and
  export variants at their own frame rate.
- Space plays and pauses in every tool.

### Removed

- Scopes and Cull, folded into the shared core.

## [0.3.0] - 2026-06-20 — Cobalt
<!-- commit: d9542fc35bc56b5fe7ec15bab0dc2741f2090633 -->

### Added

- Five capture tools: Photo EXIF, Compare A/B, Flight Map, Scopes and Composer, with an MP4 export of the composition.
- An in-browser HEVC to H.264 transcode for clips the browser cannot decode.
- Drone speed and heading derived from the GPS telemetry.

## [0.2.0] - 2026-06-06 — Bistre
<!-- commit: 8e67ddd3d88f576bc91800462d5e82fc8cca2892 -->

### Added

- LUT Studio: real-time colour grading of a video with 3D LUTs.
- Telemetry Overlay: burn the drone's telemetry into an MP4.
- A Triage / Export tool to rate, flag and deliver a shoot.
- A home page and a tool switcher.

## [0.1.0] - 2026-05-31 — Alizarin
<!-- commit: 156d4c3e20fb5ef4a05ac693b47709a78a52e91a -->

### Added

- A DJI flight telemetry viewer: a folder of clips paired with their `.srt` logs, in the Studio Papier look.
