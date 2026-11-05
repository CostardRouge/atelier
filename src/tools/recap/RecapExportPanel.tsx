import { useRef, useState } from 'react';
import { downloadBlob } from '../../shared/media/save';
import { useAvcEncodeSupport } from '../../shared/media/use-encode-support';
import { FORMATS, MAX_LENGTH, MAX_SLIDES, MIN_LENGTH, withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { slugOf } from '../../shared/recap/recap-file';
import type { RecapLayout } from '../../shared/recap/recap-layout';
import type { FilmPlan } from '../../shared/recap/recap-motion';
import type { PaintSources } from '../../shared/recap/recap-paint';
import type { DeviceAliases, ResolvedRecap } from '../../shared/recap/recap-slots';
import { startTask } from '../../shared/tasks/tasks';
import Button from '../../shared/ui/Button';
import { InspectorSection, SliderRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import type { Change } from './RecapPanels';
import { Icons } from '../../shared/ui/icons';
import { exportClipSlide, exportFilm, exportPages } from './recap-export';

export interface ExportContext {
  doc: RecapDoc;
  film: FilmPlan;
  layout: RecapLayout;
  resolved: ResolvedRecap;
  sources: PaintSources;
  aliases: DeviceAliases;
  clipSlides: ReadonlyMap<string, number>;
  files: ReadonlyMap<string, File>;
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
  const [note, setNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const base = slugOf(doc.title) || 'recap';
  const { width: W, height: H, ratio } = FORMATS[doc.format];
  const filled = resolved.slots.filter((s) => s.picture).length;
  const input = () => ({ doc, resolved, layout, film, stills: ctx.sources.still, aliases: ctx.aliases, clipSlides });
  const clips = [...clipSlides.entries()].map(([slot, n]) => ({ slot, n, key: resolved.slots.find((s) => s.id === slot)?.picture?.key ?? null }));
  const slides = layout.pages.length + (doc.clipSlides ? clips.length : 0);

  const run = async (label: string, job: (signal: AbortSignal, task: ReturnType<typeof startTask>) => Promise<string>) => {
    const controller = new AbortController();
    abort.current = controller;
    const task = startTask({ label: `${doc.title} · ${label}`, progress: 0, cancel: () => controller.abort() });
    setBusy(label);
    setNote(null);
    try {
      setNote(await job(controller.signal, task));
    } catch (err) {
      setNote(controller.signal.aborted ? 'Export cancelled: no file was written.' : err instanceof Error ? err.message : 'The export failed.');
    } finally {
      task.done();
      abort.current = null;
      setBusy(null);
    }
  };

  const exportVideo = () =>
    run('video', async (signal, task) => {
      const r = await exportFilm(input(), (ratio) => task.update({ progress: ratio, detail: ratio === null ? 'finishing the file' : `${Math.round(ratio * 100)} %` }), signal);
      downloadBlob(r.blob, `${base}.mp4`);
      const bits = [r.silent ? `exported without sound: ${r.silent}` : doc.sound ? 'exported with its sound' : 'exported, silent: no sound was added'];
      if (r.missingClips) bits.push(`${r.missingClips} clip${r.missingClips === 1 ? '' : 's'} not on this device showed as a still`);
      return `${bits.join(' · ')}.`.replace(/^./, (c) => c.toUpperCase());
    });

  const exportStills = () =>
    run('stills', async () => {
      const pages = await exportPages(input());
      for (let i = 0; i < pages.length; i++) {
        downloadBlob(pages[i], pages.length > 1 ? `${base}-${pad(i + 1)}.png` : `${base}.png`);
        if (i < pages.length - 1) await wait(350);
      }
      return `${pages.length} PNG${pages.length === 1 ? '' : 's'} written.`;
    });

  const exportCarousel = () =>
    run('carousel', async (signal, task) => {
      const pages = await exportPages(input());
      for (let i = 0; i < pages.length; i++) {
        downloadBlob(pages[i], `${base}-${pad(i + 1)}.png`);
        await wait(350);
      }
      let made = 0;
      for (const c of clips) {
        if (!c.key || signal.aborted) continue;
        task.update({ detail: `clip slide ${c.n}`, progress: null });
        const blob = await exportClipSlide(input(), c.key, (ratio) => task.update({ progress: ratio }), signal);
        if (blob) {
          downloadBlob(blob, `${base}-${pad(c.n)}.mp4`);
          made += 1;
          await wait(350);
        }
      }
      return `${pages.length + made} slides written, in their order — post them as one carousel.`;
    });

  return (
    <>
      <LengthSection doc={doc} natural={natural} change={change} />
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
          {(clips.length > 0 || layout.pages.length > 1) && doc.clipSlides && (
            <Button icon={Icons.stack} disabled={busy !== null || (clips.length > 0 && !canEncode)} onClick={() => void exportCarousel()} title="The pages, then one video slide per clip — numbered as the cells' badges say">
              Carousel · {Math.min(slides, MAX_SLIDES)} slides
            </Button>
          )}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-ink-soft" role="status">
              Exporting the {busy}…
              <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
                Cancel
              </Button>
            </div>
          )}
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
