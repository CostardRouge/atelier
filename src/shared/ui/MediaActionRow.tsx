import type { MediaAction, MediaActions } from '../sources/media-scope';

interface MediaActionRowProps {
  /** What the active tool published, or null when it offers nothing. */
  offer: MediaActions | null;
  /**
   * Run one verb. The caller is what makes the media ready first — activating
   * a pool asset, fetching an instance's row — and what closes the sheet
   * afterwards: only it knows where the picture lives.
   */
  onRun: (action: MediaAction) => void;
  /** Something is already in flight: the row waits rather than queueing. */
  busy?: boolean;
  /**
   * A LONE verb is the sheet's call to action, drawn as its one ink pill.
   * True where the sheet has nothing better to offer (the Library's own
   * files); false where it already leads with something (an instance's row,
   * whose first gesture is bringing the picture across). Several verbs are a
   * choice (Reel · Carousel · Photo) and none of them is promoted.
   */
  lead?: boolean;
}

const PRIMARY =
  'font-mono text-2xs tracking-[0.1em] uppercase px-3 py-1.5 rounded-full bg-ink text-paper cursor-pointer transition-colors hover:bg-accent disabled:opacity-50 disabled:cursor-wait';
const SECONDARY =
  'font-mono text-2xs tracking-[0.1em] uppercase px-3 py-1.5 rounded-full border border-line-strong bg-paper text-ink cursor-pointer transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:cursor-wait';

/**
 * The one row that turns a picture you are looking at into work.
 *
 * A sheet that shows a media large is where the decision "this one is worth a
 * piece" is actually taken, and until now it could only be carried out three
 * screens away: close, find the day, pick a kind, press Add. The verbs come
 * from the active tool (`media-scope.tsx`), so the shell offers them without
 * knowing what a reel is, and a tool that publishes none draws nothing at all.
 *
 * The buttons come first and the heading follows them as a sentence saying
 * what they do: a label set over a single verb read "DEVELOP · Develop".
 */
export default function MediaActionRow({ offer, onRun, busy, lead = false }: MediaActionRowProps) {
  if (!offer || offer.actions.length === 0) return null;
  const promote = lead && offer.actions.length === 1;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {offer.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onRun(action)}
          disabled={busy}
          title={action.hint}
          className={promote ? PRIMARY : SECONDARY}
        >
          {action.label}
        </button>
      ))}
      <span className="text-xs text-muted min-w-0 ml-1">{offer.heading}</span>
    </div>
  );
}
