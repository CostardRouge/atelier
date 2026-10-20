# Changelog

What each release of Atelier brings to the person using it. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); `.github/workflows/release.yml` turns each section into a
tag and a GitHub Release once it reaches `main` (COMMON-PROJECT-SPEC C13 in `second-brain`). Written in English, like
the code. Codenames are pigments, in alphabetical order. Versions 0.1.0 to 0.12.0 were given after the fact to the
history's turning points. The agent bridge keeps its own number (v1, v2…), apart from this one.

## [Unreleased]

### Added

- Develop: drag pictures along the roll or the contact sheet to reorder them (⌥←/→ moves the open one), and sort the
  roll by name, by date, or reversed.
- Develop: a History tab listing each picture's steps, with named snapshots; a click goes back to one, and ⌘Z undoes it.
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

- Develop: the gallery lists the rolls kept on a Winnow by a small summary, so it opens without downloading every roll;
  a roll is fetched when you open it.

### Fixed

- Develop: a roll kept on a Winnow no longer stops saving once it passes the instance's 1 MB document cap. The saved
  copy sheds the finest steps of the making-of histories to fit; this device keeps them all.
- Trips: Virée's vehicle no longer trembles. It stays on the road through each place instead of running past it and
  back, and rounds a hairpin instead of reversing in it. Under a following camera the dashes stay on the ground, the
  place names keep their side, and the map no longer jolts.

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
