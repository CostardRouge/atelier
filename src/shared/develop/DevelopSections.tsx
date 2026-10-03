/**
 * The workbench's sections beside the sliders — the clipboard verbs, the
 * presets, the batch verbs and the look. Each draws what a HOST passes
 * (`develop-host.ts`) and reports what it did through `onTold`, so the modal
 * and the Develop tool place them where their own layout wants.
 */

import type { SavedGrade } from '../lut/saved-grade';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import GradePanel from '../lut/GradePanel';
import type { LutPreviewSource } from '../lut/LutGalleryModal';
import type { LutStack } from '../lut/use-lut-stack';
import type { ButtonSize } from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import OverflowMenu, { type OverflowItem } from '../ui/OverflowMenu';
import { useVerb, type Verb } from '../ui/use-verb';
import type { VerbOutcome, VerbReturn } from '../ui/verb';
import VerbWord, { useVerbWord } from '../ui/VerbWord';
import { useIsCompact } from '../ui/use-layout-mode';
import { VERB_GROUND, VERB_INK, VerbButton } from '../ui/VerbMarks';
import DevelopFold from './DevelopFold';
import { DEFAULT_DEVELOP, describeDevelop, type DevelopSettings } from './develop';
import { developButtonClass, developLinkClass } from './develop-classes';
import { copyDevelop, hasCopiedDevelop, pasteDevelop, subscribeDevelopClipboard } from './develop-clipboard';
import type { DevelopApplyVerb, DevelopPresets, DevelopPresetsPlace } from './develop-host';

/**
 * The same three verbs as ONE GROUP of glyphs, for a host whose room is the
 * picture's: the Develop tool's stage bar (2026-09-22, variant A2 of the
 * stage-bar study). Three underlined links took ≈ 150px of a row that is read
 * above a photograph all day, and «As shot» never said that it RESETS. A well
 * of three icon buttons keeps every verb at ONE click — which a menu would have
 * cost — and gives them one family; each carries the full sentence as its
 * tooltip, and `Reset` is the one that says what it does in words there.
 *
 * Reset sits apart as a GHOST button: two benign verbs and one that throws
 * work away should not read as three of a kind. It greys out when the picture
 * is already as shot, so the group also says whether there is anything to undo.
 *
 * `children` are the HOST's own verbs, drawn in the same well past a hairline
 * (variant E2): the Develop bar puts its A/B and its `?` there, so the row ends
 * with ONE block of verbs instead of three loose pills. They stay the host's
 * because they are about its stage — a modal has neither.
 *
 * The modal keeps the links (`DevelopClipboardActions`): a sheet has room, and
 * no stage bar.
 *
 * `clip` lets a host copy MORE than the develop numbers through the same two
 * glyphs — the Develop tool copies the whole picture — and hang a ▾ off the
 * paste for what a paste carries. The ▾ is drawn always, greyed when nothing
 * is held: a control that appeared on a copy would slide every verb after it.
 */
export interface DevelopClipVerbs {
  canCopy: boolean;
  copyTitle: string;
  /** The copy; its return says how it went (`VerbReturn`) — the glyph lives it (`useVerb`). */
  onCopy: () => VerbReturn;
  canPaste: boolean;
  pasteTitle: string;
  onPaste: () => VerbReturn;
  /**
   * Whether a paste lands on the picture ON SCREEN (false when it goes to a
   * selection that leaves it out): only then does the stage echo it.
   */
  pasteLandsHere?: boolean;
  /** What a paste carries, as toggles — the ▾ beside the paste glyph. */
  pasteMenu: readonly OverflowItem[];
}

