# Saying that something is taking time

**Status (2026-09-21).** §1 is the maintainer's ask, in his words. §2 is FACT,
read in this repository — **corrected the same day, see its last paragraph**:
the video exports DO take an `AbortSignal` already. §3 onwards was a proposal;
the maintainer said *"finish the whole thing, T1 to T5"* and the phases are
being built in order (`docs/run-sheet.md` says which). It came out of
`capture-renditions.md` — a 52 MB fetch and a 4.4 s decode are what made him
ask — but it is deliberately written for the whole suite, not for RAW.

---

## 1. What was asked

> Je sais que certaines opérations peuvent être longues […] un encodage sur un
> téléphone ou sur un ordinateur ne va pas prendre le même temps. Une chose à
> faire dans le projet de manière générale, pas que pour le décodage des
> fichiers bruts, ça sera de donner du feedback à l'utilisateur. Je pensais
> mettre une sorte de barre qui serait soit un placeholder quand la durée est
> indéterminée, soit une barre de progression, sur l'une des bordures — en haut
> ou en bas d'un média, ou sur toute la page. Sur la bordure du média tout
> simplement : c'est une façon élégante, passive et discrète d'afficher qu'une
> opération est en cours. Ou sinon une petite pop-up qui laisse l'opération se
> faire : le titre, l'opération, une barre de progression et un bouton pour
> annuler.

Two surfaces, then: a **hairline on the media's edge** for the passive case,
and something with a **name and a cancel** for the case where a person needs to
know what is running and be able to stop it.

## 2. What exists today

**The plumbing is everywhere and the surface is nowhere.** A dozen modules
already report progress through an `onProgress`-shaped callback —
`media/export-variant.ts`, `media/webcodecs-export.ts`, `media/transcode.ts`,
`roadtrip/deck-export.ts`, `roadtrip/hook-video-export.ts`,
`lut/pack-import.ts`, `develop/delivery-source.ts`, `tools/develop/use-roll-export.ts`
— and every one of them is drawn differently:

- Trips' **Export word becomes its own progress fill** while exporting
  (`frontend.md`) — the closest thing to a house style, and it belongs to one
  button in one tool.
- **`SyncPill`** says a document's state as a dot plus one word, with the
  sentence in a popover — the pattern `frontend.md` records for *"a status
  whose sentence nobody controls the length of"*.
- The Develop tool's **`tell()` notice** is a line of prose under the stage,
  used for "fetching the RAW · 52 MB…" and for a run's result alike.
- `TranscodeControl`, `LutPackImportModal` and the roll's export panel each
  draw their own line or bar.
- **`shared/ui/` has no progress element at all** — no bar, no spinner beyond
  `LoadingState`, which is for a screen that has nothing to show yet.

So nothing needs inventing at the source. What is missing is **one place that
knows what is running**, and two ways of drawing it.

