import { useEffect, useRef, useState } from 'react';
import { downloadBlob } from '../../shared/media/save';
import { useAvcEncodeSupport } from '../../shared/media/use-encode-support';
import { FORMATS, MAX_LENGTH, MIN_LENGTH, withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { slugOf } from '../../shared/recap/recap-file';
import type { RecapLayout } from '../../shared/recap/recap-layout';
import type { FilmPlan } from '../../shared/recap/recap-motion';
import type { Drawable, PaintSources } from '../../shared/recap/recap-paint';
import type { DeviceAliases, ResolvedRecap } from '../../shared/recap/recap-slots';
import { startTask } from '../../shared/tasks/tasks';
import Button from '../../shared/ui/Button';
import { InspectorSection, SliderRow, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import type { Change } from './RecapPanels';
import { Icons } from '../../shared/ui/icons';
import { exportClipSlide, exportFilm, exportPages, type FilmProgress } from './recap-export';
import { carouselSlides } from '../../shared/recap/recap-layout';
import { QUALITIES, QUALITY_LABEL, deliveryBitrate, deliverySize, sizeText, type Quality, type RecapDelivery } from '../../shared/recap/recap-delivery';
import { supportsQuantizer } from '../../shared/media/two-pass';

export interface ExportContext {
  doc: RecapDoc;
  film: FilmPlan;
  layout: RecapLayout;
  resolved: ResolvedRecap;
  sources: PaintSources;
  aliases: DeviceAliases;
  clipSlides: ReadonlyMap<string, number>;
  files: ReadonlyMap<string, File>;
  /** A Winnow clip's original, fetched for one export (`recap-export.ts`); null when it has none here. */
  original: (key: string, signal: AbortSignal) => Promise<Blob | null>;
  /** A picture's original as a graded still, for one export; null when it has none here. */
  stillOriginal: (key: string, signal: AbortSignal) => Promise<Drawable | null>;
  /** Some of what the film draws has an original within reach (a Winnow, a file in hand): the choice applies. */
  originals: boolean;
}

/** The constant-quality mode the second pass needs, asked of this browser once. */
function useTwoPassSupport(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const codec of ['avc1.640033', 'avc1.640028', 'avc1.4d0028']) {
        if (await supportsQuantizer(codec, 1080, 1920, 30)) return alive && setOk(true);
      }
      if (alive) setOk(false);
    })();
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

/**
 * How the video is made (his ask, 2026-11-05: «net, clean, impeccable»): a
 * quality (its target bitrate), 30 or 60 frames a second, one VBR pass or
 * two (measured: `media/two-pass.ts`, where the encoder allows it), and a
 * Winnow clip's proxy or its original — the file's size said beside it.
 */
function QualitySection({ doc, change, seconds, originals }: { doc: RecapDoc; change: Change; seconds: number; originals: boolean }) {
  const d = doc.delivery;
  const twoPass = useTwoPassSupport();
  const set = (patch: Partial<RecapDelivery>) => change((x) => withRecap(x, { delivery: { ...x.delivery, ...patch } }));
  const { width: W, height: H } = FORMATS[doc.format];
  const mbps = (q: Quality) => (deliveryBitrate({ quality: q, fps: d.fps }, W, H) / 1e6).toFixed(0);
  return (
    <InspectorSection id="recap-quality" title="Quality" foldable={false}>
      <div className="flex flex-col gap-2">
        <Segmented<Quality>
          size="sm"
          fill
          label="Quality"
          value={d.quality}
          onChange={(quality) => set({ quality })}
          options={QUALITIES.map((q) => ({ id: q, label: QUALITY_LABEL[q], title: `About ${mbps(q)} Mb/s, variable` }))}
        />
        <Segmented
          size="sm"
          fill
          label="Frame rate"
          value={String(d.fps)}
          onChange={(v) => set({ fps: v === '60' ? 60 : 30 })}
          options={[
            { id: '30', label: '30 fps', title: 'What the socials play' },
            { id: '60', label: '60 fps', title: 'Smoother entrances and pans — twice the frames to paint' },
          ]}
        />
        <Segmented
          size="sm"
          fill
          label="Passes"
          value={String(d.passes)}
          onChange={(v) => set({ passes: v === '2' ? 2 : 1 })}
          options={[
            { id: '1', label: 'One pass', title: 'Variable bitrate, in one go' },
            {
              id: '2',
              label: 'Two passes',
              title: 'The film is measured first, then encoded at the one quality that lands on its size — twice as long',
              disabled: twoPass === false && d.passes !== 2 ? 'This browser’s encoder has no constant-quality mode: one VBR pass is what it can do' : false,
            },
          ]}
        />
        {originals && (
          <Segmented
            size="sm"
            fill
            label="Painted from"
            value={d.media}
            onChange={(media) => set({ media: media === 'original' ? 'original' : 'proxy' })}
            options={[
              { id: 'proxy', label: 'Light copies', title: 'What the stage shows: Winnow’s proxies and the prints kept here — fast, softer where a clip or a picture fills the page' },
              { id: 'original', label: 'Originals', title: 'Every clip — the background first — and every picture a print would blow up, from its original, fetched for this export: sharpest, heavier' },
            ]}
          />
        )}
        {originals && d.media === 'original' && (
          <ToggleField
            checked={d.convert}
            onChange={(convert) => set({ convert })}
            label="Convert what this browser cannot play"
          >
            <span title="An original this browser cannot play — an iPhone HEVC .MOV — converted here by ffmpeg, only the part the film shows, at the size it is shown, and kept on this device for the next export. The first time, ffmpeg (about 31 MB) is fetched from unpkg.com; nothing of yours leaves.">
              Convert what this browser cannot play
            </span>
          </ToggleField>
        )}
        <p className="m-0 font-mono text-2xs text-muted tabular-nums">
          ≈ {(deliveryBitrate(d, W, H) / 1e6).toFixed(1)} Mb/s · about {sizeText(deliverySize(d, W, H, seconds, Boolean(doc.sound)))}
          {d.passes === 2 && twoPass === false ? ' · one pass here' : ''}
        </p>
      </div>
    </InspectorSection>
  );
}

