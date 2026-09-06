import { useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import { renderDeck } from '../../shared/roadtrip/deck-export';
import {
  hookRange,
  hookSourceProblem,
  hookVariant,
  hookVideoName,
} from '../../shared/roadtrip/hook-video';
import { exportHookVideo } from '../../shared/roadtrip/hook-video-export';
import type { HookBlock } from '../../shared/roadtrip/shades';
import type { TripDoc, TripPost } from '../../shared/roadtrip/trip-types';
import { canWriteToDisk, pickWritableDirectory, writeItems } from '../../shared/sources/write-files';

export interface PostExportInputs {
  trip: TripDoc;
  post: TripPost;
  aspect: number;
  /** How many slides the deck has, so a short render can say how many fell out. */
  slideCount: number;
  /** The badge's clock, so a PNG is taken where the stage is. */
  timeSeconds: number;
  /** Finds a slide's picture in the Library by name. */
  resolve: (ref: { name: string } | null) => File | null;
  /** The hook's own clip and its measured dimensions. */
  hookFile: File | null;
  hookIsVideo: boolean;
  hookInfo: { width: number; height: number; duration: number };
  /** The badge exactly as the stage draws it. */
  hookElements: OverlayElement[];
  block: HookBlock | null;
  /** How long the burned-in clip runs, already clamped to the clip. */
  hookLength: number;
  /** The composed grade every picture goes through; null leaves them as shot. */
  lut: CubeLut | null;
  /** Called as an export starts, so the caller can bring the report into view. */
  onStart?: () => void;
}

export interface PostExports {
  /** A running export's progress line, or null when idle. */
  exporting: string | null;
  /** The last export's outcome, in a sentence. */
  note: string | null;
  exportDeck: () => Promise<void>;
  exportHookClip: () => Promise<void>;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The two things that leave the piece editor as files: the deck as PNGs, and
 * the hook burned into its clip through the Studio's own video export. Both
 * report through one progress line and one note, because only one runs at a
 * time and the author reads them in the same place.
 */
export function usePostExports(inputs: PostExportInputs): PostExports {
  const [exporting, setExporting] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Burn the animated hook into the clip. The still shows the badge settled;
   * this is the version that plays it — which is the whole point of an
   * entrance.
   */
  async function exportHookClip() {
    const { hookFile, hookIsVideo, hookInfo, post, trip } = inputs;
    if (!hookFile || !hookIsVideo) return;
    inputs.onStart?.();
    const problem = hookSourceProblem(hookFile.name, hookFile.type);
    if (problem) {
      setNote(problem);
      return;
    }
    if (!hookInfo.width || !hookInfo.height) {
      setNote('The clip is still loading — try again in a moment.');
      return;
    }
    setNote(null);
    setExporting('Encoding…');
    try {
      const variant = hookVariant(post.badge.aspectId);
      const blob = await exportHookVideo({
        file: hookFile,
        variant,
        elements: inputs.hookElements,
        theme: trip.theme,
        srcWidth: hookInfo.width,
        srcHeight: hookInfo.height,
        range: hookRange(post.badge.videoTimeSeconds, inputs.hookLength, hookInfo.duration),
        shades: post.badge.shades,
        block: inputs.block,
        lut: inputs.lut,
        onProgress: (p) =>
          setExporting(
            p.ratio === null ? `${p.phase}…` : `Encoding ${Math.round(p.ratio * 100)}%…`,
          ),
      });
      const name = hookVideoName(trip.name, post.title.trim() || `day-${post.date}`, variant);
      download(blob, name);
      setNote(`${name} downloaded`);
    } catch (err) {
      // The pipeline's messages already name the cause (an undecodable HEVC
      // points at the transcode), so they are shown as they come.
      setNote(err instanceof Error ? err.message : 'The clip could not be encoded.');
    } finally {
      setExporting(null);
    }
  }

  /**
   * Render every slide and hand the set over. A folder keeps the deck in
   * order on disk; where the picker is unavailable each slide is downloaded
   * in turn, which is the only thing a non-Chromium browser can do.
   */
  async function exportDeck() {
    inputs.onStart?.();
    setNote(null);
    setExporting('Rendering…');
    try {
      const rendered = await renderDeck({
        trip: inputs.trip,
        post: inputs.post,
        aspect: inputs.aspect,
        longEdge: 1920,
        timeSeconds: inputs.timeSeconds,
        resolve: inputs.resolve,
        lut: inputs.lut,
        onProgress: (done, total) => setExporting(`Rendering ${done}/${total}…`),
      });
      if (!rendered.length) {
        setNote('Nothing could be rendered — check the pictures are loaded.');
        return;
      }
      const short = inputs.slideCount - rendered.length;

      if (canWriteToDisk()) {
        let dir: FileSystemDirectoryHandle;
        try {
          dir = await pickWritableDirectory();
        } catch {
          return; // dismissed
        }
        setExporting('Writing…');
        const res = await writeItems(
          dir,
          rendered.map((r) => ({ name: r.name, file: new File([r.blob], r.name) })),
        );
        setNote(
          `${res.written} slide${res.written === 1 ? '' : 's'} written` +
            (short ? ` · ${short} could not be rendered` : '') +
            (res.errors.length ? ` · ${res.errors.length} failed to write` : ''),
        );
      } else {
        for (const r of rendered) download(r.blob, r.name);
        setNote(
          `${rendered.length} slide${rendered.length === 1 ? '' : 's'} downloaded` +
            (short ? ` · ${short} could not be rendered` : ''),
        );
      }
    } finally {
      setExporting(null);
    }
  }

  return { exporting, note, exportDeck, exportHookClip };
}
