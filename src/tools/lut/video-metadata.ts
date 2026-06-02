/**
 * Lightweight video metadata + thumbnail helpers for the LUT Studio clip list.
 *
 * Cheap, per-clip facts (resolution, duration, a still thumbnail) come from a
 * throwaway `<video>` element — the browser reads only what it needs. The codec
 * isn't exposed by `<video>`, so it's probed from the container via mp4box, but
 * only for the *active* clip and with a byte cap, since a camera file's `moov`
 * can sit at the end (probing it fully would mean reading the whole file).
 */

import { createFile, MP4BoxBuffer, type Movie } from 'mp4box';

/** Recognised video container extensions. */
const VIDEO_EXT = /\.(mp4|mov|m4v)$/i;

/** Keep only the video files from an arbitrary picked/dropped set. */
export function filterVideos(files: File[]): File[] {
  return files.filter((f) => {
    // Skip hidden files and macOS AppleDouble sidecars (`._clip.mp4`,
    // `.DS_Store`) — a folder pick on a Mac SD card is full of these, and
    // `._clip.mp4` would otherwise sneak past an extension-only check.
    if (f.name.startsWith('.')) return false;
    return f.type.startsWith('video/') || VIDEO_EXT.test(f.name);
  });
}

export interface ClipMeta {
  width: number;
  height: number;
  duration: number;
  /** Object URL of a small JPEG thumbnail, or undefined if a frame couldn't
   *  be captured (e.g. an undecodable codec). Caller must revoke it. */
  thumbUrl?: string;
}

/**
 * Read resolution + duration from a file and try to capture a thumbnail.
 * Rejects only if even the metadata can't be read (e.g. the browser can't
 * demux the container at all). A missing thumbnail is not an error.
 */
export function loadClipMeta(file: File): Promise<ClipMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;

    let settled = false;
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    const done = (meta: ClipMeta) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(meta);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Could not read video metadata'));
    };

    // Backstop: never hang a row if seeking/decoding stalls.
    const timer = setTimeout(() => {
      if (video.videoWidth) {
        done({
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
        });
      } else {
        fail();
      }
    }, 4000);

    video.onerror = () => {
      clearTimeout(timer);
      fail();
    };

    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;

      const finishNoThumb = () => {
        clearTimeout(timer);
        done({ width, height, duration });
      };

      const captureThumb = () => {
        if (settled) return;
        try {
          const scale = 200 / Math.max(1, width);
          const cw = Math.max(1, Math.round(width * scale));
          const ch = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext('2d');
          if (!ctx) return finishNoThumb();
          ctx.drawImage(video, 0, 0, cw, ch);
          canvas.toBlob(
            (blob) => {
              clearTimeout(timer);
              done({
                width,
                height,
                duration,
                thumbUrl: blob ? URL.createObjectURL(blob) : undefined,
              });
            },
            'image/jpeg',
            0.72,
          );
        } catch {
          finishNoThumb();
        }
      };

      video.onseeked = captureThumb;
      // Seek a little in so we don't grab a black leading frame.
      try {
        video.currentTime = Math.min(1, (duration || 2) / 2);
      } catch {
        captureThumb();
      }
    };
  });
}

export interface ContainerInfo {
  codec?: string;
  fps?: number;
}

/**
 * Probe the container for codec and frame rate, feeding mp4box in chunks and
 * stopping as soon as the `moov` is parsed or `capBytes` is read. Best-effort:
 * resolves `{}` if the header isn't reachable within the cap.
 */
export function probeContainer(
  file: File,
  capBytes = 48 * 1024 * 1024,
): Promise<ContainerInfo> {
  return new Promise((resolve) => {
    const mp4 = createFile();
    let done = false;

    const finish = (info: ContainerInfo) => {
      if (done) return;
      done = true;
      resolve(info);
    };

    mp4.onError = () => finish({});
    mp4.onReady = (movie: Movie) => {
      const track = movie.videoTracks[0];
      let fps: number | undefined;
      if (track && track.nb_samples && movie.duration && movie.timescale) {
        const seconds = movie.duration / movie.timescale;
        if (seconds > 0) fps = Math.round(track.nb_samples / seconds);
      }
      finish({ codec: track?.codec, fps });
    };

    const CHUNK = 1024 * 1024;
    let offset = 0;
    const pump = async () => {
      while (!done && offset < file.size && offset < capBytes) {
        const end = Math.min(offset + CHUNK, file.size);
        const buffer = await file.slice(offset, end).arrayBuffer();
        if (done) break;
        mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, offset));
        offset = end;
      }
      finish({});
    };
    void pump();
  });
}
