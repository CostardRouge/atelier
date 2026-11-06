# Changelog

What each release of Atelier brings to the person using it. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); `.github/workflows/release.yml` turns each section into a
tag and a GitHub Release once it reaches `main` (COMMON-PROJECT-SPEC C13 in `second-brain`). Written in English, like
the code. Codenames are pigments, in alphabetical order, starting again at A after Z with a pigment not used yet.
Versions 0.1.0 to 0.12.0 were given after the fact to the history's turning points. The agent bridge keeps its own number (v1, v2…), apart from this one.

## [Unreleased]

### Added

- Recap, a new editor that turns your pictures into recaps to post: a month as a calendar of its days, the same day
  a year, a month and a week ago, a week, a grid, a single picture or a photo dump over a carousel. It fills itself
  from your Winnow's days (or your files), lets you pin, swap or empty any day, filter by device, develop each picture
  with Develop's sheet under one look, set it over a looping video with a sound, and exports a Reel, PNGs or a whole
  carousel whose clips get slides of their own. Each of its texts has its own face, size, weight, colour, outline,
  shadow and glow, or one of the suite's title styles (Or ciné, Rouge plein cadre…); the video's length can be set;
  the shadow under its pictures is a setting. The background and every picture can be framed — moved and zoomed in
  the inspector, or straight on the stage with a double-click, a drag and the wheel or a pinch — and straightened by
  a few degrees without an empty corner; a picture keeps its framing wherever it goes. The background's clip is chosen from a drawer of thumbnails — the recap's own days
  first, Live Photos marked and offered as short loops — and its loop is a band on a filmstrip, set by its two
  handles or dragged whole. A cell's words never pass its edge: you choose which camera settings it says (for the
  whole recap or one picture) and whether they stand on one line, stacked, or packed to fit. The video export has
  its quality (Standard, High, Maximum), 30 or 60 frames a second, two passes where the browser allows it, and your
  originals instead of the light copies — every clip, the background first, and every picture that would otherwise be
  enlarged — and every picture and frame scaled with the browser's best filter, with the file's size said ahead and a progress bar that
  tells what it is doing, how fast and how long is left. *Keep as my style* makes a recap's look the starting point
  of every new recap of its template. An original your browser cannot play — an iPhone HEVC `.MOV` behind a recap —
  can be converted for the video by ffmpeg, in your browser: only the part the film shows, at the size it is shown,
  kept on the device for the next export. Every slide of a carousel sits in a strip under the stage, in its order,
  to look at and drag around; a month is followed by its highlights (or a slide per week); you leave pictures out
  and the next best comes in, a burst enters as one frame you can change, a slide's layout can be set, and the
  first slide's title can repeat on the others. A new template, The Sheets, lays a period on one long sheet cut into
  slides — in rows, a collage, a film strip or a timeline — with pictures across the cuts to make people swipe
  (never a face, one picture at most per cut), and its Reel is a camera travelling along the sheet. Each arrangement
  has its own settings (rows and a big top row; a collage's density, tilt and border; one or two film strips with
  their edge print; a timeline's spacing and marked days), and a slide can take a layout of its own — one picture
  edge to edge, a pair, or a pause with a line of yours. A day with no
  picture can be given one from your Winnow — any picture, even one from another day, marked as chosen by hand.
  Taking a picture out of a carousel no longer brings another in: ✕ removes it and the carousel holds one fewer, ⇄
  replaces it with one you choose among the next best; your selection stays as you made it until you let the rule
  choose again. The rule draws from your Winnow favourites (♥) or picks when they fill the carousel — or from your
  ♥ only, showing fewer pictures rather than others — puts a ♥ first wherever it chooses the best, and leaves out screenshots,
  bursts and look-alikes by the same conditions as Storytelling's wall. Drag a picture onto another in the carousel's
  list, or on the stage, to swap them — or onto its edge in the list to put it before or after it. The number of
  pictures can be changed again once you have corrected the selection — at the head of the carousel's list in
  *Pictures* as well as in *Layout* — and pictures you add by hand join the carousel.
  A recap's Reel can start with an **opener**, as in Trips: a **Défilé** (its pictures flicking by, faster and faster,
  over a tape of its days, with a tick at each) or a **Badge** (one picture slowly pushed in, its day, its place and
  its camera) — then the recap; and, when a trip of Trips covers its days, **Virée** or **Itinerary** over that
  trip, from picture to picture. The Badge, Virée or Itinerary can also be the carousel's first slide.
  A new template, **Wrapped**: a year (or any period) in numbers, a slide each — your pictures counted, the busiest
  day, your camera, the place you came back to, the hour you shoot most, your best picture — then the rest in a
  grid.
  **Cuts on the beat**: a recap's sound has its beat found on your device, and the slides change, the pictures enter
  and the film ends on it.
  A new template, **One second a day**: a second of each day of a period — a clip's middle, a Live Photo's motion or
  a still slowly pushed in — with the day in a corner.
  Every template lists its places in *Pictures*, where a picture is dragged onto another to swap them; a slow drag in
  the carousel's list no longer falls through.
  Choosing a recap's period: a month shown in the calendar is the period (no need to click its days), *Take all of
  <month>* takes it in one click, and a whole month is named by its name.
  A blurred background is the best photograph of the recap's own days, or the one you choose among them — any picture
  of the pool when you force it.
  A week's seven bands move in its Reel: each day in turn opens wide (Accordion), fills the screen (Spotlight), rides
  a wave, slides past or stays bright while the others dim (Focus), each picture drifting inside its band.
