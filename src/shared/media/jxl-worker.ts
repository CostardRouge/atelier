/**
 * One JPEG XL decoder in a worker: a codestream in, its SAMPLES out
 * (`png-read.ts`), the buffer transferred back. Several of these run side by
 * side for the tiles of a ProRAW DNG (`jxl-pool.ts`), since jxl-oxide decodes
 * on one thread and a 48-megapixel sensor is hundreds of tiles.
 */

import init, { JxlImage } from 'jxl-oxide-wasm';
import wasmUrl from 'jxl-oxide-wasm/module.wasm?url';
import { readPngSamples } from './png-read';

let ready: Promise<unknown> | null = null;

self.onmessage = async (event: MessageEvent<{ id: number; bytes: Uint8Array }>) => {
  const { id, bytes } = event.data;
  try {
    ready ??= init({ module_or_path: wasmUrl });
    await ready;
    const img = new JxlImage();
    let png: Uint8Array;
    try {
      img.feedBytes(bytes);
      if (!img.tryInit() || !img.loaded) throw new Error('an incomplete JPEG XL tile');
      // `encodeToPng` takes the render by value: never freed a second time.
      png = img.render().encodeToPng();
    } finally {
      img.free();
    }
    const samples = await readPngSamples(png);
    (self as unknown as Worker).postMessage({ id, ok: true, samples }, [samples.data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