**What is cancellable today — corrected 2026-09-21.** The first reading of this
section said nothing was; that was wrong for the VIDEO exports. `render-video.ts`,
`webcodecs-export.ts`, `export-variant.ts`, `hook-video-export.ts`,
`export-overlay*.ts` and `transcode.ts` all take a `signal?: AbortSignal` and
check it between frames, and the Studio's Export tab already draws a Cancel
over it (`StudioEditor`'s `exportAbort`). What takes NO signal: every fetch
(`WinnowClient.request`, so `fetchFile`, `fetchHead`, `materialize`,
`refetchMedia`, the originals and companions), the RAW decode
(`raw-decoder.ts`), the Develop roll's export loop (`use-roll-export.ts`),
the deck's PNG run (`deck-export.ts`) and Trips' `use-post-exports` (which
never passes the signal the pipeline would take), and the pack import. So the
real work of T4 is the roll and the deck, not the encoder loop.

## 3. The proposal

### 3.1 One registry, two surfaces

`shared/tasks/` — a module registry beside `history/` and `sources/`, in the
shape the suite already uses for cross-cutting state (module state + a
`useTasks()` subscription, the preset book's pattern):

```ts
export interface Task {
  id: string;
  /** What is happening, in the words a person would use: "Opening DSC00123.ARW". */
  label: string;
  /** 0..1 where it is known, null where it is not — a determinate bar or a sweep. */
  progress: number | null;
  /** What it belongs to, so a media's own edge can draw only its own tasks. */
  scope?: string;
  /** Present only where the work can really stop. Never drawn otherwise. */
  cancel?: () => void;
  startedAt: number;
}

export function startTask(init: Omit<Task, 'id' | 'startedAt'>): TaskHandle;
```

- **`TaskEdge`** — a 2px hairline along the bottom edge of a media stage,
  drawn for the tasks whose `scope` is that media. Determinate: a fill in the
  vermilion accent. Indeterminate: a short segment sweeping the edge. This is
  his passive surface, and it costs the picture nothing.
- **`TaskPill`** — the `SyncPill` family in a header bar: a dot, one word, and
  a popover listing every running task with its bar and its Cancel. This is his
  pop-up, without being a modal that blocks the page — which matters, because
  the second half of his ask is *"si l'utilisateur veut faire autre chose"*, and
  a modal is precisely what stops him doing anything else.

### 3.2 Rules the suite should keep

- **A task is named after what a person asked for**, never after the
  mechanism: "Opening DSC00123.ARW", not "libraw decode".
- **Indeterminate is honest.** A step whose length nobody knows sweeps; a
  percentage nobody measured is a lie, and the suite's standing rule against
  fabricated values (`roadtrip.md`, "a preview shows the real value or
  nothing") applies to a progress bar as much as to a badge.
- **A Cancel is drawn only where the work can really stop.** A button that
  does nothing is worse than no button.
- **Under 400 ms, draw nothing.** A bar that flashes on every fetch is noise;
  a task registers at once and the surfaces wait before showing it.
- **The edge belongs to the media, the pill to the screen.** Anything a person
  might walk away from goes in the pill; anything about the picture in front of
  them goes on its edge. Both may show the same task.
- **A finished task says its result where the result matters**, which is what
  `tell()` already does — the task disappears, the sentence stays.

### 3.3 Phases (one commit each)

- **T1** — `shared/tasks/` (pure registry + hook, tested), `TaskEdge`,
  `TaskPill`. Nothing wired: the two surfaces and a story-style page proving
  determinate, indeterminate and cancel.
- **T2** — wire the **fetches**: `delivery-source.ts`, `original-cache.ts`,
  `resolve-media.ts`, the Winnow client's `fetchFile`. These already know their
  byte counts, so they are determinate for free, and a fetch is the one thing
  that can be aborted today with no rework (`AbortController` into `fetch`).
- **T3** — the **RAW decode** and the loupe (`raw-decoder.ts`,
  `use-develop-picture.ts`): indeterminate, with a cancel that drops the
  worker's turn rather than the worker.
- **T4** — the **exports** (`export-variant.ts`, `deck-export.ts`,
  `use-roll-export.ts`): determinate per frame or per picture; cancel means
  stopping between two frames, so it needs a real signal through the encoder
  loop. This is the phase with actual work in it.
- **T5** — retire the one-off surfaces: Trips' Export fill stays (it is good),
  the others become the pill.

## 4. The questions — all five answered by building (T1–T5, 2026-09-21)

1. **Modal or pill?** He offered both. The pill + popover is recommended,
   because his own reason for wanting a cancel is to go on doing something
   else, and a modal forbids exactly that. A modal is right for one case only:
   an operation that must not be interrupted by an edit to the same document.
2. **Does a cancelled task leave anything behind?** A half-written folder of
   exports, a partly fetched original. Recommended: a fetch leaves nothing, an
   export keeps the files already written and says how many. **Built as
   recommended (T4)**: a cancelled fetch holds nothing, a cancelled export
   writes what it rendered and says `Cancelled after 1 of 2 — 1 picture
   written`.
3. **Where does the pill live on a phone?** The shell's bottom bar has no room
   for a seventh cell; the edge hairline may be the only surface there.
   **Built**: the masthead, the one row every screen keeps — the dot alone
   on a compact shell, the word on anything wider.
4. **Does a task survive a route change?** A roll export while the person walks
   to the gallery. Recommended: yes — the registry is module state, and that is
   the difference between a pill and a panel. **Built as recommended.**
5. **Is there a ceiling on concurrent tasks**, or does the popover just list
   them? **Built**: no ceiling; the popover lists them, oldest first.
