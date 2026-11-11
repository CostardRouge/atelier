import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { defaultKind, musicFor, networkCaption, networkTitle, publicationGroups, withPublications, type PublishKind } from '../../shared/recap/recap-publish';
import { placeWords } from '../../shared/recap/recap-places';
import type { ResolvedRecap } from '../../shared/recap/recap-slots';
import { PostizClient, type PostizChannel, type PostizPost } from '../../shared/sources/postiz/client';
import NetworkMark from '../../shared/sources/postiz/NetworkMark';
import { networkOf, networkPlan, postMoments, type MediaType, type NetworkPlan, type NetworkRefusal } from '../../shared/sources/postiz/networks';
import { nextFreeSlot, rhythmWarnings, slotLabel } from '../../shared/sources/postiz/rhythm';
import { defaultDestinations, publishChannels } from '../../shared/sources/postiz/store';
import { usePostiz } from '../../shared/sources/postiz/use-postiz';
import type { startTask } from '../../shared/tasks/tasks';
import { InspectorSection, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { readWhere, writeWhere } from './publish-where';
import PublishSound from './PublishSound';
import PublishWords, { unreadWords, type WordsFor } from './PublishWords';
import { sendPosts, sendSummary, type Destination } from './recap-post';
import type { Change } from './RecapPanels';
import WhenCard, { type When } from './WhenCard';

type Task = ReturnType<typeof startTask>;

const KIND_LABEL: Record<PublishKind, string> = { reel: 'Reel', carousel: 'Carousel', story: 'Story' };
const state = 'font-mono text-3xs text-muted tabular-nums select-none';
/** How far ahead the planned posts are read, to mark the slots taken. */
const AHEAD_DAYS = 42;
/** *Instagram first*: how long after it the other networks go out. */
const STAGGER_MS = 2 * 3600_000;

/** What the foot of the Export tab needs from Publish: its verbs, and what they will send. */
export interface PublishVerbs {
  /** A Postiz and an account are there: the foot can publish. */
  ready: boolean;
  /** `Reel · 4 accounts · caption approved`. */
  summary: string;
  /** The verb as the slot chosen says it: `Schedule 4 posts · Fri 14 Nov · 19:00`, `Publish now`, `Send as a draft`. */
  label: string;
  /** Why it cannot be sent now, or null. */
  blocked: string | null;
  /** Sends as chosen, or now / as a draft whatever is chosen. */
  send: (as?: 'now' | 'draft') => void;
  /** What the chosen slot is, in a few words. */
  when: string;
}

interface Offer {
  channel: PostizChannel;
  plan: NetworkPlan | NetworkRefusal;
}

/**
 * Export › *Publish* (lab 12; several networks since lab 18, his yes of
 * 2026-11-11): ONE recap rendered once, sent to HIS Postiz and scheduled on
 * the accounts he ticks — Instagram, TikTok, YouTube, Bluesky, Threads, X —
 * in one slot of his rhythm, each network getting what it takes of it.
 *
 * - **Where**: every account as a chip saying what it will receive there (a
 *   Reel, a Short, the first four pictures) or why it cannot; the ones ticked
 *   are the last ones this TEMPLATE went to on this device.
 * - **When**: the next free slot (a broken rhythm SAID, never refused), the
 *   other networks two hours after Instagram if he likes.
 * - **Words**: the caption, a template of Recap's words filled when sent, and
 *   what each network gets of it (`PublishWords.tsx`).
 * - **Sound**: the recap's own, or a track of the network's library where an
 *   account has one (`PublishSound.tsx`).
 *
 * The SETTINGS are these sections and the VERB is the Export tab's pinned
 * foot (lab 13): `usePublish` holds both.
 */
export function usePublish({
  doc,
  resolved,
  change,
  slides,
  media,
  seconds,
  cuts,
  onWithFilm,
  canEncode,
  busy,
  run,
  render,
}: {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  change: Change;
  slides: number;
  /** The carousel's slides in order, each a picture or a clip — what a network is offered of it. */
  media: readonly MediaType[];
  /** The film's length. */
  seconds: number;
  /** When the film cuts, in seconds. */
  cuts: readonly number[];
  /** Plays the film on the stage with a library track over it (null: its own sound back). */
  onWithFilm: (over: { url: string; music: number; film: number } | null) => void;
  canEncode: boolean;
  busy: boolean;
  run: (label: string, job: (signal: AbortSignal, task: Task) => Promise<string>) => Promise<void>;
  render: (kind: PublishKind, signal: AbortSignal, task: Task) => Promise<File[]>;
}): { sections: ReactNode; verbs: PublishVerbs } {
  const conn = usePostiz();
  const channels = useMemo(() => publishChannels(conn), [conn]);
  const [kind, setKind] = useState<PublishKind>(() => defaultKind(doc, slides));
  const [ticked, setTicked] = useState<string[]>(() => defaultDestinations(conn, readWhere(doc.template)));
  const [trial, setTrial] = useState(false);
  const [graduate, setGraduate] = useState<'auto' | 'manual'>('auto');
  const [collab, setCollab] = useState(true);
  const [stagger, setStagger] = useState(false);
  const [planned, setPlanned] = useState<PostizPost[] | null>(null);
  const [plannedError, setPlannedError] = useState<string | null>(null);
  const [when, setWhen] = useState<When | null>(null);
  /** The shortened words he has opened, by account: the text he saw there. */
  const [seen, setSeen] = useState<Record<string, string>>({});

  // A Postiz connected, or its accounts changed, since this opened: the ticks follow what exists.
  useEffect(() => {
    setTicked((cur) => (cur.some((id) => channels.some((c) => c.id === id)) ? cur.filter((id) => channels.some((c) => c.id === id)) : defaultDestinations(conn, readWhere(doc.template))));
  }, [channels]);

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
  // One recap on several networks is ONE moment of the rhythm (lab 18, Q3).
  const takenAt = useMemo(() => postMoments((planned ?? []).filter((p) => p.state !== 'error' && p.state !== 'draft').map((p) => ({ at: new Date(p.publishDate), channelId: p.channel?.id ?? null }))), [planned]);
  const now = new Date();
  const free = rhythm ? nextFreeSlot(rhythm, takenAt, now) : null;
  // The next free slot, until he picks another.
  const chosen: When = when ?? (free ? { kind: 'slot', at: free } : { kind: 'draft' });
  const at = chosen.kind === 'slot' || chosen.kind === 'other' ? chosen.at : null;
  const warnings = rhythm && at ? rhythmWarnings(rhythm, takenAt, at) : [];

  const place = placeWords(resolved.slots.flatMap((s) => (s.picture ? [s.picture] : []))).place;

  // What each account would receive of this recap, as `kind`.
  const shape: readonly MediaType[] = kind === 'carousel' ? media : ['video'];
  const offers: Offer[] = channels.map((channel) => ({ channel, plan: networkPlan(networkOf(channel.identifier)!, kind, shape, kind === 'carousel' ? null : seconds) }));
  const going = offers.filter((o) => o.plan.ok && ticked.includes(o.channel.id));
  const instagram = going.some((o) => networkOf(o.channel.identifier)?.id === 'instagram');
  const others = going.some((o) => networkOf(o.channel.identifier)?.id !== 'instagram');
  const wordsFor: WordsFor[] = going.map((o) => ({ channel: o.channel, net: networkOf(o.channel.identifier)! }));
  const unread = unreadWords(doc, resolved, wordsFor, seen);

  const linkTo = (words: string) => (
    <InspectorSection id="recap-publish" title="Publish" summary="not connected">
      <p className="m-0 text-xs text-muted leading-relaxed">
        {words}{' '}
        <a href="#/sources" className="text-accent-ink font-semibold no-underline hover:underline">
          Sources →
        </a>
      </p>
    </InspectorSection>
  );
  const idle: PublishVerbs = { ready: false, summary: '', label: '', blocked: null, send: () => {}, when: '' };
  if (!conn) return { sections: linkTo('Schedule this recap on your networks from here: connect your own Postiz on'), verbs: idle };
  if (!channels.length) return { sections: linkTo('Your Postiz has no account Recap can post to yet. Add one there, then refresh it on'), verbs: idle };

  const kindOk = (k: PublishKind) => (k === 'carousel' ? slides > 1 : canEncode);
  const tz = rhythm!.timeZone;
  const whenWords = chosen.kind === 'now' ? 'now' : chosen.kind === 'draft' ? 'a draft' : at ? slotLabel(at, tz) : 'a time to choose';
  const posts = going.length === 1 ? '' : ` ${going.length} posts`;
  const label = chosen.kind === 'now' ? `Publish${posts} now` : chosen.kind === 'draft' ? `Send${posts || ''} as ${going.length > 1 ? 'drafts' : 'a draft'}` : at ? `Schedule${posts} · ${slotLabel(at, tz)}` : 'Schedule';
  const blocked = !kindOk(kind)
    ? kind === 'carousel'
      ? 'A carousel needs two slides at least.'
      : 'This browser cannot encode video.'
    : !going.length
      ? 'Tick an account in Where.'
      : chosen.kind === 'other' && !chosen.at
        ? 'Choose when it goes out.'
        : null;

  const toggle = (id: string) => setTicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const schedule = (as?: 'now' | 'draft') =>
    run('publish', async (signal, task) => {
      const files = await render(kind, signal, task);
      const target: Date | 'now' | 'draft' = as ?? (chosen.kind === 'now' ? 'now' : chosen.kind === 'draft' ? 'draft' : (at ?? 'draft'));
      // Instagram first: the others two hours after it, whenever it goes.
      const later = (): Date | 'draft' => (target === 'draft' ? 'draft' : new Date((target === 'now' ? Date.now() : target.getTime()) + STAGGER_MS));
      const destinations: Destination[] = going.map((o) => ({
        channel: o.channel,
        caption: networkCaption(doc, resolved, o.channel.id, networkOf(o.channel.identifier)!).text,
        title: networkTitle(doc, resolved, o.channel.id, networkOf(o.channel.identifier)!) || null,
        music: musicFor(doc.publish, o.channel.identifier, kind),
        at: stagger && instagram && others && networkOf(o.channel.identifier)?.id !== 'instagram' ? later() : target,
      }));
      const result = await sendPosts({
        client: client!,
        kind,
        files,
        seconds: kind === 'carousel' ? null : seconds,
        destinations,
        trial,
        graduate,
        collaborators: collab && conn.collaborator ? [conn.collaborator] : [],
        signal,
        onFile: (n, of) => task.update({ progress: (n - 1) / (of + destinations.length), detail: `sending file ${n} / ${of}` }),
        onPost: (n, of, name) => task.update({ progress: 1 - (of - n + 1) / (of + files.length), detail: `scheduling on ${name}` }),
      });
      if (result.sent.length) {
        change((d) => withRecap(d, { publish: withPublications(d.publish, result.sent) }));
        writeWhere(doc.template, ticked);
      }
      void refresh();
      setWhen(null);
      const where = target === 'now' ? 'Sent — it is being published' : target === 'draft' ? 'Sent to Postiz as a draft' : `Scheduled for ${slotLabel(target, tz)}`;
      const what = `${KIND_LABEL[kind]}${kind === 'reel' && trial && instagram ? ', trial on Instagram' : ''}`;
      return `${sendSummary(result, `${where} (${what})`)}${place && instagram && result.sent.length ? ` Once it is out, add the location in Instagram: ${place}.` : ''}`;
    });

  const verbs: PublishVerbs = {
    ready: true,
    summary: `${KIND_LABEL[kind]} · ${going.length === 1 ? going[0].channel.name : `${going.length} accounts`} · words ${doc.publish.approved ? 'approved' : 'not approved yet'}`,
    label,
    blocked: busy ? null : blocked,
    send: (as) => void schedule(as),
    when: whenWords,
  };

  const withTrack = going.filter((o) => musicFor(doc.publish, o.channel.identifier, kind)).length;
  const soundWords = withTrack ? `network music on ${withTrack}` : doc.sound ? 'the recap’s own' : 'silent';
  const cutNotes = going.flatMap((o) => (o.plan.ok && o.plan.note ? [o.plan.note] : []));
  const sections = (
    <>
      <InspectorSection
        id="recap-publish-where"
        title="Where"
        summary={`${KIND_LABEL[kind]} · ${going.length} of ${channels.length}`}
        actions={<span className={state}>{going.length} of {channels.length}</span>}
        info="One recap, rendered once, sent to your Postiz for each account ticked. Each network gets what it takes of it."
      >
        <div className="flex flex-col gap-2">
          <Segmented<PublishKind> size="sm" fill label="Publish as" value={kind} onChange={setKind} options={(['reel', 'carousel', 'story'] as const).map((k) => ({ id: k, label: KIND_LABEL[k], disabled: !kindOk(k) }))} />
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="The accounts it goes out on">
            {offers.map(({ channel, plan }) => {
              const on = plan.ok && ticked.includes(channel.id);
              const net = networkOf(channel.identifier)!;
              return (
                <button
                  key={channel.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={!plan.ok}
                  aria-label={`${channel.name}, ${net.label} · ${plan.ok ? plan.as : plan.short}`}
                  title={plan.ok ? (plan.note ?? `${net.label} · ${plan.as}`) : plan.why}
                  onClick={() => toggle(channel.id)}
                  className={`touch-halo grid grid-cols-[1.75rem_minmax(0,1fr)_1rem] items-center gap-2 min-h-12 px-2 py-1.5 rounded-control border text-left cursor-pointer transition-colors duration-150 ease-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-55 ${
                    on ? 'border-ink bg-surface' : 'border-line-strong bg-paper hover:border-accent'
                  }`}
                >
                  <NetworkMark identifier={channel.identifier} picture={channel.picture} />
                  <span className="min-w-0 flex flex-col">
                    <span className="text-xs font-medium text-ink truncate">{channel.name}</span>
                    {/* The mark says the network: the line is what it receives there. */}
                    <span className="font-mono text-3xs text-muted truncate">{plan.ok ? plan.as : plan.short}</span>
                  </span>
                  <span aria-hidden="true" className={`w-4 h-4 rounded-[4px] border-[1.5px] grid place-items-center text-3xs leading-none ${on ? 'bg-accent border-accent text-on-media' : 'border-line-strong'}`}>
                    {on ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
          {cutNotes.map((n) => (
            <span key={n} className="text-2xs text-warn">
              {n}
            </span>
          ))}
          {instagram && kind === 'reel' && (
            <div className="flex flex-col gap-1.5">
              <span title="Shown to people who do not follow you first; nothing reaches your followers until it is shared with them">
                <ToggleField checked={trial} onChange={setTrial} label="Trial Reel on Instagram">
                  Trial Reel on Instagram — non-followers first
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
          {instagram && kind !== 'story' && conn.collaborator && (
            <ToggleField checked={collab} onChange={setCollab} label={`@${conn.collaborator} as collaborator on Instagram`}>
              @{conn.collaborator} as collaborator on Instagram
            </ToggleField>
          )}
        </div>
      </InspectorSection>

      <InspectorSection id="recap-publish-when" title="When" summary={whenWords} actions={<span className={state}>one slot · every account</span>}>
        <div className="flex flex-col gap-2">
          <WhenCard rhythm={rhythm!} taken={takenAt} chosen={chosen} free={free} warnings={warnings} onChoose={setWhen} />
          {instagram && others && chosen.kind !== 'draft' && (
            <span title="Instagram goes out in the slot; the other networks two hours later — one moment of your rhythm all the same">
              <ToggleField checked={stagger} onChange={setStagger} label="Instagram first, the others 2 h later">
                Instagram first, the others 2 h later
              </ToggleField>
            </span>
          )}
          {planned === null && <span className="text-2xs text-muted">Asking your Postiz what is planned…</span>}
          {plannedError && <span className="text-2xs text-warn">{plannedError} The slots are not marked.</span>}
        </div>
      </InspectorSection>

      <InspectorSection
        id="recap-publish-words"
        title="Words"
        marked={unread.length > 0}
        summary={unread.length ? `${unread.length} to read` : doc.publish.approved ? 'approved' : 'not approved yet'}
        actions={<span className={state}>{unread.length ? `${unread.length} to read` : doc.publish.approved ? 'approved' : 'not approved yet'}</span>}
        info="A template: Recap's words — {heading} the title as shown, {at} « — Albany », {route} the route, {tags} hashtags from the places, {place} {places} {month} {year} {count} {days} — are filled when it is sent. Each network gets them cut to its length."
      >
        <PublishWords doc={doc} resolved={resolved} change={change} going={wordsFor} seen={seen} onSeen={(id, text) => setSeen((cur) => (cur[id] === text ? cur : { ...cur, [id]: text }))} />
      </InspectorSection>

      <InspectorSection
        id="recap-publish-sound"
        title="Sound"
        summary={soundWords}
        actions={<span className={state}>{soundWords}</span>}
        info="A network lays a track of its own library over a Reel: nothing of it is in the file Recap sends, and the network picks the excerpt. The other networks hear the recap's own sound."
      >
        <PublishSound doc={doc} change={change} client={client!} going={going.map((o) => o.channel)} kind={kind} cuts={cuts} onWithFilm={onWithFilm} />
      </InspectorSection>

      {doc.publish.publications.length > 0 && (
        <InspectorSection id="recap-publish-sent" title="Sent" defaultOpen={false} summary={`${publicationGroups(doc.publish.publications).length} time${publicationGroups(doc.publish.publications).length === 1 ? '' : 's'}`}>
          <Sent doc={doc} planned={planned} tz={tz} />
        </InspectorSection>
      )}
    </>
  );
  return { sections, verbs };
}

/** What this recap sent, newest send first — each account of a send with Postiz's own state when it said. */
function Sent({ doc, planned, tz }: { doc: RecapDoc; planned: PostizPost[] | null; tz: string }) {
  const live = new Map((planned ?? []).map((p) => [p.id, p]));
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2">
      {publicationGroups(doc.publish.publications).map((group) => {
        const first = group[0];
        return (
          <li key={first.group ?? first.postId} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="text-ink">
                {KIND_LABEL[first.kind]}
                {first.trial ? ' · trial' : ''}
              </span>
              <span className="font-mono text-2xs text-muted">{first.at ? slotLabel(new Date(first.at), tz) : 'a draft in Postiz'}</span>
            </span>
            <ul className="m-0 p-0 list-none flex flex-col gap-1">
              {group.map((p) => {
                const s = live.get(p.postId);
                const word = s ? { queue: 'scheduled', published: 'published', error: 'failed', draft: 'draft' }[s.state] : p.at && Date.parse(p.at) < Date.now() ? 'sent' : p.at ? 'scheduled' : 'draft';
                return (
                  <li key={p.postId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <NetworkMark identifier={p.network} size="xs" />
                    <span className="min-w-0 truncate text-ink-soft">{p.channel}</span>
                    <span className={`font-mono text-2xs ${word === 'failed' ? 'text-danger' : word === 'published' ? 'text-ok' : 'text-muted'}`}>{word}</span>
                    {s?.releaseURL && (
                      <a href={s.releaseURL} target="_blank" rel="noreferrer" className="text-2xs text-accent-ink">
                        open
                      </a>
                    )}
                    {s?.error && <span className="basis-full text-2xs text-danger">{s.error}</span>}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
