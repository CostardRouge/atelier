import { useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import { classifyPart } from '../../shared/library/assets';
import { loadClipMeta } from '../../shared/media/video-metadata';
import { contentSlideElements } from '../../shared/roadtrip/deck';
import { renderDeck, renderDeckReel } from '../../shared/roadtrip/deck-export';
import { exportPlan, type PlanItem } from '../../shared/roadtrip/export-plan';
import {
  hookRange,
  hookSourceProblem,
  hookVariant,
  hookVideoName,
} from '../../shared/roadtrip/hook-video';
import {
  exportHookStillVideo,
  exportHookVideo,
} from '../../shared/roadtrip/hook-video-export';
import {
  isEncodeSupported,
  type ExportProgress,
} from '../../shared/media/webcodecs-export';
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
  /** The piece's ONE primary export: every slide in the format it is. */
  exportPiece: (opts?: PieceExportOptions) => Promise<void>;
  exportDeck: () => Promise<void>;
  exportHookClip: () => Promise<void>;
}

/** The two delivery choices the export keeps; neither is a format. */
export interface PieceExportOptions {
  /** Every slide as an image, whatever the deck says. */
  imagesOnly?: boolean;
  /** The whole deck as one silent reel. Ignored under `imagesOnly`. */
  combine?: boolean;
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
   * Burn the animated hook into a video. The still shows the badge settled;
   * this is the version that plays it — which is the whole point of an
   * entrance.
   *
   * Two sources, one composition: a clip is re-encoded through the Studio's
   * pipeline with its audio copied, a PHOTOGRAPH is painted frame by frame
   * through `renderBadge` and comes out silent. Which one is decided by the
   * file, not by the author — the author decided whether this slide is a video
   * at all, on the Content tab.
   */
  async function exportHookClip() {
    const { hookFile, hookIsVideo, hookInfo, post, trip } = inputs;
    if (!hookFile) return;
    inputs.onStart?.();
    if (!isEncodeSupported()) {
      setNote(
        'This browser has no video encoder (WebCodecs), so a clip cannot be written here. The slides still export as images.',
      );
      return;
    }
    if (hookIsVideo) {
      const problem = hookSourceProblem(hookFile.name, hookFile.type);
      if (problem) {
        setNote(problem);
        return;
      }
      if (!hookInfo.width || !hookInfo.height) {
        setNote('The clip is still loading — try again in a moment.');
        return;
      }
    }
    setNote(null);
    setExporting('Encoding…');
    const onProgress = (p: ExportProgress) =>
      setExporting(p.ratio === null ? `${p.phase}…` : `Encoding ${Math.round(p.ratio * 100)}%…`);
    try {
      const variant = hookVariant(post.badge.aspectId);
      const shared = {
        variant,
        elements: inputs.hookElements,
        theme: trip.theme,
        shades: post.badge.shades,
        block: inputs.block,
        // The hook's own framing, so the burned-in picture is cropped where
        // the preview showed it — the PNG deck goes through the same value.
        framing: post.badge.framing,
        lut: inputs.lut,
        onProgress,
      };
      const blob = hookIsVideo
        ? await exportHookVideo({
            ...shared,
            file: hookFile,
            srcWidth: hookInfo.width,
            srcHeight: hookInfo.height,
            range: hookRange(
              post.badge.videoTimeSeconds,
              inputs.hookLength,
              hookInfo.duration,
            ),
          })
        : await exportHookStillVideo({
            ...shared,
            file: hookFile,
            seconds: inputs.hookLength,
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
   * ONE video for one slide, whatever it is made of.
   *
   * The four cases collapse into two calls: a clip goes through the Studio's
   * export (audio copied, trimmed to the slide's own in point and length), a
   * still is painted frame by frame. What differs between the hook and a
   * content picture is only which elements are burned in and whether the
   * shades apply — the hook owns those, a content picture carries its caption.
   */
  async function renderSlideVideo(
    item: PlanItem,
    onProgress: (p: ExportProgress) => void,
  ): Promise<Blob> {
    const { post, trip, aspect } = inputs;
    const { slide } = item;
    const isHook = slide.kind === 'hook';
    const file = inputs.resolve(slide.media);
    if (!file) throw new Error(`${slide.media?.name ?? 'This slide'} is not in the Library.`);
    const variant = hookVariant(post.badge.aspectId);
    const shared = {
      variant,
      elements: isHook
        ? inputs.hookElements
        : contentSlideElements(slide.caption, aspect, undefined, slide.captionStyle, item.seconds),
      theme: isHook ? trip.theme : null,
      shades: isHook ? post.badge.shades : undefined,
      block: isHook ? inputs.block : null,
      framing: slide.framing,
      lut: inputs.lut,
      onProgress,
    };
    if (classifyPart(file.name) !== 'video') {
      return exportHookStillVideo({ ...shared, file, seconds: item.seconds });
    }
    // A content clip's own size has to be read here; the hook's is already
    // measured by the stage that is showing it.
    const meta = isHook
      ? inputs.hookInfo
      : await loadClipMeta(file, { thumbnail: false });
    return exportHookVideo({
      ...shared,
      file,
      srcWidth: meta.width,
      srcHeight: meta.height,
      range: hookRange(slide.videoTimeSeconds, item.seconds, meta.duration),
    });
  }

  /**
   * The whole piece, each slide in the format the deck says it is: PNGs for
   * the stills, MP4s for what moves, in one folder and in swipe order.
   *
   * This is the piece's ONE primary export, and it is why the plan exists —
   * the author sees what it will write before pressing it, and a slide that
   * cannot be written says why instead of failing silently in the middle.
   */
  async function exportPiece(opts: PieceExportOptions = {}) {
    inputs.onStart?.();
    setNote(null);
    const plan = exportPlan(inputs.trip, inputs.post, {
      canEncode: isEncodeSupported(),
      hasPicture: (slide) => inputs.resolve(slide.media) !== null || slide.media === null,
      imagesOnly: opts.imagesOnly,
      combine: opts.combine,
    });
    if (plan.files === 0) {
      setNote(plan.blockers[0] ?? 'Nothing in this piece can be written.');
      return;
    }

    // One reel: the deck painted in order through the same encoder a still
    // hook goes through. A single file, so a single delivery.
    if (plan.reel) {
      setExporting('Rendering…');
      try {
        const blob = await renderDeckReel({
          trip: inputs.trip,
          post: inputs.post,
          aspect: inputs.aspect,
          longEdge: 1920,
          resolve: inputs.resolve,
          lut: inputs.lut,
          onProgress: (p) =>
            setExporting(
              p.ratio === null ? `${p.phase}…` : `Encoding ${Math.round(p.ratio * 100)}%…`,
            ),
        });
        setExporting('Writing…');
        await deliver([{ name: plan.reel.name, blob }], 0, plan.blockers);
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'The reel could not be encoded.');
      } finally {
        setExporting(null);
      }
      return;
    }

    const items = plan.items.filter((i) => i.blocker === null);
    const rendered: { name: string; blob: Blob }[] = [];
    setExporting('Rendering…');
    try {
      // The stills go through the deck renderer in one pass, so a carousel of
      // photographs costs one decode each and not one per call.
      const stills = items.filter((i) => i.medium === 'image');
      if (stills.length) {
        const wanted = new Set(stills.map((i) => i.position));
        const out = await renderDeck({
          trip: inputs.trip,
          post: inputs.post,
          aspect: inputs.aspect,
          longEdge: 1920,
          timeSeconds: inputs.timeSeconds,
          resolve: inputs.resolve,
          lut: inputs.lut,
          include: (slide) => wanted.has(slide.position),
          onProgress: (done, total) => setExporting(`Rendering ${done}/${total}…`),
        });
        rendered.push(...out);
      }

      // A clip that fails must not cost the slides that already rendered:
      // each one is caught, and what went wrong is said with the delivery
      // rather than instead of it.
      const failures: string[] = [];
      const clips = items.filter((i) => i.medium === 'video');
      for (const [i, item] of clips.entries()) {
        try {
          const blob = await renderSlideVideo(item, (p) =>
            setExporting(
              p.ratio === null
                ? `${p.phase}…`
                : `Encoding ${i + 1}/${clips.length} · ${Math.round(p.ratio * 100)}%…`,
            ),
          );
          rendered.push({ name: item.name, blob });
        } catch (err) {
          failures.push(err instanceof Error ? err.message : `${item.name} could not be encoded.`);
        }
      }

      if (!rendered.length) {
        setNote(failures[0] ?? 'Nothing could be rendered — check the pictures are loaded.');
        return;
      }
      setExporting('Writing…');
      const short = plan.items.length - rendered.length;
      await deliver(rendered, short, [...plan.blockers, ...failures]);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The piece could not be exported.');
    } finally {
      setExporting(null);
    }
  }

  /**
   * Hand a rendered set over: a folder keeps the deck in order on disk, and
   * where the picker is unavailable each file is downloaded in turn, which is
   * the only thing a non-Chromium browser can do.
   */
  async function deliver(
    rendered: { name: string; blob: Blob }[],
    short: number,
    blockers: string[] = [],
  ) {
    const tail =
      (short ? ` · ${short} could not be written` : '') +
      (blockers.length ? ` — ${blockers[0]}` : '');
    if (canWriteToDisk()) {
      let dir: FileSystemDirectoryHandle;
      try {
        dir = await pickWritableDirectory();
      } catch {
        return; // dismissed
      }
      const res = await writeItems(
        dir,
        rendered.map((r) => ({ name: r.name, file: new File([r.blob], r.name) })),
      );
      setNote(
        `${res.written} file${res.written === 1 ? '' : 's'} written` +
          (res.errors.length ? ` · ${res.errors.length} failed to write` : '') +
          tail,
      );
      return;
    }
    for (const r of rendered) download(r.blob, r.name);
    setNote(
      `${rendered.length} file${rendered.length === 1 ? '' : 's'} downloaded` + tail,
    );
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

  return { exporting, note, exportPiece, exportDeck, exportHookClip };
}