const STAGE_WORDS: Record<FilmProgress['stage'], string> = { clips: 'Opening the clips', converting: 'Converting an original', pictures: 'Fetching the originals', sound: 'Mixing the sound', encoding: 'Encoding', finishing: 'Finishing the file' };

/** The export's own bar, beside its button: what it is doing, how far, its speed and what is left. */
function ProgressBar({ p, started, onCancel }: { p: FilmProgress; started: number; onCancel: () => void }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = (now - started) / 1000;
  // What is left and the speed are the STAGE's: a conversion before the encode must not skew its estimate.
  const stage = useRef({ name: p.stage, at: started });
  if (stage.current.name !== p.stage) stage.current = { name: p.stage, at: performance.now() };
  const inStage = (now - stage.current.at) / 1000;
  const ratio = p.ratio;
  const left = ratio && ratio > 0.02 && ratio < 1 && inStage > 1 ? (inStage / ratio) * (1 - ratio) : null;
  const passes = p.passes ?? 1;
  const painted = p.frame !== undefined && p.frames ? (((p.pass ?? 1) - 1) * p.frames + p.frame) : null;
  const speed = painted && inStage > 1 ? painted / inStage : null;
  const time = (s: number) => (s < 60 ? `${Math.ceil(s)} s` : `${Math.floor(s / 60)} min ${String(Math.ceil(s % 60)).padStart(2, '0')}`);
  const what =
    p.stage === 'encoding'
      ? `${passes > 1 ? (p.pass === 1 ? 'Measuring · pass 1 of 2' : 'Encoding · pass 2 of 2') : 'Encoding'}${p.frame !== undefined && p.frames ? ` · frame ${p.frame} / ${p.frames}` : ''}`
      : (p.stage === 'clips' || p.stage === 'pictures' || p.stage === 'converting') && p.of
        ? `${STAGE_WORDS[p.stage]} · ${Math.min(p.of, (p.done ?? 0) + 1)} / ${p.of}`
        : STAGE_WORDS[p.stage];
  return (
    <div className="flex flex-col gap-1" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <div
          className="flex-1 h-2 rounded-full bg-line overflow-hidden"
          role="progressbar"
          aria-label="Export"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
        >
          {ratio === null ? (
            <div className="h-full w-1/3 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
          ) : (
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
          )}
        </div>
        <span className="w-10 text-right font-mono text-2xs tabular-nums text-ink">{ratio === null ? '' : `${Math.round(ratio * 100)} %`}</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <span className="font-mono text-2xs tabular-nums text-muted">
        {what}
        {speed ? ` · ${speed.toFixed(speed < 10 ? 1 : 0)} fps` : ''} · {time(elapsed)}
        {left !== null ? ` · ~${time(left)} left` : ''}
      </span>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Export tab — three deliveries of the same recap, each said by what it
 * is for: the FILM (a Reel or a Story, its sound under it), the STILLS (the
 * post, or a carousel's slides as PNG), and the CAROUSEL whole (the slides
 * then one MP4 per clip, numbered as the cells' badges say). The shell's
 * task pill carries the progress and the Cancel wherever the author is.
 */
const LENGTHS = [7, 15, 30] as const;

/**
 * The film's length: its own (*Auto* — the entrances, the clips' turns and the
 * hold), the socials' usual 7, 15 or 30 s, or any. Longer holds longer; shorter
 * plays the whole film faster; set, it wins over the sound's whole loops.
 */
function LengthSection({ doc, natural, change }: { doc: RecapDoc; natural: number; change: Change }) {
  const value = doc.length;
  const mode = value === null ? 'auto' : (LENGTHS as readonly number[]).includes(value) ? String(value) : 'other';
  const set = (length: number | null) => change((d) => withRecap(d, { length }));
  return (
    <InspectorSection id="recap-length" title="Length" foldable={false}>
      <div className="flex flex-col gap-2">
        <Segmented
          size="sm"
          fill
          label="The video's length"
          value={mode}
          onChange={(m) => set(m === 'auto' ? null : m === 'other' ? Math.round(value ?? natural) : Number(m))}
          options={[
            { id: 'auto', label: `Auto · ${natural.toFixed(1)} s`, title: 'Its own length: the entrances, the clips’ turns and the hold' },
            ...LENGTHS.map((n) => ({ id: String(n), label: `${n} s` })),
            { id: 'other', label: 'Other' },
          ]}
        />
        {mode === 'other' && value !== null && (
          <SliderRow label="Length" value={value} min={MIN_LENGTH} max={MAX_LENGTH} step={0.5} format={(v) => `${v} s`} onChange={(v) => set(v)} />
        )}
        {value !== null && (
          <p className="m-0 text-2xs text-muted">
            {value > natural ? 'Everything stays on longer.' : value < natural ? 'The whole film plays faster to fit.' : 'Its own length.'}
            {doc.sound?.fit ? ' The sound is cut to it, with its fade.' : ''}
          </p>
        )}
      </div>
    </InspectorSection>
  );
}

export default function RecapExportPanel({ ctx, natural, change }: { ctx: ExportContext; natural: number; change: Change }) {
  const { doc, film, layout, resolved, clipSlides } = ctx;
  const canEncode = useAvcEncodeSupport();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ p: FilmProgress; started: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const base = slugOf(doc.title) || 'recap';
  const { width: W, height: H, ratio } = FORMATS[doc.format];
  const filled = resolved.slots.filter((s) => s.picture).length;
  const input = () => ({ doc, resolved, layout, film, stills: ctx.sources.still, aliases: ctx.aliases, clipSlides, original: ctx.original, stillOriginal: ctx.stillOriginal });
  const report = (task: ReturnType<typeof startTask>) => (p: FilmProgress) => {
    setProgress((cur) => (cur ? { ...cur, p } : cur));
    task.update({ progress: p.ratio, detail: p.ratio === null ? STAGE_WORDS[p.stage].toLowerCase() : `${Math.round(p.ratio * 100)} %` });
  };
  const order = carouselSlides(doc, resolved, layout);
  const clips = order.flatMap((s) => (s.kind === 'clip' ? [s] : []));
  const slides = order.length;

  const run = async (label: string, job: (signal: AbortSignal, task: ReturnType<typeof startTask>) => Promise<string>) => {
    const controller = new AbortController();
    abort.current = controller;
    const task = startTask({ label: `${doc.title} · ${label}`, progress: 0, cancel: () => controller.abort() });
    setBusy(label);
    setNote(null);
    setProgress({ p: { stage: 'clips', ratio: null }, started: performance.now() });
    try {
      setNote(await job(controller.signal, task));
    } catch (err) {
      setNote(controller.signal.aborted ? 'Export cancelled: no file was written.' : err instanceof Error ? err.message : 'The export failed.');
    } finally {
      task.done();
      abort.current = null;
      setBusy(null);
      setProgress(null);
    }
  };

  const exportVideo = () =>
    run('video', async (signal, task) => {
      const r = await exportFilm(input(), report(task), signal);
      downloadBlob(r.blob, `${base}.mp4`);
      const bits = [r.silent ? `exported without sound: ${r.silent}` : doc.sound ? 'exported with its sound' : 'exported, silent: no sound was added'];
      bits.push(`${sizeText(r.blob.size)}, ${doc.delivery.fps} fps`);
      if (r.onePass) bits.push(`one pass: ${r.onePass}`);
      if (r.prints) bits.push(`${r.prints} picture${r.prints === 1 ? '' : 's'} from ${r.prints === 1 ? 'its' : 'their'} print, the original out of reach`);
      if (r.converted) bits.push(`${r.converted} original${r.converted === 1 ? '' : 's'} converted by ffmpeg`);
      if (r.unplayable) bits.push(`${r.unplayable} original${r.unplayable === 1 ? '' : 's'} this browser cannot play — turn on «Convert what this browser cannot play»`);
      if (r.proxies - r.unplayable > 0) bits.push(`${r.proxies - r.unplayable} clip${r.proxies - r.unplayable === 1 ? '' : 's'} from ${r.proxies - r.unplayable === 1 ? 'its' : 'their'} prox${r.proxies - r.unplayable === 1 ? 'y' : 'ies'}, the original out of reach`);
      if (r.missingClips) bits.push(`${r.missingClips} clip${r.missingClips === 1 ? '' : 's'} not on this device showed as a still`);
      return `${bits.join(' · ')}.`.replace(/^./, (c) => c.toUpperCase());
    });

  const exportStills = () =>
    run('stills', async (signal) => {
      const pages = await exportPages(input(), signal);
      for (let i = 0; i < pages.length; i++) {
        downloadBlob(pages[i], pages.length > 1 ? `${base}-${pad(i + 1)}.png` : `${base}.png`);
        if (i < pages.length - 1) await wait(350);
      }
      return `${pages.length} PNG${pages.length === 1 ? '' : 's'} written.`;
    });

  const exportCarousel = () =>
    run('carousel', async (signal, task) => {
      // Slide by slide in the carousel's order: a page as a PNG, a clip as its own MP4 — the file's number is its place.
      const pages = await exportPages(input(), signal);
      let made = 0;
      for (const [i, s] of order.entries()) {
        if (signal.aborted) break;
        if (s.kind === 'page') {
          const blob = pages[s.page];
          if (blob) {
            downloadBlob(blob, `${base}-${pad(i + 1)}.png`);
            made += 1;
          }
        } else {
          const key = resolved.slots.find((x) => x.id === s.slot)?.picture?.key;
          if (!key) continue;
          task.update({ detail: `clip slide ${i + 1}`, progress: null });
          const blob = await exportClipSlide(input(), key, (ratio) => report(task)({ stage: 'encoding', ratio }), signal, { n: i + 1, of: order.length });
          if (!blob) continue;
          downloadBlob(blob, `${base}-${pad(i + 1)}.mp4`);
          made += 1;
        }
        await wait(350);
      }
      return `${made} slides written, in their order — post them as one carousel.`;
    });

  return (
    <>
      <LengthSection doc={doc} natural={natural} change={change} />
      <QualitySection doc={doc} change={change} seconds={film.total} originals={ctx.originals} />
      <InspectorSection id="recap-export" title="Export" foldable={false}>
        <div className="flex flex-col gap-3">
          <p className="m-0 font-mono text-2xs text-muted tabular-nums">
            {W} × {H} · {ratio} · {filled}/{resolved.slots.length} places filled
          </p>
          <div className="flex flex-col gap-1.5">
            <Button variant="primary" icon={Icons.video} disabled={busy !== null || !canEncode} onClick={() => void exportVideo()} title={canEncode ? 'The recap as it plays, its sound under it' : 'This browser cannot encode H.264 video'}>
              Video · {film.total.toFixed(1)} s
            </Button>
            {!canEncode && <span className="text-2xs text-warn">This browser cannot encode video — the stills still export.</span>}
          </div>
          <Button icon={Icons.image} disabled={busy !== null} onClick={() => void exportStills()} title="Each page as it rests, everything on">
            {layout.pages.length > 1 ? `Stills · ${layout.pages.length} PNG` : 'Still · PNG'}
          </Button>
          {slides > 1 && (
            <Button icon={Icons.stack} disabled={busy !== null || (clips.length > 0 && !canEncode)} onClick={() => void exportCarousel()} title="Every slide in the strip's order — the pages as PNG, each clip as its own video slide">
              Carousel · {slides} slides
            </Button>
          )}
          {busy && progress && <ProgressBar p={progress.p} started={progress.started} onCancel={() => abort.current?.abort()} />}
          {note && (
            <p className="m-0 text-xs text-ink-soft" role="status">
              {note}
            </p>
          )}
          <p className="m-0 text-2xs text-muted leading-relaxed">Painted here, from the same painter as the stage: what you see is what the files hold. Nothing leaves this device.</p>
        </div>
      </InspectorSection>
    </>
  );
}
