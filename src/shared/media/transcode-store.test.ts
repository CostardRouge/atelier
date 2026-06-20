import { describe, expect, it, vi } from 'vitest';
import { createTranscodeStore, type TranscodeFn } from './transcode-store';

function makeFile(name = 'DJI_0001.MP4'): File {
  // Fixed lastModified so two handles for the "same" file share an identity.
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: 'video/mp4',
    lastModified: 1000,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('transcode store', () => {
  it('starts idle, runs, reports progress, and caches the H.264 result', async () => {
    const d = deferred<Blob>();
    let report: (r: number | null) => void = () => {};
    const fn: TranscodeFn = (_file, onProgress) => {
      report = onProgress;
      return d.promise;
    };
    const store = createTranscodeStore(fn);
    const file = makeFile();

    expect(store.get(file).status).toBe('idle');

    store.request(file);
    expect(store.get(file).status).toBe('running');

    report(0.4);
    expect(store.get(file).ratio).toBe(0.4);

    d.resolve(new Blob([new Uint8Array([9])], { type: 'video/mp4' }));
    await vi.waitFor(() => expect(store.get(file).status).toBe('done'));

    const entry = store.get(file);
    expect(entry.file).toBeInstanceOf(File);
    expect(entry.file?.name).toBe('DJI_0001-h264.mp4');
    expect(entry.ratio).toBe(1);
  });

  it('dedupes concurrent requests and ignores requests once done', async () => {
    const d = deferred<Blob>();
    const fn = vi.fn<TranscodeFn>(() => d.promise);
    const store = createTranscodeStore(fn);
    const file = makeFile();

    store.request(file);
    store.request(file); // still running — must not start a second run
    expect(fn).toHaveBeenCalledTimes(1);

    d.resolve(new Blob([new Uint8Array([1])], { type: 'video/mp4' }));
    await vi.waitFor(() => expect(store.get(file).status).toBe('done'));

    store.request(file); // already done — no-op
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('records the reason when a transcode fails', async () => {
    const d = deferred<Blob>();
    const store = createTranscodeStore(() => d.promise);
    const file = makeFile();

    store.request(file);
    d.reject(new Error('ffmpeg could not transcode this clip.'));

    await vi.waitFor(() => expect(store.get(file).status).toBe('error'));
    expect(store.get(file).error).toBe('ffmpeg could not transcode this clip.');
  });

  it('cancel aborts the run and resets to idle (retryable)', () => {
    let signal: AbortSignal | undefined;
    const fn: TranscodeFn = (_file, _onProgress, s) => {
      signal = s;
      return new Promise<Blob>(() => {}); // never settles
    };
    const store = createTranscodeStore(fn);
    const file = makeFile();

    store.request(file);
    expect(store.get(file).status).toBe('running');

    store.cancel(file);
    expect(signal?.aborted).toBe(true);
    expect(store.get(file).status).toBe('idle');
  });

  it('keys by file identity, not object reference', () => {
    const store = createTranscodeStore(() => new Promise<Blob>(() => {}));
    store.request(makeFile());
    // A different File handle for the same underlying file resolves to the same
    // entry (identity is name + size + lastModified).
    const twin = makeFile();
    expect(store.get(twin).status).toBe('running');
  });

  it('clear aborts everything and empties the cache', () => {
    let signal: AbortSignal | undefined;
    const store = createTranscodeStore((_f, _p, s) => {
      signal = s;
      return new Promise<Blob>(() => {});
    });
    const file = makeFile();
    store.request(file);

    store.clear();
    expect(signal?.aborted).toBe(true);
    expect(store.get(file).status).toBe('idle');
  });

  it('notifies subscribers on change', () => {
    const store = createTranscodeStore(() => new Promise<Blob>(() => {}));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.request(makeFile());
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    const calls = listener.mock.calls.length;
    store.clear();
    expect(listener.mock.calls.length).toBe(calls); // no longer notified
  });
});
