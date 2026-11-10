# The sensor outside Develop — a RAW at full quality in Recap, Trips and the Studio

Read before touching how an instrument OTHER than the Develop tool gets a
RAW's pixels (`recap-media.ts`, `loadBadgeSource`, the Studio's stage
rendition), before adding a caller of `decodeRaw`, or before changing
`carried-edit.ts`'s refusal of a sensor develop. The decoder is `raw.md`, the
files of a capture `renditions.md`, a roll's own choice `roll-choice.md`.

## His ask, and what it decides (2026-11-10)

*"RAW media loaded from Winnow or from local assets must have a way to use the
camera render the way the Develop instrument does, so a drone DNG comes out at
full quality."* This IS call (1) of `raw.md`'s open item «RAW by default»,
answered for everything OUTSIDE Develop: a RAW may be read from its sensor
there. Whether it goes there BY ITSELF, and inside Develop, are questions 1 and
5 of the lab. **His yes came 2026-11-10 («oui, tes recommandations») on
https://claude.ai/artifact/AY2Z7mmPpxc8g13BHLa9w1**: Auto never downloads, the
whole-document line after a pick, Trips and the Studio TAKE a sensor develop,
Storytelling and Mosaic unchanged, Develop unchanged (no «RAW by default»
inside it). The build log is the section «Built» below.

## The audit (2026-11-10, read in the code)

- **No instrument but Develop ever calls `decodeRaw`.** Its five callers are
  the workbench's stage and loupe (`use-develop-picture.ts`), `renderFromRaw`
  (`roll-render.ts`), `meterRaw` (`roll-choice-source.ts`) and the timelapse.
  Everything else enters through `decodeStill`, which for a RAW name slices the
  render inside the file (`extractRawPreview`).
- **Recap**: a Winnow print is cut from the proxy, a local one from
  `decodePhoto` — 960 × 540 on a DJI DNG, drawn ×3.56 on a full 1080 × 1920
  page. **Defect, read not yet reproduced on his instance**: with *Originals*,
  `stillOriginal` (`RecapEditor.tsx`) downloads the 74 MB DNG, decodes its
  960 × 540 render through `decodePhoto`, and `originalStills` puts it IN PLACE
  of the 2048 px print — the export is softer than with *Proxies*. An original
  must never replace a print it does not beat.
- **Trips**: stage on the proxy or the embedded render (`loadBadgeSource`);
  the export fetches an original only where `deliveryFor` finds its embedded
  render beats the proxy — never on a DJI.
- **Studio**: the stage's rendition chip lists the capture's files with NO
  sensor row (`media-rendition.ts`, `sensor: null`).
- **Storytelling, Mosaic**: Winnow thumbnails and proxies only (192 px tiles,
  1080 / 1280 px prints), no local photo. At those sizes the proxy is not the
  limit; the lab recommends leaving them.
- **A develop made on the sensor in the Develop tool is REFUSED by Trips and
  the Studio** (`offerFrom`, `carried-edit.ts`: «export it from Develop
  instead»). "A developed picture is TAKEN" holds for a render develop only.

## The plan the lab carried (his yes 2026-11-10, built as drawn)

- **One brick, no second decoder**: `shared/develop/sensor-still.ts` — the
  recipe a roll's FOLLOWER on `opensOn: 'sensor'` leaves Develop with
  (`use-roll-export.ts`, the `followed` branch: `sensorSourceFor` +
  `fetchSourceFile`, `meterRaw` with `'resolve'`, `openingBaseCurve`, the top
  rung of `readRawCalibration`, `renderRollPicture` with `raw`), EXTRACTED
  from that file and called by it, so Develop and the others cannot drift. It
  hands back an 8-BIT as-shot picture: the print, the Develop sheet, the look
  and the export of each host stay what they are, which is what keeps stage =
  export. Highlight recovery in the sensor's range stays the Develop tool's.
- **A pure rule** (`raw-choice.ts`): per PICTURE `render | sensor`, absent =
  Auto. Auto never downloads: the sensor when the RAW is in hand and its
  camera render is under half the sensor's long edge (DJI 12 % → sensor, Sony
  ARW 99.5 % → render); a Winnow row stays on its proxy until asked. Stated
  about the FILE, never the cell, so a picture keeps one material (one colour)
  at every size and in every instrument.
- **The control** (Recap first): the picture's NAME becomes its menu, Develop's
  own grammar, two rows and no rungs; after a pick, a line offers the same for
  every RAW of the recap (the roll's «C + B»). No new control at export:
  *Originals* re-renders a Sensor picture from its sensor at the page's
  density. **It is drawn on `shared/ui/PictureCard.tsx`** (PR #453, branch
  `claude/fervent-thompson-l4uqb0`, not merged on 2026-11-10; `frontend.md`
  there, «The picture in hand is ONE card»): the chip is passed as the card's
  `name` for a RAW — a column of ~190 px at the 23 rem inspector, so the file
  name truncates and «Sensor ▾» stays whole — and the whole-recap line sits
  under the card in the same `row`. In Trips and the Studio the menu goes
  BESIDE `DevelopDoor`, never inside it. Build R1 on that branch, or after it
  merges: `SlotSection` conflicts otherwise.
- **Kept on the device**: the 2048 px print only, in the existing
  `atelier-recap` store under a key per material; the RAW never (a Winnow
  original held for the session, `original-cache.ts`). No new store, no new
  request — `/download` is already called by Recap's *Originals*.
- **Order**: S0 the brick and the rule · R1 Recap's print and menu · R2 Recap's
  exports and the *Originals* defect · T Trips · St the Studio's sensor row ·
  D (his call) lifting `carried-edit`'s refusal.

## Measured while auditing (2026-11-10, headless Chromium, the suite's own modules)

On a synthetic DJI-shaped DNG (`scripts/gen-dji-shaped-dng.py`, `testing.md`):
`decodeStill(file, { maxEdge: 2048 })` answers 960 × 540 `viaRawPreview`; the
follower recipe answers the whole 8064 × 4536 on `gainMapWarp`, gain 3.073,
and its frame and corners match the embedded render where the `gain` rung
alone is vignetted and 4.93 % wider — the top rung is what the brick must
deliver. **Trap**: `renderFromRaw` asks `minLongEdge: decodeEdge * 2`, so a
2048 px target decodes all 36 megapixels (4096 > the half's 4032); a print
needs no crop margin and should ask for the half. Timings under SwiftShader
mean nothing; his Mac's are `raw.md`'s (4.4 s whole the first time, 456 ms at
the stage budget).

## Built — see `sensor-outside-develop-build.md`

Every phase (S0, R1, R2, T, St, D) was built on 2026-11-10; what each fixed,
the traps and what was and was not driven is in that file.
