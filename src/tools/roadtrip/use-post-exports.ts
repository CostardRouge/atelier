import { useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import { classifyPart } from '../../shared/library/assets';
import { loadClipMeta } from '../../shared/media/video-metadata';
import { contentSlideElements, type DeckSlide } from '../../shared/roadtrip/deck';
import { loadCollageSources } from '../../shared/roadtrip/badge-render';
import { renderDeck } from '../../shared/roadtrip/deck-export';
import { exportPlan, type PlanItem } from '../../shared/roadtrip/export-plan';
import {
  clipSpeed,
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
  DecodeUnsupportedError,
  isEncodeSupported,
  type ExportProgress,
} from '../../shared/media/webcodecs-export';
import { transcodeStore } from '../../shared/media/transcode-store';
import type { HookBlock } from '../../shared/roadtrip/shades';
import type { TripDoc, TripPost } from '../../shared/roadtrip/trip-types';
import { canWriteToDisk, pickWritableDirectory, writeItems } from '../../shared/sources/write-files';
import type { HookPicture, ResolvedHook } from '../../shared/roadtrip/hooks/hook-variant';
import type { ElementsAt } from '../../shared/roadtrip/hooks/hook-elements';

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
  /**
   * The deck's first slide. The hook clip export composes from `post.badge`
   * directly, but its LOOK is now a chain the piece alone cannot answer
   * (`post-grade.ts`), and `lutFor` reads a slide.
   */
  hookSlide: DeckSlide;
  /** The hook's own clip and its measured dimensions. */
  hookFile: File | null;
  hookIsVideo: boolean;
  hookInfo: { width: number; height: number; duration: number };
  /** The badge exactly as the stage draws it. */
  hookElements: OverlayElement[];
  /**
   * The piece's prepared opener, WITH its pictures — the same object the stage
   * paints, so a burned-in scrub flashes what the preview flashed.
   */
  hook: ResolvedHook | null;
  /**
   * The opener's decoded pictures, for the PNG path: the video path reads
   * them through `hook`, but the deck renderer prepares the opener itself.
   */
  hookPictures?: ReadonlyMap<string, HookPicture>;
  /**
   * The hook picture's exposure line, when the piece credits its camera —
   * measured in the editor, so the PNG deck says what the stage says. The
   * video paths need nothing: they burn in `hookElements`, which already
   * carries the credit.
   */
  exposure?: string | null;
  /** The badge's elements at a moment, when the opener rewrites its words. */
  hookElementsAt: ElementsAt | null;
  block: HookBlock | null;
  /** How long the burned-in clip runs, already clamped to the clip. */
  hookLength: number;
  /**
   * The cube a slide is rendered through — the grade it wears baked with its
   * own develop (`TripGradeBinding.lutFor`); null leaves that picture as shot.
   */
  lutFor: (slide: DeckSlide) => CubeLut | null;
  /** Called as an export starts, so the caller can bring the report into view. */
  onStart?: () => void;
}

