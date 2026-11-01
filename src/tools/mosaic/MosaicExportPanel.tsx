import { EXPORT_SHORTS, type MosaicSettings as Settings } from '../../shared/mosaic/mosaic-doc';
import { filmParts, playsOnce } from '../../shared/mosaic/motion';
import { FieldRow, SliderRow } from '../../shared/ui/Inspector';
import Button from '../../shared/ui/Button';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import { exportCellPx, exportSize } from '../../shared/mosaic/export-size';
import type { MosaicExport } from './use-mosaic-export';
import { gridShape } from '../../shared/mosaic/match';

interface MosaicExportPanelProps {
  settings: Settings;
  update: (fn: (s: Settings) => Settings) => void;
  stageW: number;
  stageH: number;
  exporter: MosaicExport;
  /** The mosaic has a target: something to write. */
  ready: boolean;
}

const SHORT_LABELS: Record<number, string> = { 720: '720p', 1080: '1080p', 1440: '1440p', 2160: '4K' };

/**
 * The Export section (M7): the file's size by its short side, the stage's shape kept; whether a bigger file has more
 * cells (D2) or the stage's own; how many steps a film plays. Two verbs — the image, the film — and while one runs,
 * its progress and a Cancel in place (the masthead's pill says the same).
 */
export default function MosaicExportPanel({ settings, update, stageW, stageH, exporter, ready }: MosaicExportPanelProps) {
  const ex = settings.export;
  const { w, h } = exportSize(stageW, stageH, ex.short);
  const cellPx = exportCellPx(ex.cells, settings.cellPx, stageW, stageH, w);
  const shape = gridShape(w, h, cellPx);
  const once = playsOnce(settings.mode);
  const seconds = settings.mode === 'single' ? 0 : filmParts(settings.motion, settings.speed, ex.steps, once).reduce((a, b) => a + b, 0) / 1000;
  const busy = exporter.running !== null;
  const filmRefusal = settings.mode === 'single' ? 'Choose a mode under the stage — Mosaics, Chain… — to film it' : !exporter.canFilm ? 'This browser cannot encode a film (no WebCodecs)' : null;
  return (
    <>
      <FieldRow label="Size">
        <Segmented<`${(typeof EXPORT_SHORTS)[number]}`>
          size="sm"
          fill
          value={`${ex.short}`}
          options={EXPORT_SHORTS.map((s) => ({ id: `${s}` as const, label: SHORT_LABELS[s], title: `${s} px on the short side, the stage’s shape kept` }))}
          onChange={(id) => update((s) => ({ ...s, export: { ...s.export, short: Number(id) as (typeof EXPORT_SHORTS)[number] } }))}
        />
      </FieldRow>
      <FieldRow label="Cells" hint={<p><b>More cells</b>: a cell keeps its width in the file’s pixels, so a bigger file holds more pictures. <b>As on screen</b>: the stage’s cells, each drawn bigger — up to a tile’s own 160 px.</p>}>
        <Segmented<Settings['export']['cells']>
          size="sm"
          fill
          value={ex.cells}
          options={[
            { id: 'pixels', label: 'More cells' },
            { id: 'screen', label: 'As on screen' },
          ]}
          onChange={(cells) => update((s) => ({ ...s, export: { ...s.export, cells } }))}
        />
      </FieldRow>
      <p className="m-0 font-mono text-2xs text-muted tabular-nums">
        {w} × {h} px · {shape.cols} × {shape.rows} cells
      </p>
      <SliderRow
        label="Steps"
        name="film-steps"
        value={ex.steps}
        min={1}
        max={40}
        step={1}
        reset={6}
        format={(v) => `${v}`}
        onChange={(steps) => update((s) => ({ ...s, export: { ...s.export, steps } }))}
        hint={<p>How many steps of the motion the film plays after its opening — the mode and the Motion section decide what a step is. A pull-back plays once.</p>}
      />
      <p className="m-0 font-mono text-2xs text-muted tabular-nums">
        {settings.mode === 'single' ? 'film · choose a mode to film it' : `film · ${Math.round(seconds)} s at 30 fps · ${once ? 'one step' : `${ex.steps} step${ex.steps === 1 ? '' : 's'}`} · no sound`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="default" icon={Icons.image} disabled={busy || !ready} onClick={() => void exporter.run('png')} title="Save the target’s mosaic as a PNG at this size">
          Save image
        </Button>
        <Button
          size="sm"
          variant="default"
          icon={Icons.video}
          disabled={busy || !ready}
          aria-disabled={filmRefusal !== null || undefined}
          onClick={() => void exporter.run('mp4')}
          title={filmRefusal ?? 'Save the motion as an MP4 (H.264) — the same steps the stage plays, from the same seed'}
        >
          Save film
        </Button>
        {busy && (
          <Button size="sm" variant="ghost" icon={Icons.close} onClick={exporter.cancel}>
            Cancel
          </Button>
        )}
      </div>
      {busy && (
        <p className="m-0 text-xs text-muted tabular-nums" role="status">
          {exporter.running}
          {exporter.progress !== null && exporter.progress > 0 ? ` ${Math.round(exporter.progress * 100)} %` : ''}
        </p>
      )}
      {!busy && exporter.note && (
        <p className="m-0 text-xs text-muted" role="status">
          {exporter.note}
        </p>
      )}
    </>
  );
}
