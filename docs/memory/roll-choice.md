# The roll's choice of file — one role for every picture of a roll

Read before touching `shared/develop/roll-choice.ts`, `roll-choice-source.ts`,
`RollDoc.opensOn`, the foot of the name menu (`DevelopBase.tsx`), the line a
pick offers in `PictureWorkbench.tsx` (`rollOffer`), or anything that decides
which file a picture opens on WITHOUT the picture having chosen. The
vocabulary of a capture's files is `renditions.md`.

## Built 2026-10-02, his pick «C + B»

`RollDoc.opensOn` (`'delivered' | 'sensor'`, absent = each picture where it
opens; no format bump, like `rendition`) and `shared/develop/roll-choice.ts`.
Rules a later change must keep:

- **The roll stores a ROLE, never a file.** A rendition id names one capture's
  file (`delivered:dsc08463.arw`) and means nothing on another; the role is
  RESOLVED per picture against its own `renditionsOf` rows — by the stage from
  the rows its name menu lists, by the export and the *Delivers* row from the
  same rows gathered from heads (`roll-choice-source.ts`, `captureRenditions`),
  so what is seen is what leaves. Never materialised on open: one fact, one
  undo step, and a picture added later follows.
- **Own choice wins; who has one is `ownChoice`**: a RAW base (`sensor`), a
  stored rendition (`proxy` or `delivered:`). Under a roll choice, picking the
  OPENING row stores its id (`proxy`) instead of null — null means "follow".
  A clip never follows (its camera file is a gigabyte rush). `≠` on a cell is
  `departsFromRoll`: only against a roll that has a choice.
- **The proxy is a FLOOR** (`resolveRollChoice`): the largest measured camera
  file, kept only where its area beats the proxy's (a DJI DNG's 960 × 540
  render is refused and the menu says so); a render inside a RAW decides
  nothing until measured (`pending`, no fetch); a camera file that is not
  embedded is taken unmeasured — a source's proxy is a downscale of it.
- **Numbers bind their material.** The roll never moves numbers set on a
  render onto the sensor (`rollChoiceFor` refuses a non-default develop). On
  the roll's sensor the base is VIRTUAL in the workbench (`developNow`, handed
  to the stack after the draft's own effect) until the picture gets numbers:
  the first write carries `base: 'gain'` + the metered gain, and the
  write-through's echo re-seeds the draft (the `settling` window is drawn on
  the stored base, or the stage flashes the render). Both answers live in
  ONE pure function, `tools/develop/develop-now.ts` (`developNowOf` +
  `developToWrite`): **only the ROLL's base (`rollBase`, a follower) ever
  rides a write — settling NEVER does** (2026-10-08, his A7C II report: a
  picture stepped DOWN from *Gain* to its proxy or camera render settles
  too, and writing the stored base back with the stepped-down draft made the
  write equal the document, so nothing re-seeded and the stage stayed on the
  sensor for good, undo included). A kelvin `rawWb` alone
  counts as numbers there. Apply to / Paste keep a SENSOR's numbers on a
  follower's sensor (`ontoRollSensor`), else the paste would read as set on
  the render and drop the picture off it — the case he will hit first.
- **A follower's gain is metered, never 1.** The stage's decode meters it
  (held for the visit, `followGain`); the run meters any RAW develop with no
  stored gain through `meterRawGain` — the stage's own budget, edge and
  `hold`, so the number is the stage's. Before this, a batch-set RAW base with
  no gain left at gain 1.
- **A failed fetch or a cancelled decode lets go of the roll's file for that
  VISIT** (`rollOff`), never writes the picture.
- **The offer chip sits UNDER the stage's corner-pill row** (`top-9`, 2026-10-02):
  on `top-2` it shared the row with `before · after`, which widens with the
  wipe, and with the crop verb a zoom brings — on a 390 px phone they met.
  Measured headless; the loupe's status pill (under the crop verb, zoomed
  past 1:1) was not.
- **Where it lives on screen**: the name menu's *Whole roll* side — a scope
  switch at its top since 2026-10-06, the same three roles, where it used to
  be a second list at the foot (`renditions-build.md`) —, the line after a pick (*Use Camera render for the whole roll*,
  dismissed by ✕, never a mode), New roll's *Pictures open on*. Put in the
  name menu rather than the band's ⋯ — that menu is per-DEVICE layout, this
  is the document's. Not built, by the brief's own recommendation: prefetching
  the two neighbours' originals (the stage still prefetches their proxies),
  and «Open from ▾» in the selection bar (D in the lab) for a subset.
