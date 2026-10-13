/**
 * The Road pane's previews computed off the main thread (`road-preview.ts`):
 * a year of fixes read by a mode, a detail and a drive costs a few hundred
 * milliseconds, which on the main thread froze the slider under the hand.
 *
 * Asks arrive faster than they are answered while a slider is dragged: only
 * the LATEST is computed — each ask overwrites the one waiting, and the
 * worker yields once before computing so the queue can catch up. Each answer
 * carries its ask's `id`, so the page drops one that is no longer wanted.
 */

import { packPreview, RoadPreviewer, type PackedPreview, type RoadPreviewAsk } from './road-preview';

export interface RoadPreviewRequest {
  id: number;
  ask: RoadPreviewAsk;
}

export type RoadPreviewReply = { id: number; ok: true; preview: PackedPreview } | { id: number; ok: false; error: string };

const previewer = new RoadPreviewer();
let waiting: RoadPreviewRequest | null = null;
let busy = false;

self.onmessage = (event: MessageEvent<RoadPreviewRequest>) => {
  waiting = event.data;
  if (!busy) void run();
};

async function run(): Promise<void> {
  busy = true;
  while (waiting) {
    // Let the asks queued behind this one land first: the newest wins.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = waiting;
    waiting = null;
    if (!request) break;
    try {
      const { packed, transfer } = packPreview(previewer.preview(request.ask));
      const reply: RoadPreviewReply = { id: request.id, ok: true, preview: packed };
      (self as unknown as Worker).postMessage(reply, transfer);
    } catch (err) {
      const reply: RoadPreviewReply = { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) };
      (self as unknown as Worker).postMessage(reply);
    }
  }
  busy = false;
}
