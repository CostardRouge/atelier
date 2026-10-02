import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import { Icons } from '../../shared/ui/icons';

export interface SelectionVerbs {
  /** How many pictures are marked. */
  count: number;
  /** The open picture's name, for "Apply …'s develop"; null with none open. */
  openLabel: string | null;
  /** How many marked pictures the open picture's develop would be written onto (never itself). */
  applyCount: number;
  /** Every marked picture is ignored — the Ignore verb brings them back instead. */
  allIgnored: boolean;
  /** Settings are copied (⌘⇧C), so "Paste settings" can act. */
  canPaste: boolean;
  onAll: () => void;
  onNone: () => void;
  onSend: () => void;
  onHold: () => void;
  onIgnore: () => void;
  onRule: () => void;
  onApply: () => void;
  onPaste: () => void;
  onVariants: () => void;
  onRemove: () => void;
  onDone: () => void;
}

/**
 * The band's header while the selection is on (`docs/develop-roll-browser.md`
 * §5): the verbs the cells used to wear, acting on every marked picture at
 * once. One row, the band's own height — small buttons on a desktop, finger
 * sized on a phone where the words fold into glyphs and the rest into ⋯.
 * Done (or Escape, or S) leaves the selection and clears it.
 */
export default function SelectionBar({
  compact,
  dense = false,
  narrow = false,
  verbs,
}: {
  compact: boolean;
  /** Too narrow a band for every verb in words: Apply folds into More. */
  dense?: boolean;
  /** A column beside the picture: the phone's glyphs, wrapped onto two rows. */
  narrow?: boolean;
  verbs: SelectionVerbs;
}) {
  const n = verbs.count;
  const none = n === 0;
  const glyphs = compact || narrow;
  const more: OverflowItem[] = [
    ...(glyphs || dense
      ? [
          {
            id: 'apply',
            label: `Apply ${verbs.openLabel ?? 'the open picture'}’s develop`,
            disabled: verbs.applyCount === 0,
            onSelect: verbs.onApply,
          },
        ]
      : []),
    { id: 'rule', label: 'Back to the roll’s rule', title: 'U — each leaves if it is edited', disabled: none, onSelect: verbs.onRule },
    { id: 'paste', label: 'Paste settings', title: '⌘⇧V — the sections copied with ⌘⇧C, onto each', disabled: none || !verbs.canPaste, onSelect: verbs.onPaste },
    { id: 'variants', label: 'A variant of each, as edited', disabled: none, onSelect: verbs.onVariants },
    { id: 'remove', label: `Take ${n === 1 ? 'it' : 'them'} off the roll…`, title: 'The files stay where they are', danger: true, disabled: none, onSelect: verbs.onRemove },
  ];
  const size = compact ? 'md' : 'sm';
  return (
    <div
      className={`flex items-center gap-1.5 w-full min-w-0 px-1 rounded-control bg-accent-wash ${narrow ? 'flex-wrap py-1' : 'h-full'}`}
      role="toolbar"
      aria-label="Selected pictures"
    >
      <IconButton size={size} variant="ghost" label="Leave the selection (Esc)" onClick={verbs.onDone}>
        {Icons.close}
      </IconButton>
      <span className="flex-none font-mono text-2xs font-medium text-accent-ink tabular-nums whitespace-nowrap" aria-live="polite">
        {glyphs ? `${n} ✓` : `${n} selected`}
      </span>
      {!glyphs && (
        <>
          <Button size="sm" variant="ghost" onClick={verbs.onAll} title="Every picture the band shows (⌘A)">
            All
          </Button>
          <Button size="sm" variant="ghost" onClick={verbs.onNone} disabled={none}>
            None
          </Button>
          <span className="flex-none w-px h-4 bg-line-strong mx-0.5" aria-hidden="true" />
        </>
      )}
      {glyphs && <span className="flex-1" />}
      {glyphs ? (
        <>
          <IconButton size={size} label="Send at export (P)" onClick={verbs.onSend} disabled={none}>
            {Icons.arrowUp}
          </IconButton>
          <IconButton size={size} label="Hold back from the export" onClick={verbs.onHold} disabled={none}>
            {Icons.minus}
          </IconButton>
          <IconButton size={size} label={verbs.allIgnored ? 'Bring back into the roll’s work (M)' : 'Ignore (M)'} onClick={verbs.onIgnore} disabled={none}>
            {verbs.allIgnored ? Icons.eye : Icons.eyeOff}
          </IconButton>
          <OverflowMenu label="More for the selection" size={size} variant="default" side="above" items={more} />
        </>
      ) : (
        <>
          <Button size="sm" icon={Icons.arrowUp} onClick={verbs.onSend} disabled={none} title="Each leaves at export (P)">
            Send
          </Button>
          <Button size="sm" icon={Icons.minus} onClick={verbs.onHold} disabled={none} title="Each is held back from the export">
            Hold
          </Button>
          <Button
            size="sm"
            icon={verbs.allIgnored ? Icons.eye : Icons.eyeOff}
            onClick={verbs.onIgnore}
            disabled={none}
            title={verbs.allIgnored ? 'Back into the roll’s work (M)' : 'Never exported, stepped over by ← / → (M)'}
          >
            {verbs.allIgnored ? 'Bring back' : 'Ignore'}
          </Button>
          {!dense && (
            <Button
              size="sm"
              onClick={verbs.onApply}
              disabled={verbs.applyCount === 0}
              title="The open picture’s develop written onto each marked picture, as its own copy"
              className="min-w-0 max-w-[16rem]"
            >
              <span className="truncate">Apply {verbs.openLabel ?? 'this'}’s develop</span>
            </Button>
          )}
          <OverflowMenu label="More for the selection" side="above" items={more} trigger={{ text: 'More', size: 'sm' }} />
        </>
      )}
      {!glyphs && <span className="flex-1" />}
      <Button size={size} variant="primary" onClick={verbs.onDone} title="Leave the selection (Esc)">
        Done
      </Button>
    </div>
  );
}
