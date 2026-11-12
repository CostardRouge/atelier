import { useState } from 'react';
import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { CAPTION_MAX, DEFAULT_CAPTION, captionText, networkCaption, networkTitle, withCaption, withNetworkCaption, withNetworkTitle } from '../../shared/recap/recap-publish';
import type { ResolvedRecap } from '../../shared/recap/recap-slots';
import type { PostizChannel } from '../../shared/sources/postiz/client';
import NetworkMark from '../../shared/sources/postiz/NetworkMark';
import { captionLength, type Network } from '../../shared/sources/postiz/networks';
import Button from '../../shared/ui/Button';
import type { Change } from './RecapPanels';

export interface WordsFor {
  channel: PostizChannel;
  net: Network;
}

/** What a network's tab still asks of him: its words were shortened by Atelier and he has not opened them since. */
export function unreadWords(doc: RecapDoc, resolved: ResolvedRecap, going: readonly WordsFor[], seen: Readonly<Record<string, string>>): WordsFor[] {
  return going.filter(({ channel, net }) => {
    const c = networkCaption(doc, resolved, channel.id, net);
    return c.fitted && !c.own && seen[channel.id] !== c.text;
  });
}

const field = 'w-full font-sans text-sm leading-snug px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';

/**
 * *Words* (lab 18, his pick: «raccourcies automatiquement puis relues»): the
 * caption every network starts from under *All*, and a tab per account ticked
 * with what THAT network gets — the same words, cut to its length at a
 * sentence with two hashtags kept, a dot on the tab until he has read them;
 * typing there makes them that network's own. YouTube and TikTok ask a title:
 * the heading, until he writes one.
 */
export default function PublishWords({
  doc,
  resolved,
  change,
  going,
  seen,
  onSeen,
}: {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  change: Change;
  going: readonly WordsFor[];
  seen: Readonly<Record<string, string>>;
  onSeen: (channelId: string, text: string) => void;
}) {
  const [tab, setTab] = useState<string>('all');
  const here = going.find((g) => g.channel.id === tab) ?? null;
  const unread = new Set(unreadWords(doc, resolved, going, seen).map((g) => g.channel.id));
  // Two accounts of one network: their tabs say which.
  const twice = (net: Network) => going.filter((g) => g.net.id === net.id).length > 1;

  const base = captionText(doc, resolved);
  const mine = here ? networkCaption(doc, resolved, here.channel.id, here.net) : null;
  const text = mine ? mine.text : base;
  const max = here ? here.net.captionMax : CAPTION_MAX;
  const length = here ? captionLength(text, here.net) : text.length;
  const value = here ? (doc.publish.captions[here.channel.id] ?? text) : (doc.publish.caption ?? DEFAULT_CAPTION);
  const write = (next: string) => change((d) => withRecap(d, { publish: here ? withNetworkCaption(d.publish, here.channel.id, next) : withCaption(d.publish, next) }));
  const open = (id: string) => {
    setTab(id);
    const g = going.find((x) => x.channel.id === id);
    if (g) onSeen(id, networkCaption(doc, resolved, id, g.net).text);
  };
  const pill = (on: boolean) =>
    `flex-none inline-flex items-center gap-1.5 min-h-7 pointer-coarse:min-h-11 pl-1 pr-2.5 rounded-full border font-sans text-2xs font-medium cursor-pointer transition-colors duration-150 ease-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
      on ? 'bg-ink text-paper border-ink' : 'bg-paper text-ink-soft border-line-strong hover:border-accent'
    }`;
  const hint = !here
    ? 'What every network starts from. A network’s tab shows what it gets.'
    : mine!.own
      ? `${here.net.label}’s own words.`
      : mine!.fitted
        ? `Shortened for ${here.net.label}: cut at a sentence, two hashtags kept. Type to make them its own.`
        : `The shared words fit ${here.net.label} as they are.`;

  return (
    <div className="flex flex-col gap-2">
      {going.length > 0 && (
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-0.5 px-0.5 py-0.5" role="tablist" aria-label="The words, per network">
          <button type="button" role="tab" aria-selected={!here} className={`${pill(!here)} pl-2.5`} onClick={() => setTab('all')}>
            All
          </button>
          {going.map(({ channel, net }) => (
            <button key={channel.id} type="button" role="tab" aria-selected={here?.channel.id === channel.id} title={`${channel.name} · ${net.label}`} className={pill(here?.channel.id === channel.id)} onClick={() => open(channel.id)}>
              <NetworkMark identifier={channel.identifier} size="xs" />
              {twice(net) ? channel.name.replace(/^\P{L}+/u, '').split(/\s+/)[0] : net.label}
              {unread.has(channel.id) && <span className="w-1.5 h-1.5 rounded-full bg-warn-bright" role="img" aria-label="shortened, not read yet" title="Shortened for this network — not read yet" />}
            </button>
          ))}
        </div>
      )}
      {here?.net.titleMax && (
        <label className="flex flex-col gap-1">
          <input
            className={field}
            value={doc.publish.titles[here.channel.id] ?? networkTitle(doc, resolved, here.channel.id, here.net)}
            maxLength={here.net.titleMax}
            onChange={(e) => change((d) => withRecap(d, { publish: withNetworkTitle(d.publish, here.channel.id, e.target.value) }))}
            aria-label={`${here.net.label} title`}
          />
          <span className="font-mono text-3xs text-muted">
            {here.net.label} title · {here.net.titleMax} at most{here.net.titleRequired ? ' · required' : ''}
          </span>
        </label>
      )}
      <textarea value={value} onChange={(e) => write(e.target.value)} rows={5} aria-label={here ? `Words for ${here.net.label}` : 'Caption template'} spellCheck className={`${field} resize-y`} />
      <div className="flex items-center gap-2">
        <div className="flex-1 h-[3px] rounded-full bg-line overflow-hidden" aria-hidden="true">
          <div className={`h-full rounded-full ${length > max ? 'bg-danger' : 'bg-ok'}`} style={{ width: `${Math.min(100, (length / max) * 100)}%` }} />
        </div>
        <span className={`font-mono text-3xs tabular-nums ${length > max ? 'text-danger' : 'text-muted'}`}>
          {length.toLocaleString('en-GB')} / {max.toLocaleString('en-GB')}
        </span>
      </div>
      <p className={`m-0 text-2xs leading-relaxed ${here && unread.has(here.channel.id) ? 'text-warn' : 'text-muted'}`}>{hint}</p>
      {(!here || mine!.own) && value !== text && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">As it will read</summary>
          <p className="m-0 mt-1.5 whitespace-pre-wrap text-ink-soft border-l-2 border-line pl-2.5">{text || '—'}</p>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!doc.publish.approved && (
          <Button size="sm" variant="ghost" onClick={() => change((d) => withRecap(d, { publish: { ...d.publish, approved: true } }))} title="You read them: an agent may now schedule it">
            Approve the words
          </Button>
        )}
        {!here && doc.publish.caption !== null && (
          <Button size="sm" variant="ghost" onClick={() => change((d) => withRecap(d, { publish: withCaption(d.publish, null) }))} title="Back to Recap's own: the title, the place, the route, the tags">
            Recap&apos;s caption
          </Button>
        )}
        {here && mine!.own && (
          <Button size="sm" variant="ghost" onClick={() => change((d) => withRecap(d, { publish: withNetworkCaption(d.publish, here.channel.id, null) }))} title="Back to the shared words, fitted to this network">
            The shared words
          </Button>
        )}
      </div>
    </div>
  );
}
