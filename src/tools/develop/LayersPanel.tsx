import SectionLegend from '../../shared/ui/SectionLegend';
import Button from '../../shared/ui/Button';
import Segmented from '../../shared/ui/Segmented';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import { developLinkClass } from '../../shared/develop/develop-classes';
import { MAX_LAYERS, layerLabel, type AdjustLayer } from '../../shared/develop/layer';
import type { MaskKind } from '../../shared/render/mask';

const HINT =
  'A layer is an ordinary develop that applies only where its mask says. Linear is a straight edge with a soft transition — a darkened sky; radial is an ellipse — a face lifted out of its surround, or a vignette drawn on purpose; brightness picks a band of tone wherever it falls in the frame; colour picks the colours you tap, wherever they are; painted is drawn by hand on the picture; subject is found by a model from a point you tap. A layer’s mask can be COMBINED with further ones — added, subtracted or intersected — in the layer’s own mask panel. Everything on the Develop tab works inside a layer, so a local exposure, a local white balance and a local curve are the same controls you already know. Layers apply on top of the picture as you see it, after its own develop and its look, so what a slider does here is what you are looking at.';

/** How the open layer's mask is shown on the picture. */
export type MaskView = 'off' | 'outline' | 'fill';

const MASK_VIEWS: readonly { id: MaskView; label: string }[] = [
  { id: 'off', label: 'Hidden' },
  { id: 'outline', label: 'Outline' },
  { id: 'fill', label: 'Fill' },
];

/** What `M` steps to: hidden → outline → fill → hidden. */
export function nextMaskView(v: MaskView): MaskView {
  return v === 'off' ? 'outline' : v === 'outline' ? 'fill' : 'off';
}

const KINDS: readonly { kind: MaskKind | null; label: string }[] = [
  { kind: 'linear', label: 'Linear' },
  { kind: 'radial', label: 'Radial' },
  { kind: 'luma', label: 'Brightness' },
  { kind: 'colour', label: 'Colour' },
  { kind: 'brush', label: 'Painted' },
  { kind: 'subject', label: 'Subject' },
  { kind: null, label: 'Whole picture' },
];

/**
 * The stack, drawn TOP FIRST.
 *
 * The array is bottom to top — entry 0 is applied first and everything after
 * reads what it wrote — but every layer UI since Photoshop shows the top of the
 * stack at the top of the list, so this renders reversed. Nothing else does:
 * `layer.ts`'s helpers all speak the real order and are addressed by id, so the
 * reversal cannot leak into an index.
 */
export default function LayersPanel({
  layers,
  selectedId,
  showMask,
  maskView,
  onMaskView,
  autoShown,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  onPatch,
  onShowMask,
}: {
  layers: readonly AdjustLayer[];
  selectedId: string | null;
  /** The mask pinned on, outside Pick and Paint. */
  showMask: boolean;
  maskView: MaskView;
  onMaskView: (v: MaskView) => void;
  /** Pick or Paint is on, so the mask is showing by itself. */
  autoShown: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (kind: MaskKind | null) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onPatch: (id: string, patch: Partial<Omit<AdjustLayer, 'id'>>) => void;
  onShowMask: (on: boolean) => void;
}) {
  const full = layers.length >= MAX_LAYERS;
  // Top of the stack first, the way a layer list has always read.
  const rows = [...layers].reverse();

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label="Layers">
        <p>{HINT}</p>
      </SectionLegend>

      <div className="flex flex-wrap items-center gap-1">
        {KINDS.map((k) => (
          <Button
            key={k.label}
            size="sm"
            variant="ghost"
            disabled={full}
            onClick={() => onAdd(k.kind)}
          >
            + {k.label}
          </Button>
        ))}
      </div>
      {full && (
        <span className="font-mono text-3xs text-faint">
          {MAX_LAYERS} layers is the limit — each one is a pass over the whole picture
        </span>
      )}

      {rows.length === 0 ? (
        <p className="m-0 font-mono text-2xs text-faint leading-relaxed">
          No layers. Add one and it changes nothing until you move a slider on it.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((layer) => {
            const selected = layer.id === selectedId;
            return (
              <li
                key={layer.id}
                className={`flex items-center gap-1 rounded-paper border px-1.5 py-1 ${
                  selected ? 'border-accent bg-surface-raised' : 'border-line'
                }`}
              >
                {/* Visibility is a VERB, not a field: the maintainer asked for
                    "an option to toggle visibility of a layer", and a bare
                    checkbox beside a name reads as "include this one" rather
                    than "show it". Same size and same row as the other three
                    verbs, and an eye crossed out says which state it is in —
                    an unticked box only ever says which state it is not. */}
                <IconButton
                  size="sm"
                  label={layer.enabled ? `Hide ${layerLabel(layer, layers)}` : `Show ${layerLabel(layer, layers)}`}
                  aria-pressed={!layer.enabled}
                  className={layer.enabled ? undefined : 'text-faint'}
                  onClick={() => onPatch(layer.id, { enabled: !layer.enabled })}
                >
                  {layer.enabled ? Icons.eye : Icons.eyeOff}
                </IconButton>
                <button
                  type="button"
                  className={`flex-1 min-w-0 text-left font-mono text-2xs truncate bg-transparent border-0 p-0 ${
                    layer.enabled ? 'text-ink' : 'text-faint line-through'
                  }`}
                  onClick={() => onSelect(selected ? null : layer.id)}
                >
                  {layerLabel(layer, layers)}
                  {layer.opacity < 1 && (
                    <span className="text-faint"> · {Math.round(layer.opacity * 100)} %</span>
                  )}
                </button>
                <IconButton
                  size="sm"
                  label="Move up"
                  onClick={() => onMove(layer.id, 1)}
                >
                  {Icons.up}
                </IconButton>
                <IconButton
                  size="sm"
                  label="Move down"
                  onClick={() => onMove(layer.id, -1)}
                >
                  {Icons.down}
                </IconButton>
                <IconButton
                  size="sm"
                  label="Delete layer"
                  onClick={() => onRemove(layer.id)}
                >
                  {Icons.trash}
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      {selectedId && (
        <div className="flex flex-col gap-1.5">
          {/* HOW the mask is shown, and WHEN: by itself while Pick or Paint is
              on — the moment the mask is being made — else only when pinned,
              since a red wash left on by accident reads as the picture. */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-3xs text-faint">Mask</span>
            <Segmented size="sm" label="Show the mask" value={maskView} onChange={(v) => onMaskView(v as MaskView)} options={MASK_VIEWS} />
            <span className="flex-1" />
            <button type="button" className={developLinkClass} onClick={() => onSelect(null)}>
              Done
            </button>
          </div>
          <label className="flex items-center gap-1.5 font-mono text-3xs text-faint">
            <input type="checkbox" checked={showMask} onChange={(e) => onShowMask(e.target.checked)} />
            {autoShown ? 'keep it shown once Pick / Paint is off' : 'show it now — it shows by itself while picking or painting'}
            <span className="text-faint"> · M</span>
          </label>
        </div>
      )}
    </div>
  );
}
