import { useEffect, useMemo, useState } from 'react';
import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { CAPTION_MAX, DEFAULT_CAPTION, captionText, defaultKind, withCaption, withPublication, type PublishKind } from '../../shared/recap/recap-publish';
import { placeWords } from '../../shared/recap/recap-places';
import type { ResolvedRecap } from '../../shared/recap/recap-slots';
import { PostizClient, postProblem, uploadProblem, type PostizPost } from '../../shared/sources/postiz/client';
import { nextFreeSlot, rhythmWarnings, slotLabel, slotsWithState } from '../../shared/sources/postiz/rhythm';
import { publishChannel } from '../../shared/sources/postiz/store';
import { usePostiz } from '../../shared/sources/postiz/use-postiz';
import type { startTask } from '../../shared/tasks/tasks';
import Button from '../../shared/ui/Button';
import { InspectorSection, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import type { Change } from './RecapPanels';

type Task = ReturnType<typeof startTask>;
type When = { kind: 'slot'; at: Date } | { kind: 'other'; at: Date | null } | { kind: 'now' } | { kind: 'draft' };

const KIND_LABEL: Record<PublishKind, string> = { reel: 'Reel', carousel: 'Carousel', story: 'Story' };
const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const chip = 'px-2.5 min-h-8 pointer-coarse:min-h-11 rounded-full border text-xs cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:line-through';
/** How far ahead the planned posts are read, to mark the slots taken. */
const AHEAD_DAYS = 42;

/** `2026-11-17T09:00` for a datetime-local input, in this browser's own zone. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/**
 * Export › *Publish* (lab 12, his yes of 2026-11-08): the recap rendered, sent
 * to HIS Postiz and scheduled on his Instagram — as a Reel (a trial one, if he
 * likes), a carousel or a story, in the next free slot of his rhythm (taken
 * slots barred, a broken rhythm SAID, never refused), with its caption: a
 * template of Recap's words he edits, filled when sent. Pressing Schedule
 * approves the caption he reads; an agent's caption waits for that.
 */
export default function PublishSection({
  doc,
  resolved,
  change,
  slides,
  canEncode,
  busy,
  run,
  render,
}: {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  change: Change;
  slides: number;
  canEncode: boolean;
  busy: boolean;
  run: (label: string, job: (signal: AbortSignal, task: Task) => Promise<string>) => Promise<void>;
  render: (kind: PublishKind, signal: AbortSignal, task: Task) => Promise<File[]>;
}) {
  const conn = usePostiz();
  const channel = publishChannel(conn);
  const [kind, setKind] = useState<PublishKind>(() => defaultKind(doc, slides));
  const [trial, setTrial] = useState(false);
  const [graduate, setGraduate] = useState<'auto' | 'manual'>('auto');
  const [collab, setCollab] = useState(true);
  const [planned, setPlanned] = useState<PostizPost[] | null>(null);
  const [plannedError, setPlannedError] = useState<string | null>(null);
  const [when, setWhen] = useState<When | null>(null);

  const client = useMemo(() => (conn ? new PostizClient(conn.apiBase, conn.apiKey) : null), [conn?.apiBase, conn?.apiKey]);
  const refresh = async () => {
    if (!client) return;
    const now = new Date();
    try {
      setPlanned(await client.posts(new Date(now.getTime() - 86400000), new Date(now.getTime() + AHEAD_DAYS * 86400000)));
      setPlannedError(null);
    } catch (err) {
      setPlannedError(err instanceof Error ? err.message : String(err));
      setPlanned([]);
    }
  };
  useEffect(() => {
    void refresh();
  }, [client]);

  const rhythm = conn?.rhythm;
  const takenAt = useMemo(() => (planned ?? []).filter((p) => p.state !== 'error' && p.state !== 'draft').map((p) => new Date(p.publishDate)), [planned]);
  const now = new Date();
  const slots = rhythm ? slotsWithState(rhythm, takenAt, now, 5) : [];
  const free = rhythm ? nextFreeSlot(rhythm, takenAt, now) : null;
  // The next free slot, until he picks another.
  const chosen: When = when ?? (free ? { kind: 'slot', at: free } : { kind: 'draft' });
  const at = chosen.kind === 'slot' || chosen.kind === 'other' ? chosen.at : null;
  const warnings = rhythm && at ? rhythmWarnings(rhythm, takenAt, at) : [];

  const template = doc.publish.caption ?? DEFAULT_CAPTION;
  const text = captionText(doc, resolved);
  const place = placeWords(resolved.slots.flatMap((s) => (s.picture ? [s.picture] : []))).place;

  if (!conn) {
    return (
      <InspectorSection id="recap-publish" title="Publish" foldable={false}>
        <p className="m-0 text-xs text-muted leading-relaxed">
          Schedule this recap on Instagram from here: connect your own Postiz on{' '}
          <a href="#/sources" className="text-accent-ink font-semibold no-underline hover:underline">
            Sources →
          </a>
        </p>
      </InspectorSection>
    );
  }
  if (!channel) {
    return (
      <InspectorSection id="recap-publish" title="Publish" foldable={false}>
        <p className="m-0 text-xs text-muted leading-relaxed">
          Choose the Instagram account Recap posts to on{' '}
          <a href="#/sources" className="text-accent-ink font-semibold no-underline hover:underline">
            Sources →
          </a>
        </p>
      </InspectorSection>
    );
  }

  const kindOk = (k: PublishKind) => (k === 'carousel' ? slides > 1 : canEncode);
  const label = chosen.kind === 'now' ? 'Publish now' : chosen.kind === 'draft' ? 'Send as a draft' : at ? `Schedule · ${slotLabel(at, rhythm!.timeZone)}` : 'Schedule';

  const schedule = () =>
    run('publish', async (signal, task) => {
      const files = await render(kind, signal, task);
      const problem = postProblem(kind, files) ?? files.map(uploadProblem).find(Boolean) ?? null;
      if (problem) throw new Error(problem);
      const media = [];
      for (const [i, f] of files.entries()) {
        task.update({ progress: i / files.length, detail: `sending ${i + 1} / ${files.length}` });
        media.push(await client!.upload(f, signal));
      }
      const target = chosen.kind === 'now' ? 'now' : chosen.kind === 'draft' ? 'draft' : (at ?? 'draft');
      const ids = await client!.createPost(
        { channel, kind, caption: text, media, at: target, trial: kind === 'reel' && trial, graduate, collaborators: collab && conn.collaborator ? [conn.collaborator] : [] },
        signal,
      );
      if (!ids.length) throw new Error('Postiz took the post but gave no id back — look in Postiz before sending it again.');
      change((d) =>
        withRecap(d, {
          publish: withPublication(withCaption(d.publish, d.publish.caption), {
            postId: ids[0],
            channelId: channel.id,
            channel: channel.name,
            kind,
            trial: kind === 'reel' && trial,
            at: target instanceof Date ? target.toISOString() : target === 'now' ? new Date().toISOString() : null,
            sentAt: Date.now(),
            caption: text,
          }),
        }),
      );
      void refresh();
      setWhen(null);
      const where = target === 'now' ? 'Sent — Instagram is publishing it' : target === 'draft' ? 'Sent to Postiz as a draft' : `Scheduled on Postiz for ${slotLabel(target, rhythm!.timeZone)}`;
      return `${where} (${KIND_LABEL[kind]}${kind === 'reel' && trial ? ', trial' : ''}, ${files.length} file${files.length === 1 ? '' : 's'}).${place ? ` Once it is out, add the location in Instagram: ${place}.` : ''}`;
    });

  return (
    <InspectorSection id="recap-publish" title="Publish" foldable={false}>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs">
          {channel.picture ? <img src={channel.picture} alt="" className="w-6 h-6 rounded-full object-cover" /> : <span className="w-6 h-6 rounded-full bg-accent-wash block" aria-hidden="true" />}
          <span className="flex-1 min-w-0 truncate text-ink">{channel.name}</span>
          <a href="#/sources" className="font-mono text-2xs text-muted no-underline hover:text-accent-ink">
            via Postiz
          </a>
        </div>
        <Segmented<PublishKind> size="sm" fill label="Publish as" value={kind} onChange={setKind} options={(['reel', 'carousel', 'story'] as const).map((k) => ({ id: k, label: KIND_LABEL[k], disabled: !kindOk(k) }))} />
        {kind === 'carousel' && slides > 10 && <span className="text-2xs text-warn">Instagram&apos;s API takes 10 slides — this carousel has {slides}.</span>}
        {kind === 'reel' && (
          <div className="flex flex-col gap-1.5">
            <span title="Shown to people who do not follow you first; nothing reaches your followers until it is shared with them">
              <ToggleField checked={trial} onChange={setTrial} label="Trial Reel">
                Trial Reel — non-followers first
              </ToggleField>
            </span>
            {trial && (
              <Segmented<'auto' | 'manual'>
                size="sm"
                fill
                label="Share it with your followers"
                value={graduate}
                onChange={setGraduate}
                options={[
                  { id: 'auto', label: 'When it works', title: 'Instagram shares it with your followers if it performs' },
                  { id: 'manual', label: 'By hand', title: 'You share it from Instagram when you choose' },
                ]}
              />
            )}
          </div>
        )}

        <span className={legend}>When · your rhythm</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="When it goes out">
          {slots.map((s) => {
            const on = chosen.kind === 'slot' && chosen.at.getTime() === s.at.getTime();
            return (
              <button
                key={s.at.toISOString()}
                type="button"
                disabled={s.taken}
                aria-pressed={on}
                title={s.taken ? 'A post already goes out then' : undefined}
                onClick={() => setWhen({ kind: 'slot', at: s.at })}
                className={`${chip} ${on ? 'border-accent bg-accent-wash text-ink' : 'border-line-strong text-ink-soft hover:border-accent'}`}
              >
                {slotLabel(s.at, rhythm!.timeZone)}
              </button>
            );
          })}
          {(['other', 'now', 'draft'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={chosen.kind === k}
              onClick={() => setWhen(k === 'other' ? { kind: 'other', at: at ?? new Date(Date.now() + 3600000) } : { kind: k })}
              className={`${chip} ${chosen.kind === k ? 'border-accent bg-accent-wash text-ink' : 'border-line-strong text-ink-soft hover:border-accent'}`}
            >
              {k === 'other' ? 'Other…' : k === 'now' ? 'Now' : 'Draft in Postiz'}
            </button>
          ))}
        </div>
        {chosen.kind === 'other' && (
          <input
            type="datetime-local"
            aria-label="When it goes out, on this device's clock"
            className="font-mono text-sm px-3 py-1.5 border border-line-strong rounded-paper bg-paper text-ink"
            value={chosen.at ? localInput(chosen.at) : ''}
            onChange={(e) => setWhen({ kind: 'other', at: e.target.value ? new Date(e.target.value) : null })}
          />
        )}
        {planned === null && <span className="text-2xs text-muted">Asking your Postiz what is planned…</span>}
        {plannedError && <span className="text-2xs text-warn">{plannedError} The slots are not marked.</span>}
        {warnings.map((w) => (
          <span key={w} className="text-2xs text-warn">
            {w} Still yours to send.
          </span>
        ))}

        <span className={legend}>
          Caption · {text.length.toLocaleString('en-GB')} / {CAPTION_MAX.toLocaleString('en-GB')}
          {doc.publish.approved ? ' · approved' : doc.publish.caption !== null ? ' · not approved yet' : ''}
        </span>
        <textarea
          value={template}
          onChange={(e) => change((d) => withRecap(d, { publish: withCaption(d.publish, e.target.value) }))}
          rows={5}
          aria-label="Caption template"
          spellCheck
          className="w-full font-sans text-sm leading-snug px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink resize-y focus:outline-none focus:border-accent"
        />
        <p className="m-0 text-2xs text-muted leading-relaxed" title="{heading} the title as shown · {at} « — Albany » · {route} the route · {tags} hashtags from the places · {place} {places} {month} {year} {count} {days}">
          Recap&apos;s words are filled when it is sent: <code className="font-mono">{'{heading} {route} {tags}'}</code>…
        </p>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">As it will read</summary>
          <p className="m-0 mt-1.5 whitespace-pre-wrap text-ink-soft border-l-2 border-line pl-2.5">{text || '—'}</p>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          {!doc.publish.approved && (
            <Button size="sm" variant="ghost" onClick={() => change((d) => withRecap(d, { publish: { ...d.publish, approved: true } }))} title="You read it: an agent may now schedule it">
              Approve the caption
            </Button>
          )}
          {doc.publish.caption !== null && (
            <Button size="sm" variant="ghost" onClick={() => change((d) => withRecap(d, { publish: withCaption(d.publish, null) }))} title="Back to Recap's own: the title, the place, the route, the tags">
              Recap&apos;s caption
            </Button>
          )}
        </div>
        {conn.collaborator && (
          <ToggleField checked={collab} onChange={setCollab} label={`@${conn.collaborator} as collaborator`}>
            @{conn.collaborator} as collaborator
          </ToggleField>
        )}
        <Button variant="primary" disabled={busy || !kindOk(kind) || (chosen.kind === 'other' && !chosen.at)} onClick={() => void schedule()}>
          {label}
        </Button>
        {doc.publish.publications.length > 0 && <Sent doc={doc} planned={planned} tz={rhythm!.timeZone} />}
      </div>
    </InspectorSection>
  );
}

/** What this recap sent, newest first, with Postiz's own state when it said. */
function Sent({ doc, planned, tz }: { doc: RecapDoc; planned: PostizPost[] | null; tz: string }) {
  const state = new Map((planned ?? []).map((p) => [p.id, p]));
  return (
    <div className="flex flex-col gap-1 mt-1">
      <span className={legend}>Sent from this recap</span>
      <ul className="m-0 p-0 list-none flex flex-col gap-1">
        {[...doc.publish.publications].reverse().map((p) => {
          const s = state.get(p.postId);
          const word = s ? { queue: 'scheduled', published: 'published', error: 'failed', draft: 'draft' }[s.state] : p.at && Date.parse(p.at) < Date.now() ? 'sent' : p.at ? 'scheduled' : 'draft';
          return (
            <li key={p.postId} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className={`font-mono text-2xs ${word === 'failed' ? 'text-danger' : word === 'published' ? 'text-ok' : 'text-ink-soft'}`}>{word}</span>
              <span className="text-ink">{KIND_LABEL[p.kind]}{p.trial ? ' · trial' : ''}</span>
              <span className="font-mono text-2xs text-muted">{p.at ? slotLabel(new Date(p.at), tz) : 'in Postiz'}</span>
              {s?.error && <span className="basis-full text-2xs text-danger">{s.error}</span>}
              {s?.releaseURL && (
                <a href={s.releaseURL} target="_blank" rel="noreferrer" className="text-2xs text-accent-ink">
                  open
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
