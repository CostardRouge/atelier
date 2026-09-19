import { useState } from 'react';
import { readFilmSettings, type FilmSettings } from '../film/emulsion';
import { isFilmLayer } from '../film/film-layer';
import { FILM_GROUP_LABEL, FILM_STOCKS, type FilmStockId } from '../film/stocks';
import {
  LUT_GROUPS,
  UNGROUPED_LUTS,
} from './builtin-luts';
import FilmDials from './FilmDials';
import LutGalleryModal, { type LutPreviewSource } from './LutGalleryModal';
import { MAX_LAYER_INTENSITY } from './lut-stack';
import { OUTPUT_TRANSFORM_OPTIONS } from './transfer';
import type { LutStack } from './use-lut-stack';

/** The picker's id for a film stock — no built-in id looks like this. */
const FILM_PICK = 'film:';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import Segmented from '../ui/Segmented';
import { FieldRow, RangeField, SelectField, ToggleField } from '../ui/Inspector';
import { Icons } from '../ui/icons';

interface GradePanelProps {
  stack: LutStack;
  /** The picture on the stage, if there is one — the gallery's truest preview. */
  previewImage?: LutPreviewSource | null;
}

/**
 * The grade: a stack of looks applied top to bottom, each with its own
 * strength and an on/off switch. Order matters (a contrast look before or
 * after a film print reads differently), so layers move with ↑/↓ — plain
 * buttons rather than drag-and-drop, which is fiddly in a narrow column.
 *
 * The stack bakes into a single LUT, so the preview, the stills and every
 * export variant grade through exactly one shader pass.
 */
