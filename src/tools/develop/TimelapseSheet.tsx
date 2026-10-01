import { useMemo, type ReactNode } from 'react';
import DevelopFold from '../../shared/develop/DevelopFold';
import { pictureLabel, type RollPicture } from '../../shared/develop/roll-types';
import { PICTURE_SECTIONS } from '../../shared/develop/picture-sections';
import type { PictureChapters } from '../../shared/develop/timelapse-chapters';
import {
  TIMELAPSE_FORMATS,
  TIMELAPSE_LENGTHS,
  type CameraKind,
  type GroundKind,
  type HookKind,
  type RevealKind,
  type SoundKind,
  type TimelapseFormat,
  type TimelapseOptions,
  type TimelapseWords,
} from '../../shared/develop/timelapse-options';
import { KIT_IDS, TICK_KITS } from '../../shared/roadtrip/hooks/tick-kits';
import { timelapseScript, type TimelapseScript } from '../../shared/develop/timelapse-script';
import Button from '../../shared/ui/Button';
import { FieldRow, SwitchRow, TextField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import type { RollCubes } from './roll-cubes';
import type { TimelapseSource } from './timelapse-paint';
import { useTimelapsePreview } from './use-timelapse-preview';

const BEATS: readonly { id: string; label: string }[] = [
  { id: '0', label: 'Free' },
  { id: '100', label: '100' },
  { id: '120', label: '120' },
  { id: '140', label: '140' },
];

function clock(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

/** The sentence a making-of row says about a picture: how many steps, recorded or told in a standard order, and the video's shape. */
export function makingOfLine(chapters: PictureChapters, options: TimelapseOptions): string {
  const n = chapters.chapters.length;
  if (n === 0) return 'nothing to tell yet — develop the picture first';
  const steps = `${n} step${n === 1 ? '' : 's'}`;
  const how = chapters.recorded
    ? chapters.reconstructed.length
      ? `recorded, ${chapters.reconstructed.length} told in a standard order`
      : 'recorded'
    : 'in a standard order (not recorded)';
  return `${steps} ${how} · ${options.seconds} s · ${options.format}`;
}

/**
 * The storyboard of a picture's making-of (`docs/develop-timelapse.md`
 * §3.5): the video played on a canvas through the export's own painter, the
 * roll's options as pills, the five overlay switches, the words, and the
 * chapter list — each chapter's caption editable, an eye folding it into the
 * next. The order is the record's and is never reordered: a making-of that
 * lies about the order is the fabrication the suite refuses.
 *
 * A sheet, not a drawer: a surface you pick from, whose wash lies about
 * nothing. One scrolling pane on a phone.
 */
export default function TimelapseSheet({
  picture,
  chapters,
  source,
  cubes,
  options,
  onOptions,
  onMakingOf,
  plate,
  credit,
  verdict = null,
  exportVerb = null,
  onClose,
}: {
  picture: RollPicture;
  chapters: PictureChapters;
  /** The picture's bytes as the stage draws them, or null while they are not in hand. */
  source: TimelapseSource | null;
  /** The cubes each state is graded through — the export's own resolver, shared with the run. */
  cubes: RollCubes;
  options: TimelapseOptions;
  onOptions: (patch: Partial<TimelapseOptions>) => void;
  /** The picture's own edits of its chapters — a document write, one undo step. */
  onMakingOf: (change: { hidden?: string[]; captions?: Record<string, string> }) => void;
  /** The camera plate's line, or null when the file says nothing. */
  plate: string | null;
  /** The credit line, or null. */
  credit: string | null;
  /** What this browser can encode, when it cannot — said before the click. */
  verdict?: string | null;
  /** The export verb, when a host offers one: handed the script and the source as the sheet holds them. */
  exportVerb?: { label: string; run: (script: TimelapseScript, source: TimelapseSource) => void; busy: boolean; note?: string | null } | null;
  onClose: () => void;
}) {
  useDialogKeys({ onCancel: onClose });
  const hidden = useMemo(() => new Set(picture.makingOf?.hidden ?? []), [picture.makingOf?.hidden]);
  const captions = picture.makingOf?.captions ?? {};
  const script: TimelapseScript = useMemo(
    () => timelapseScript(chapters, options, { hidden, captions, plate, credit }),
    [chapters, options, hidden, captions, plate, credit],
  );
  const preview = useTimelapsePreview({ script, source, cubes });
  const kept = useMemo(() => new Map(script.chapters.map((c) => [c.chapter.id, c] as const)), [script]);
  const format = TIMELAPSE_FORMATS[options.format];
  const portrait = format.height >= format.width;

  const setHidden = (id: string, hide: boolean) => {
    const next = new Set(hidden);
    if (hide) next.add(id);
    else next.delete(id);
    onMakingOf({ hidden: [...next] });
  };
  const setCaption = (id: string, value: string) => {
    const next = { ...captions };
    if (value.trim()) next[id] = value;
    else delete next[id];
    onMakingOf({ captions: next });
  };
  const setWord = (key: keyof TimelapseWords, value: string) => onOptions({ words: { ...options.words, [key]: value } });

  const status: ReactNode = !source
    ? 'This picture’s bytes are not in hand — open its folder or its day first.'
    : script.empty
      ? 'Nothing to tell yet: develop the picture, and its steps become the video.'
      : preview.error
        ? `The preview could not be drawn: ${preview.error}`
        : preview.progress
          ? `Rendering the states · ${preview.progress.done} of ${preview.progress.total}`
          : !chapters.recorded
            ? 'These steps were not recorded: they are told in a standard order.'
            : chapters.reconstructed.length
              ? `${chapters.reconstructed.length} of these steps were not recorded and are told first, in a standard order.`
              : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Making-of video"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[70rem] max-h-[min(94dvh,52rem)] overflow-y-auto overscroll-contain flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-4 max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:max-h-none max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex-none flex items-center gap-2.5 min-w-0">
          <h2 className="m-0 font-serif text-lg min-w-0 truncate">Making-of · {pictureLabel(picture)}</h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="flex-none inline-flex items-center h-[2.125rem] font-mono text-3xs tracking-[0.12em] uppercase text-muted border border-line rounded-full px-3.5 hover:text-accent hover:border-line-strong transition-colors cursor-pointer"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>

        <div className="grid gap-4 min-[821px]:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] items-start">
          {/* The preview: the export's own painter on a canvas, the file scaled. */}
          <div className="flex flex-col gap-2 min-w-0">
            <div
              className={`relative mx-auto w-full bg-frame rounded-paper overflow-hidden ${portrait ? 'max-w-[20rem]' : ''}`}
              style={{ aspectRatio: `${format.width} / ${format.height}` }}
            >
              <canvas
                ref={preview.canvasRef}
                width={preview.size.width}
                height={preview.size.height}
                className="block w-full h-full"
                aria-label="Making-of preview"
              />
              {!preview.ready && (
                <div className="absolute inset-0 grid place-items-center p-4 text-center font-mono text-2xs text-on-media/80">
                  {status ?? 'Rendering…'}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <Button size="sm" icon={preview.playing ? Icons.pause : Icons.play} onClick={preview.toggle} disabled={!preview.ready}>
                {preview.playing ? 'Pause' : 'Play'}
              </Button>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, script.seconds)}
                step={0.05}
                value={preview.t}
                onChange={(e) => preview.seek(Number(e.target.value))}
                disabled={!preview.ready}
                aria-label="Position in the video"
                className="flex-1 min-w-0 accent-accent"
              />
              <span className="flex-none font-mono text-2xs tabular-nums text-muted w-12 text-right">{clock(preview.t)}</span>
            </div>
            {/* One line, always: a status that wrapped differently as its words
                changed moved the export button under it. */}
            <p className="m-0 font-mono text-2xs leading-snug text-ink-soft truncate" role="status">
              {preview.ready && status ? status : `${format.width} × ${format.height} · ${clock(script.seconds)} · 30 fps${script.options.beat ? ` · on ${script.options.beat} BPM` : ''}`}
            </p>
            {verdict && (
              <p className="m-0 font-mono text-2xs leading-snug text-danger">{verdict}</p>
            )}
            {exportVerb && (
              <>
                <Button
                  variant="primary"
                  icon={Icons.export}
                  onClick={() => source && exportVerb.run(script, source)}
                  disabled={exportVerb.busy || script.empty || !source || Boolean(verdict)}
                >
                  {exportVerb.busy ? 'Exporting…' : exportVerb.label}
                </Button>
                {exportVerb.note && (
                  <p className="m-0 font-mono text-2xs leading-snug text-ink-soft" role="status">
                    {exportVerb.note}
                  </p>
                )}
              </>
            )}
          </div>

          {/* The storyboard's controls. */}
          <div className="flex flex-col min-w-0">
            <DevelopFold id="develop.timelapse.shape" title="Shape" foldable={false}>
              <FieldRow label="Format">
                <Segmented
                  size="sm"
                  label="Format"
                  columns={4}
                  value={options.format}
                  onChange={(id) => onOptions({ format: id as TimelapseFormat })}
                  options={(Object.keys(TIMELAPSE_FORMATS) as TimelapseFormat[]).map((id) => ({ id, label: id }))}
                />
              </FieldRow>
              <FieldRow label="Length">
                <Segmented
                  size="sm"
                  label="Length"
                  value={String(options.seconds)}
                  onChange={(id) => onOptions({ seconds: Number(id) })}
                  options={TIMELAPSE_LENGTHS.map((s) => ({ id: String(s), label: `${s} s` }))}
                />
              </FieldRow>
              <FieldRow label="Hook" hint="what opens the video: the finished picture then the file as shot, the inverse, or the two alternating">
                <Segmented
                  size="sm"
                  label="Hook"
                  value={options.hook}
                  onChange={(id) => onOptions({ hook: id as HookKind })}
                  options={[
                    { id: 'result-first', label: 'Result first' },
                    { id: 'raw-first', label: 'As shot first' },
                    { id: 'flash', label: 'Flash' },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Reveal" hint="the before/after at the end: the file as shot wiped off the finished picture, split on the middle, or flickered">
                <Segmented
                  size="sm"
                  label="Reveal"
                  value={options.reveal}
                  onChange={(id) => onOptions({ reveal: id as RevealKind })}
                  options={[
                    { id: 'wipe', label: 'Wipe' },
                    { id: 'split', label: 'Split' },
                    { id: 'flicker', label: 'Flicker' },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Camera" hint="follows the tool — a heal's spot, a mask's box, read in the step itself — or stays on the whole picture">
                <Segmented
                  size="sm"
                  label="Camera"
                  value={options.camera}
                  onChange={(id) => onOptions({ camera: id as CameraKind })}
                  options={[
                    { id: 'follow', label: 'Follows the tool' },
                    { id: 'still', label: 'Still' },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Beat" hint="lands every cut on a half-note grid, so a track laid on the file in the socials app finds its downbeats on them; the file carries no music">
                <Segmented
                  size="sm"
                  label="Beat"
                  value={String(options.beat ?? 0)}
                  onChange={(id) => onOptions({ beat: Number(id) || null })}
                  options={BEATS}
                />
              </FieldRow>
              <FieldRow label="Sound" hint="a tick where each chapter starts, a deeper one at the tease, the seat at the reveal — heard in the file; the preview is silent. Off writes no track: the socials app lays the music">
                <Segmented
                  size="sm"
                  label="Sound"
                  value={options.sound}
                  onChange={(id) => onOptions({ sound: id as SoundKind })}
                  options={[{ id: 'none', label: 'None' }, ...KIT_IDS.map((id) => ({ id, label: TICK_KITS[id].label }))]}
                />
              </FieldRow>
              <FieldRow label="Ground" hint="what fills the frame around the picture">
                <Segmented
                  size="sm"
                  label="Ground"
                  value={options.ground}
                  onChange={(id) => onOptions({ ground: id as GroundKind })}
                  options={[
                    { id: 'blur', label: 'Blur' },
                    { id: 'paper', label: 'Paper' },
                    { id: 'ink', label: 'Ink' },
                  ]}
                />
              </FieldRow>
            </DevelopFold>

            <DevelopFold id="develop.timelapse.overlays" title="Overlays">
              <SwitchRow label="Captions" name="Captions" checked={options.overlays.captions} onChange={(captions) => onOptions({ overlays: { ...options.overlays, captions } })} hint="a line per chapter saying what changed, and the hook's words" />
              <SwitchRow label="Step counter" name="Step counter" checked={options.overlays.counter} onChange={(counter) => onOptions({ overlays: { ...options.overlays, counter } })} hint="3/7 in a corner" />
              <SwitchRow label="Tools drawn" name="Tools drawn" checked={options.overlays.tools} onChange={(tools) => onOptions({ overlays: { ...options.overlays, tools } })} hint="the crop's zone growing, a heal's rings, a mask's fill" />
              <SwitchRow label="Camera plate" name="Camera plate" checked={options.overlays.plate} onChange={(plate) => onOptions({ overlays: { ...options.overlays, plate } })} hintShown hint={plate ?? 'the file says nothing about its camera'} />
              <SwitchRow label="Credit" name="Credit" checked={options.overlays.credit} onChange={(credit) => onOptions({ overlays: { ...options.overlays, credit } })} hintShown hint={credit ?? 'set a creator under Export → Metadata to be credited'} />
            </DevelopFold>

            <DevelopFold id="develop.timelapse.words" title="Words" defaultOpen={false}>
              <FieldRow label="After">
                <TextField label="Over the finished picture" value={options.words.after} onChange={(v) => setWord('after', v)} />
              </FieldRow>
              <FieldRow label="As shot">
                <TextField label="Over the picture as shot" value={options.words.raw} onChange={(v) => setWord('raw', v)} />
              </FieldRow>
              <FieldRow label="Tease">
                <TextField label="The tease" value={options.words.how} onChange={(v) => setWord('how', v)} />
              </FieldRow>
              <FieldRow label="Labels">
                <div className="flex gap-2 min-w-0">
                  <TextField label="Before label" value={options.words.before} onChange={(v) => setWord('before', v)} />
                  <TextField label="After label" value={options.words.afterLabel} onChange={(v) => setWord('afterLabel', v)} />
                </div>
              </FieldRow>
            </DevelopFold>

            <DevelopFold
              id="develop.timelapse.chapters"
              title="Chapters"
              info={
                <p>
                  One chapter per tool, in the order the picture was edited — never reordered. A caption says what
                  changed; write your own, or clear it to get the computed one back. The eye folds a chapter away:
                  its change still happens, it rides the next chapter with no card of its own. A video keeps only as
                  many chapters as its length allows; the lightest fold the same way.
                </p>
              }
            >
              {chapters.chapters.length === 0 ? (
                <p className="m-0 text-xs text-muted">No steps yet.</p>
              ) : (
                <ol className="m-0 p-0 list-none flex flex-col border-t border-line">
                  {chapters.chapters.map((c, i) => {
                    const off = hidden.has(c.id);
                    const timed = kept.get(c.id);
                    return (
                      <li key={c.id} className={`flex items-center gap-2 min-h-11 py-1 border-b border-line ${off ? 'opacity-60' : ''}`}>
                        <span className="flex-none w-6 font-mono text-3xs text-faint tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                        <span className="flex-none w-[4.5rem] font-mono text-3xs uppercase tracking-[0.08em] text-accent-ink truncate" title={c.via === 'earlier' ? 'not recorded — told in a standard order' : undefined}>
                          {PICTURE_SECTIONS.find((s) => s.id === c.section)?.label ?? c.section}
                          {c.via === 'earlier' ? ' ·' : ''}
                        </span>
                        <span className="flex-1 min-w-0">
                          <TextField label={`Caption of chapter ${i + 1}`} value={captions[c.id] ?? ''} placeholder={c.caption} onChange={(v) => setCaption(c.id, v)} disabled={off} />
                        </span>
                        <span className="flex-none w-12 text-right font-mono text-3xs tabular-nums text-muted">
                          {off ? 'folded' : timed ? clock(timed.dur) : 'rides next'}
                        </span>
                        <Button size="sm" variant="ghost" icon={off ? Icons.eyeOff : Icons.eye} onClick={() => setHidden(c.id, !off)} title={off ? 'Show this chapter' : 'Fold this chapter into the next one'} aria-pressed={!off}>
                          <span className="sr-only">{off ? 'Show' : 'Fold'}</span>
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </DevelopFold>
          </div>
        </div>
      </div>
    </div>
  );
}
