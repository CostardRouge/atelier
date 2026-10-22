/**
 * The workbench's sections beside the sliders — the clipboard verbs, the
 * presets, the batch verbs and the look. Each draws what a HOST passes
 * (`develop-host.ts`) and reports what it did through `onTold`, so the modal
 * and the Develop tool place them where their own layout wants.
 */

import type { SavedGrade } from '../lut/saved-grade';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
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
import { useFingerSize } from '../ui/use-coarse-pointer';
import { VERB_GROUND, VERB_INK, VerbButton } from '../ui/VerbMarks';
import DevelopFold from './DevelopFold';
import { DEFAULT_DEVELOP, carriesDevelop, describeDevelop, sameDevelop, withoutBase, type DevelopPreset, type DevelopSettings } from './develop';
import { developButtonClass, developLinkClass } from './develop-classes';
import { copyDevelop, hasCopiedDevelop, pasteDevelop, subscribeDevelopClipboard } from './develop-clipboard';
import type { DevelopApplyVerb, DevelopPresets, DevelopPresetsPlace } from './develop-host';
import { focusOnMount } from '../ui/focus';
import { uniqueDocName } from '../sources/doc-name';

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
          label="Sections — what ⌘V carries, apply, reset"
          icon={Icons.down}
          size={size}
          align="start"
          className="-ml-0.5 [&>button]:w-6 [&>button]:min-w-0 [&>button]:px-0"
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

/** How long a removed preset's row offers Undo. */
const PRESET_UNDO_MS = 8000;

