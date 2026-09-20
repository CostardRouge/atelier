import { useState } from 'react';
import { readFilmSettings, type FilmSettings } from '../film/emulsion';
import { isFilmLayer } from '../film/film-layer';
import { FILM_GROUP_LABEL, FILM_STOCKS, type FilmStockId } from '../film/stocks';
import {
  LUT_GROUPS,
  UNGROUPED_LUTS,
} from './builtin-luts';
import FilmDials from './FilmDials';
import FilmTextureDials from './FilmTextureDials';
import { FILM_PICK, packPickId, readPackPick } from './gallery-nodes';
import LutGalleryModal, { type LutPreviewSource } from './LutGalleryModal';
import { looksUnder, nodeLabelPath, flattenNodes, visibleLooks } from './lut-pack';
import { MAX_LAYER_INTENSITY } from './lut-stack';
import { OUTPUT_TRANSFORM_OPTIONS } from './transfer';
import type { LutStack } from './use-lut-stack';
import { useLutPacks } from './use-lut-packs';

import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import Segmented from '../ui/Segmented';
import { FieldRow, NativeSelect, RangeField, SelectField, ToggleField } from '../ui/Inspector';
import { Icons } from '../ui/icons';

interface GradePanelProps {
  stack: LutStack;
  /** The picture on the stage, if there is one — the gallery's truest preview. */
  previewImage?: LutPreviewSource | null;
  /**
   * The height in pixels of the surface the host really draws its preview at.
   * What decides whether a grain cell can be SEEN here, said as a visible
   * state rather than a tooltip (`docs/film-simulation.md` §6). A host that
   * cannot say passes nothing and the panel claims nothing.
   */
  previewHeight?: number | null;
  /** False where the host's preview does not draw the film node at all (the Studio's stage). */
  previewDraws?: boolean;
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
export default function GradePanel({
  stack,
  previewImage = null,
  previewHeight = null,
  previewDraws = true,
}: GradePanelProps) {
  const packs = useLutPacks();
  const [pick, setPick] = useState('');
  const [gallery, setGallery] = useState(false);

  const pickLook = (id: string) => {
    const packPick = readPackPick(id);
    if (packPick) {
      // The layer stores the REFERENCE; the vault holds the lattice.
      const pack = packs.find((p) => p.id === packPick.pack);
      const look = pack?.looks.find((l) => l.id === packPick.look);
      void stack.addPackLook({ pack: packPick.pack, look: packPick.look, hash: look?.hash ?? '' });
    } else if (id.startsWith(FILM_PICK)) {
      stack.addFilm(id.slice(FILM_PICK.length) as FilmStockId);
    } else {
      void stack.addBuiltin(id);
    }
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
        {/* Native optgroups, one per family — the same grouping the Look
            picker and the gallery use, rather than a flat list whose group
            name is repeated as a prefix on every line. */}
        <NativeSelect
          label="Add a built-in look"
          value={pick}
          onChange={(e) => {
            const id = e.target.value;
            setPick('');
            if (id) pickLook(id);
          }}
        >
          <option value="">{stack.busy ? 'Loading…' : 'Built-in…'}</option>
          {/* The film stocks are generated, not files: they sit beside the
              folder groups rather than in the manifest, which lists files. */}
          <optgroup label={FILM_GROUP_LABEL}>
            {FILM_STOCKS.map((s) => (
              <option key={s.id} value={`${FILM_PICK}${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
          {UNGROUPED_LUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          {LUT_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.luts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          ))}
          {/* A pack's own tree, flattened into the group's label: native
              optgroups do not nest, so author → category → camera is written
              out (`docs/lut-packs.md` §6). Hidden nodes are left out. */}
          {packs.flatMap((pack) => {
            const rootLooks = visibleLooks(pack).filter((l) => !l.node);
            const branches = flattenNodes(pack.tree)
              .map(({ node }) => ({
                node,
                looks: looksUnder(pack, node.id).filter((l) => l.node === node.id),
              }))
              .filter(({ looks }) => looks.length > 0);
            const packLabel = (pack.name || pack.author || 'Pack').toUpperCase();
            return [
              ...(rootLooks.length
                ? [
                    <optgroup key={`${pack.id}-root`} label={packLabel}>
                      {rootLooks.map((l) => (
                        <option key={l.id} value={packPickId(pack.id, l.id)}>
                          {l.label}
                        </option>
                      ))}
                    </optgroup>,
                  ]
                : []),
              ...branches.map(({ node, looks }) => (
                <optgroup
                  key={`${pack.id}-${node.id}`}
                  label={[packLabel, ...nodeLabelPath(pack.tree, node.id).map((p) => p.toUpperCase())].join(' · ')}
                >
                  {looks.map((l) => (
                    <option key={l.id} value={packPickId(pack.id, l.id)}>
                      {l.label}
                    </option>
                  ))}
                </optgroup>
              )),
            ];
          })}
        </NativeSelect>
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
            {layer.missing ? (
              /* A purchased look whose lattice this device does not hold: the
                 layer stays, in its place, and says why rather than grading as
                 identity (`docs/lut-packs.md` §5.2). */
              <FieldRow label="Missing">
                <span className="text-xs text-warn">{layer.missing}</span>
              </FieldRow>
            ) : (
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
            )}
            {isFilmLayer(layer) && (
              <FilmLayer
                text={stack.customText[layer.id]}
                onChange={(settings) => stack.setFilm(layer.id, settings)}
              />
            )}
          </div>
        ))
      )}

      {/* The TEXTURE, between the stack and the delivery stage — which is
          where the node draws it: after the cube, before the output. It is
          the grade's, not a layer's, because it cascades with the rung. */}
      <FilmTextureDials
        texture={stack.film}
        onChange={(next) => stack.setTexture(next)}
        previewHeight={previewHeight}
        previewDraws={previewDraws}
      />

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
        A film stock goes after a conversion LUT, never before it. Its grain and halation are
        not in the LUT: they are drawn after it, at the size the frame is delivered at.
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
