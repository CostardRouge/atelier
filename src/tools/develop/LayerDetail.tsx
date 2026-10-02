import { useRef, useState, type ReactNode } from 'react';
import Segmented from '../../shared/ui/Segmented';
import type { AdjustLayer } from '../../shared/develop/layer';
import KindGlyph from './KindGlyph';
import KindPalette from './KindPalette';
import { kindLabel, type PaletteKind } from './kind-palette';

/** Which half of the open layer is shown: where it applies, or what it changes. */
export type LayerTab = 'mask' | 'adjust';

const TABS: readonly { id: LayerTab; label: string }[] = [
  { id: 'mask', label: 'Mask · where' },
  { id: 'adjust', label: 'Adjust · what' },
];

/**
 * The OPEN layer's head (2026-10-02, `docs/mask-ui-redesign.md` §3.3): its
 * name, edited where it is read, the chip of its kind (the palette of kinds),
 * and the switch between WHERE it applies and WHAT it changes — so a layer's
 * sliders are one tap away rather than under every mask control (they started
 * 857 px down on a Subject, measured). The halves are the caller's children.
 */
export default function LayerDetail({
  layer,
  tab,
  onTab,
  onRename,
  onKind,
  children,
}: {
  layer: AdjustLayer;
  tab: LayerTab;
  onTab: (tab: LayerTab) => void;
  onRename: (name: string) => void;
  onKind: (kind: PaletteKind) => void;
  children: ReactNode;
}) {
  const kind: PaletteKind = layer.mask?.kind ?? 'whole';
  const chipRef = useRef<HTMLButtonElement>(null);
  const [palette, setPalette] = useState(false);
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      <div className="flex items-center gap-1.5">
        <input
          value={layer.name}
          placeholder={kindLabel(kind)}
          aria-label="Layer name"
          onChange={(e) => onRename(e.target.value)}
          className="min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-1.5 py-0.5 font-serif text-xl leading-tight text-ink placeholder:text-ink-soft hover:border-line-strong focus:border-line-strong focus:bg-paper"
        />
        <button
          ref={chipRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={palette}
          title="Change what this layer’s mask is"
          onClick={() => setPalette((on) => !on)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-paper py-0.5 pl-1.5 pr-2.5 text-xs text-ink cursor-pointer hover:border-ink-soft"
        >
          <KindGlyph kind={kind} className="h-[15px] w-[22px]" />
          {kindLabel(kind)} ▾
        </button>
      </div>
      {palette && (
        <KindPalette
          mode="type"
          current={kind}
          anchorRect={() => chipRef.current?.getBoundingClientRect() ?? null}
          within={chipRef}
          onClose={() => setPalette(false)}
          onPick={(picked) => {
            setPalette(false);
            if (picked !== kind) onKind(picked);
          }}
        />
      )}
      <Segmented size="sm" fill label="Layer" value={tab} onChange={onTab} options={TABS} />
      {children}
    </div>
  );
}