/**
 * The host's presets as ROWS (2026-10-22, his pick B on a computer and E on a
 * phone, lab https://claude.ai/artifact/6JZ93yBx3ad7tc98amR6it): each row is
 * ONE target — it applies a COPY of the preset's numbers — and says what the
 * preset does under its name (`describeDevelop`), `+ look` where it carries
 * one. A dot marks the preset whose numbers ARE the picture's (`sameDevelop`
 * on the draft, nothing stored: it goes out as soon as a slider moves). The
 * rest is the row's ⋯ — update it with this picture, rename, clone, remove —
 * so the chip's three 22 px targets, its × beside the name and its silent
 * delete are gone: a removal leaves an Undo in the row's place. Saving is the
 * quiet last row. `onNaming` tells the host while a name field is open, so
 * Enter belongs to that field and not to Done.
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
  const finger = useFingerSize();
  const [naming, setNamingState] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [withLook, setWithLook] = useState(false);
  const canSaveLook = Boolean(look);
  // A name being given: a copy of a preset, or a preset's new name. `typed`
  // stays null until the person types, so the field follows the suggestion.
  const [renaming, setRenamingState] = useState<{ id: string; name: string; mode: 'clone' | 'rename'; typed: string | null } | null>(null);
  // The preset just removed, and where it stood: its row offers Undo for a while.
  const [removed, setRemoved] = useState<{ preset: DevelopPreset; at: number } | null>(null);
  useEffect(() => {
    if (!removed) return;
    const t = window.setTimeout(() => setRemoved(null), PRESET_UNDO_MS);
    return () => window.clearTimeout(t);
  }, [removed]);
  const setNaming = (on: boolean) => {
    setNamingState(on);
    onNaming?.(on || renaming !== null);
  };
  const setRenaming = (next: typeof renaming) => {
    setRenamingState(next);
    onNaming?.(next !== null || naming);
  };
  // The draft as a preset would hold it: the base belongs to one picture.
  const portable = useMemo(() => withoutBase(draft), [draft]);
  const apply = (p: DevelopPreset) => {
    onApply({ ...DEFAULT_DEVELOP, ...p.settings });
    if (p.look && onApplyLook) onApplyLook(p.look);
    onTold(p.look && !onApplyLook ? `applied ${p.name} — its look stays in Develop` : `applied ${p.name}`);
  };
  const menu = (p: DevelopPreset, at: number): OverflowItem[] => [
    {
      id: 'update',
      label: (
        <span className="flex flex-col gap-0.5">
          <span>Update with this picture</span>
          <span className="font-mono text-3xs text-muted">{p.look && look ? 'its light and look replace the preset’s' : 'its light replaces the preset’s'}</span>
        </span>
      ),
      disabled: asShot && !(p.look && look),
      title: asShot && !(p.look && look) ? 'Move a slider first' : undefined,
      onSelect: () => {
        presets.onUpdate(p.id, { ...draft }, p.look ? (look ?? p.look) : null);
        onTold(`${p.name} now holds this picture’s light`);
      },
    },
    { id: 'rename', label: 'Rename…', onSelect: () => (setNaming(false), setRenaming({ id: p.id, name: p.name, mode: 'rename', typed: null })) },
    { id: 'clone', label: 'Clone…', onSelect: () => (setNaming(false), setRenaming({ id: p.id, name: p.name, mode: 'clone', typed: null })) },
    {
      id: 'remove',
      label: 'Remove',
      danger: true,
      title: 'The pictures it was applied to keep their numbers',
      onSelect: () => {
        presets.onRemove(p.id);
        setRemoved({ preset: p, at });
      },
    },
  ];
  const nameRow = (r: NonNullable<typeof renaming>) => (
    <PresetNameRow
      key={`${r.mode}:${r.id}`}
      mode={r.mode}
      original={r.name}
      typed={r.typed}
      taken={presets.list.filter((p) => r.mode === 'clone' || p.id !== r.id).map((p) => p.name)}
      onType={(typed) => setRenaming({ ...r, typed })}
      onCancel={() => setRenaming(null)}
      onDone={(name) => {
        if (r.mode === 'clone') {
          presets.onClone(r.id, name);
          onTold(`cloned ${r.name} as ${name}`);
        } else {
          presets.onRename(r.id, name);
          onTold(`renamed ${r.name} ${name}`);
        }
        setRenaming(null);
      }}
    />
  );
  const undoRow = removed && (
    <li key={`removed:${removed.preset.id}`} className="flex items-center gap-2 min-h-11 pointer-coarse:min-h-[3.25rem] pl-6 pr-2 rounded-[10px] bg-paper-2">
      <span className="flex-1 min-w-0 truncate text-xs text-ink-soft">{removed.preset.name} removed</span>
      <button
        type="button"
        onClick={() => {
          presets.onRestore(removed.preset, removed.at);
          onTold(`${removed.preset.name} is back`);
          setRemoved(null);
        }}
        className={developLinkClass}
      >
        Undo
      </button>
    </li>
  );
  const rows: ReactNode[] = [];
  presets.list.forEach((p, i) => {
    if (removed && removed.at === i) rows.push(undoRow);
    if (renaming?.mode === 'rename' && renaming.id === p.id) {
      rows.push(<li key={p.id}>{nameRow(renaming)}</li>);
      return;
    }
    const on = carriesDevelop(p.settings) && sameDevelop(portable, p.settings);
    const lookNote = p.look ? (onApplyLook ? ' · and its look' : ' · its look applies in the Develop tool only; here the numbers alone') : '';
    rows.push(
      <li key={p.id} className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => apply(p)}
          aria-current={on ? 'true' : undefined}
          title={`Apply ${p.name} — ${describeDevelop(p.settings)}${lookNote}`}
          className={`group flex-1 min-w-0 flex items-center gap-2 min-h-11 pointer-coarse:min-h-[3.25rem] pl-2.5 pr-2 py-1.5 rounded-[10px] border-0 text-left cursor-pointer ${
            on ? 'bg-accent-wash' : 'bg-transparent hover:bg-paper-2'
          }`}
        >
          <span aria-hidden="true" className={`flex-none w-1.5 h-1.5 rounded-full ${on ? 'bg-accent' : 'bg-transparent'}`} />
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className={`min-w-0 truncate text-sm text-ink ${on ? 'font-semibold' : 'font-medium'}`}>{p.name}</span>
              {p.look && (
                <span className={`flex-none font-mono text-3xs ${onApplyLook ? 'text-accent-ink' : 'text-faint line-through'}`}>+ look</span>
              )}
            </span>
            <span className="min-w-0 truncate font-mono text-3xs text-ink-soft">
              {carriesDevelop(p.settings) ? describeDevelop(p.settings) : 'the look alone'}
            </span>
          </span>
        </button>
        <OverflowMenu label={`Actions for ${p.name}`} items={menu(p, i)} size={finger} />
      </li>,
    );
    if (renaming?.mode === 'clone' && renaming.id === p.id) rows.push(<li key={`clone:${p.id}`}>{nameRow(renaming)}</li>);
  });
  if (removed && removed.at >= presets.list.length) rows.push(undoRow);
  return (
    <DevelopFold
      id="presets"
      title="Presets"
      info={
        <p>
          Your own names for a light{presets.keptOn ? `, kept ${presets.keptOn}` : ''}. A row writes a
          COPY of its numbers here — applied, never followed, so editing a preset later changes no
          picture; the dot marks the preset whose numbers are this picture’s. There is no factory set.
          A preset saved in the Develop tool may carry the picture’s LOOK too (<em>+ look</em>); it is
          worn where a picture owns its look, and elsewhere the numbers apply alone.
        </p>
      }
    >
      {rows.length > 0 && <ul className="m-0 -mx-2 p-0 list-none flex flex-col gap-0.5">{rows}</ul>}
      {naming ? (
        <form
          className="flex flex-col gap-2 -mx-2 p-2 rounded-[10px] bg-paper-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = presetName.trim();
            if (!name) return;
            presets.onSave(name, { ...draft }, withLook && look ? look : null);
            onTold(withLook && look ? `saved ${name} with its look` : `saved ${name}`);
            setPresetName('');
            setWithLook(false);
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
            ref={focusOnMount}
            className="min-w-0 px-2.5 py-[0.3rem] rounded-control border border-line-strong bg-surface text-xs max-[820px]:text-base leading-tight text-ink placeholder:text-faint focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            {canSaveLook && (
              <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer select-none" title="Save this picture’s look with the light">
                <input type="checkbox" checked={withLook} onChange={(e) => setWithLook(e.target.checked)} className="accent-[var(--color-accent)]" />
                with this picture’s look
              </label>
            )}
            <span className="flex-1" />
            <button type="button" onClick={() => setNaming(false)} className={developLinkClass}>
              Cancel
            </button>
            <button type="submit" className={developButtonClass} disabled={!presetName.trim()}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => (setRenaming(null), setNaming(true))}
          disabled={asShot && !canSaveLook}
          className="-mx-2 flex items-center gap-2 min-h-9 pointer-coarse:min-h-12 px-2 rounded-[10px] border-0 bg-transparent text-left text-sm font-medium text-accent-ink cursor-pointer hover:bg-accent-wash disabled:opacity-45 disabled:cursor-default disabled:hover:bg-transparent"
          title={asShot && !canSaveLook ? 'Move a slider first' : 'Keep these numbers under a name of your own'}
        >
          <span aria-hidden="true" className="inline-flex">{Icons.plus}</span>
          Save this picture’s light…
        </button>
      )}
      {presets.place && <PresetsPlaceRow place={presets.place} />}
    </DevelopFold>
  );
}

/**
 * Naming a preset — a COPY of one (the first free name prefilled: the same
 * rule as cloning a trip, a project or a roll, `doc-name.ts`, minus the
 * destination, since the book is one list kept in one place) or the preset
 * itself, renamed. The line under it says what will be kept: a name another
 * preset holds is numbered, never replaced.
 */
