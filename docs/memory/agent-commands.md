# Agent commands — the registry, the console, the MCP bridge

Read when you touch `src/shared/commands/`, `src/app/app-commands.ts`, a
`useRegisterCommands` call in a tool, `scripts/atelier-mcp.mjs`, or anything
that would let a script or an agent DRIVE the suite.

## Every agent-facing verb is a COMMAND, registered by the screen that can do it (2026-10-09)

**Decision.** The maintainer asked for LightCraft's command registry and MCP server (`storytold/lightcraft`, a Rust clone of Lightroom, read on 2026-10-08: every gesture there is a command with a stable id and JSON params, and the UI, CLI, a control channel and MCP dispatch through one entry). Atelier takes the REGISTRY half of that idea, not its "the UI is commands" half: `shared/commands/registry.ts` holds `{id, title, description, params, available, run}`, one `execute` door checks the params and runs; a screen registers its commands with `useRegisterCommands(owner, specs)` while it is MOUNTED, and `run` calls the very funnel its gestures call. **Why.** Rewriting every handler of a 200 k-line React app into commands would be a rewrite; registering from the screen means an agent's edit goes through the same updater, journal, undo stack and save as the author's (preview = export holds for free), and a command whose screen is not open is simply ABSENT — `app.waitFor` is how an agent waits for one after `app.navigate`. **How to apply.**
- Ids are dotted and stable (`app.status`, `develop.set`): scripts outlive labels. Two owners may register one id; the latest mounted wins, the earlier comes back when it leaves.
- Params are a small typed subset (`number` with bounds and `integer`, `string` with `enum`, `boolean`, `strings`, `object`), turned into JSON Schema by `paramsJsonSchema` for MCP. Out of range is REFUSED, never clamped, and an unknown field is refused naming the known ones — a misspelt key that silently did nothing is the failure an agent cannot see.
- `available()` returns `true` or the REASON; `execute` answers `CommandError` with a code (`unknown` · `unavailable` · `invalid` · `failed`).
- `useRegisterCommands` reads the specs through a ref and re-registers only when the SET of ids changes — per-render registration would tell every subscriber the list changed on every slider step.
- A command answers JSON; a picture to LOOK at is an `ImageResult` (`kind: 'image'`, base64 JPEG/PNG), which the MCP bridge turns into an image content block.

## `window.atelier` is the console's door to the same registry (2026-10-09)

`installCommandConsole()` (`main.tsx`) puts `atelier.commands()` and `atelier.run(id, params)` on `window`. It grants nothing a script on the page could not already do; it gives a console, Playwright or a bookmarklet the same checked, undoable door an agent gets. **How to apply**: drive the app headless through `page.evaluate(() => atelier.run(...))` rather than clicking coordinates when the check is about a result, not about the gesture.

## Develop's commands, and an agent's write is MARKED (2026-10-09)

**Decision.** Develop registers its commands from the three screens that hold what they need: `DevelopTool` (`develop.rolls`, `develop.openRoll`, `develop.undo`/`redo` — the roll's own history, so an agent's write is one ⌘Z like the author's), `RollEditor` (`develop.pictures`, `develop.openPicture`, `develop.controls`, `develop.get`, `develop.set`, `develop.reset`), `PictureWorkbench` (`develop.snapshot`). The arithmetic is pure in `shared/develop/develop-commands.ts`: `withDevelopValues` writes ABSOLUTE slider values checked against `DEVELOP_RANGES` (refused outside, never clamped), keeps everything the sliders do not name (curves, mixer, grading, the RAW material) and answers null for "as shot"; `targetPicture` is the one rule "the named picture, else the open one". Every write goes through `handleDevelop` / `update` with `via: 'agent'` — a JournalVia added for this — so the making-of says *by an agent* and the training file carries `agent: true` (`develop-roll.md`). **Why the mark**: B2's pairs exist to learn HIS taste; an agent's develop in them would teach the model the agent. **How to apply**: any new command that writes a picture passes `'agent'`; a trainer filters on `agent`.

**The snapshot waits for the stage.** `develop.set` reaches the roll at once, the stage's cube a render later. `develop.snapshot` first waits until `picture.delivered` — whose IDENTITY tracks every input of the render — has not changed for 150 ms (`untilSteady`, capped at 3 s), then bakes the band cell's own recipe (`framedThumbnail`: graded, cropped, bordered) at `longEdge` (64–2048, default 1024), or the source AS SHOT with `before: true`. Measured headless: a snapshot asked right after a set shows the set. It is `unavailable` while the picture decodes — `app.waitFor('develop.snapshot')` after an open.

**Only the eleven sliders are writable in v1.** Curves, levels, the mixer, grading, crop, layers, the look are read (`develop.get`) but not written by a command yet; each is the next command to add, through the same `handleX(id, value, 'agent')` funnel.

**Drive it headless** (`testing.md`'s Playwright recipe): `atelier.run('app.navigate', {path: '/develop/home'})`, `app.waitFor('develop.rolls')`, `develop.openRoll`, then drop files on the editor as the recipe says; every step after that is `atelier.run`.
