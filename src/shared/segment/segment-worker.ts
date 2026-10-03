/**
 * The subject model in a WORKER: MediaPipe's `InteractiveSegmenter` loaded
 * off the main thread, shown a picture once per view and asked one point at
 * a time (`segmenter.ts`, `segment-worker-client.ts`).
 *
 * Why a worker (2026-10-02): `segment()` answers SYNCHRONOUSLY on the thread
 * it runs on — the main thread stood still for every inference, a second or
 * more per point on a laptop, which is what a tap felt like and what every
 * re-ask after a lens or keystone change cost the whole interface. Here the
 * inference still blocks, but a thread nobody is typing on.
 *
 * Everything is still served from our own origin (`MEDIAPIPE_BASE`), and the
 * model's GPU delegate draws on an `OffscreenCanvas` of its own — the one
 * thing a worker must hand MediaPipe explicitly, since it cannot make a
 * `<canvas>` of its own here (WebKit's path asks the document for one).
 */

interface VisionBundle {
  FilesetResolver: { forVisionTasks(path: string): Promise<unknown> };
  InteractiveSegmenter: {
    createFromOptions(fileset: unknown, options: unknown): Promise<SegmenterTask>;
  };
}

interface MPMask {
  getAsFloat32Array(): Float32Array;
  width: number;
  height: number;
  close(): void;
}

interface SegmentationResult {
  confidenceMasks?: MPMask[] | null;
  close?(): void;
}

interface SegmenterTask {
  segment(source: ImageBitmap, roi: { keypoint: { x: number; y: number } }, callback: (result: SegmentationResult) => void): void;
  close?(): void;
}

/** What the main thread sends. */
export type WorkerRequest =
  | { kind: 'load'; base: string }
  | { kind: 'show'; token: number; bitmap: ImageBitmap }
  | { kind: 'segment'; id: number; token: number; x: number; y: number }
  | { kind: 'dispose' };

/** What the worker answers. */
export type WorkerReply =
  | { kind: 'loaded'; ok: boolean; delegate?: 'GPU' | 'CPU'; error?: string }
  | { kind: 'mask'; id: number; ok: true; width: number; height: number; data: Uint8Array }
  | { kind: 'mask'; id: number; ok: false; error?: string };

const toByte = (confidence: number): number => Math.round(Math.min(1, Math.max(0, confidence)) * 255);

let task: SegmenterTask | null = null;
let shown: { token: number; bitmap: ImageBitmap } | null = null;

const post = (reply: WorkerReply, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(reply, transfer);

async function load(base: string): Promise<void> {
  if (task) {
    post({ kind: 'loaded', ok: true });
    return;
  }
  try {
    const bundle = (await import(/* @vite-ignore */ `${base}/vision_bundle.js`)) as unknown as VisionBundle;
    const fileset = await bundle.FilesetResolver.forVisionTasks(`${base}/wasm`);
    const create = (delegate: 'GPU' | 'CPU') =>
      bundle.InteractiveSegmenter.createFromOptions(fileset, {
        baseOptions: { delegate, modelAssetPath: `${base}/magic_touch.tflite` },
        // The surface the GPU delegate renders on: a worker has no document
        // to make a canvas from, so it is handed one.
        canvas: new OffscreenCanvas(1, 1),
        // The CONFIDENCE map, as on the main thread (`segmenter.ts`).
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    let delegate: 'GPU' | 'CPU' = 'GPU';
    try {
      task = await create('GPU');
    } catch {
      delegate = 'CPU';
      task = await create('CPU');
    }
    post({ kind: 'loaded', ok: true, delegate });
  } catch (e) {
    post({ kind: 'loaded', ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

function segment(id: number, token: number, x: number, y: number): void {
  if (!task || !shown || shown.token !== token) {
    post({ kind: 'mask', id, ok: false, error: !task ? 'the model is not loaded' : 'the picture shown is not the one asked about' });
    return;
  }
  try {
    task.segment(shown.bitmap, { keypoint: { x, y } }, (result) => {
      const masks = result.confidenceMasks ?? [];
      const mask = masks[0];
      if (!mask) {
        for (const m of masks) m.close();
        result.close?.();
        post({ kind: 'mask', id, ok: false });
        return;
      }
      // Copied out before `close()`: the buffer is the task's.
      const confidence = mask.getAsFloat32Array();
      const data = new Uint8Array(confidence.length);
      for (let i = 0; i < confidence.length; i += 1) data[i] = toByte(confidence[i]);
      const { width, height } = mask;
      for (const m of masks) m.close();
      result.close?.();
      post({ kind: 'mask', id, ok: true, width, height, data }, [data.buffer]);
    });
  } catch (e) {
    post({ kind: 'mask', id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  switch (msg.kind) {
    case 'load':
      void load(msg.base);
      break;
    case 'show':
      shown?.bitmap.close();
      shown = { token: msg.token, bitmap: msg.bitmap };
      break;
    case 'segment':
      segment(msg.id, msg.token, msg.x, msg.y);
      break;
    case 'dispose':
      task?.close?.();
      task = null;
      shown?.bitmap.close();
      shown = null;
      break;
  }
};