function PresetNameRow({
  mode,
  original,
  typed,
  taken,
  onType,
  onCancel,
  onDone,
}: {
  mode: 'clone' | 'rename';
  original: string;
  typed: string | null;
  /** The names the new one must not take — every preset's for a copy, the others' for a rename. */
  taken: readonly string[];
  onType: (typed: string) => void;
  onCancel: () => void;
  onDone: (name: string) => void;
}) {
  const suggestion = mode === 'clone' ? uniqueDocName(original, taken) : original;
  const name = typed ?? suggestion;
  const effective = uniqueDocName(name, taken);
  const verb = mode === 'clone' ? 'Clone' : 'Rename';
  return (
    <form
      className="flex flex-col gap-1 px-2 py-1.5 rounded-[10px] bg-paper-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (effective) onDone(effective);
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={name}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            // The host's own Escape closes it; here it closes the field.
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          aria-label={mode === 'clone' ? `Name of the copy of ${original}` : `New name for ${original}`}
          ref={focusOnMount}
          className="flex-1 min-w-0 px-2.5 py-[0.3rem] rounded-control border border-line-strong bg-surface text-xs max-[820px]:text-base leading-tight text-ink placeholder:text-faint focus:outline-none focus:border-accent"
        />
        <button type="submit" className={developButtonClass} aria-disabled={!effective}>
          {verb}
        </button>
        <button type="button" onClick={onCancel} className={developLinkClass}>
          Cancel
        </button>
      </div>
      <p className={`m-0 font-mono text-3xs ${!effective ? 'text-danger' : effective !== name.trim() ? 'text-warn' : 'text-muted'}`} role="status">
        {!effective
          ? 'A preset needs a name.'
          : effective !== name.trim()
            ? `“${name.trim()}” is taken → kept as “${effective}”`
            : mode === 'clone'
              ? `Copy of “${original}” — saved as “${effective}”`
              : `“${original}” becomes “${effective}”`}
      </p>
    </form>
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
