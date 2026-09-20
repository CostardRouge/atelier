import { useState, type ReactNode } from 'react';
import type { LutStack } from '../lut/use-lut-stack';
import StageZoomControl from '../ui/StageZoomControl';
import useDialogKeys from '../ui/use-dialog-keys';
import { usePixelView } from '../ui/use-pixel-view';
import type { DevelopSettings } from './develop';
import { developButtonClass, developLegendClass, developPillClass } from './develop-classes';
import type { DevelopApplyVerb, DevelopPresets } from './develop-host';
import { usePresetBookHost } from './use-preset-book';
import {
  DevelopApplySection,
  DevelopClipboardActions,
  DevelopLookSection,
  DevelopPresetsSection,
} from './DevelopSections';
import DevelopCurve from './DevelopCurve';
import { DevelopAutoSection, DevelopLevelsSection } from './DevelopAuto';
import { whiteBalanceFor } from './auto-develop';
import DevelopHistogram from './DevelopHistogram';
import DevelopSliders from './DevelopSliders';
import DevelopViewport, { DevelopCaption } from './DevelopViewport';
import { useDevelopDraft, useTold } from './use-develop-draft';
import { useDevelopPicture } from './use-develop-picture';

export interface DevelopSheetProps {
  /** The picture, or null when the slide has none — the controls still show. */
  file: File | null;
  /** Frame of a clip to sit on; ignored for a photo. */
  videoTimeSeconds?: number;
  /** What the sheet is about, in the header: usually the file's name. */
  title: string;
  /** What the picture IS — `JPEG · 8-bit`, `proxy · 8-bit`, later `RAW · 16-bit`. */
  fidelity?: string | null;
  /** One line under the picture: what this picture can and cannot give back. */
  note?: string | null;
  /** What an empty frame says — the host knows where a picture comes from. */
  emptyText?: string;
  /**
   * The host's stack. The sheet holds its DRAFT in `stack.develop`, so the
   * preview bakes through the deferred path the strength slider already uses;
   * the host's own renderers keep reading the stored value through
   * `composeWith` until Done writes it.
   */
  stack: LutStack;
  /** What the sheet opened on. */
  value: DevelopSettings | null;
  /** The corrected picture's numbers; null when it came back to as shot. */
  onDone: (develop: DevelopSettings | null) => void;
  onCancel: () => void;
  /** Drawn above the Look panel — a host's scope chips. */
  lookHeader?: ReactNode;
  /** What Done writes to, in the footer: "writes to this slide". */
  footerHint?: string;
  /**
   * The presets drawn beside the sliders. Omitted, it is the person's own book
   * (`use-preset-book.ts`), the same list in every Develop host; a host passes
   * a list only to show another one.
   */
  presets?: DevelopPresets;
  /** Batch verbs the host offers (`DevelopApplyVerb`). */
  applyTo?: readonly DevelopApplyVerb[];
}

/**
 * The Develop sheet: one picture, its correction as sliders, the look under
 * it, and Done — the MODAL home of the develop workbench.
 *
 * The workbench is shared blocks, and this file only lays them out in a
 * dialog: `useDevelopDraft` (the numbers, riding the host's stack),
 * `useDevelopPicture` + `DevelopViewport` (decode, grade, split, zoom),
 * `DevelopSliders`, and the sections of `DevelopSections.tsx`. The Develop
 * tool (`docs/develop-tool.md`) lays the same blocks out full-screen, so a
 * change to how a picture is developed is made once.
 *
 * Every host opens the same sheet (`docs/photo-develop.md` §7.1): Trips over a
 * slide, the Studio over its active media. What it draws is develop → look →
 * output — the host's stack with the draft baked in first — so the picture on
 * the sheet IS what the piece will deliver, and the before/after is the
 * untouched frame against it. Cancel puts the stack back.
 */