export interface PostExports {
  /** A running export's progress line, or null when idle. */
  exporting: string | null;
  /** The last export's outcome, in a sentence. */
  note: string | null;
  /**
   * A clip the last export could not DECODE (HEVC on a browser without it),
   * so the panel can offer the in-browser transcode right there — the
   * pipeline's own message says "transcode it first", and a sentence that
   * names a remedy the screen does not offer is a dead end. Cleared by the
   * next export that starts.
   */
  undecodable: File | null;
  /** The piece's ONE primary export: every slide in the format it is. */
  exportPiece: (imagesOnly?: boolean) => Promise<void>;
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
 * The file the pipeline should read: the H.264 the author transcoded from it
 * when there is one, else the file itself — the Studio's own preference. The
 * transcode keeps the picture's size, so the measured dimensions still hold.
 */
function deliverable(file: File): File {
  return transcodeStore.get(file).file ?? file;
}

/**
 * What an export failure means, in a sentence a person can act on; null for
 * a cancellation. The pipeline's messages already name most causes; the two
 * it cannot are a file handle gone stale (a folder's files become unreadable
 * after a while) and — flagged apart so the panel can offer the remedy — a
 * codec this browser does not decode.
 */
function explainFailure(
  err: unknown,
  fallback: string,
): { note: string | null; undecodable: boolean } {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { note: null, undecodable: false };
  }
  if (
    err instanceof DOMException &&
    (err.name === 'NotReadableError' || err.name === 'NotFoundError')
  ) {
    return {
      note: 'The clip could not be read. Files opened from a folder can become unreadable after a while — re-add it to the Library (drag it in, or “Add files”) and export again.',
      undecodable: false,
    };
  }
  if (err instanceof DecodeUnsupportedError) {
    return { note: err.message, undecodable: true };
  }
  return { note: err instanceof Error ? err.message : fallback, undecodable: false };
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
  const [undecodable, setUndecodable] = useState<File | null>(null);

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
    }
    setNote(null);
    setUndecodable(null);
    setExporting('Encoding…');
    let audioSkipped: string | null = null;
    const onProgress = (p: ExportProgress) =>
      setExporting(p.ratio === null ? `${p.phase}…` : `Encoding ${Math.round(p.ratio * 100)}%…`);
    try {
      // The stage measures the hook's clip while it shows it; a piece opened
      // on another slide has not shown it yet, so the size is read from the
      // file rather than the author told to wait for something not coming.
      const meta =
        hookIsVideo && (!hookInfo.width || !hookInfo.height)
          ? await loadClipMeta(hookFile, { thumbnail: false })
          : hookInfo;
      // The slide's own speed, resolved by the deck (1 for a photograph).
      const speed = hookIsVideo ? clipSpeed(post.badge.videoSpeed) : 1;
      const variant = hookVariant(post.badge.aspectId, 1080, speed);
      const shared = {
        variant,
        elements: inputs.hookElements,
        hook: inputs.hook,
        elementsAt: inputs.hookElementsAt,
        theme: trip.theme,
        shades: post.badge.shades,
        block: inputs.block,
        // The hook's own framing, so the burned-in picture is cropped where
        // the preview showed it — the PNG deck goes through the same value.
        framing: post.badge.framing,
        lut: inputs.lutFor(inputs.hookSlide),
        onProgress,
      };
      const blob = hookIsVideo
        ? await exportHookVideo({
            ...shared,
            file: deliverable(hookFile),
            onAudioSkipped: (reason) => {
              audioSkipped = reason;
            },
            srcWidth: meta.width,
            srcHeight: meta.height,
            range: hookRange(post.badge.videoTimeSeconds, inputs.hookLength, meta.duration, speed),
          })
        : post.badge.collage
          ? await (async () => {
              // The hook's collage, painted: its cells decoded and graded
              // exactly as the piece export does for any collage slide.
              const cells = await loadCollageSources(inputs.hookSlide, post.badge.collage!, inputs.resolve);
              try {
                return await exportHookStillVideo({
                  ...shared,
                  collage: {
                    render: { collage: post.badge.collage!, items: cells.items, seconds: inputs.hookLength },
                    luts: cells.items.map((cell) =>
                      inputs.lutFor({ ...inputs.hookSlide, develop: cell.develop }),
                    ),
                    aspect: inputs.aspect,
                  },
                  seconds: inputs.hookLength,
                  onAudioSkipped: (reason) => {
                    audioSkipped = reason;
                  },
                });
              } finally {
                cells.release();
              }
            })()
          : await exportHookStillVideo({
              ...shared,
              file: hookFile,
              seconds: inputs.hookLength,
              onAudioSkipped: (reason) => {
                audioSkipped = reason;
              },
            });
      const name = hookVideoName(trip.name, post.title.trim() || `day-${post.date}`, variant);
      download(blob, name);
      // A clip that went out without the ticks it was composed with says so
      // with the delivery, rather than being discovered on a phone later.
      setNote(audioSkipped ? `${name} downloaded — ${audioSkipped}` : `${name} downloaded`);
    } catch (err) {
      const failure = explainFailure(err, 'The clip could not be encoded.');
      setNote(failure.note);
      if (failure.undecodable) setUndecodable(hookFile);
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
    onAudioSkipped?: (reason: string) => void,
  ): Promise<Blob> {
    const { post, trip, aspect } = inputs;
    const { slide } = item;
    const isHook = slide.kind === 'hook';
    const variant = hookVariant(post.badge.aspectId, 1080, slide.speed);
    const shared = {
      variant,
      elements: isHook ? inputs.hookElements : contentSlideElements(slide.caption, aspect),
      hook: isHook ? inputs.hook : null,
      elementsAt: isHook ? inputs.hookElementsAt : null,
      theme: isHook ? trip.theme : null,
      shades: isHook ? post.badge.shades : undefined,
      block: isHook ? inputs.block : null,
      framing: slide.framing,
      lut: inputs.lutFor(slide),
      onProgress,
    };
    // A collage is PAINTED, whatever its cells hold: every cell's picture
    // decoded, each graded through the slide's grade with its own develop.
    if (slide.collage) {
      const cells = await loadCollageSources(slide, slide.collage, inputs.resolve);
      try {
        return await exportHookStillVideo({
          ...shared,
          collage: {
            render: { collage: slide.collage, items: cells.items, seconds: item.seconds },
            luts: cells.items.map((cell) => inputs.lutFor({ ...slide, develop: cell.develop })),
            aspect,
          },
          seconds: item.seconds,
          onAudioSkipped,
        });
      } finally {
        cells.release();
      }
    }
    const file = inputs.resolve(slide.media);
    if (!file) throw new Error(`${slide.media?.name ?? 'This slide'} is not in the Library.`);
    if (classifyPart(file.name) !== 'video') {
      return exportHookStillVideo({ ...shared, file, seconds: item.seconds, onAudioSkipped });
    }
    // The hook's size is usually already measured by the stage that showed
    // it; a content clip's has to be read here — and so has the hook's when
    // the stage has not shown it yet (a piece opened on another slide), or
    // the variant would be sized from 0×0 and the encoder refused.
    const meta =
      isHook && inputs.hookInfo.width > 0 && inputs.hookInfo.height > 0
        ? inputs.hookInfo
        : await loadClipMeta(file, { thumbnail: false });
    return exportHookVideo({
      ...shared,
      file: deliverable(file),
      onAudioSkipped,
      srcWidth: meta.width,
      srcHeight: meta.height,
      range: hookRange(slide.videoTimeSeconds, item.seconds, meta.duration, slide.speed),
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
  async function exportPiece(imagesOnly = false) {
    inputs.onStart?.();
    setNote(null);
    setUndecodable(null);
    const plan = exportPlan(inputs.trip, inputs.post, {
      canEncode: isEncodeSupported(),
      hasPicture: (slide) => inputs.resolve(slide.media) !== null || slide.media === null,
      imagesOnly,
    });
    if (plan.files === 0) {
      setNote(plan.blockers[0] ?? 'Nothing in this piece can be written.');
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
          pictures: inputs.hookPictures,
          exposure: inputs.exposure,
          lutFor: inputs.lutFor,
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
          const blob = await renderSlideVideo(
            item,
            (p) =>
              setExporting(
                p.ratio === null
                  ? `${p.phase}…`
                  : `Encoding ${i + 1}/${clips.length} · ${Math.round(p.ratio * 100)}%…`,
              ),
            // Not a failure — the file is delivered — but a departure from what
            // was composed, reported with the delivery like one.
            (reason) => failures.push(`${item.name}: ${reason}`),
          );
          rendered.push({ name: item.name, blob });
        } catch (err) {
          const failure = explainFailure(err, `${item.name} could not be encoded.`);
          if (failure.note) failures.push(failure.note);
          // The first clip this browser cannot decode gets the transcode
          // offered; a second would be the same codec from the same camera.
          if (failure.undecodable) {
            setUndecodable((cur) => cur ?? inputs.resolve(item.slide.media));
          }
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
      setNote(explainFailure(err, 'The piece could not be exported.').note);
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
        pictures: inputs.hookPictures,
        exposure: inputs.exposure,
        lutFor: inputs.lutFor,
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
    } catch (err) {
      setNote(explainFailure(err, 'The slides could not be exported.').note);
    } finally {
      setExporting(null);
    }
  }

  return { exporting, note, undecodable, exportPiece, exportDeck, exportHookClip };
}
