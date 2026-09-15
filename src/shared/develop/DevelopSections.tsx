/**
 * The workbench's sections beside the sliders — the clipboard verbs, the
 * presets, the batch verbs and the look. Each draws what a HOST passes
 * (`develop-host.ts`) and reports what it did through `onTold`, so the modal
 * and the Develop tool place them where their own layout wants.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import GradePanel from '../lut/GradePanel';
import type { LutStack } from '../lut/use-lut-stack';
import SectionLegend from '../ui/SectionLegend';
import { DEFAULT_DEVELOP, describeDevelop, type DevelopSettings } from './develop';
import { developButtonClass, developLinkClass } from './develop-classes';
import { copyDevelop, hasCopiedDevelop, pasteDevelop, subscribeDevelopClipboard } from './develop-clipboard';
import type { DevelopApplyVerb, DevelopPresets } from './develop-host';

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
}: {
  presets: DevelopPresets;
  draft: DevelopSettings;
  asShot: boolean;
  onApply: (settings: DevelopSettings) => void;
  onTold: (message: string) => void;
  onNaming?: (naming: boolean) => void;
}) {
  const [naming, setNamingState] = useState(false);
  const [presetName, setPresetName] = useState('');
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
          picture. There is no factory set.
        </p>
      </SectionLegend>
      {presets.list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.list.map((p) => (
            <span key={p.id} className="inline-flex items-center rounded-full border border-line-strong bg-paper overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  onApply({ ...DEFAULT_DEVELOP, ...p.settings });
                  onTold(`applied ${p.name}`);
                }}
                className="px-2.5 py-[0.3rem] border-0 bg-transparent text-xs text-ink-soft cursor-pointer hover:text-accent-ink"
                title={describeDevelop(p.settings)}
              >
                {p.name}
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
            presets.onSave(name, { ...draft });
            onTold(`saved ${name}`);
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
            className="flex-1 min-w-0 px-2.5 py-[0.3rem] rounded-full border border-line-strong bg-paper text-base leading-tight text-ink focus:outline-none focus:border-accent"
          />
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
          disabled={asShot}
          className={`${developButtonClass} self-start`}
          title={asShot ? 'Move a slider first' : 'Keep these numbers under a name of your own'}
        >
          Save current as…
        </button>
      )}
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
export function DevelopLookSection({ stack, header }: { stack: LutStack; header?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 pt-3 border-t border-line">
      <span className="flex items-center gap-2">
        <SectionLegend label="Look">
          <p>
            The same grade the piece already wears, applied AFTER this correction — set both in one
            place. Looks apply top to bottom and the output transform last.
          </p>
        </SectionLegend>
      </span>
      {header}
      <GradePanel stack={stack} />
    </div>
  );
}
