import { useCallback, useRef, useState } from 'react';
import type { BrushRaster } from '../../shared/render/brush-raster';
import { segmentSubject, unionMasks } from '../../shared/segment/segmenter';
import { subjectLayersToSegment, type AdjustLayer } from '../../shared/develop/layer';
import { describeSubjectCrop, maskBounds, subjectZone } from '../../shared/develop/subject-crop';
import { SEGMENT_INPUT_LONG_EDGE } from '../../shared/segment/segmenter';
import { startTask } from '../../shared/tasks/tasks';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import type { CropZoneApi } from './use-crop-zone';

export interface SubjectCropVerb {
  /** Build the zone and write it; reports through `onTold`. Settles once the model has answered. */
  run: () => Promise<void> | void;
  /** The model is being asked. */
  busy: boolean;
  /** The picture has Subject layers with points: the crop will use those. */
  named: boolean;
}

/**
 * The Crop tab's *Crop to subject* (A3 of `docs/auto-develop.md`).
 *
 * The subject is the union of the picture's Subject layers' rasters when it
 * has any — the author already said what the subject is, and the rasters are
 * the very ones the layer pass draws (`useSubjectMasks`). Otherwise the model
 * is asked about the CENTRE of the picture, once, and the told line says so:
 * an assumption spoken is not a fabrication, a crop silently taken from
 * nowhere would be. The model's answer is a task while it comes, on the
 * stage's own scope, so the hairline says it. The zone goes through
 * `crop.setZone`, which keeps the chip — the format the author locked is
 * what the zone is grown to.
 */
export function useSubjectCrop({
  picture,
  crop,
  layers,
  rasters,
  taskScope,
  onTold,
  record,
}: {
  picture: DevelopPicture;
  crop: CropZoneApi;
  layers: readonly AdjustLayer[];
  rasters: ReadonlyMap<string, BrushRaster>;
  taskScope: string | null;
  onTold: (message: string) => void;
  /** Runs the write so the Crop tab's switch remembers the crop around it (`use-crop-switches.ts`). */
  record?: (write: () => void) => void;
}): SubjectCropVerb {
  const [busy, setBusy] = useState(false);
  const subjects = subjectLayersToSegment(layers);
  const named = subjects.length > 0;
  // Read at the click, never through a stale closure: a drag may have moved
  // the crop between the render and the press.
  const live = useRef({ picture, crop, subjects, rasters, taskScope, onTold, record });
  live.current = { picture, crop, subjects, rasters, taskScope, onTold, record };

  const write = useCallback((raster: BrushRaster | null, from: 'layers' | 'centre') => {
    const { crop: c, onTold: tell, record: remember } = live.current;
    const src = c.src;
    if (!raster || !src) {
      tell(from === 'layers' ? 'the subject is still being found' : 'the model found no subject at the centre');
      return;
    }
    const bounds = maskBounds(raster);
    if (!bounds) {
      tell('the model found no subject');
      return;
    }
    const { rotation, flipX, flipY } = c.framing;
    const result = subjectZone(bounds, src, rotation, flipX, flipY, c.lock);
    if (result.ok) {
      const write = () => c.setZone(result.zone);
      if (remember) remember(write);
      else write();
    }
    tell(`crop to subject · ${describeSubjectCrop(result, from)}`);
  }, []);

  const run = useCallback(() => {
    const { picture: p, subjects: s, rasters: r, taskScope: scope } = live.current;
    if (s.length > 0) {
      let union: BrushRaster | null = null;
      for (const layer of s) union = unionMasks(union, r.get(layer.id) ?? null);
      write(union, 'layers');
      return;
    }
    // No subject named: the model is shown the picture as its geometry bends
    // it when that view exists, else the picture as shot, drawn small.
    const source = p.segmentView?.image ?? p.asShotSample(SEGMENT_INPUT_LONG_EDGE);
    if (!source) {
      live.current.onTold('the picture has not been read yet');
      return;
    }
    setBusy(true);
    const task = startTask({ label: 'Finding the subject', scope });
    return segmentSubject(source, [{ x: 0.5, y: 0.5 }])
      .then((raster) => write(raster, 'centre'))
      .catch(() => live.current.onTold('the subject model could not answer'))
      .finally(() => {
        task.done();
        setBusy(false);
      });
  }, [write]);

  return { run, busy, named };
}