- Storytelling: the before/after block shows a picture you developed — Count finds your Gallery finals of the trip's
  days and their originals on your Winnow, and the block wipes from the original to the final.
- Storytelling: a map scene can be drawn as Trips' Itinerary or as Virée's 3D drive, on the series' trip and the leg
  you choose, with its caption kept — or as the series' map, as before.
- Storytelling: your own pictures inside the blocks — each device of the gear block shows a picture it took on the
  trip, and the app's grid, a burst's frames and the folders of pictures draw the wall's pictures instead of colour
  tiles, once counted.
- Storytelling: captions are laid like the hook — a column you set, a line limit past which a long caption shrinks
  (or grows upward, as before), and the buttons of the short-video apps as an edge the words never cross, even when
  the caption is dragged.
- Storytelling: every block's own words are typed where they are drawn — select a counter's number, the gear's names,
  the folders' path, the clocks, the transfer, the names, the season's posts, the opening's title or the closing card
  and its Content section shows each of its words in a field, written into this post's script.
- Storytelling: the living wall — Look › *Motion* sets the wall's rows or columns moving: Marquee, Metro, Waterfall,
  Shuffle board, Flip board, Calm, or each lane its own mode with a click. *Smart* holds the first picture while the
  camera lands, moves a stage's band as one, slows under your voice, steps on your music's beats and ends aligned;
  *More pictures* brings in pictures from off the frame as a lane turns. For the series or one post.
- Storytelling: every export is measured on the device that makes it — how long it took against how long it plays,
  the video profile and the sound codec, the file's size, the memory at its fullest — and listed under Export with
  *Copy*.
- Storytelling: keep a series on your Winnow (Script › *Keep on …*) so your Mac and your phone open the same one:
  edits are saved there once you pause, a newer copy from another device is taken when you come back, and a change
  made on both is never overwritten — *Keep mine* or *Take theirs*. *Series kept on …* opens one in a new browser.
- Storytelling: the script's last ten versions are kept in this browser as you work — Script › *Versions on this
  device*, each with *Restore*. Loading a file or restoring a version keeps the script it replaces first, so a wrong
  file loaded is one click away from undone.
- Storytelling: *Before you export* — the Export panel checks the post first and lists what would come out wrong in
  the file: a fact not counted (drawn with its braces), the map's tiles or the wall's pictures missing from this
  device, a face not loaded, words under the buttons of TikTok, Reels or Shorts, a hook shrunk to fit its lines. Each
  line opens what fixes it.
