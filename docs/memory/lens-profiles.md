# Lens profiles — Lensfun, measured, per lens

Read before touching `src/shared/lens/` (`lensfun.ts`, the fetch and the
cache), `LensProfileTerms` in `render/lens.ts`, the profile uniforms of
`lens-pass.ts`, or anything that corrects a lens from data rather than by eye.
The manual sliders and the pass itself are `render-geometry.md`. Audit item 20
of `docs/lightroom-gaps.md`; his answer (§8): YES, fetched ON DEMAND per lens
and KEPT locally, never the whole database in `dist/`.

## The engine (2026-09-23, L1)

- **Three coordinate systems, and converting them IS the feature.** Lensfun's
  distortion and TCA models are Hugin's: r = 1 at half the SHORT side of the
  CALIBRATION sensor (`modifier.cpp`'s own comment, read at the source, not
  remembered). Its vignetting (`pa`) has r = 1 at the calibration sensor's
  CORNER. Ours has r = 1 at the corner of the picture. With a half-diagonal
  `hypot(36,24)/crop/2` mm, one of our units is `s = hypot(calAspect,1) ·
  calCrop/imageCrop` Hugin units and `q = calCrop/imageCrop` `pa` units. The
  real focal length CANCELS (Lensfun multiplies it in and divides it out), so
  `real-focal` is read and unused. A spec transcribes Lensfun's own per-pixel
  path (NormScale, the `ptlens` rescale, back to pixels) and our radius lands
  within 0.05 px of it at 24/40/70 mm on a 6000×4000 frame.
- **`ptlens` keeps the centre's scale**: Lensfun rescales a,b,c by `d = 1−a−b−c`
  (a/d⁴, b/d³, c/d²) so the corrected image keeps its focal length; ours does
  too, and our lens model was already centre-preserving. `ptlens` has ODD terms
  (c·r, a·r³) the sliders never had, so the profile is its own 4-term
  polynomial, not folded into k1/k2.
- **Composition, one pass**: manual map → profile distortion → per-channel TCA
  `r_s·(v + c·r_s + b·r_s²)` × the manual CA scale → the manual vignette gain at
  the OUTPUT radius × the measured one at the SOURCE radius (Lensfun corrects
  vignetting on the picture as it left the sensor). Horner's form in the pure
  twin and the GLSL alike.
- **Interpolation is Lensfun's**: distortion and TCA by the Hermite spline over
  the two nearest focal lengths either side, on `term × focal` for every
  distortion term and the TCA's radius terms (`__parameter_scales`), the
  nearest alone past the ends; vignetting by inverse-distance weighting (power
  3.5) over focal (normalised to the lens's range), `4/aperture` and
  `0.1/distance`, refused past a distance of 1. Distance is unknown from EXIF
  and taken as 1000 m, as darktable does.
- **Refused, not approximated**: non-rectilinear lenses (a fisheye's
  correction is a projection change), `acm` models, and a calibration made on a
  SMALLER sensor than the picture's (`imageCrop/calCrop ≥ 0.96`, Lensfun's rule;
  the closest from above wins). A lens name matches when its NUMBERS agree
  exactly and its words overlap ≥ 0.6 (Jaccard), so `GM` and `GM II`, and a
  24-70 and a 24-105, never mix.
- **The XML is read with regexes**, comments stripped FIRST — the files keep
  commented-out older calibrations that a naive reader would apply. Node has
  no DOMParser, and the database is attribute-only.
- Gate row: a picture whose red is x and green is y reads back where each
  channel was sampled — distortion within 0.54 codes, distortion + TCA within
  0.64, moving up to 3.8; the measured vignetting lifts 128 → 150 against 149.
