import { afterEach, describe, expect, it } from 'vitest';
import { clearTasks, listTasks } from '../tasks/tasks';
import { canDecodeRaw, decodeCacheKey, decodeRaw, decodedRawBytes, dropDecodedRaws, librawSettings, wantsHalfSize } from './raw-decoder';

afterEach(() => clearTasks());

describe('a decode is a task, and a cancel drops its turn', () => {
  it('registers "Opening <file>" with a cancel, and rejects before touching the file once cancelled', async () => {
    const file = new File([new Uint8Array(16)], 'DJI_0001.DNG');
    const controller = new AbortController();
    controller.abort();
    // A signal already aborted: the chain is entered and left with nothing
    // read and no decoder loaded (loading libraw-wasm here would fail loudly).
    await expect(decodeRaw(file, { signal: controller.signal, scope: 'p1' })).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Opening DJI_0001.DNG was cancelled',
    });
    expect(listTasks()).toEqual([]);
  });

  it('is named and scoped, and its own cancel ends it', async () => {
    const file = new File([new Uint8Array(16)], 'DSC08463.ARW');
    const pending = decodeRaw(file, { scope: 'p2' });
    const task = listTasks().find((t) => t.label === 'Opening DSC08463.ARW');
    expect(task).toMatchObject({ scope: 'p2', progress: null, detail: 'the sensor’s data' });
    expect(task?.cancel).toBeTypeOf('function');
    task!.cancel!();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(listTasks()).toEqual([]);
  });

  it('starts no task when told to be quiet', async () => {
    const controller = new AbortController();
    controller.abort();
    const pending = decodeRaw(new File([], 'X.DNG'), { signal: controller.signal, quiet: true });
    expect(listTasks()).toEqual([]);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('wantsHalfSize', () => {
  it('halves a picture past the budget and leaves one inside it whole', () => {
    const budget = { budgetPixels: 3840 * 2160 };
    expect(wantsHalfSize(4000, 3000, budget)).toBe(true);
    expect(wantsHalfSize(8064, 6048, budget)).toBe(true);
    expect(wantsHalfSize(3000, 2000, budget)).toBe(false);
  });

  it('never halves below the long edge an export asked for', () => {
    expect(wantsHalfSize(8064, 6048, { minLongEdge: 4032 })).toBe(true);
    expect(wantsHalfSize(8064, 6048, { minLongEdge: 4033 })).toBe(false);
    expect(wantsHalfSize(8064, 6048, { budgetPixels: 1_000_000, minLongEdge: 6000 })).toBe(false);
    // Nothing asked, or nothing known: whole.
    expect(wantsHalfSize(8064, 6048, {})).toBe(false);
    expect(wantsHalfSize(null, null, { budgetPixels: 1 })).toBe(false);
  });

  it('halves a picture the edge cap would box-average anyway, and never under the long edge asked for', () => {
    // A phone's export ceiling: the whole 6000 px would be boxed to 3000, so
    // LibRaw's own half is asked for instead — a third of the time, a quarter
    // of the worker's heap.
    expect(wantsHalfSize(6000, 4000, { maxEdge: 4096 })).toBe(true);
    expect(wantsHalfSize(4000, 3000, { maxEdge: 4096 })).toBe(false);
    // Asked for 3500 px at least: the half (3000) falls short, so whole.
    expect(wantsHalfSize(6000, 4000, { maxEdge: 4096, minLongEdge: 3500 })).toBe(false);
    expect(wantsHalfSize(6000, 4000, { maxEdge: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe('the decoder’s settings and its gate', () => {
  it('asks for linear 16-bit output with the camera’s white balance and no auto-bright', () => {
    const s = librawSettings(true);
    expect(s).toMatchObject({ outputBps: 16, noAutoBright: true, useCameraWb: true, outputColor: 1, highlight: 0, halfSize: true });
    expect(librawSettings(false).halfSize).toBe(false);
  });

  it('is asked only for a RAW by name', () => {
    expect(canDecodeRaw(new File([], 'DJI_0001.DNG'))).toBe(true);
    expect(canDecodeRaw(new File([], 'IMG_1.ARW'))).toBe(true);
    expect(canDecodeRaw(new File([], 'IMG_1.jpg'))).toBe(false);
    expect(canDecodeRaw(null)).toBe(false);
  });
});

describe('what a decode is held under, and what is held', () => {
  it('keys a decode by the file and everything that sizes it — never the gain', () => {
    const file = new File([new Uint8Array(8)], 'DJI_0101.DNG', { lastModified: 1700000000000 });
    const key = decodeCacheKey(file, { budgetPixels: 8_294_400, maxEdge: 2560, gain: 2.5 });
    expect(key).toBe('DJI_0101.DNG:8:1700000000000|budget=8294400|min=|edge=2560');
    expect(decodeCacheKey(file, { budgetPixels: 8_294_400, maxEdge: 2560, gain: 1 })).toBe(key);
    expect(decodeCacheKey(file, { maxEdge: 4096 })).not.toBe(key);
  });

  it('holds nothing until a decode lands, and can be told to forget', () => {
    expect(decodedRawBytes()).toBe(0);
    dropDecodedRaws();
    expect(decodedRawBytes()).toBe(0);
  });

  it('a held decode asked for under an aborted signal is still a cancel', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(decodeRaw(new File([], 'X.DNG'), { signal: controller.signal, hold: true, quiet: true })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
