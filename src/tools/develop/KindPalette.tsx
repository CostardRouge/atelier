import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import BottomSheet from '../../shared/ui/BottomSheet';
import Segmented from '../../shared/ui/Segmented';
import { menuAnchor, type AnchorRect, type MenuAnchor } from '../../shared/ui/menu-anchor';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { developLinkClass } from '../../shared/develop/develop-classes';
import type { MaskOp } from '../../shared/render/mask';
import KindGlyph from './KindGlyph';
import { paletteGroups, paletteTitle, type PaletteKind, type PaletteMode } from './kind-palette';

const OPS: readonly { id: MaskOp; label: string }[] = [
  { id: 'add', label: '+ Add' },
  { id: 'subtract', label: '− Subtract' },
  { id: 'intersect', label: '∩ Intersect' },
];

/**
 * The palette of mask kinds (`kind-palette.ts`): a popover hung from the
 * button that opened it — `+ Layer`, a layer's kind chip, the recipe's `+` —
 * and a sheet on a phone. Combining a term puts Add / Subtract / Intersect at
 * its head, so the operation is chosen in the same breath as the kind.
 *
 * Drawn in a PORTAL at fixed coordinates (`menu-anchor.ts`), like every menu
 * of the suite: an inspector that scrolls must not clip it (`frontend.md`).
 */
export default function KindPalette({
  mode,
  current,
  anchorRect,
  within,
  onPick,
  onClose,
}: {
  mode: PaletteMode;
  /** The kind already there, marked — when the palette CHANGES a kind. */
  current?: PaletteKind | null;
  /** Where it hangs from, measured by the caller — called again on scroll and resize. */
  anchorRect: () => AnchorRect | null;
  /** The trigger: a press on it does not count as a press outside. */
  within?: RefObject<HTMLElement | null>;
  onPick: (kind: PaletteKind, op: MaskOp) => void;
  onClose: () => void;
}) {
  const compact = useIsCompact();
  const [op, setOp] = useState<MaskOp>('add');
  const groups = paletteGroups(mode);
  const title = paletteTitle(mode);

  const body = (
    <div className="flex flex-col gap-2.5">
      {mode === 'part' && (
        <Segmented size="sm" fill label="How it combines" value={op} onChange={setOp} options={OPS} />
      )}
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-1">
          <span className="font-mono text-3xs tracking-[0.12em] uppercase text-muted">{g.label}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {g.kinds.map((e) => {
              const isCurrent = current === e.kind;
              return (
                <button
                  key={e.kind}
                  type="button"
                  data-kind={e.kind}
                  aria-current={isCurrent || undefined}
                  onClick={() => onPick(e.kind, op)}
                  className={`grid grid-cols-[34px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-control border px-2 py-1.5 text-left cursor-pointer text-ink-soft hover:border-ink-soft hover:bg-surface ${
                    isCurrent ? 'border-accent bg-surface' : 'border-line bg-paper'
                  }`}
                >
                  <span className="row-span-2">
                    <KindGlyph kind={e.kind} />
                  </span>
                  <span className="text-xs font-medium text-ink">{e.label}</span>
                  <span className="text-3xs leading-snug text-muted">{e.line}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <BottomSheet open onClose={onClose} title={title}>
        <div className="p-3">{body}</div>
      </BottomSheet>
    );
  }
  return <Popover title={title} anchorRect={anchorRect} within={within} onClose={onClose}>{body}</Popover>;
}

function Popover({
  title,
  anchorRect,
  within,
  onClose,
  children,
}: {
  title: string;
  anchorRect: () => AnchorRect | null;
  within?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, anchorRect });
  latest.current = { onClose, anchorRect };

  useEffect(() => {
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (within?.current?.contains(target) || ref.current?.contains(target)) return;
      latest.current.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        latest.current.onClose();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [within]);

  const place = useCallback(() => {
    const rect = latest.current.anchorRect();
    const el = ref.current;
    if (!rect || !el) return;
    setAnchor(
      menuAnchor({
        trigger: rect,
        menu: { width: el.offsetWidth, height: el.scrollHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side: 'below',
        align: 'end',
      }),
    );
  }, []);

  useLayoutEffect(() => {
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [place]);

  // The first kind takes the focus, so the keyboard lands in the choice.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[data-kind]')?.focus({ preventScroll: true });
  }, []);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className="fixed z-[70] w-[330px] max-w-[calc(100vw-24px)] flex flex-col gap-2.5 p-2.5 overflow-y-auto bg-surface border border-line-strong rounded-paper shadow-paper"
      style={anchor ? { left: anchor.left, top: anchor.top, maxHeight: anchor.maxHeight } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink">{title}</span>
        <button type="button" className={developLinkClass} onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
