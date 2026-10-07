import { useRef, useState } from 'react';
import type { FilmTexture } from '../../shared/film/film-texture';
import type { CubeLut } from '../../shared/lib/cube-parser';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import { classifyPart } from '../../shared/library/assets';
import { loadClipMeta } from '../../shared/media/video-metadata';
import { deepestFraming } from '../../shared/media/framing-motion';
import { downloadBlob } from '../../shared/media/save';
import { deckSlides, type DeckSlide } from '../../shared/roadtrip/deck';
import { freezeLooks } from '../../shared/roadtrip/frozen-looks';
import { describePieceEdits, editedDuringExport } from '../../shared/roadtrip/run-edits';
import { slideRender } from '../../shared/roadtrip/slide-render';
import { frameSize, loadCollageSources } from '../../shared/roadtrip/badge-render';
import { exportEdge } from '../../shared/media/photo-frame';
import { DECK_LONG_EDGE, renderDeck } from '../../shared/roadtrip/deck-export';
import { deliveryFor } from '../../shared/develop/delivery-source';
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
import type { HookBlock } from '../../shared/shades/shades';
import type { TripDoc, TripPost } from '../../shared/roadtrip/trip-types';
import { deliverFilesTo, pickDeliveryTarget, type DeliveryTarget } from '../../shared/sources/deliver-files';
import type { HookPicture, HookPictureStatus, ResolvedHook } from '../../shared/roadtrip/hooks/hook-variant';
import { groundNote } from '../../shared/roadtrip/hooks/basemap-strip';
import type { ElementsAt } from '../../shared/roadtrip/hooks/hook-elements';
import { startTask, type TaskHandle } from '../../shared/tasks/tasks';
import {
  atStep,
  cancelRun,
  enterUnit,
  finishUnit,
  runFraction,
  startRun,
  type RunPhase,
  type RunProgress,
  type RunUnit,
} from '../../shared/tasks/run-progress';
import { isAbortError } from '../../shared/sources/fetch-options';
import type { ExifData } from '../../shared/exif/exif-parser';

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
   * The hook picture's effective EXIF, when the piece credits its camera —
   * read in the editor, so the PNG deck says what the stage says. The
   * video paths need nothing: they burn in `hookElements`, which already
   * carries the credit.
   */
  exif?: ExifData | null;
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
  /** The film TEXTURE that slide wears — `TripGradeBinding.filmFor`, the twin of `lutFor`. */
  filmFor: (slide: DeckSlide) => FilmTexture | null;
  /** Called as an export starts, so the caller can bring the report into view. */
  onStart?: () => void;
  /**
   * Resolves once the openers' pictures and map tiles have all landed or
   * failed and the editor has rendered with them (`useHookPictures`). An
   * export awaits it before its first frame, then reads `hook` and
   * `hookPictures` as they are THEN: a recorded file never holds a tile that
   * was still on its way at the click.
   */
  ready?: (signal?: AbortSignal) => Promise<void>;
  /** Where the pictures and tiles stand — what the wait could not bring is said with the delivery. */
  pictureStatus?: HookPictureStatus;
}

export interface PostExports {
  /** A running export's progress line, or null when idle. */
  exporting: string | null;
  /**
   * Where a running export stands slide by slide (`run-progress.ts`) — the
   * Deliver bar's segments and the deck strip's marks; null when idle.
   */
  run: RunProgress | null;
  /** Stop the running export at the next slide, ending an encode in flight. */
  cancel: () => void;
  /**
   * How far the running export is through the WHOLE job, 0–1, counted in
   * the run's stages (`runFraction`) — never a time. The header's button draws this
   * as its own fill and a number of fixed width, while the sentence above
   * goes to its tooltip — a label that changes length every percent made the
   * whole bar jump.
   */
  progress: number | null;
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
  /** Every slide as a PNG — or only the slide at `position`. */
  exportDeck: (position?: number) => Promise<void>;
  exportHookClip: () => Promise<void>;
}

