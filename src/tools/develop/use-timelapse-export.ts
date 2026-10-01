import { useCallback, useRef, useState } from 'react';
import { deliverFilesTo, pickDeliveryTarget } from '../../shared/sources/deliver-files';
import { encodeFrames } from '../../shared/media/render-video';
import { exportEdge } from '../../shared/media/photo-frame';
import { deepestZoom, makingOfName, type TimelapseScript } from '../../shared/develop/timelapse-script';
import { startTask } from '../../shared/tasks/tasks';
import { atStep, cancelRun, enterUnit, finishUnit, startRun, type RunPhase, type RunProgress } from '../../shared/tasks/run-progress';
import { prepareTimelapse, type TimelapseSource } from './timelapse-paint';
import type { RollCubes } from './roll-cubes';

/** A making-of's stages: grading its states, encoding the frames, writing the file. */
const PHASES: readonly RunPhase[] = [
  { id: 'render', label: 'Render' },
  { id: 'encode', label: 'Encode' },
  { id: 'write', label: 'Write' },
];

export interface TimelapseExport {
  /** The running export's progress line, or null when idle. */
  exporting: string | null;
  /** Where it stands (`run-progress.ts`): one unit, the picture — null when idle. */
  progress: RunProgress | null;
  cancel: () => void;
  /** The last run's outcome, in a sentence. */
  note: string | null;
  /** Render and deliver `script` over `source` — the folder asked for AT the click, before a pixel is drawn. */
  run: (args: { script: TimelapseScript; source: TimelapseSource; refName: string; pictureId: string; scope: string | null }) => Promise<void>;
}

/**
 * A making-of as a RUN of the suite's shape (`tasks.md`): a task on the
 * picture's own edge, one unit on the Deliver bar with three stages, a
 * Cancel that ends the decode or the encode in flight. The folder is picked
 * FIRST, from the click, while the browser still honours it; the states are
 * then graded once at the frame's density times the deepest zoom (within
 * what this device delivers a still at), every frame is painted by the
 * sheet's own painter and encoded to H.264, and the file lands under the
 * picture's name with a `-making-of` suffix.
 */
export function useTimelapseExport({ cubes }: { cubes: RollCubes }): TimelapseExport {
  const [exporting, setExporting] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const run = useCallback<TimelapseExport['run']>(
    async ({ script, source, refName, pictureId, scope }) => {
      if (controllerRef.current) return;
      if (script.empty) {
        setNote('Nothing to tell yet — develop the picture first.');
        return;
      }
      setNote(null);
      let target;
      try {
        target = await pickDeliveryTarget();
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err));
        return;
      }
      if (!target) {
        setNote('No folder was chosen — nothing was rendered.');
        return;
      }
      const name = makingOfName(refName);
      setExporting('Preparing…');
      const controller = new AbortController();
      controllerRef.current = controller;
      const task = startTask({ label: `Making-of · ${refName}`, scope, progress: 0, cancel: () => controller.abort() });
      let progressNow = startRun([{ id: pictureId, name: refName, phases: PHASES }], Date.now());
      const show = (next: RunProgress) => {
        progressNow = controller.signal.aborted ? cancelRun(next) : next;
        setProgress(progressNow);
      };
      show(enterUnit(progressNow, 0));
      controller.signal.addEventListener('abort', () => show(progressNow));
      const say = (phase: string, words: string, ratio: number | null = null) => {
        setExporting(`${words}…`);
        task.update({ detail: words, ...(ratio === null ? {} : { progress: ratio }) });
        show(atStep(progressNow, phase, words, ratio));
      };
      let painter: Awaited<ReturnType<typeof prepareTimelapse>> | null = null;
      try {
        say('render', 'Grading the states');
        // The frame's long edge times the deepest zoom, so a close-up is not
        // a blow-up — within what this device delivers a still at (a phone's
        // own ceiling, the GPU's edge), said nowhere because the stage obeys
        // the same number.
        const edge = Math.min(exportEdge(), Math.round(Math.max(script.width, script.height) * deepestZoom(script)));
        painter = await prepareTimelapse(script, source, {
          cubes,
          edge,
          signal: controller.signal,
          onProgress: (done, total) => say('render', `Grading the states · ${done} of ${total}`, (done / total) * 0.3),
        });
        const p = painter;
        say('encode', 'Encoding', 0.3);
        const grained = script.states.some((s) => (s.grade?.film?.grain ?? 0) > 0);
        const blob = await encodeFrames({
          width: script.width,
          height: script.height,
          seconds: script.seconds,
          fps: script.fps,
          grained,
          signal: controller.signal,
          draw: (t) => {
            p.draw(script, t);
            return p.canvas;
          },
          onProgress: (ep) => {
            if (ep.phase === 'encoding') say('encode', 'Encoding', 0.3 + 0.65 * (ep.ratio ?? 0));
            else if (ep.phase === 'finalizing') say('encode', 'Writing the container', 0.95);
          },
        });
        say('write', 'Writing', 0.97);
        const file = new File([blob], name, { type: 'video/mp4', lastModified: Date.now() });
        const delivery = await deliverFilesTo(target, [file], { replace: false });
        const failed = delivery.method === 'folder' && delivery.failed.length > 0;
        show(finishUnit(progressNow, 0, !failed, Date.now()));
        const size = `${script.width} × ${script.height} · ${script.seconds.toFixed(1)} s`;
        if (failed) setNote(`${name} could not be written: ${delivery.errors[0] ?? 'the folder refused it'}`);
        else if (delivery.method === 'download') setNote(`${name} downloaded · ${size}`);
        else setNote(`${name} written${delivery.renamed ? ' (numbered — the folder already held that name)' : ''} · ${size}`);
      } catch (err) {
        show(finishUnit(progressNow, 0, false, Date.now()));
        if (err instanceof DOMException && err.name === 'AbortError') setNote('Making-of cancelled — nothing was written.');
        else setNote(err instanceof Error ? err.message : 'The making-of could not be made.');
      } finally {
        painter?.dispose();
        task.done();
        setExporting(null);
        setProgress(null);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [cubes],
  );

  return { exporting, progress, cancel, note, run };
}
