import {
  DEFAULT_FILM_TEXTURE,
  FADE_CELL_PX,
  TEXTURE_RANGES,
  grainShowable,
  type FilmTexture,
} from '../film/film-texture';
import { FieldRow, RangeField, SwitchRow } from '../ui/Inspector';

interface FilmTextureDialsProps {
  texture: FilmTexture | null;
  onChange: (texture: FilmTexture | null) => void;
  /**
   * The height in pixels of the surface this panel's preview really draws at.
   * Absent means the host cannot say, and then nothing is claimed — a badge
   * that guesses is worse than none.
   */
  previewHeight?: number | null;
  /**
   * False where the host's own preview does NOT draw the node at all — the
   * Studio's stage, which drives the single-pass renderer frame by frame for
   * its split and its strength and never builds a grader (`render-film.md`).
   * Its exports carry the texture; its stage cannot show it, and a panel that
   * stayed silent about that would read as a broken slider.
   */
  previewDraws?: boolean;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The film TEXTURE's dials: grain and halation, the half of a stock the cube
 * cannot carry.
 *
 * It edits the GRADE's texture, never a layer's — the texture belongs to the
 * stock but cascades with the rung, so it sits beside the layers exactly as
 * the output transform does (`render-film.md`).
 *
 * **Sizes are fractions of the frame's HEIGHT and are shown as such**, never
 * in pixels: a pixel would be a different grain at every export size, which is
 * the one thing the whole design exists to prevent. A cell's size in THIS
 * preview's pixels is shown beside it, because that is the number that decides
 * whether the preview can honestly show it.
 */
export default function FilmTextureDials({
  texture,
  onChange,
  previewHeight = null,
  previewDraws = true,
}: FilmTextureDialsProps) {
  const on = texture !== null;
  const t = texture ?? DEFAULT_FILM_TEXTURE;
  const patch = (over: Partial<FilmTexture>) => onChange({ ...t, ...over });

  // What this preview can honestly show. A cell under ~1.5 preview pixels
  // cannot be resolved at all and the node FADES it out rather than aliasing;
  // between there and 3 px it is drawn at part strength. Said as a visible
  // state, never as a tooltip — the export will carry what the screen cannot.
  const shown =
    previewDraws && on && t.grain > 0 && previewHeight && previewHeight > 0
      ? grainShowable(t, previewHeight)
      : null;
  const faded = shown ? shown.cellPixels < FADE_CELL_PX : false;

  return (
    <div className="flex flex-col gap-2">
      <SwitchRow
        label="Grain and halation"
        checked={on}
        onChange={(next) => onChange(next ? { ...DEFAULT_FILM_TEXTURE, grain: 0.3, halation: 0.2 } : null)}
        hint="The half of a film stock the cube cannot carry: a grain field, and the bleed a bright highlight leaves through the base. Drawn after the look, at the size the frame is delivered at."
      />
      {on && (
        <>
          <FieldRow label="Grain">
            <RangeField
              label="Grain amount"
              min={TEXTURE_RANGES.grain.min}
              max={TEXTURE_RANGES.grain.max}
              step={TEXTURE_RANGES.grain.step}
              value={t.grain}
              onChange={(v) => patch({ grain: v })}
              format={pct}
            />
          </FieldRow>
          {!previewDraws && (
            <p className="m-0 text-2xs leading-relaxed text-warn">
              This stage does not draw the texture — every export does. Dial it in Develop, where
              the loupe shows it at the file&rsquo;s own pixels.
            </p>
          )}
          {shown && (
            <p className={`m-0 text-2xs leading-relaxed ${shown.showable ? 'text-muted' : 'text-warn'}`}>
              {shown.showable
                ? faded
                  ? `A grain cell is ${shown.cellPixels.toFixed(1)} px here — drawn at part strength. Judge it in the loupe.`
                  : `A grain cell is ${shown.cellPixels.toFixed(1)} px on this preview.`
                : `Finer than this preview can show (${shown.cellPixels.toFixed(1)} px a cell) — it will be there in the export.`}
            </p>
          )}
          <FieldRow label="Cell" hint="A fraction of the frame's HEIGHT, so the export's grain is this one, resampled — never a size in pixels.">
            <RangeField
              label="Grain size"
              min={TEXTURE_RANGES.grainSize.min}
              max={TEXTURE_RANGES.grainSize.max}
              step={TEXTURE_RANGES.grainSize.step}
              value={t.grainSize}
              onChange={(v) => patch({ grainSize: v })}
              format={(v) => `h/${Math.round(1 / v)}`}
            />
          </FieldRow>
          <FieldRow label="Chroma" hint="0 moves every channel together — a silver screen door. 1 gives each its own field, which is the digital look.">
            <RangeField
              label="Grain chroma"
              min={TEXTURE_RANGES.grainChroma.min}
              max={TEXTURE_RANGES.grainChroma.max}
              step={TEXTURE_RANGES.grainChroma.step}
              value={t.grainChroma}
              onChange={(v) => patch({ grainChroma: v })}
              format={pct}
            />
          </FieldRow>
          <FieldRow
            label="Re-rolls"
            hint="On a clip, how often the field is drawn again, per second of the SOURCE. Real film re-rolls once per photographed frame; 60 a second is the boiling. Frozen leaves a still, and a Ken-Burns move, with one field."
          >
            <RangeField
              label="Grain cadence"
              min={TEXTURE_RANGES.grainFps.min}
              max={TEXTURE_RANGES.grainFps.max}
              step={TEXTURE_RANGES.grainFps.step}
              value={t.grainFps}
              onChange={(v) => patch({ grainFps: v })}
              format={(v) => (v <= 0 ? 'Frozen' : `${Math.round(v)}/s`)}
            />
          </FieldRow>
          <FieldRow label="Halation" hint="The warm bleed a bright highlight leaves through the film base. Resolution-independent by construction: the blur is the same over the same small buffer at every size.">
            <RangeField
              label="Halation amount"
              min={TEXTURE_RANGES.halation.min}
              max={TEXTURE_RANGES.halation.max}
              step={TEXTURE_RANGES.halation.step}
              value={t.halation}
              onChange={(v) => patch({ halation: v })}
              format={pct}
            />
          </FieldRow>
          {t.halation > 0 && (
            <>
              <FieldRow label="Bleed">
                <RangeField
                  label="Halation radius"
                  min={TEXTURE_RANGES.halationRadius.min}
                  max={TEXTURE_RANGES.halationRadius.max}
                  step={TEXTURE_RANGES.halationRadius.step}
                  value={t.halationRadius}
                  onChange={(v) => patch({ halationRadius: v })}
                  format={(v) => `h/${Math.round(1 / v)}`}
                />
              </FieldRow>
              <FieldRow label="From" hint="The luminance a highlight has to reach before it bleeds.">
                <RangeField
                  label="Halation threshold"
                  min={TEXTURE_RANGES.halationThreshold.min}
                  max={TEXTURE_RANGES.halationThreshold.max}
                  step={TEXTURE_RANGES.halationThreshold.step}
                  value={t.halationThreshold}
                  onChange={(v) => patch({ halationThreshold: v })}
                  format={pct}
                />
              </FieldRow>
            </>
          )}
        </>
      )}
    </div>
  );
}