/** A still is rendered then written; what moves is encoded then written. */
const STILL_PHASES: readonly RunPhase[] = [
  { id: 'render', label: 'Render' },
  { id: 'write', label: 'Write' },
];
const CLIP_PHASES: readonly RunPhase[] = [
  { id: 'encode', label: 'Encode' },
  { id: 'write', label: 'Write' },
];

/** A slide as one unit of a run: named as the deck strip names it, with its file. */
function slideUnit(slide: DeckSlide, name: string, moving: boolean): RunUnit {
  const which = slide.kind === 'hook' ? 'Hook' : slide.kind === 'cta' ? 'Closing card' : `Slide ${slide.position}`;
  return { id: String(slide.position), name: `${which} · ${name}`, phases: moving ? CLIP_PHASES : STILL_PHASES };
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
  const [exporting, setLine] = useState<string | null>(null);
  /**
   * Which pixels each STILL slide leaves from, decided before a frame is
   * drawn, and a resolver that hands the renderer what was chosen: a source's
   * original only for a picture whose proxy would be upscaled into the deck's
   * frame (O2 of `docs/develop-originals.md`; the door that could force or
   * refuse it left with R5 of `docs/capture-renditions.md`). The clips are
   * untouched — the Studio's own export already fetches a clip's capture.
   *
   * The deck renderer knows nothing about sources — its `resolve` is injected
   * exactly so that it stays testable and free of the library — so the
   * substitution happens here, by wrapping that resolver. A collage slide is
   * deliberately left alone: each of its cells is drawn into a fraction of
   * the frame, so asking the whole frame's question for one would fetch an
   * original to fill a box a quarter its size.
   */
  async function pixelsForStills(
    slides: readonly DeckSlide[],
  ): Promise<(ref: { name: string } | null) => File | null> {
    const base = inputs.resolve;
    const out = frameSize(inputs.aspect, DECK_LONG_EDGE);
    const swap = new Map<File, File>();
    for (const slide of slides) {
      if (slide.collage) continue;
      const file = base(slide.media);
      if (!file || swap.has(file) || classifyPart(file.name) === 'video') continue;
      try {
        // A picture that moves needs the pixels of its CLOSEST frame, not of its rest.
        const chosen = await deliveryFor(file, deepestFraming(slide.framing, slide.motion), out, (line) => setExporting(line));
        if (chosen.file !== file) swap.set(file, chosen.file);
      } catch {
        // Knowing nothing about a picture is never a reason to drop it: the
        // slide leaves from the file in hand, exactly as it always did.
      }
    }
    if (swap.size === 0) return base;
    return (ref) => {
      const file = base(ref);
      return file ? (swap.get(file) ?? file) : null;
    };
  }

  const [progress, setProgress] = useState<number | null>(null);
  // The run as a TASK (`tasks.md`, T4): what the header's fill says, the
  // masthead's pill says too — and the pill carries the Cancel, which stops
  // between two slides or two frames and keeps what was made.
  const task = useRef<{ handle: TaskHandle; controller: AbortController } | null>(null);
  const beginTask = (label: string) => {
    const controller = new AbortController();
    const handle = startTask({ label, scope: `piece:${inputs.post.id}`, progress: 0, cancel: () => controller.abort() });
    task.current = { handle, controller };
    return controller.signal;
  };
  const endTask = () => {
    task.current?.handle.done();
    task.current = null;
  };
  // The line and its measure always change together, so a stale ratio can
  // never sit beside a new sentence.
  const setExporting = (line: string | null, ratio: number | null = null) => {
    setLine(line);
    setProgress(ratio);
    if (line !== null) task.current?.handle.update({ progress: ratio, detail: line });
  };
  // Where the run stands slide by slide (`run-progress.ts`): the bar's
  // segments, the deck's marks, and the header's fill counted in stages. A
  // Cancel from anywhere — the bar, the pill — is shown at once.
  const [run, setRun] = useState<RunProgress | null>(null);
  const runNow = useRef<RunProgress | null>(null);
  const showRun = (next: RunProgress | null) => {
    const signal = task.current?.controller.signal;
    runNow.current = next && signal?.aborted ? cancelRun(next) : next;
    setRun(runNow.current);
    if (runNow.current) setProgress(runFraction(runNow.current));
  };
  // The piece as the run was given it, and as it is now: what changed in
  // between is named when the run ends (`run-edits.ts`, L2) — the files are
  // the click's, and a retouch made meanwhile is not in them.
  const latest = useRef(inputs);
  latest.current = inputs;
  // The opener and its pictures as they were once the wait ended — every
  // renderer below reads these, never the click's, during a run.
  const ground = useRef<{ hook: ResolvedHook | null; pictures: ReadonlyMap<string, HookPicture> | undefined } | null>(null);
  const liveHook = () => (ground.current ? ground.current.hook : inputs.hook);
  const livePictures = () => (ground.current ? ground.current.pictures : inputs.hookPictures);
  /**
   * Wait for every tile and picture the openers asked for, then hold the
   * opener drawn with them. Returns what the ground lost, or null.
   */
  async function awaitGround(signal: AbortSignal): Promise<string | null> {
    if (!inputs.ready) return null;
    setExporting('Fetching the map tiles and pictures…');
    await inputs.ready(signal);
    const now = latest.current;
    ground.current = { hook: now.hook, pictures: now.hookPictures };
    return groundNote(now.pictureStatus);
  }
  const sent = useRef<{ trip: TripDoc; post: TripPost; positions: number[] } | null>(null);
  const withEdits = (text: string) => {
    const at = sent.current;
    const edits = at ? describePieceEdits(editedDuringExport(at, latest.current, at.positions)) : null;
    return edits ? `${edits} ${text}` : text;
  };
  const beginRun = (units: readonly RunUnit[]) => {
    sent.current = { trip: inputs.trip, post: inputs.post, positions: units.map((u) => Number(u.id)) };
    showRun(startRun(units, Date.now()));
    task.current?.controller.signal.addEventListener('abort', () => showRun(runNow.current));
  };
  /** One step of the slide in hand: the bar, the pill, the header, the line. */
  const say = (phase: string, words: string, ratio: number | null = null) => {
    if (!runNow.current) return;
    const next = atStep(runNow.current, phase, words, ratio);
    setLine(words);
    showRun(next);
    task.current?.handle.update({ progress: runFraction(next), detail: words });
  };
  const enter = (i: number) => runNow.current && showRun(enterUnit(runNow.current, i));
  const finish = (i: number, ok: boolean) => runNow.current && showRun(finishUnit(runNow.current, i, ok, Date.now()));
  const cancel = () => task.current?.controller.abort();

  /**
   * Write ONE file where the run lands, as soon as it is made — a reel of
   * clips no longer waits in memory for the last one, and a slide counts as
   * done when it is on disk. The counts feed the run's closing sentence.
   */
  const written = useRef({ count: 0, errors: [] as string[], method: 'folder' as 'folder' | 'download' });
  async function writeOne(target: DeliveryTarget, name: string, blob: Blob): Promise<boolean> {
    const res = await deliverFilesTo(target, [new File([blob], name)], { replace: true });
    written.current.method = res.method;
    written.current.count += res.written;
    if (res.method === 'folder') written.current.errors.push(...res.errors);
    return res.written > 0;
  }
  /** The run's closing sentence, from what was written and what was not. */
  function closingNote(short: number, blockers: readonly string[]): string {
    const w = written.current;
    return (
      `${w.count} file${w.count === 1 ? '' : 's'} ${w.method === 'folder' ? 'written' : 'downloaded'}` +
      (w.errors.length ? ` · ${w.errors.length} failed to write` : '') +
      (short > 0 ? ` · ${short} could not be written` : '') +
      (blockers.length ? ` — ${blockers[0]}` : '')
    );
  }
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
    // The looks as they are at the click, before anything awaits (`frozen-looks.ts`).
    const looks = freezeLooks([inputs.hookSlide], inputs.lutFor, inputs.filmFor);
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
    const signal = beginTask('Encoding the hook');
    beginRun([slideUnit(inputs.hookSlide, hookFile.name, true)]);
    enter(0);
    let audioSkipped: string | null = null;
    const onProgress = (p: ExportProgress) =>
      say('encode', p.ratio === null ? `${p.phase}…` : `Encoding the hook · ${Math.round(p.ratio * 100)}%`, p.ratio);
    try {
      const lost = await awaitGround(signal);
      say('encode', 'Encoding the hook', 0);
      const hook = liveHook();
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
        hook,
        elementsAt: inputs.hookElementsAt,
        theme: trip.theme,
        shades: post.badge.shades,
        block: inputs.block,
        // The hook's own framing, so the burned-in picture is cropped where
        // the preview showed it — the PNG deck goes through the same value.
        framing: post.badge.framing,
        // And how it moves over the hook, on the clock the stage plays it on.
        motion: {
          motion: post.badge.motion ?? null,
          seconds: inputs.hookLength,
          openerSeconds: hook?.seconds ?? 0,
        },
        lut: looks.lutFor(inputs.hookSlide),
        film: looks.filmFor(inputs.hookSlide),
        onProgress,
        signal,
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
              const cells = await loadCollageSources(inputs.hookSlide, post.badge.collage!, inputs.resolve, { maxEdge: exportEdge() });
              try {
                return await exportHookStillVideo({
                  ...shared,
                  collage: {
                    render: { collage: post.badge.collage!, items: cells.items, seconds: inputs.hookLength },
                    luts: cells.items.map((cell) =>
                      looks.lutFor({ ...inputs.hookSlide, develop: cell.develop }),
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
      say('write', `Downloading ${name}`);
      downloadBlob(blob, name);
      finish(0, true);
      // A clip that went out without the ticks it was composed with says so
      // with the delivery, rather than being discovered on a phone later.
      const said = [audioSkipped, lost].filter(Boolean).join('; ');
      setNote(withEdits(said ? `${name} downloaded — ${said}` : `${name} downloaded`));
    } catch (err) {
      const failure = explainFailure(err, 'The clip could not be encoded.');
      setNote(isAbortError(err) ? 'Encoding cancelled — nothing was written.' : failure.note);
      if (failure.undecodable) setUndecodable(hookFile);
    } finally {
      ground.current = null;
      setExporting(null);
      showRun(null);
      endTask();
    }
  }

  /**
   * ONE video for one slide, whatever it is made of.
   *
   * The four cases collapse into two calls: a clip goes through the Studio's
   * export (audio copied, trimmed to the slide's own in point and length), a
   * still is painted frame by frame. The first slide burns in what the stage
   * drew for it — the piece's badge, its opener with its pictures — and every
   * other slide is composed by the one function the deck, the rail and the
   * stage share (`slideRender`): its own badge, opener, shades and words, in
   * the trip's title style. That last point is a repair: a content slide's
   * video used to draw its caption with NO title style while its PNG, its
   * thumbnail and the stage all used the trip's.
   */
  async function renderSlideVideo(
    item: PlanItem,
    looks: Pick<PostExportInputs, 'lutFor' | 'filmFor'>,
    onProgress: (p: ExportProgress) => void,
    onAudioSkipped?: (reason: string) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const { post, trip, aspect } = inputs;
    const { slide } = item;
    const isHook = slide.kind === 'hook';
    const variant = hookVariant(post.badge.aspectId, 1080, slide.speed);
    const own = isHook ? null : slideRender(trip, post, slide, aspect, livePictures(), inputs.exif);
    const opener = own ? own.hook : liveHook();
    const shared = {
      signal,
      variant,
      elements: own ? own.elements : inputs.hookElements,
      hook: opener,
      elementsAt: own ? own.elementsAt : inputs.hookElementsAt,
      theme: trip.theme,
      shades: own ? own.shades : post.badge.shades,
      block: own ? own.block : inputs.block,
      framing: slide.framing,
      // A picture that moves in its frame moves on this slide's own clock,
      // and waits for the slide's own opener wherever the slide sits.
      motion: {
        motion: slide.motion,
        seconds: item.seconds,
        openerSeconds: opener?.seconds ?? 0,
      },
      lut: looks.lutFor(slide),
      film: looks.filmFor(slide),
      onProgress,
    };
    // A collage is PAINTED, whatever its cells hold: every cell's picture
    // decoded, each graded through the slide's grade with its own develop.
    if (slide.collage) {
      const cells = await loadCollageSources(slide, slide.collage, inputs.resolve, { maxEdge: exportEdge() });
      try {
        return await exportHookStillVideo({
          ...shared,
          collage: {
            render: { collage: slide.collage, items: cells.items, seconds: item.seconds },
            luts: cells.items.map((cell) => looks.lutFor({ ...slide, develop: cell.develop })),
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
    // The piece as it is AT THE CLICK, before anything awaits: the documents
    // are this render's, and the looks are asked now (`frozen-looks.ts`) —
    // the grade stack answers live, and a look nudged mid-run used to reach
    // the slides not yet rendered.
    const looks = freezeLooks(deckSlides(inputs.trip, inputs.post), inputs.lutFor, inputs.filmFor);
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

    // Where it lands, asked FIRST: the folder picker opens only in the few
    // seconds the click is honoured for, and a piece renders longer than that
    // (`deliver-files.ts`).
    const target = await askTarget();
    if (!target) return;

    const items = plan.items.filter((i) => i.blocker === null);
    const signal = beginTask('Exporting the piece');
    written.current = { count: 0, errors: [], method: 'folder' };
    beginRun(items.map((item) => slideUnit(item.slide, item.name, item.medium === 'video')));
    setExporting('Preparing…');
    let made = 0;
    try {
      // Every tile and picture the openers draw, in before the first frame.
      const lost = await awaitGround(signal);
      // Which pixels each still leaves from, decided once for all of them.
      const stills = items.filter((i) => i.medium === 'image');
      let resolve = inputs.resolve;
      if (stills.length) {
        setExporting('Choosing the pixels…');
        resolve = await pixelsForStills(stills.map((i) => i.slide));
      }

      // In DECK ORDER, one slide at a time, each WRITTEN as soon as it is
      // made: the files land in swipe order, a run is followed slide by slide
      // on the deck, and a reel of clips never waits in memory for the last.
      // A slide that fails must not cost the ones already made: each is
      // caught, and what went wrong is said with the delivery.
      const failures: string[] = [];
      for (const [i, item] of items.entries()) {
        // Cancelled between two slides: what was written stays written.
        if (signal.aborted) break;
        enter(i);
        let file: { name: string; blob: Blob } | null = null;
        if (item.medium === 'image') {
          say('render', `Rendering ${item.name}`);
          const out = await renderDeck({
            signal,
            trip: inputs.trip,
            post: inputs.post,
            aspect: inputs.aspect,
            longEdge: DECK_LONG_EDGE,
            timeSeconds: inputs.timeSeconds,
            resolve,
            pictures: livePictures(),
            exif: inputs.exif,
            lutFor: looks.lutFor,
            filmFor: looks.filmFor,
            include: (slide) => slide.position === item.position,
          });
          file = out[0] ?? null;
        } else {
          try {
            const blob = await renderSlideVideo(
              item,
              looks,
              (p) => say('encode', p.ratio === null ? `${p.phase}…` : `Encoding ${item.name} · ${Math.round(p.ratio * 100)}%`, p.ratio),
              // Not a failure — the file is delivered — but a departure from what
              // was composed, reported with the delivery like one.
              (reason) => failures.push(`${item.name}: ${reason}`),
              signal,
            );
            file = { name: item.name, blob };
          } catch (err) {
            if (isAbortError(err)) break;
            const failure = explainFailure(err, `${item.name} could not be encoded.`);
            if (failure.note) failures.push(failure.note);
            // The first clip this browser cannot decode gets the transcode
            // offered; a second would be the same codec from the same camera.
            if (failure.undecodable) {
              setUndecodable((cur) => cur ?? inputs.resolve(item.slide.media));
            }
          }
        }
        if (!file) {
          finish(i, false);
          continue;
        }
        made += 1;
        say('write', `Writing ${file.name}`);
        finish(i, await writeOne(target, file.name, file.blob));
      }

      if (!made) {
        setNote(signal.aborted ? 'Export cancelled — nothing was written.' : (failures[0] ?? 'Nothing could be rendered — check the pictures are loaded.'));
        return;
      }
      // A cancelled run keeps what it made and says so (his question 2).
      setNote(
        withEdits(
          closingNote(plan.items.length - written.current.count, [
            ...(signal.aborted ? [`cancelled after ${made} of ${items.length}`] : []),
            ...plan.blockers,
            ...failures,
            ...(lost ? [lost] : []),
          ]),
        ),
      );
    } catch (err) {
      setNote(isAbortError(err) ? 'Export cancelled — nothing was written.' : explainFailure(err, 'The piece could not be exported.').note);
    } finally {
      ground.current = null;
      setExporting(null);
      showRun(null);
      endTask();
    }
  }

  /**
   * Where a run will land, asked from the click that starts it. Null when the
   * picker was dismissed, or refused — and a refusal is said, never swallowed.
   */
  async function askTarget(): Promise<DeliveryTarget | null> {
    try {
      const target = await pickDeliveryTarget();
      if (!target) setNote('No folder was chosen — nothing was rendered.');
      return target;
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'No folder could be chosen.');
      return null;
    }
  }

  /**
   * Render every slide and hand the set over. A folder keeps the deck in
   * order on disk; where the picker is unavailable each slide is downloaded
   * in turn, which is the only thing a non-Chromium browser can do.
   */
  async function exportDeck(position?: number) {
    const looks = freezeLooks(deckSlides(inputs.trip, inputs.post), inputs.lutFor, inputs.filmFor);
    inputs.onStart?.();
    setNote(null);
    const target = await askTarget();
    if (!target) return;
    const slides = deckSlides(inputs.trip, inputs.post).filter((s) => position === undefined || s.position === position);
    const signal = beginTask(position === undefined ? 'Exporting the slides' : 'Exporting the slide');
    written.current = { count: 0, errors: [], method: 'folder' };
    beginRun(slides.map((s) => slideUnit(s, s.media?.name ?? (s.kind === 'cta' ? 'the card' : 'no picture'), false)));
    let made = 0;
    try {
      const lost = await awaitGround(signal);
      setExporting('Choosing the pixels…');
      const resolve = await pixelsForStills(slides);
      for (const [i, slide] of slides.entries()) {
        if (signal.aborted) break;
        enter(i);
        say('render', `Rendering ${slide.media?.name ?? 'the slide'}`);
        const [file] = await renderDeck({
          signal,
          trip: inputs.trip,
          post: inputs.post,
          aspect: inputs.aspect,
          longEdge: DECK_LONG_EDGE,
          timeSeconds: inputs.timeSeconds,
          resolve,
          pictures: livePictures(),
          exif: inputs.exif,
          lutFor: looks.lutFor,
          filmFor: looks.filmFor,
          include: (s) => s.position === slide.position,
        });
        if (!file) {
          finish(i, false);
          continue;
        }
        made += 1;
        say('write', `Writing ${file.name}`);
        finish(i, await writeOne(target, file.name, file.blob));
      }
      if (!made) {
        setNote(signal.aborted ? 'Export cancelled — nothing was written.' : 'Nothing could be rendered — check the pictures are loaded.');
        return;
      }
      setNote(
        withEdits(
          closingNote(slides.length - written.current.count, [
            ...(signal.aborted ? [`cancelled after ${made} of ${slides.length}`] : []),
            ...(lost ? [lost] : []),
          ]),
        ),
      );
    } catch (err) {
      setNote(isAbortError(err) ? 'Export cancelled — nothing was written.' : explainFailure(err, 'The slides could not be exported.').note);
    } finally {
      ground.current = null;
      setExporting(null);
      showRun(null);
      endTask();
    }
  }

  return { exporting, run, cancel, progress, note, undecodable, exportPiece, exportDeck, exportHookClip };
}
