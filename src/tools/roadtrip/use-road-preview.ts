import { useEffect, useRef, useState } from 'react';
import {
  RoadPreviewer,
  unpackPreview,
  type RoadPreview,
  type RoadPreviewAsk,
} from '../../shared/roadtrip/road-preview';
import type { RoadPreviewReply, RoadPreviewRequest } from '../../shared/roadtrip/road-preview-worker';
import { startTask, type TaskHandle } from '../../shared/tasks/tasks';

/** The Road pane's map edge: where a preview being computed is drawn (`TaskEdge`). */
export const ROAD_PREVIEW_SCOPE = 'road-preview';

export interface RoadPreviewState {
  /** The last preview answered, kept on screen while the next is computed; null before the first. */
  preview: RoadPreview | null;
  /** The ask that preview answers. */
  answered: RoadPreviewAsk | null;
  /** A newer ask is being computed. */
  computing: boolean;
}

/**
 * The Road pane's preview of `ask` (`road-preview.ts`), computed in a worker
 * so a slider dragged across a year of fixes never stalls the page: each ask
 * replaces the last, the newest answer wins, and while one is computed the
 * previous preview stays on screen beside an ECHO on the map's edge (a
 * person caused it this instant, so it is drawn at once and kept out of the
 * masthead's pill). Where no worker starts, the same work runs on this thread
 * a frame later, so the "computing" state is at least painted first.
 */
export function useRoadPreview(ask: RoadPreviewAsk | null): RoadPreviewState {
  const [state, setState] = useState<RoadPreviewState>({ preview: null, answered: null, computing: false });
  const worker = useRef<Worker | null | 'none'>(null);
  const seq = useRef(0);
  const asked = useRef(new Map<number, RoadPreviewAsk>());
  const task = useRef<TaskHandle | null>(null);
  const local = useRef<RoadPreviewer | null>(null);

  const settle = (id: number, preview: RoadPreview | null) => {
    const a = asked.current.get(id);
    asked.current.delete(id);
    // An answer to an ask overtaken by a newer one is dropped.
    if (id !== seq.current || !a) return;
    task.current?.done();
    task.current = null;
    setState((cur) => (preview ? { preview, answered: a, computing: false } : { ...cur, computing: false }));
  };

  // The worker, for the pane's life.
  useEffect(() => {
    return () => {
      const w = worker.current;
      if (w && w !== 'none') w.terminate();
      worker.current = null;
      task.current?.done();
      task.current = null;
    };
  }, []);

  const key = ask ? askKey(ask) : '';
  useEffect(() => {
    if (!ask) return;
    const id = ++seq.current;
    asked.current.set(id, ask);
    task.current ??= startTask({ label: 'Drawing the road', scope: ROAD_PREVIEW_SCOPE, echo: true });
    setState((cur) => (cur.computing ? cur : { ...cur, computing: true }));

    // Here, after a frame, the newest only: where no worker starts, or one failed.
    const inThread = () =>
      setTimeout(() => {
        const latest = asked.current.get(seq.current);
        if (!latest) return;
        local.current ??= new RoadPreviewer();
        let preview: RoadPreview | null = null;
        try {
          preview = local.current.preview(latest);
        } catch {
          preview = null;
        }
        settle(seq.current, preview);
      }, 16);
    if (worker.current === null) {
      worker.current = startWorker(
        (reply) => settle(reply.id, reply.ok ? unpackPreview(reply.preview) : null),
        () => {
          // The worker's module did not load: this thread from now on.
          worker.current = 'none';
          inThread();
        },
      );
    }
    const w = worker.current;
    if (w !== 'none') {
      const request: RoadPreviewRequest = { id, ask };
      w.postMessage(request);
      return;
    }
    const timer = inThread();
    return () => clearTimeout(timer);
    // `key` stands for the ask: a new object with the same reading asks nothing.
  }, [key]);

  return state;
}

/** One string per reading of one road: the track and the hand points by content, the settings by value. */
function askKey(ask: RoadPreviewAsk): string {
  const d = ask.drive;
  return [
    ask.track.length,
    hash(ask.track),
    ask.added.map((f) => `${f.t},${f.lat},${f.lon}`).join(';'),
    ask.mode,
    ask.detail,
    d.style,
    d.lookM,
    d.radiusM,
    d.withinM,
    d.smoothM,
  ].join('|');
}

/** FNV-1a over the encoded track: a few tens of kilobytes, read once per ask. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function startWorker(onReply: (reply: RoadPreviewReply) => void, onFail: () => void): Worker | 'none' {
  if (typeof Worker === 'undefined') return 'none';
  try {
    const w = new Worker(new URL('../../shared/roadtrip/road-preview-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (event: MessageEvent<RoadPreviewReply>) => onReply(event.data);
    w.onerror = (event) => {
      event.preventDefault();
      w.terminate();
      onFail();
    };
    return w;
  } catch {
    // A worker that cannot start (a strict CSP, a file: origin): this thread.
    return 'none';
  }
}
