# Mosaic — the matching in lots, the Performance panel, the loading

Read before touching how a mosaic is computed and fetched: `perf.ts`,
`match.ts`'s `matchLot`, `measure-worker.ts`, `match-pool.ts`,
`scene-builder.ts`'s build, `use-mosaic-perf.ts`, the Performance section.
The core is `mosaic.md`.

## The matching comes in lots, painted as they land (2026-11-01, F3)

His ask («une propagation ludique des cellules au fur et à mesure des
résultats … une barre de progression dans la bordure du canvas … garder
"matching…"»). **Rules**: `planLots` (`perf.ts`, pure) cuts the cells into
lots in a PROPAGATION order — rows, from a point (the cell clicked, else the
centre), a spiral, random from the seed, or one block; `matchLot`
(`match.ts`) matches one lot reading the cells already decided (`known`)
for the neighbour rule; the lots run over `MatchPool` (`tools/mosaic/
match-pool.ts`, N persistent `measure-worker.ts` holding the library by
TOKEN, re-sent only when the descriptors change) in as many lanes as
workers; `SceneBuilder.build` paints each lot into the SAME canvas, which
starts from the previous scene's pixels when the size matches (so a
retarget replaces cells rather than blanking), records `arrivals` and
`progress`, and `MosaicStage` animates the cells younger than `ms` from
`scene.before` (fade, appear, flip) and shows a 2 px `role="progressbar"`
hairline at the bottom while `progress < 1`. **Honesty**: with several
lanes two lots in flight do not see each other, so a neighbour rule may
differ from a one-block match at lot edges — exact only with one worker
and `rows`; the panel says so. **Traps** (both hung the pool): a lot
cancelled while a worker ran it must still decrement that worker's `busy`
when its reply lands (the job carries a `gone` flag), and a waiter whose
signal aborts must wake the NEXT waiter when a worker is free and leave
the queue, else every later `take` waits forever. Driven headless: 1 500
pictures, 37 × 37 cells, 22 lots at 9 ms a lot on the pool, the frames
distinct as they land, a click propagating from its cell.

## Performance is the device's panel, never the document's (2026-11-01, F4)

His ask («tout un panel pour gérer la performance et les animations ou le
worker … au peigne fin, tous les paramètres du premier artefact»). **Rules**:
`PerfPrefs` (`perf.ts`) live in `localStorage` `atelier.mosaic.perf`
(`use-mosaic-perf.ts`, bounded on read by `sanitizePerf`) — a `.mosaic.json`
opened on a phone must not impose six workers; the document keeps what the
mosaic IS, the device how it is computed and shown. The section sits at the
inspector's foot, closed by default: workers (Auto · N here, 1–8), where the
measure runs (pool, one worker, this thread), the lot (a row, 64, 256,
1 024), the propagation, *Show each lot as it lands*, the cell animation and
its ms, tiles in memory, scenes ahead, motion (the zoom's meaning moved to the Target section's Auto-frame switch); a
measured line «last matching · N lots · ms a lot · where · fps» under them.
`workers: 0` is auto (`workersFor`: cores − 1, two to six, one or two
constrained); the pool is remade on that number; `measure()` reads the pref
at call time. **How to apply**: a new knob is a field with a default and a
bound in `sanitizePerf`, read through the hook, never a new store.

## Loading in three bounded depths (2026-11-01, F7)

Lab 2's «charger avec élégance»: the band's thumbnails are the device's
tiles through object URLs (free, F5); the player prepares `perf.ahead`
(1–3) scenes past the one playing — `pendings`, a Map by step index, each
chained on the one before since its picture is where the next starts, a
played step DELETED so a chain of thousands never holds every scene it
drew; and as a step starts it WARMS the proxies of the two queued pictures
past the scenes ahead (`warm`), which only the queue can name — a drawn
step is unknown until its turn. `SceneBuilder.targetBitmap` shares a fetch
in flight (`fetching`) and holds eight targets, so the warm and the build
ask the instance once. Measured headless with 250 ms proxies: one proxy a
step either way; one scene ahead waited on the next picture three times in
seven steps, three ahead never. Nothing for the eleventh: it waits to be
the ninth.
