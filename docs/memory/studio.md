# Studio — the unified editor and the merge plan

Read before touching `src/tools/studio/`, `src/shared/overlay/`, anything about project persistence, title styles, or before retiring one of the legacy tool pages.

## The suite is converging into one Studio (2026-08-20)

**Decision.** The maintainer wants the separate tools merged into a single editing studio: import from the drone's card, view, grade (LUT), place styled telemetry/text overlays by drag-and-drop, compare, and export — without switching pages. Agreed phases: **0** consolidate `shared/` (done, PR #29) · **1** the `/studio` route with viewer + overlay + grade + export (this phase) · **2** projects (gallery, persistence, reconciliation) · **3** title styles (cascade + glow) · **4** absorb the remaining tools as panels and retire their routes · **5** SD-card import + photo export. **Why**: juggling between pages to produce one piece of content. **How to apply**: the transition is *soft* — legacy routes stay until their studio equivalent exists (phase 4); new capability goes into the studio (or the shared engine), not into the legacy pages. Scopes and Cull were explicitly retired (maintainer decision, 2026-08-20), not to be re-proposed.

## Routes and the end state (2026-08-20)

**Decision.** Phase 2 introduces a project gallery under `/studio/home` (create / open / delete, an After-Effects-style creation modal) while `/studio` edits the open project (`/studio/:projectId` when the router grows params — today's hash router is exact-match only, ~20 lines to extend). At the end of the transition the gallery becomes the app's home page. **How to apply**: don't build navigation that fights this; the studio opens on *projects*, not on a file picker.

## Project model: portable template + bound instance (2026-08-20)

**Decision.** A project document splits in two. *Portable* (the template): style theme, overlay elements and positions, LUT, export format/gabarit, map settings. *Bound* (the instance): the media-directory **handle**, the media list (name + size + mtime), the active clip. Media bytes are **never** copied into storage. Directory handles are structured-cloneable → stored in IndexedDB; on open, one permission click re-resolves media by filename; manual re-pointing is the fallback (Chromium-only feature — Firefox/Safari get the manual path, say so in the UI). Reconciliation classifies media found / changed / missing and never blocks opening. "Save as template" = portable half alone; "open with other media" = keep portable, rebind. **Storage**: IndexedDB for documents, handles, baked thumbnails (galleries can't decode media that isn't reconciled yet — bake thumbnail + duration + size at save time); `localStorage` for UI prefs only; request `navigator.storage.persist()`.

## Creation-modal parameters (2026-08-21)

**Decision.** Aspect before resolution (9:16 / 1:1 / 4:5 / 16:9 presets named by destination), background colour **plus** media fit (cover/contain/stretch — the real decision), frame rate defaulting to "follow source", initial style theme, "start from template", optional media folder, units + label language, safe-zone margins. Explicitly **out**: bitrate/codec/LUT/destination — export-time decisions. All parameters editable later; a *resolution* change is a pure homothety (element positions are normalized, sizes are short-side fractions), an *aspect* change is a recomposition and must go through a small confirmation step, never silently.

## Title styles: a three-level cascade (2026-08-20)

**Decision.** Named preset ("Or ciné", "Pixel CRT", "Rouge plein cadre") → project theme (preset + tweaks) → per-element **partial** overrides (store only the overridden property; show a per-property "back to theme" control). The theme carries *appearance only* (font, weight, italic, case, colour, glow, letter-spacing, legibility, grain) — never geometry (position, anchor, bound field, text); size is a theme *multiplier* over the element's own size. The film-glow ("bave") is one 0–100 theme slider driving four layers proportionally (softened core ~0.3–0.8px blur, tight bright halo 1–3px, wide warm-drifting bleed 10–30px at 5–15% opacity, animated grain), with an advanced per-layer disclosure. **Why**: the maintainer's reference imagery is optical-era title cards (halation); the slider spans muted (gold serif card) to fluo (CRT pixel cards). **How to apply**: extending `LegibilityStyle` needs `measureOverlays`' margin widened for anything painting outside the text box, and the mode is switched on in three draw sites (text, arrow, compass) — see `shared/overlay/draw-overlays.ts`.

## Phase 1 shipped shape (2026-08-21)

**Decision.** `tools/studio/StudioTool.tsx` composes the shared overlay engine + `shared/lut` + the shared transport into one page: centre stage, tabbed inspector (Overlay / Grade / Export). It accepts `video+telemetry` **and** plain `video` (cues just stay empty — telemetry fields render "—"), which the overlay page never did. The active-asset protocol lives in `shared/library/use-active-asset.ts` — reuse it instead of re-writing the activeId/echo/ensureMeta dance; legacy tools still carry their own copies until phase 4. **Known duplication, on purpose**: StudioTool and OverlayStudio share wiring; the overlay page dies in phase 4, don't polish it.

## One clip per project, for now (2026-08-21)

**Decision.** A studio project is a composition over **one** media (the maintainer's flow: a drone clip, its overlays, its style, its export). Multi-clip editing (timeline, cuts, transitions) is explicitly out of scope; if it ever comes, it is a *list of compositions sharing a theme*, not a rewrite. Don't introduce timeline concepts into the project model.
