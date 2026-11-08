import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useObjectUrl } from '../../shared/media/use-object-url';
import type { Suggestion } from '../../shared/recap/recap-suggest';
import { RECIPES } from '../../shared/recap/recap-doc';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import TemplatePreview from './TemplatePreview';
import { getThumb } from './recap-store';

export type SectionId = 'suggestions' | 'planned' | 'yours' | 'new';
const KEY = 'atelier.recap.gallery.sections';

/**
 * Which of the gallery's sections are open (lab 10, his yes of 2026-11-07),
 * remembered on this device. Absent, a section opens by its own rule:
 * Suggestions closed, Your recaps open, New recap open only while there is
 * no recap yet.
 */
export function useSectionState(hasRecaps: boolean): { isOpen: (id: SectionId) => boolean; toggle: (id: SectionId, open?: boolean) => void } {
  const [kept, setKept] = useState<Partial<Record<SectionId, boolean>>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
      const out: Partial<Record<SectionId, boolean>> = {};
      for (const id of ['suggestions', 'planned', 'yours', 'new'] as const) if (typeof raw[id] === 'boolean') out[id] = raw[id] as boolean;
      return out;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(kept));
    } catch {
      // A private window keeps it for this visit only.
    }
  }, [kept]);
  const isOpen = useCallback((id: SectionId) => kept[id] ?? (id === 'yours' || id === 'planned' ? true : id === 'new' ? !hasRecaps : false), [kept, hasRecaps]);
  const toggle = useCallback((id: SectionId, open?: boolean) => setKept((k) => ({ ...k, [id]: open ?? !(k[id] ?? (id === 'yours' || id === 'planned' ? true : id === 'new' ? !hasRecaps : false)) })), [hasRecaps]);
  return { isOpen, toggle };
}

/** One section of the gallery: a header that opens and closes it — its count, a peek, its own actions — then its body. */
export function GallerySection({
  id,
  title,
  count,
  hot = false,
  open,
  onToggle,
  peek,
  actions,
  children,
}: {
  id: SectionId;
  title: string;
  count?: number | null;
  /** The count in the accent: something waits there. */
  hot?: boolean;
  open: boolean;
  onToggle: () => void;
  /** Shown beside the title while closed (the suggestions' posters, a word). */
  peek?: ReactNode;
  /** Its own buttons, at the header's end. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const body = `recap-section-${id}`;
  return (
    <section aria-label={title} className="flex flex-col border-t border-line first:border-t-0">
      <div className="flex items-center gap-2 min-h-12 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={body}
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2.5 p-0 border-0 bg-transparent text-left cursor-pointer pointer-coarse:min-h-11"
        >
          <span aria-hidden="true" className={`inline-flex w-4 justify-center text-muted transition-transform duration-150 ease-paper ${open ? 'rotate-90' : ''}`}>
            {Icons.chevronRight}
          </span>
          <span className="font-serif text-xl leading-none whitespace-nowrap">{title}</span>
          {count != null && <span className={`flex-none font-mono text-2xs tabular-nums px-1.5 py-[1px] rounded-[6px] ${hot ? 'bg-accent-wash text-accent-ink' : 'bg-surface text-ink-soft'}`}>{count}</span>}
          {!open && peek && <span className="min-w-0 flex items-center gap-2 overflow-hidden">{peek}</span>}
        </button>
        {actions}
      </div>
      <div id={body} hidden={!open} className="pb-5 pt-1">
        {children}
      </div>
    </section>
  );
}

/** The poster a suggestion shows: its model's own, else the template's. */
export function SuggestionPoster({ s, height }: { s: Suggestion; height: number }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let alive = true;
    if (s.model) void getThumb(s.model.id).then((b) => alive && setBlob(b));
    return () => {
      alive = false;
    };
  }, [s.model]);
  const url = useObjectUrl(blob);
  return url ? <img src={url} alt="" className="block h-full w-auto object-contain" style={{ maxHeight: height }} /> : <TemplatePreview template={s.template} anchor={s.anchor} height={height} />;
}

/**
 * A ready recap: its model's poster (the dress it repeats), a READY tag, what
 * it repeats — and *Make it* (made, filled from the Winnow as it opens) or
 * *Not this month*. Nothing is saved until he makes it.
 */
export function SuggestionCard({ s, onMake, onHide }: { s: Suggestion; onMake: () => void; onHide: () => void }) {
  const compact = useIsCompact();
  return (
    <div className="flex flex-col bg-surface border-[1.5px] border-dashed border-accent rounded-paper-lg overflow-hidden shadow-paper-soft">
      <button type="button" onClick={onMake} aria-label={`Make ${RECIPES[s.template].label} · ${s.label}`} className="p-0 border-0 bg-frame cursor-pointer leading-[0]">
        <span className="w-full aspect-[4/5] flex items-center justify-center overflow-hidden">
          <SuggestionPoster s={s} height={compact ? 150 : 200} />
        </span>
      </button>
      <div className={`flex flex-col ${compact ? 'gap-1 p-2.5' : 'gap-1.5 p-[0.8rem_1rem_0.9rem]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={`m-0 flex-1 min-w-0 font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${compact ? 'text-sm' : 'text-base'}`} title={`${RECIPES[s.template].label} · ${s.label}`}>
            {s.template === 'month' ? s.label : `${RECIPES[s.template].label} · ${s.label}`}
          </h3>
          <span className="flex-none font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] bg-accent-wash text-accent-ink">ready</span>
        </div>
        <p className={`m-0 text-ink-soft ${compact ? 'text-2xs' : 'text-xs'}`}>
          {RECIPES[s.template].label}, {s.as}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Button size="sm" variant="primary" onClick={onMake} title="Made now and opened — it fills itself from your Winnow">
            Make it
          </Button>
          <Button size="sm" variant="ghost" onClick={onHide} title="Hidden until the next one">
            {s.key.startsWith('week:') ? 'Not this week' : s.key.startsWith('wrapped:') ? 'Not this year' : 'Not this month'}
          </Button>
        </div>
      </div>
    </div>
  );
}
