import { EXPORT_SHORTS, type MosaicSettings as Settings } from '../../shared/mosaic/mosaic-doc';
import { filmParts, playsOnce } from '../../shared/mosaic/motion';
import { FieldRow, SliderRow } from '../../shared/ui/Inspector';
import DeliverBar, { PlainRun, type DeliverPlacement, type ExportVerb } from '../../shared/ui/DeliverBar';
import Segmented from '../../shared/ui/Segmented';
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
 * cells (D2) or the stage's own; how many steps a film plays. What it TRIGGERS — the image, the film — is the
 * inspector's foot (`MosaicDeliver`), on the block's rule: what is set scrolls, what is triggered is pinned.
 */
export default function MosaicExportPanel({ settings, update }: Pick<MosaicExportPanelProps, 'settings' | 'update'>) {
  const ex = settings.export;
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
    </>
  );
}

/**
 * The mosaic's two verbs, pinned at the inspector's foot (`DeliverBar`, `frontend.md` «An instrument's inspector»):
 * the film while a mode plays, the image in Still, the other behind ▾; the line above says what the file will be;
 * while one runs the bar IS the run, on every tab, with its Cancel.
 */
export function MosaicDeliver({ settings, stageW, stageH, exporter, ready, placement }: Omit<MosaicExportPanelProps, 'update'> & { placement: DeliverPlacement }) {
  const ex = settings.export;
  const { w, h } = exportSize(stageW, stageH, ex.short);
  const shape = gridShape(w, h, exportCellPx(ex.cells, settings.cellPx, stageW, stageH, w));
  const still = settings.mode === 'single';
  const once = playsOnce(settings.mode);
  const seconds = still ? 0 : filmParts(settings.motion, settings.speed, ex.steps, once).reduce((a, b) => a + b, 0) / 1000;
  const film = !still && exporter.canFilm;
  const verbs: ExportVerb[] = !ready
    ? []
    : [
        { id: 'png', label: 'Save image', hint: 'The target’s mosaic as a PNG at this size', run: () => void exporter.run('png') },
        ...(film ? [{ id: 'mp4', label: 'Save film', hint: 'The motion as an MP4 (H.264) — the same steps the stage plays, from the same seed', run: () => void exporter.run('mp4') }] : []),
      ];
  const filmLine = still ? 'a mode under the stage films it' : !exporter.canFilm ? 'this browser cannot encode a film' : `film ${Math.round(seconds)} s at 30 fps`;
  return (
    <DeliverBar
      verbs={verbs}
      primary={film ? 'mp4' : 'png'}
      summary={`${w} × ${h} px · ${shape.cols} × ${shape.rows} cells · ${filmLine}`}
      exporting={null}
      progress={null}
      onCancel={exporter.cancel}
      note={exporter.note}
      placement={placement}
      unitWord="file"
      empty="Add pictures and a target first."
      running={exporter.running !== null ? <PlainRun words={exporter.running} ratio={exporter.progress} onCancel={exporter.cancel} /> : undefined}
    />
  );
}