export function DevelopActionsGroup({
  draft,
  asShot,
  onReplace,
  onTold,
  className = '',
  size = 'sm',
  clipboard = true,
  clip,
  verbs,
  onOutcome,
  echo = null,
  children,
}: {
  draft: DevelopSettings;
  asShot: boolean;
  onReplace: (next: DevelopSettings) => void;
  onTold: (message: string) => void;
  className?: string;
  /** `md` on a phone: 28px is a caption's height, not a finger's target. */
  size?: ButtonSize;
  /** The three verbs themselves — a stage with no develop to copy (the crop) keeps the well for `children` alone. */
  clipboard?: boolean;
  /** The host's own copy and paste, in place of the develop numbers'. */
  clip?: DevelopClipVerbs;
  /**
   * The host's copy and paste VERBS (`useVerb`), when a keyboard shortcut
   * drives them too — ⌘C lights the very glyph a press would. Absent, the
   * group owns its own.
   */
  verbs?: { copy: Verb; paste: Verb };
  /**
   * Where the group's own verbs say how they went (`VerbWord` beside the
   * well). Given, a verb's word goes there and not to `onTold` — a fact said
   * twice is said once.
   */
  onOutcome?: (outcome: VerbOutcome) => void;
  /** The task scope of the picture on the stage: a paste or a reset echoes on its edge (C4). */
  echo?: string | null;
  /** The host's own verbs, past a hairline. */
  children?: ReactNode;
}) {
  const canPaste = useSyncExternalStore(subscribeDevelopClipboard, hasCopiedDevelop);
  // Each glyph LIVES its verb: down while it runs and the picture catches up,
  // ✓ or – after (`docs/press-feedback.md`, C2). Copy is instant and says ✓;
  // a paste or a reset re-renders the picture, which is what the wait is.
  const ownCopy = useVerb(onOutcome);
  const ownPaste = useVerb(onOutcome);
  const reset = useVerb(onOutcome);
  const copy = verbs?.copy ?? ownCopy;
  const paste = verbs?.paste ?? ownPaste;
  const told = (word: string) => {
    if (!onOutcome) onTold(word);
    return word;
  };
  // A grey glyph keeps the touch and says why it is grey (C3): its title was
  // the only place that lived, and a finger never shows a title.
  const copyRefusal = (clip ? !clip.canCopy : asShot) ? 'nothing to copy — this picture is as shot' : null;
  const pasteRefusal = (clip ? !clip.canPaste : !canPaste) ? 'nothing copied yet — copy an edited picture first' : null;
  const resetRefusal = asShot ? 'nothing to reset — this picture is as shot' : null;
  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-control border border-line bg-paper-2 ${className}`}
    >
      {clipboard && (
        <>
      <IconButton
        label={clip ? 'Copy this picture' : 'Copy this develop'}
        title={
          clip
            ? clip.copyTitle
            : asShot
              ? 'Nothing to copy — this picture is as shot'
              : 'Copy ⌘C — keep these numbers for the next picture, in this session'
        }
        size={size}
        aria-disabled={copyRefusal ? true : undefined}
        phase={copy.phase}
        onClick={() =>
          copyRefusal
            ? copy.refuse(copyRefusal)
            : copy.run(() => {
                if (clip) return clip.onCopy();
                copyDevelop(draft);
                return told('copied');
              })
        }
      >
        {Icons.copy}
      </IconButton>
      <IconButton
        label={clip ? 'Paste onto this picture' : 'Paste a develop onto this picture'}
        title={clip ? clip.pasteTitle : canPaste ? 'Paste ⌘V — replace these numbers with the copied ones' : 'Nothing copied yet'}
        size={size}
        aria-disabled={pasteRefusal ? true : undefined}
        phase={paste.phase}
        onClick={() =>
          pasteRefusal
            ? paste.refuse(pasteRefusal)
            : paste.run(
                () => {
                  if (clip) return clip.onPaste();
                  const pasted = pasteDevelop();
                  if (!pasted) return false;
                  onReplace(pasted);
                  return told('pasted');
                },
                { echo: clip?.pasteLandsHere === false ? null : echo },
              )
        }
      >
        {Icons.paste}
      </IconButton>
      {clip && (
        <OverflowMenu
          label="What a paste carries"
          icon={Icons.down}
          size={size}
          align="start"
          className="-ml-0.5 [&>button]:w-4 [&>button]:min-w-0 [&>button]:px-0"
          items={clip.pasteMenu}
        />
      )}
      <IconButton
        label="Reset to as shot"
        title="Reset to as shot — throw these numbers away"
        variant="ghost"
        size={size}
        aria-disabled={resetRefusal ? true : undefined}
        phase={reset.phase}
        onClick={() =>
          resetRefusal
            ? reset.refuse(resetRefusal)
            : reset.run(
                () => {
                  onReplace({ ...DEFAULT_DEVELOP });
                  return told('reset — ⌘Z brings it back');
                },
                { echo },
              )
        }
      >
        {Icons.reset}
      </IconButton>
        </>
      )}
      {clipboard && children && <span className="flex-none w-px h-[1.1rem] mx-1 bg-line-strong" />}
      {children}
    </div>
  );
}

/**
 * Copy · Paste · As shot. The clipboard is module state, so the same
 * correction crosses Trips ↔ Studio ↔ the Develop tool with zero storage.
 */
export function DevelopClipboardActions({
  draft,
  asShot,
  onReplace,
  echo = null,
}: {
  draft: DevelopSettings;
  asShot: boolean;
  onReplace: (next: DevelopSettings) => void;
  /** The task scope of the sheet's picture: a paste or As shot echoes on its edge (C4). */
  echo?: string | null;
}) {
  const canPaste = useSyncExternalStore(subscribeDevelopClipboard, hasCopiedDevelop);
  // The modal's three links live their verbs like the tool's glyphs (C2): in
  // Trips and the Studio a paste re-renders the sheet's picture too. Their
  // word is drawn BESIDE them (C3) rather than in the footer, a sheet's width
  // away; a grey link keeps the touch and says why. The footer's told line
  // stays for the sheet's other verbs.
  const [word, say] = useVerbWord();
  // On a phone the links open the sheet's second row, near the left edge:
  // the word goes above them there.
  const compact = useIsCompact();
  return (
    <span className="relative inline-flex items-center gap-2.5">
      <VerbWord word={word} side={compact ? 'aboveEnd' : 'left'} />
      <VerbButton
        onRun={() => {
          copyDevelop(draft);
          return 'copied';
        }}
        onOutcome={say}
        refusal={asShot ? 'nothing to copy — this picture is as shot' : null}
        className={`${developLinkClass} ${VERB_INK} whitespace-nowrap`}
        title="Keep these numbers for the next picture, in this session"
      >
        Copy
      </VerbButton>
      <VerbButton
        onRun={() => {
          const pasted = pasteDevelop();
          if (!pasted) return { ok: false, word: 'nothing copied yet' };
          onReplace(pasted);
          return 'pasted';
        }}
        onOutcome={say}
        echo={echo}
        refusal={canPaste ? null : 'nothing copied yet — copy a corrected picture first'}
        className={`${developLinkClass} ${VERB_INK} whitespace-nowrap`}
        title={canPaste ? 'Replace these numbers with the copied ones' : 'Nothing copied yet'}
      >
        Paste
      </VerbButton>
      <VerbButton
        onRun={() => {
          onReplace({ ...DEFAULT_DEVELOP });
          return 'as shot';
        }}
        onOutcome={say}
        echo={echo}
        refusal={asShot ? 'already as shot' : null}
        className={`${developLinkClass} ${VERB_INK} whitespace-nowrap`}
      >
        As shot
      </VerbButton>
    </span>
  );
}

/**
 * The host's presets: a chip writes a COPY of its numbers into the draft,
 * `Save current as…` names the draft. `onNaming` tells the host while the name
 * field is open, so Enter belongs to that field and not to Done.
 */
export function DevelopPresetsSection({
  presets,
  draft,
  asShot,
  onApply,
  onTold,
  onNaming,
  look,
  onApplyLook,
}: {
  presets: DevelopPresets;
  draft: DevelopSettings;
  asShot: boolean;
  onApply: (settings: DevelopSettings) => void;
  onTold: (message: string) => void;
  onNaming?: (naming: boolean) => void;
  /**
   * The picture's own look, from a host whose pictures OWN one (the Develop
   * tool): offered to a new preset as "with its look". Absent where a look
   * lives elsewhere — Trips' rungs, the Studio's grade.
   */
  look?: SavedGrade | null;
  /** Wear a preset's look — the same host only; elsewhere the numbers apply alone, and say so. */
  onApplyLook?: (look: SavedGrade) => void;
}) {
  const [naming, setNamingState] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [withLook, setWithLook] = useState(false);
  const canSaveLook = Boolean(look);
  const setNaming = (on: boolean) => {
    setNamingState(on);
    onNaming?.(on);
  };
  return (
    <DevelopFold
      id="presets"
      title="Presets"
      info={
        <p>
          Your own names for a light{presets.keptOn ? `, kept ${presets.keptOn}` : ''}. A chip writes a
          COPY of its numbers here — applied, never followed, so editing a preset later changes no
          picture. There is no factory set. A preset saved in the Develop tool may carry the
          picture’s LOOK too (<em>+ look</em>); it is worn where a picture owns its look, and
          elsewhere the numbers apply alone.
        </p>
      }
    >
      {presets.place && <PresetsPlaceRow place={presets.place} />}
      {presets.list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.list.map((p) => (
            <span key={p.id} className="inline-flex items-center rounded-full border border-line-strong bg-paper overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  onApply({ ...DEFAULT_DEVELOP, ...p.settings });
                  if (p.look && onApplyLook) onApplyLook(p.look);
                  onTold(p.look && !onApplyLook ? `applied ${p.name} — its look stays in Develop` : `applied ${p.name}`);
                }}
                className="px-2.5 py-[0.3rem] border-0 bg-transparent text-xs text-ink-soft cursor-pointer hover:text-accent-ink"
                title={
                  describeDevelop(p.settings) +
                  (p.look ? (onApplyLook ? ' · and its look' : ' · its look applies in the Develop tool only; here the numbers alone') : '')
                }
              >
                {p.name}
                {p.look && (
                  <span className={`ml-1 font-mono text-3xs ${onApplyLook ? 'text-accent-ink' : 'text-faint line-through'}`}>+ look</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => presets.onRemove(p.id)}
                className="px-2 py-[0.3rem] border-0 border-l border-line bg-transparent font-mono text-3xs text-muted cursor-pointer hover:text-accent"
                aria-label={`Remove preset ${p.name}`}
                title="Remove this preset — the pictures it was applied to keep their numbers"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {naming ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const name = presetName.trim();
            if (!name) return;
            presets.onSave(name, { ...draft }, withLook && look ? look : null);
            onTold(withLook && look ? `saved ${name} with its look` : `saved ${name}`);
            setPresetName('');
            setNaming(false);
          }}
        >
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              // The host's own Escape closes it; here it closes the field.
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setNaming(false);
              }
            }}
            placeholder="Name this light"
            aria-label="Preset name"
            autoFocus
            className="flex-1 min-w-0 px-2.5 py-[0.3rem] rounded-full border border-line-strong bg-paper text-xs max-[820px]:text-base leading-tight text-ink placeholder:text-faint focus:outline-none focus:border-accent"
          />
          {canSaveLook && (
            <label className="flex-none inline-flex items-center gap-1 font-mono text-3xs text-muted cursor-pointer select-none" title="Save this picture’s look with the light">
              <input type="checkbox" checked={withLook} onChange={(e) => setWithLook(e.target.checked)} className="accent-[var(--color-accent)]" />
              + look
            </label>
          )}
          <button type="submit" className={developButtonClass} disabled={!presetName.trim()}>
            Save
          </button>
          <button type="button" onClick={() => setNaming(false)} className={developLinkClass}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          disabled={asShot && !canSaveLook}
          className={`${developButtonClass} self-start`}
          title={asShot && !canSaveLook ? 'Move a slider first' : 'Keep these numbers under a name of your own'}
        >
          Save current as…
        </button>
      )}
    </DevelopFold>
  );
}

/**
 * Where a host's own preset list is kept, and the move to another source —
 * offered only when a second source can keep it. The move is the person's
 * gesture; what could not be done is said here, never swallowed.
 */
function PresetsPlaceRow({ place }: { place: DevelopPresetsPlace }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const movable = place.options.length > 1;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-3xs text-muted">
        {/* With a picker, the picker names the place; the sentence says only how it stands. */}
        <span>{place.status ?? (movable ? 'kept' : `kept in ${place.label}`)}</span>
        {movable && (
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">Keep your presets on</span>
            <select
              value={place.sourceId}
              disabled={busy}
              onChange={(e) => {
                const target = e.target.value;
                setBusy(true);
                setProblem(null);
                void place.onKeepOn(target).then((why) => {
                  setBusy(false);
                  setProblem(why);
                });
              }}
              className="rounded-full border border-line-strong bg-paper px-1.5 py-0.5 font-mono text-3xs text-ink-soft cursor-pointer disabled:cursor-wait"
              title="Keep your presets on another source — every Develop sheet reads the same book"
            >
              {place.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id === place.sourceId ? `on ${o.label}` : `keep on ${o.label}`}
                </option>
              ))}
            </select>
          </label>
        )}
        {busy && <span>moving…</span>}
      </div>
      {problem && <p className="m-0 text-xs text-accent-ink">{problem}</p>}
    </div>
  );
}

/** The host's batch verbs, each handed a copy of the draft on its click. */
export function DevelopApplySection({
  verbs,
  draft,
  onTold,
}: {
  verbs: readonly DevelopApplyVerb[];
  draft: DevelopSettings;
  onTold: (message: string) => void;
}) {
  if (verbs.length === 0) return null;
  return (
    <DevelopFold
      id="apply"
      title="Apply to…"
      foldable={verbs.length > 1}
      info={
        <p>
          The same numbers written onto other pictures, now, each as its own copy — the look under it
          stays theirs. Done still writes this one.
        </p>
      }
    >
      {verbs.map((verb) => (
        <div key={verb.id} className="flex flex-col items-start gap-1">
          {/* Writing onto other pictures is the slow verb here (each re-bakes
              its own cube): the button stays down until that is over. */}
          <VerbButton
            onRun={() => {
              verb.run({ ...draft });
              onTold(`done · ${verb.label.toLowerCase()}`);
            }}
            className={`${developButtonClass} ${VERB_GROUND}`}
          >
            {verb.label}
          </VerbButton>
          {verb.hint && <span className="font-mono text-3xs text-faint leading-relaxed">{verb.hint}</span>}
        </div>
      ))}
    </DevelopFold>
  );
}

/** The look under the correction: the host's own grade panel, bound to the same stack. */
export function DevelopLookSection({
  stack,
  header,
  legend,
  previewHeight = null,
  previewImage = null,
  previewLabel = null,
}: {
  stack: LutStack;
  header?: ReactNode;
  /** What the ⓘ says about whose look this is — a host whose look is not the piece's says so. */
  legend?: ReactNode;
  /** The stage's real height in pixels — what tells the texture section whether its grain can be SEEN. */
  previewHeight?: number | null;
  /**
   * The picture on screen, handed to the look gallery so its SCENE can show
   * the aimed look on THIS photograph instead of on a reference frame
   * (`shared/lut/look-scene.ts`). Every host here has it decoded already.
   */
  previewImage?: LutPreviewSource | null;
  previewLabel?: string | null;
}) {
  return (
    <DevelopFold
      id="look"
      title="Look"
      marked={stack.layers.length > 0}
      info={
        legend ?? (
          <p>
            The same grade the piece already wears, applied AFTER this correction — set both in one
            place. Looks apply top to bottom and the output transform last.
          </p>
        )
      }
    >
      {header}
      <GradePanel
        stack={stack}
        previewHeight={previewHeight}
        previewImage={previewImage}
        previewLabel={previewLabel}
      />
    </DevelopFold>
  );
}
