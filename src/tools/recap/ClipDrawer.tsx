import { useEffect, useMemo, useState } from 'react';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { backgroundChoices, type ClipChoice } from '../../shared/recap/recap-clips';
import type { RecapDoc } from '../../shared/recap/recap-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import Button from '../../shared/ui/Button';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import PictureThumb from './PictureThumb';
import { getClip } from './recap-store';

type Show = 'all' | 'clips' | 'live';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

const length = (s: number | null) => (s === null || !(s > 0) ? null : s < 60 ? `${s < 10 ? s.toFixed(1) : Math.round(s)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

/**
 * The background's clip, chosen from a DRAWER of thumbnails (his ask,
 * 2026-11-05) rather than a list of names: the recap's own days first (the
 * clips its Winnow fill brought, then its Live Photos, marked with a mauve
 * dot), the clips kept for this recap, the pool's others, and a file of this
 * device. A tile says its length and its shape and plays under the pointer.
 */
export default function ClipDrawer({
  doc,
  client,
  instance,
  files,
  lengths,
  onChoose,
  onFile,
  onClose,
}: {
  doc: RecapDoc;
  client: WinnowClient | null;
  instance: string | null;
  files: ReadonlyMap<string, File>;
  /** Lengths the editor has measured on the clips it loaded — they win over what the pool says. */
  lengths: ReadonlyMap<string, number>;
  onChoose: (choice: ClipChoice) => void;
  onFile: () => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => backgroundChoices(doc), [doc]);
  const [show, setShow] = useState<Show>('all');
  useDialogKeys({ onCancel: onClose });
  const keep = (list: ClipChoice[]) => list.filter((c) => show === 'all' || (show === 'live') === c.live);
  const sections: [string, ClipChoice[]][] = [
    [doc.template === 'month' ? 'Its month' : doc.template === 'week' ? 'Its week' : 'Its days', keep(groups.days)],
    ['Kept for this recap', keep(groups.kept)],
    ['Elsewhere in its pictures', keep(groups.elsewhere)],
  ];
  const total = groups.days.length + groups.kept.length + groups.elsewhere.length;
  const lives = [...groups.days, ...groups.kept, ...groups.elsewhere].filter((c) => c.live).length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 max-[820px]:p-0 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="The background's clip"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[52rem] h-[min(44rem,calc(var(--app-h,100dvh)-2rem))] max-[820px]:h-[var(--app-h,100dvh)] max-[820px]:max-w-none max-[820px]:rounded-none flex flex-col bg-surface border border-line rounded-paper-lg shadow-paper">
        <header className="flex-none flex flex-wrap items-center gap-3 px-5 pt-4 pb-3 border-b border-line">
          <h2 className="m-0 flex-1 min-w-0 font-serif text-2xl">The background's clip</h2>
          {lives > 0 && (
            <Segmented<Show>
              size="sm"
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { id: 'all', label: 'All' },
                { id: 'clips', label: 'Clips' },
                { id: 'live', label: 'Live Photos' },
              ]}
            />
          )}
          <Button size="sm" icon={Icons.import} onClick={onFile} title="A clip from this device, kept here for this recap">
            A file…
          </Button>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 inline-flex items-center justify-center rounded-control text-muted hover:text-ink">
            {Icons.close}
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-auto px-5 py-4 flex flex-col gap-5">
          {total === 0 && (
            <p className="m-0 text-sm text-muted">
              No clip yet. {instance ? 'The recap’s days hold none on your Winnow — ' : ''}add a file of this device, or pictures with clips among them.
            </p>
          )}
          {sections.map(([title, list]) =>
            list.length ? (
              <section key={title} className="flex flex-col gap-2" aria-label={title}>
                <span className={legend}>
                  {title} · {list.length}
                </span>
                <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
                  {list.map((c) => (
                    <ClipTile key={c.key} choice={lengths.get(c.key) ? { ...c, duration: lengths.get(c.key)! } : c} current={doc.background.video === c.key} client={client} instance={instance} file={files.get(c.key) ?? null} stillFile={c.still ? (files.get(c.still.key) ?? null) : null} onChoose={() => onChoose(c)} />
                  ))}
                </div>
              </section>
            ) : null,
          )}
          {lives > 0 && (
            <p className="m-0 mt-auto inline-flex items-center gap-1.5 text-2xs text-muted">
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-live" /> a Live Photo — its three seconds of motion, looped
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ClipTile({ choice, current, client, instance, file, stillFile, onChoose }: { choice: ClipChoice; current: boolean; client: WinnowClient | null; instance: string | null; file: File | null; stillFile?: File | null; onChoose: () => void }) {
  const c = choice.clip;
  const [hover, setHover] = useState(false);
  const [kept, setKept] = useState<Blob | null>(null);
  useEffect(() => {
    if (!hover || file) return;
    let alive = true;
    void getClip(c.key).then((b) => alive && setKept(b));
    return () => {
      alive = false;
    };
  }, [hover, file, c.key]);
  const local = useObjectUrl(hover ? (file ?? kept) : null);
  // Under the pointer it plays: the file in hand, the copy kept here, else Winnow's proxy (a Live Photo's .mov has none).
  const remote = hover && !local && c.origin === 'winnow' && client && c.asset !== undefined && c.instance === instance ? (c.liveStill !== undefined ? client.originalUrl(c.asset) : client.proxyUrl(c.asset)) : null;
  const src = local ?? remote;
  const len = length(choice.duration);
  return (
    <button
      type="button"
      onClick={onChoose}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-pressed={current}
      data-clip={c.key}
      aria-label={`${c.name}${choice.live ? ', a Live Photo' : ''}${len ? `, ${len}` : ''}${choice.portrait ? ', vertical' : ''}`}
      title={c.name}
      className={`group relative flex flex-col gap-1 p-1 rounded-[8px] border text-left cursor-pointer ${current ? 'border-accent bg-accent-wash' : 'border-transparent hover:border-line-strong'}`}
    >
      <span className="relative block w-full aspect-video rounded-[5px] overflow-hidden bg-frame">
        <PictureThumb pic={choice.still ?? c} client={client} instance={instance} file={choice.still ? (stillFile ?? null) : file} className="absolute inset-0 w-full h-full" />
        {src && <video src={src} muted loop autoPlay playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover" aria-hidden="true" />}
        {choice.live && <span aria-hidden="true" className="absolute right-1.5 top-1.5 w-2.5 h-2.5 rounded-full bg-live ring-2 ring-on-media/80" />}
        <span className="absolute right-1 bottom-1 inline-flex items-center gap-1 px-1 rounded-[3px] bg-ink/70 font-mono text-3xs text-on-media tabular-nums">
          {choice.portrait && <span aria-hidden="true" className="inline-block w-[5px] h-[8px] border border-on-media/80 rounded-[1px]" />}
          {choice.live ? 'Live' : (len ?? '—')}
        </span>
      </span>
      <span className="px-0.5 font-mono text-3xs text-muted truncate">
        {c.day ?? 'no day'} · {c.name}
      </span>
    </button>
  );
}
