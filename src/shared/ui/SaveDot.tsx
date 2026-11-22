import { saveDotFace, type SaveDotState } from './save-dot';

export type { SaveDotState } from './save-dot';

interface SaveDotProps {
  state: SaveDotState;
  /** What the document is, for the sentence: "recap", "mosaic", "project"… */
  noun: string;
}

/**
 * Whether a document is kept on this device, as a DOT — the shape of Trips'
 * `SyncPill`, one lozenge a bar's height wide, so every editor's bar reads
 * `[↶|↷] [●]` and the state always comes AFTER the history (his rule,
 * 2026-11-22). A word only when the state waits on the author (the browser
 * refused to store it), which takes the bar's one word (`data-speaks`,
 * `PageBar`). The sentence is the tooltip and a live region, whatever the
 * width.
 */
export default function SaveDot({ state, noun }: SaveDotProps) {
  const face = saveDotFace(state, noun);
  return (
    <>
      <span
        title={face.sentence}
        aria-label={face.sentence}
        data-speaks={face.word ? '' : undefined}
        className={`inline-flex items-center shrink-0 whitespace-nowrap h-[2.125rem] rounded-control border bg-paper font-mono text-2xs tracking-[0.06em] uppercase ${
          face.word ? 'gap-1.5 px-2.5 border-danger-line text-danger' : 'justify-center w-[2.125rem] px-0 border-line-strong'
        }`}
      >
        <span className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 ${face.dot}`} aria-hidden="true" />
        {face.word}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {face.sentence}
      </span>
    </>
  );
}