export default function GradePanel({ stack, previewImage = null }: GradePanelProps) {
  const [pick, setPick] = useState('');
  const [gallery, setGallery] = useState(false);

  const pickLook = (id: string) => {
    if (id.startsWith(FILM_PICK)) stack.addFilm(id.slice(FILM_PICK.length) as FilmStockId);
    else void stack.addBuiltin(id);
  };

  const activeCount = stack.layers.filter(
    (l) => l.enabled && l.intensity > 0,
  ).length;

  // Conversion LUTs are authored for a Rec.709 reference display (~gamma 2.4)
  // while a browser shows ~2.2, so a look can read flatter here than intended.
  // Rec.709 and sRGB share primaries — only the curve changes.
  const outputHint =
    OUTPUT_TRANSFORM_OPTIONS.find((o) => o.id === stack.output)?.hint ?? '';

  return (
    <div className="flex flex-col gap-2.5">
      <FieldRow label="Add a look">
        <SelectField
          label="Add a built-in look"
          value={pick}
          onChange={(id) => {
            setPick('');
            if (id) pickLook(id);
          }}
          options={[
            { id: '', label: stack.busy ? 'Loading…' : 'Built-in…' },
            // The film stocks are generated, not files: they sit beside the
            // folder groups rather than in the manifest, which lists files.
            ...FILM_STOCKS.map((s) => ({ id: `${FILM_PICK}${s.id}`, label: `${FILM_GROUP_LABEL} · ${s.name}` })),
            ...UNGROUPED_LUTS.map((l) => ({ id: l.id, label: l.name })),
            ...LUT_GROUPS.flatMap((g) => g.luts.map((l) => ({ id: l.id, label: `${g.label} · ${l.name}` }))),
          ]}
        />
        <IconButton
          label="Browse looks with a live preview"
          size="sm"
          variant="ghost"
          onClick={() => setGallery(true)}
        >
          {Icons.grid}
        </IconButton>
        <Button size="sm" onClick={() => void stack.addCustom()} title="Load a .cube file from disk">
          .cube…
        </Button>
      </FieldRow>

      {gallery && (
        <LutGalleryModal
          includeFilm
          previewImage={previewImage}
          onPick={(id) => {
            pickLook(id);
            setGallery(false);
          }}
          onClose={() => setGallery(false)}
        />
      )}

      {stack.error && <p className="m-0 text-xs text-danger">{stack.error}</p>}

      {/* The stack: one block per look, its switch, its name, its order and
          its strength. Order matters and is plain ↑/↓ — drag-and-drop is
          fiddly in a narrow column. */}
      {stack.layers.length === 0 ? (
        <FieldRow label="Stack">
          <span className="text-xs text-muted">
            No look yet — the picture grades through untouched.
          </span>
        </FieldRow>
      ) : (
        stack.layers.map((layer, i) => (
          <div
            key={layer.id}
            className={`flex flex-col gap-2 pl-3 border-l-2 transition-opacity ${
              layer.enabled ? 'border-accent' : 'border-line opacity-60'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <ToggleField
                label={layer.enabled ? `Bypass ${layer.name}` : `Enable ${layer.name}`}
                checked={layer.enabled}
                onChange={(on) => stack.setEnabled(layer.id, on)}
              />
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-ink" title={layer.name}>
                {layer.name}
              </span>
              <IconButton size="sm" variant="ghost" label="Apply earlier" disabled={i === 0} onClick={() => stack.move(layer.id, -1)}>
                {Icons.up}
              </IconButton>
              <IconButton
                size="sm"
                variant="ghost"
                label="Apply later"
                disabled={i === stack.layers.length - 1}
                onClick={() => stack.move(layer.id, 1)}
              >
                {Icons.down}
              </IconButton>
              <IconButton size="sm" variant="ghost" label="Remove from the stack" onClick={() => stack.remove(layer.id)}>
                {Icons.close}
              </IconButton>
            </div>
            <FieldRow label="Strength">
              <RangeField
                label={`${layer.name} strength`}
                min={0}
                max={MAX_LAYER_INTENSITY}
                step={0.05}
                value={layer.intensity}
                disabled={!layer.enabled}
                onChange={(v) => stack.setIntensity(layer.id, v)}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
            {isFilmLayer(layer) && (
              <FilmLayer
                text={stack.customText[layer.id]}
                onChange={(settings) => stack.setFilm(layer.id, settings)}
              />
            )}
          </div>
        ))
      )}

      {/* The delivery stage, always last. */}
      <FieldRow label="Output" hint={outputHint}>
        <SelectField
          label="Output transform"
          value={stack.output}
          onChange={(v) => stack.setOutput(v)}
          options={OUTPUT_TRANSFORM_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
        />
      </FieldRow>

      <FieldRow
        label="Interpolation"
        hint={
          stack.interpolation === 'tetrahedral'
            ? 'Reads the 4 lattice corners that matter, so greys stay grey — what Resolve uses.'
            : 'Averages all 8 corners: faster, and it can tint greys. Look at skies and gradients.'
        }
      >
        <Segmented
          fill
          size="sm"
          label="Interpolation"
          value={stack.interpolation}
          onChange={(mode) => stack.setInterpolation(mode)}
          options={[
            { id: 'tetrahedral', label: 'Tetrahedral' },
            { id: 'trilinear', label: 'Trilinear' },
          ]}
          className="flex-1 min-w-0"
        />
      </FieldRow>

      <p className="m-0 text-xs text-muted leading-relaxed">
        {stack.layers.length > 1 && `${activeCount} of ${stack.layers.length} looks active. `}
        Looks apply top to bottom and bake into one LUT — the preview, the stills and every
        export grade identically. Above 100% a look extrapolates past what it was authored for.
        A film stock goes after a conversion LUT, never before it.
      </p>
    </div>
  );
}

/** A film layer's dials, read from the settings the stack holds for it. */
function FilmLayer({
  text,
  onChange,
}: {
  text: string | undefined;
  onChange: (settings: FilmSettings) => void;
}) {
  const settings = readFilmSettings(text);
  if (!settings) {
    return <p className="m-0 text-xs text-danger">This film layer lost its settings — remove it and add the stock again.</p>;
  }
  return <FilmDials settings={settings} onChange={onChange} />;
}
