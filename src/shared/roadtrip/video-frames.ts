/**
 * Pulling a handful of stills out of a clip, for the filmstrip.
 *
 * One video element seeked from moment to moment, never one per frame: a clip
 * is gigabytes, and building a `<video>` (plus an object URL) per thumbnail is
 * how a strip of a dozen frames becomes a second of stutter. Frames arrive one
 * at a time through `onFrame` rather than as a finished array, so the strip
 * fills in as it decodes instead of staying blank until the last one lands.
 *
 * Cancellable, and it releases the element and its URL whatever happens —
 * a strip whose clip is swapped mid-decode must not leave a decoder running.
 */

export interface FilmstripRequest {
  file: File;
  /** Moments to grab, in seconds. */
  times: readonly number[];
  /** Height of each thumbnail in pixels; the width follows the clip's shape. */
  height?: number;
  onFrame: (index: number, url: string) => void;
  signal?: AbortSignal;
}

/**
 * Decode the asked-for moments, calling `onFrame` as each lands. Resolves when
 * every frame has been tried; a frame the browser cannot produce is skipped
 * silently — one missing cell costs the strip a picture, never the picker.
 */
export async function decodeFilmstrip(req: FilmstripRequest): Promise<void> {
  const { file, times, height = 64, onFrame, signal } = req;
  if (!times.length || signal?.aborted) return;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  const release = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('undecodable'));
      video.src = url;
    });
    if (signal?.aborted) return;

    const w = Math.max(
      1,
      Math.round((video.videoWidth / Math.max(video.videoHeight, 1)) * height),
    );
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) return;
      try {
        await seek(video, times[i]);
        ctx.drawImage(video, 0, 0, w, height);
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, 'image/jpeg', 0.7),
        );
        if (!blob || signal?.aborted) continue;
        onFrame(i, URL.createObjectURL(blob));
      } catch {
        // One cell short is not worth abandoning the strip for.
      }
    }
  } catch {
    // An undecodable clip simply has no strip; the caller already says so.
  } finally {
    release();
  }
}

/**
 * Seek and wait for the frame to actually be there. Clamped short of the end,
 * because a seek past the last frame never fires `seeked` and would hang the
 * whole strip on its final cell.
 */
export function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.min(Math.max(seconds, 0), Math.max(duration - 0.05, 0));
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('seek failed'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = target;
  });
}
