# Vitrine — the vehicle-showcase opener

An opener of Trips (`shared/roadtrip/hooks/showcase*.ts(x)`, id `showcase`, on screen **Vitrine**): the trip's car shown on its own, as **place × entrance × ending × look**. Designed with the maintainer in two labs: the six art directions (*Prado Showcase*) and the configurator (https://claude.ai/artifact/B7dEcPYeCHC9MLDau4WtCD, v5). The lab and the opener share the same numbers. A change to a place should go into both, or the lab stops being a reference.

## Shape (2026-10-08)

- **Four modules, split by purity.** `showcase-scenes.ts` holds the eleven places as data plus geometry builders. `showcase-plan.ts` holds the options, the trajectory, the car's state per entrance, the scene cache, tiling and recipes. Both are pure and node-tested in `showcase-plan.test.ts`. `showcase-paint.ts` is the browser painter, and `showcase.tsx` holds the panel and the variant. Keep the next piece of pure logic in the first two, not in the painter.
- **One sort for the scene and the car.** Scene faces are tagged `s|role` and car faces `c<i>|role`, and `mesh3d.renderOrder` orders them together. A prop is never painted in a separate pass from the car: they interleave in depth.
- **Cars only.** `showcaseSpec` falls back to the Prado whenever the choice is a boat. A boat has no road, no shoulder and no wheel spin.
- **The badge comes in after the entrance.** `badgeWindow` starts at 5 s for `after` (the default), runs `{0, null}` for `always` and `{0, 0}` for `never`. Showing it during the entrance competes with the one thing on screen.
- **The Place line rewrites the badge's caption.** `contentKeys` are vehicle, colour and caption. The ferry route is whatever the author types (his rule: «il ne faut pas le mettre en dur»).

## The rules the maintainer set

- **On a road the vehicle never stops in its lane** («la voiture ne devrait pas toujours rester sur la route»). There are three endings:
  - `road`: it keeps driving at 8 m/s, passing the middle at 5.5 s, while the scenery tiles past.
  - `pullover`: it brakes onto the shoulder with the indicator on.
  - `offroad`: it leaves the road for flat ground.

  `endOf` never returns `still` for a place with a road, and a place without one always gets `still`. Labels come per place (`PlaceEnds.*.label`: «At the pump», «By the guardrail»…).
- **The beach is driven, K'gari-style.** The lane is the hard sand at the water's edge, and a Gaussian swerve steers round `BEACH_OBSTACLES` (driftwood, a rock, a dingo) on every tile.
- **The ferry deck follows his photograph** (DFDS, Tanger Med): green-grey deck, dark lanes, yellow lines and lashing X's, a container, mooring drums, a yellow rail. Vehicles are parked bumper to bumper in lanes, with a few gaps. A deck with only the hero car on it read as false.

## Traps and how to apply

- **Every path is checked against every prop** («the paths leave room»): every place, variant and ending, the Prado and the Trafic, every tile copy. A prop added or moved needs this test green. Something a vehicle may stand on (the turntable's disc) is marked `drivable`.
- **An entrance offset follows the path itself** (`Trajectory.back(m)`). Offsetting along the heading cut every swerve and ran the car through the beach's rocks.
- **The rest heading is the Bezier's exact derivative**, not a chord. The last chord left the car about 0.3° skew at rest.
- **The scenery is tiled every `tile` m (48 by default).** A `unique` thing is drawn once. A `far` thing is pulled into the horizon band, scaled down, and follows the camera at 0.95 parallax. A `camp` thing pops when the car arrives.
- **A mid prop on a road place must fit inside one tile** (`|x| ≤ P/2`), or two copies overlap.
- **Culling is what keeps the ferry deck fast.** The painter culls at |X| > 11.7 m, or 24 m for far things. Without it the deck took 120–220 ms a frame; with it about 50–70 ms headless. Every other place takes 5–40 ms.