- Storytelling: start a series with no file — *New series*, then name it under Script. Until the series has its
  Winnow, its trip and a first Count in this browser, the map of subjects lists what is missing, each step with the
  gesture that fixes it, and *Check the connection* tells you when your Winnow does not allow this app's address yet.
- Storytelling: the hook's big text and second line take your own line breaks — press Return in their field, now a
  text area. Choose how a long one is laid: Wrap (your breaks and the column's), Your breaks only (shrunk so the
  widest line fits) or One line; set how many lines Wrap may take before it shrinks, and the line spacing.
- Storytelling: *Correct the wall…* has Recap's gestures — ✕ takes a picture off and the wall holds one fewer
  (nothing comes in; the pictures after it close up), ⇄ lets you choose its replacement among the next best, nearest
  in time first, and a picture dragged onto another trades places with it, or onto its edge moves before or after it.
  Your first correction freezes the wall in your order, kept by every Count until *Let the rules choose again*.
- Winnow picker (Develop, Mosaic, Storytelling, the Library, Flight Atlas): a **Subject** section in its filters —
  choose the **people** in the frame (one, several, or all of them together), **describe** what is in the picture
  (*a dog*, *a parrot*, *sunset over the sea*: the image index your Winnow keeps lists its closest pictures across
  the whole library, whatever day is open — in English, unless your Winnow's index reads other languages)
  or look for words in the file's name and the text read in it, and pick a **place** by your Winnow's own names
  (country, region, city, point of interest). Remembered per instance, like the other filters.
- Winnow picker: a **Map** view beside Grid and Logbook — each picture a dot where it was taken; hold ⇧ and drag, or
  switch *Draw a box* on and drag with a finger, and every picture inside the box is ticked; a dot ticks on a click.
  Pictures with no position are counted beside the map. The map background stays the usual opt-in.
- Winnow picker: a description reaches **Precise** (the 200 closest) or **Broad** (everything that stays close to the
  best match, up to 3 000) — Mosaic opens on Broad to gather as many pictures as a description can find, the other
  tools on Precise, and you can switch it for a search. Going past 200 needs a Winnow that pages its search.

### Fixed

- *Transcode to H.264* — converting a clip your browser cannot play — failed before it started: ffmpeg could not be
  loaded. It loads again.
- Storytelling: two places close on the map (Parramatta and Sydney) no longer write their names over each other — a
  name moves above its dot or to its other side, and is left out only when there is no room.
- Storytelling: the wall's number says what was counted when your script names none, instead of 100 000.
- Storytelling: *Before you export* now flags a scene whose caption is still a placeholder (« ⟨ caption 2 ⟩ »), with a
  link to type it.
- Storytelling: the before/after's BEFORE label stays on the original's side while the developed picture wipes in.
- Storytelling: starting a new export clears the previous one's files, so Archive can never send a video that no
  longer matches the post.

## [1.7.0] - 2026-11-02 — Aureolin

### Added

- Mosaic, a new editor (work in progress): one picture rebuilt out of hundreds of others from your Winnow, each cell a
  photo whose colours match, then played as the screen saver that dove from picture to picture — or pulled back, revealed
  the picture cell by cell, or drifted over it — on the whole screen if you like. Choose the target from a grid of your
  pictures, its shape (16:9 to 9:16, square), and the part of it rebuilt by dragging a frame on it. A big mosaic is
  matched in lots painted as they land, spreading from the cell you clicked, with a hairline saying how far it has come;
  a Performance section sets this device's workers, lots, propagation and animations. The chain is a band of pictures
  under the stage, ten ahead and refilled as it goes: replace, remove, add or shuffle them, or let it end on your last
  pick. Zooming the stage while nothing plays frames it (an Auto-frame switch turns that off): what you see becomes the part
  rebuilt, with as many cells on it; undo and
  redo step through every edit, and a ‹ › pair in the bar walks back and forward over the targets visited. On a phone the editor takes the whole screen: one header line, the
  stage, the chain's band and the transport, and the settings as five tabs of the floating bottom bar, each a drawer
  under the stage. The animated modes are recipes of one step — a departure, a trajectory, an arrival —
  and *Mosaics*, the default, goes from mosaic to mosaic without ever showing the photo; *Wave* lands the next mosaic's
  cells on this one from the aimed cell outward, *Slideshow* cuts to a new mosaic at a steady beat, *Steer* lets a click
  on the held mosaic choose where the chain goes next; a Motion section opens every part of the step (departure,
  arrival, the reveal's direction, sharpening, aim, move, hold, cadence, drift) and a part set by hand makes the mode
  *Custom*; the camera never cuts between steps, and the Performance section measures how long a step takes to be ready. Each mosaic, the colours of its
  pictures and a small tile of each are kept in this browser; a `.mosaic.json` file carries it elsewhere. Save the mosaic as a PNG
  up to 4K, or its motion as an MP4 film of the steps you choose — the same chain Play shows, more cells for a bigger
  file or the stage's own. Keep a mosaic on your Winnow to open it from any device, its pictures' colours
  included so nothing is measured again. An agent connected through the bridge can make, fill, tune,
  play, look at and export a mosaic with the same gestures, each one undoable. The modes are one button opening a drawer of
  animated tiles in three families (Travel, Transform, Watch); Still sits beside it and Play plays the mode on the
  button. While a mode plays, the Target card shows the picture whose mosaic is on screen. On the stage a drag moves
  the view — with Auto-frame it slides the frame across the picture — and a click on a cell makes it the target at any
  zoom. Zoomed in without Auto-frame, the cells load sharper pictures from your Winnow and the tint
  fades, so a close look shows the photos themselves.
- Connect a Winnow from another site with an app token: Atelier running on your computer can now reach your Winnow on
  its server. Paste a token minted on the instance's Users › App tokens; it stays in this browser until you forget the
  source.
- Storytelling, a new editor for a series of short narrated videos: each post plays on a vertical stage with its
  captions, its map and its counters, from a script file of your own that stays in this browser. Add a voice-over, a
  music bed and sound effects from your own files (or the built-in sounds), and export the post as an MP4 with its sound, or its cover as a PNG. The ending of each
  post names the next one and shows its cover.
- Storytelling opens on a map of subjects: every subject of the series by pillar, against every channel, each crossing a
  state (idea, in progress, ready, published, not for that channel) changed with a click and saved back into your
  script.
- Storytelling can send an exported post and its cover to a connected Winnow, to archive them there.
- Storytelling: choose the trip and the Winnow a series takes its data from, under Sources. They are saved in your
  script and shared by every post of the series.
- Storytelling: with a trip chosen under Sources, the maps follow its real road from Trips and name the towns where
  each stage starts or ends.
- Storytelling: *Count* takes the exact number of photos and videos of the trip's days from your Winnow; write
  `{media.total}` (or `{media.photo}`, `{media.video}`, `{days}`) in a caption, a title or a block's setting and the post
  shows the number.
- Storytelling: the wall of the first episode shows your own pictures — one per day of the trip, from your Winnow — in
  place of coloured squares. They are kept in this browser once fetched.
- Storytelling: counting also gives each camera's media, the days with and without a position and the trip's
  kilometres, stages and places to cite in the script; the map with holes draws the days without a position on the
  road, and a season recap lists the season's posts when the script does not.
- Storytelling: leave stages of a trip out of the map and the counts, and choose which places the map names and what it
  says for each — the place, the stage, the place and its day, or nothing.
- Storytelling: choose exactly which days are counted, on a calendar of the trip where each day shows its media and
  can be left out.
- Storytelling: choose the wall's pictures yourself — hide one, or pick another picture of the same day.
- Storytelling: a post can open on a hook instead of its title — your words over the first picture, typed letter by
  letter with a key click each, then a word landing as a sticker. Edit it under Hook: its lines, how they arrive and
  leave, its timing, place and ink, its sounds (built-in or your own files), variants to test, and the post's promise.
- Storytelling: choose the series' look under Look — the wall's columns and rows, the gap between pictures, rounded
  corners, some pictures twice as big, the order the days are laid in and how close the camera ends — and the grain and
  vignette over every post. The wall can also be grouped by stage of the trip or by month, each group a band of rows
  named on its first picture.
- Storytelling: choose the wall's pictures in the same Winnow picker as Develop's *Add a day*, filtered by camera, type,
  extension, picks and stars — so screenshots and PNGs stay off the wall.
- Storytelling: choose the wall by rules under Sources — leave out rejects, screenshots, all but the best of a burst and
  look-alikes; spread the places over days, folders or weeks, the same each or more on busy ones; and prefer, in your
  order, picked pictures, stars, edits, people and sharpness. *Correct the wall…* shows what the rules chose and why:
  remove a picture and the next under the same rules takes its place, pin one so it stays whatever the rules, or swap
  it for another of its day. Your corrections are kept in the script, apart from the rules.
- Storytelling: choose what the series' maps are drawn over — the coastline shipped with Atelier, no land at all, or
  OpenStreetMap's streets and terrain, greyed, natural, sepia or night like Flight Atlas's ground, and how strongly they
  show. Set it under Charte & look › Maps or from the chip on the stage while a map is shown. The tiles are fetched only
  once this device says yes, and their credit appears on the map's frames alone, as an object you can move, size and
  set in another face.
- Storytelling: over OpenStreetMap, a map seen whole no longer shows a band at the foot of the frame — the sea carries
  on to the edge, in every tone.
- Storytelling: in the Studio a click selects the object whose letters are nearest, not the biggest one around — the
  badge's header, second line and place can be picked beside its glowing big text — and the selection's outline hugs
  the letters rather than their glow.
- Storytelling: the Studio's list folds — the series, the post, each scene and the hook's pieces — and keeps what you
  folded on this device; the scene under the playhead and the selected object's group open themselves.
- Storytelling: in the Studio's inspector, Turn is now called Rotation, and an object's text settings come before
  where it sits.
- Storytelling: an object's inspector opens on what it says — type the hook's big text and second line, a scene's
  caption or the camera right there; for a text the series computes (the badge's header, place and why now) it shows
  where it comes from and takes this post's own words over it; the HUD and the header take this post's own number;
  the map's credit says the licence fixes it.
- Storytelling: the hook's settings — its words, variants, badge, motion and sounds — open when you select the Hook
  itself, in the list or from any of its pieces, above where it sits; the Hook row under This post leads there too.
- Storytelling: choose what the map says at each point, on two lines — the place, the town it is in or near, the
  state or its code, the country, the stage, the day of the trip, the date or the kilometres so far — with a place
  written as in Trips (« Perth, WA »), which points carry their name (all, those passed, the current one, the first
  and last, none), and a line said once. Ready-made settings cover the usual ones; a stop of your own list can be
  renamed by hand. A new series says the town and its state's code.
- Storytelling: the maps follow the road as Trips drives it — smoothed into a ribbon by default — instead of the
  recorded points joined corner to corner, so a camera close on the route no longer jerks at every point. The trip's
  road settings (which points, the detail, how the line is driven) can be tuned under Sources › The map, and they are
  the trip's own: Trips' openers and the story maps change together.
- Storytelling: the map's camera can follow the route like Trips' openers do — Calm, Navigation (the map turning so
  the road runs up the frame) or Documentary, or your own view width, smoothing, look-ahead and wide shots — under
  Charte & look › Map camera. The posts already made keep their camera until you choose one.
- Storytelling: draw a map's route by the distance or by the days lived (a week in one town takes its share), pause
  it at each stop, and mark its tip with a dot or an arrow along the road — under Charte & look › Map camera.
- Storytelling: a post's hook is drawn as Trips' badge — a header (the series and the post's number), your big text
  typed or wiped in, your second line popping on its beat, then the place, why now (« il y a un an ») and the camera —
  in Trips' title styles (Or ciné by default, Pixel CRT, Rouge plein cadre, Neutral) or the series' charte, stacked,
  centred, split top and bottom or on a band. Each piece is an object of the Studio, a post can write its own, and the
  typed lines with a sticker remain one choice away.
- Storytelling: the hook's big text and second line break at words inside a column you set, and the pieces under them
  make room — a long sentence no longer runs off the frame; past three lines it shrinks (or keep it on one line with
  Shrink to fit). The Numeral sets the whole badge's size, from 4 % to 30 % of the frame's width.
- Storytelling: place the hook's badge on Trips' 3×3 anchor grid; Stack, Centre, Top and bottom and Band remain as
  starting places.
- Storytelling: in the Studio the hook's badge moves and grows as one block — drag any of its pieces, or set its Size,
  and the whole badge follows; a piece's Text size is its share of the stack, the pieces under it making room instead
  of being covered. A piece's font, colour, case and spacing now reach the badge too.
- Storytelling: shades under the hook's badge, Trips' own — up to four, each a direction, a reach, a strength and a
  colour; one that follows the badge lands on its edge or sits in its cell of the grid and moves with it.
- Storytelling: the hook's pieces arrive in a cascade, Trips' own — one entrance for all, a beat apart, in the order
  you choose (top to bottom, big first, random…) and the curve you choose; on by default, rising top to bottom. Your
  typed lines keep their own entry and key clicks unless you say otherwise.
- A new entrance, Flicker: a piece blinks on and off, then stays — shown or not, never half. With Cut (shown at once)
  it makes a raw « tac tac tac » sequence. Offered in Trips' badge pieces and cascade, the Studio's elements and
  Storytelling's hook.
- Storytelling: a post can keep its own place and shades for the hook's badge, over the series' — its picture is its
  own — under Hook › This post's badge place and shades.
- A title style can be exported as a `.badge.json` file and imported back — in Trips' Look tab, the Studio, Flight
  Atlas and Storytelling alike — and Storytelling can take a trip's own badge style.
- Storytelling: the Studio — a post opens with the list of its scenes and of the objects each draws (captions, the
  HUD, the hook, the scenes' parts), the stage, and an inspector to set the selected object: shown or hidden, its place,
  size, turn and opacity, its font, weight, size, spacing, colour, case and outline, a shadow and a delay — for every
  post of the series or this post alone. A timeline under the stage shows the scenes, the hook, the captions and the
  HUD on one clock: click a bar to select it, drag a scene's end or a caption's edges to time them in this post. Click an
  object on the stage to select it — it is outlined — and drag it to move it.
- Storytelling: the series' charte — its six colours (or a whole palette: linen, night, kraft, white paper, sea), its
  faces for titles, text, numbers and hand, and its weights — every block is drawn in it.
- Storytelling: every part of every scene is an object of its own in the Studio — the wall's number, the map's route,
  the counter's label, the HUD's progress line… — and every change in the Studio can be undone and redone (⌘Z / ⇧⌘Z).
- Storytelling: the Studio is laid out like Flight Atlas — the stage stays in place while the inspector scrolls, on a
  phone too — with Space to play and pause, and the safe areas of TikTok, Reels and Shorts (and a grid) over the
  preview, never in the export. Twelve faces
  ship with Atelier for it.
- Storytelling: H (or ⌨ beside the guides) lists every key and gesture of the Studio. A finger picks an object on a
  phone's stage, Forget asks before it drops the script, and an open script is edited in one tab at a time — another
  tab shows it read only, with *Edit here*. If the browser refuses to keep the script, the tool says so.
- Storytelling: an agent connected on Sources can read the open post, move its playhead, select an object, set its
  style for the series or the post, undo, and look at any frame.
- Storytelling: tell a series in English or French. The counted numbers, the map's days and the words the blocks write
  themselves (next episode, before / after, midnight…) follow the language chosen under Script.
- Develop: switch a setting off without losing it. Click the dot beside a slider's name, or the eye in a section's
  header (Light, Tone, Colour, White balance, Levels, Curve, the mixer, Colour grading): the bar greys and keeps its
  number, and a second click — or moving the bar — brings it back. What is off is saved with the picture, taken back
  by Ctrl/⌘+Z, and left out of the export exactly as on screen. The same switches are in Trips' and the Studio's
  Develop sheet.
- Develop: a menu on each set slider and section — right-click, the section's ⋯, or hold its dot or eye on a touch
  screen — with Reset, Hide or Show, Show only and Invert hidden. After a Show only, the same line reads "Show the
  others again" and puts back exactly what was on before.
- Develop: while a setting is off, a pill over the picture names what is off — tap a name to bring it back — with a
  way back from the last Show only or Invert, Invert, and Show all.
- Develop: a mask layer's sliders and curve can be switched off and have the same menu, acting on that layer alone;
  its row in the layer list says what is off.
- Develop: the A/B's before side can show your correction without one section or one slider — pick it on the
  "before ▾" label — to compare side by side what that setting brings. The choice stays as you move through the roll.

### Changed

- Storytelling: choose the stops the series' map names under Sources. Take the trip's stage ends, starts or every
  place, then remove, move or add stops, here or on the same big map as Trips' openers; nearby stops can be drawn as
  one, and the road now runs from your first stop to your last, so a stopover before or after the trip leaves the map.
- The Winnow picker over a long span: a click on a month goes there at once and loads that month first, with a
  spinner on it and the month named on the status line; the scrollbar covers the whole span from the start; requests
  nobody needs any more are cancelled. A new filter, One per burst, keeps the best picture of each burst.
- Choosing a font shows each one in itself: the Storytelling charte and its objects, the Studio's title styles and
  elements, and Trips' Look tab list every face written in it, over a line of your own text, with a search. In
  Storytelling the picture tries the face as you move through the list; Escape puts it back.
- Flight Atlas is now one of the main tools: it has its own card on the home page and among the editors in the tool
  menu, and it is no longer marked experimental.
- Each tool's card on the home page shows a drawing of what the tool does until you have a project, trip, roll or atlas
  of your own; then your latest one takes its place.
- Storytelling carries a « Work in progress » badge on the home page and in the tool menu; hover it to see what is still
  coming.

### Fixed

- Storytelling: a map's route and stops can no longer drift off the land. They move, grow and turn with their map —
  dragging the route moves the whole map — and an offset given to them alone before is dropped.
- Sending exports to a Winnow with an app token no longer ends in « not allowed to do that » after the files arrived:
  an archive is not reconciled, and finals sent by an editor say that linking them needs an admin.
- Exports keep their sound in browsers that cannot encode AAC (Chromium on Linux, for one): the voice, music, ticks
  and effects are then encoded to Opus, in sync with the picture, instead of being left out.
- An export whose sound this browser cannot encode now says it went out without its sound, rather than without its ticks.
- Flight Atlas: the intro and the outro no longer jump. Their lines used to shift each time the next one faded in (the
  title moved up when its second line, then the drone, appeared; the summary moved as its totals and the drone came in),
  and the totals' row could re-flow as it counted. An atlas now starts playing once its fonts, coastline and place names
  are in — a few seconds at most — so the place name no longer pops in as the title, and nothing pauses the intro
  halfway through its fade. The same holds in an exported video.

## [1.6.0] - 2026-10-24 — Zaffre

### Added

- Develop: the A/B divider catches the middle and the two edges as you drag it, with marks along the bottom of the picture
  while you drag; hold ⌥ (Alt) to pass them. Double-click the picture to put the divider back in the middle.

## [1.5.0] - 2026-10-24 — Xanthophyll

### Added

- Develop: press / to turn the A/B divider on and off, in the Develop tool and in the Develop sheet of Trips and the
  Studio — on a computer, and on an iPad or phone with a keyboard.

### Fixed

- Develop: the A/B divider stays where you left it when you move to another picture, so you can page through a roll and
  see each one before and after without placing it again. Opening a picture in the editor still starts on the corrected
  picture.
- Develop: dragging the A/B divider is smooth again — it no longer redraws the picture on every move.

## [1.4.0] - 2026-10-23 — Woad

### Added

- Develop: ↑ and ↓ move to the nearest picture in the row above or below when the band is pulled up into rows,
  stands beside the picture, or the contact sheet is open — rows with nothing to work on are stepped over, and the
  column is kept while you go on.
- Develop on a phone or an iPad with a keyboard: the arrow keys and the editor's other keys work in the contact sheet too,
  as they do on a computer.
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
