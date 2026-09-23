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
import SectionLegend from '../ui/SectionLegend';
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
 */
export function DevelopActionsGroup({
  draft,
  asShot,
  onReplace,
  onTold,
  className = '',
  size = 'sm',
  clipboard = true,
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
  /** The host's own verbs, past a hairline. */
  children?: ReactNode;
}) {
  const canPaste = useSyncExternalStore(subscribeDevelopClipboard, hasCopiedDevelop);
  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-control border border-line bg-paper-2 ${className}`}
    >
      {clipboard && (
        <>
      <IconButton
        label="Copy this develop"
        title={asShot ? 'Nothing to copy — this picture is as shot' : 'Copy ⌘C — keep these numbers for the next picture, in this session'}
        size={size}
        disabled={asShot}
        onClick={() => {
          copyDevelop(draft);
          onTold('copied');
        }}
      >
        {Icons.copy}
      </IconButton>
      <IconButton
        label="Paste a develop onto this picture"
        title={canPaste ? 'Paste ⌘V — replace these numbers with the copied ones' : 'Nothing copied yet'}
        size={size}
        disabled={!canPaste}
        onClick={() => {
          const pasted = pasteDevelop();
          if (!pasted) return;
          onReplace(pasted);
          onTold('pasted');
        }}
      >
        {Icons.paste}
      </IconButton>
      <IconButton
        label="Reset to as shot"
        title="Reset to as shot — throw these numbers away"
        variant="ghost"
        size={size}
        disabled={asShot}
        onClick={() => {
          onReplace({ ...DEFAULT_DEVELOP });
          onTold('reset');
        }}
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
  onTold,
}: {
  draft: DevelopSettings;
  asShot: boolean;
  onReplace: (next: DevelopSettings) => void;
  onTold: (message: string) => void;
}) {
  const canPaste = useSyncExternalStore(subscribeDevelopClipboard, hasCopiedDevelop);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          copyDevelop(draft);
          onTold('copied');
        }}
        disabled={asShot}
        className={`${developLinkClass} whitespace-nowrap`}
        title="Keep these numbers for the next picture, in this session"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={() => {
          const pasted = pasteDevelop();
          if (pasted) onReplace(pasted);
        }}
        disabled={!canPaste}
        className={`${developLinkClass} whitespace-nowrap`}
        title={canPaste ? 'Replace these numbers with the copied ones' : 'Nothing copied yet'}
      >
        Paste
      </button>
      <button
        type="button"
        onClick={() => onReplace({ ...DEFAULT_DEVELOP })}
        disabled={asShot}
        className={`${developLinkClass} whitespace-nowrap`}
      >
        As shot
      </button>
    </>
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
    <div className="flex flex-col gap-2 pt-3 border-t border-line">
      <SectionLegend label="Presets">
        <p>
          Your own names for a light{presets.keptOn ? `, kept ${presets.keptOn}` : ''}. A chip writes a
          COPY of its numbers here — applied, never followed, so editing a preset later changes no
          picture. There is no factory set. A preset saved in the Develop tool may carry the
          picture’s LOOK too (<em>+ look</em>); it is worn where a picture owns its look, and
          elsewhere the numbers apply alone.
        </p>
      </SectionLegend>
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
    </div>
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
    <div className="flex flex-col gap-2 pt-3 border-t border-line">
      <SectionLegend label="Apply to…">
        <p>
          The same numbers written onto other pictures, now, each as its own copy — the look under it
          stays theirs. Done still writes this one.
        </p>
      </SectionLegend>
      {verbs.map((verb) => (
        <div key={verb.id} className="flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={() => {
              verb.run({ ...draft });
              onTold(`done · ${verb.label.toLowerCase()}`);
            }}
            className={developButtonClass}
          >
            {verb.label}
          </button>
          {verb.hint && <span className="font-mono text-3xs text-faint leading-relaxed">{verb.hint}</span>}
        </div>
      ))}
    </div>
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
    <div className="flex flex-col gap-2 pt-3 border-t border-line">
      <span className="flex items-center gap-2">
        <SectionLegend label="Look">
          {legend ?? (
            <p>
              The same grade the piece already wears, applied AFTER this correction — set both in one
              place. Looks apply top to bottom and the output transform last.
            </p>
          )}
        </SectionLegend>
      </span>
      {header}
      <GradePanel
        stack={stack}
        previewHeight={previewHeight}
        previewImage={previewImage}
        previewLabel={previewLabel}
      />
    </div>
  );
}