export default function DevelopSheet({
  file,
  videoTimeSeconds = 0,
  title,
  fidelity = null,
  note = null,
  emptyText,
  stack,
  value,
  onDone,
  onCancel,
  lookHeader,
  footerHint,
  presets: hostPresets,
  applyTo,
}: DevelopSheetProps) {
  const book = usePresetBookHost();
  const presets = hostPresets ?? book;
  const draft = useDevelopDraft(value, stack);
  const [told, tell] = useTold();
  const [naming, setNaming] = useState(false);
  const [pixelView, setPixelView] = usePixelView();
  // The loupe too: the modal hosts gain RENDERING, never panels (§4.2), and
  // the file's own pixels under a magnified view are rendering.
  const picture = useDevelopPicture({ file, videoTimeSeconds, cube: stack.composed, loupe: true, pixelView });

  const done = () => onDone(draft.result());
  // While a preset is being named, Enter belongs to that field's own form.
  useDialogKeys({ onCancel, onConfirm: naming ? null : done });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Develop ${title}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[64rem] h-[min(90dvh,54rem)] flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-4 overflow-hidden max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:p-3 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Header: what, what it is, the clipboard, the zoom, close. */}
        <div className="flex-none flex items-center gap-2.5 min-w-0">
          <h2 className="m-0 font-serif text-lg min-w-0 truncate" title={title}>
            Develop · {title}
          </h2>
          {fidelity && <span className={developPillClass}>{fidelity}</span>}
          <span className="flex-1" />
          <DevelopClipboardActions draft={draft.draft} asShot={draft.asShot} onReplace={draft.setDraft} onTold={tell} />
          {/* In the header, never over the picture (the lightbox's rule); under
              820px there is none — the pinch is the gesture there. */}
          {picture.source && (
            <StageZoomControl zoom={picture.view.zoom} hint="wheel, or pinch" className="flex-none max-[820px]:hidden" />
          )}
          {/* Only where it means anything: below 1:1 the browser is downscaling
              and `pixelated` is simply worse. The preference is the machine's,
              shared with the Develop tool (`use-pixel-view.ts`). */}
          {picture.source && picture.view.magnifying && (
            <button
              type="button"
              className={`${developPillClass} flex-none cursor-pointer hover:border-accent max-[820px]:hidden`}
              onClick={() => setPixelView(pixelView === 'pixels' ? 'smooth' : 'pixels')}
              title={
                pixelView === 'pixels'
                  ? 'Pixels as pixels — past 100 % nothing is invented between them'
                  : 'Smoothed — past 100 % the gradients between pixels are the browser’s, not the picture’s'
              }
            >
              {pixelView === 'pixels' ? 'pixels' : 'smooth'}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            // The zoom pill's own height (34px), the lightbox's rule: controls
            // sharing a row share a height. Kept when the pill is absent, so the
            // header does not change height as a picture decodes.
            className="flex-none inline-flex items-center h-[2.125rem] font-mono text-3xs tracking-[0.12em] uppercase text-muted border border-line rounded-full px-3.5 hover:text-accent hover:border-line-strong transition-colors cursor-pointer"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 flex gap-4 max-[820px]:flex-col max-[820px]:gap-3">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 max-[820px]:flex-none">
            <DevelopViewport
              picture={picture}
              hasFile={Boolean(file)}
              emptyText={emptyText}
              pixelView={pixelView}
              onPick={(linear) => {
                const { temperature, tint, clamped } = whiteBalanceFor(linear);
                draft.patch({ temperature, tint });
                tell(
                  `picked grey · temperature ${temperature}, tint ${tint}` +
                    (clamped ? ' · as far as the sliders reach' : ''),
                );
              }}
              // On a phone the picture takes a fixed share of the MEASURED app
              // height (`--app-h`, never `vh`: a locked document is where a
              // stale unit can never be corrected — `frontend.md`) and the
              // column scrolls under it.
              className="flex-1 max-[820px]:flex-none max-[820px]:h-[calc(var(--app-h)*0.38)]"
            />
            <DevelopCaption draft={draft.draft} note={note} picture={picture} />
          </div>

          {/* The column: the pipeline in order, then the look under it. */}
          <div className="w-[22rem] flex-none min-h-0 overflow-y-auto overscroll-contain pr-1.5 flex flex-col gap-4 max-[820px]:w-full max-[820px]:flex-1">
            <DevelopHistogram histogram={picture.histogram} />
            <DevelopAutoSection
              stats={picture.stats}
              onPatch={draft.patch}
              onTold={tell}
              picking={picture.picking}
              onPicking={picture.setPicking}
            />
            <DevelopSliders value={draft.draft} onChange={draft.set} />
            <DevelopLevelsSection value={draft.draft.levels} onChange={(levels) => draft.patch({ levels })} />
            <DevelopCurve
              value={draft.draft.curves}
              histogram={picture.histogram}
              onChange={(curves) => draft.patch({ curves })}
            />
            <DevelopPresetsSection
              presets={presets}
              draft={draft.draft}
              asShot={draft.asShot}
              onApply={draft.setDraft}
              onTold={tell}
              onNaming={setNaming}
            />
            {applyTo && <DevelopApplySection verbs={applyTo} draft={draft.draft} onTold={tell} />}
            <DevelopLookSection stack={stack} header={lookHeader} />
          </div>
        </div>

        {/* Footer: Enter is Done, Escape is Cancel. */}
        <div className="flex-none flex items-center gap-2 pt-3 border-t border-line">
          {footerHint && <span className={developLegendClass}>{footerHint}</span>}
          {told && (
            <span className="font-mono text-2xs text-accent-ink" role="status">
              · {told}
            </span>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className={developButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={done}
            className="px-4 py-[0.4rem] rounded-full border border-ink bg-ink text-paper text-xs font-semibold cursor-pointer hover:bg-accent hover:border-accent"
          >
            Done
            <span className="ml-1.5 font-mono text-3xs opacity-70">↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
