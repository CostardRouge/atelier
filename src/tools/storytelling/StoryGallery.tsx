import { useMemo, useState } from 'react';
import { assemble, SCRIPT_KIND, type CellState, type StoryScript } from '../../shared/story/story-script';
import { channelsOf, coverage, flatten, hasWork, leavesOf, mapRows, nextState, stateOf, withCell, type MapRow } from '../../shared/story/story-map';
import { paintCover } from './covers';
import { POSTS } from './posts';
import ScriptControls from './ScriptControls';

const STATE_LABEL: Record<CellState, string> = {
  idee: 'Idea',
  encours: 'In progress',
  pret: 'Ready',
  publie: 'Published',
  non: 'Not for this channel',
};

/** A state drawn as a mark, the same on the map and in its legend. */
function Mark({ s }: { s: CellState | null }) {
  if (!s) return <i aria-hidden="true" className="block w-1 h-1 rounded-full bg-line-strong" />;
  if (s === 'non') return <i aria-hidden="true" className="block w-3 h-[2px] rounded-full bg-line-strong" />;
  if (s === 'idee') return <i aria-hidden="true" className="block w-3.5 h-3.5 rounded-full border-[1.5px] border-muted" />;
  if (s === 'encours')
    return (
      <i
        aria-hidden="true"
        className="block w-3.5 h-3.5 rounded-full border-[1.5px] border-warn bg-[linear-gradient(90deg,var(--color-warn)_50%,transparent_50%)]"
      />
    );
  if (s === 'pret')
    return <i aria-hidden="true" className="block w-3.5 h-3.5 rounded-full border-2 border-accent bg-accent shadow-[inset_0_0_0_2.5px_var(--color-surface)]" />;
  return (
    <i aria-hidden="true" className="grid place-items-center w-3.5 h-3.5 rounded-full bg-accent text-3xs leading-none text-on-media not-italic font-bold">
      ✓
    </i>
  );
}

/** How a set of lines stands on one channel: a thin bar, published first. */
function CoverageBar({ rows, channel }: { rows: MapRow[]; channel: string }) {
  const c = coverage(rows, channel);
  const n = c.total || 1;
  const part = (k: number, cls: string) => (k ? <i className={`block h-full ${cls}`} style={{ width: `${(k / n) * 100}%` }} /> : null);
  return (
    <span className="flex h-1 w-full overflow-hidden rounded-full bg-paper-2" aria-hidden="true">
      {part(c.publie, 'bg-accent')}
      {part(c.pret, 'bg-accent/50')}
      {part(c.encours, 'bg-warn')}
      {part(c.idee, 'bg-faint')}
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Storytelling's gallery: the MAP OF SUBJECTS. Every subject the author means
 * to tell, filed by pillar, against every channel — each crossing a state, a
 * click away from the next one. A line that is a post of the series wears
 * its cover and opens it; a subject not made yet is on the map all the same,
 * which is what makes it a map and not a list of what exists.
 *
 * The map lives in the script (`story-map.ts`): states change here, are kept
 * in this browser with it, and go back to the author's file with *Save
 * script*.
 */
export default function StoryGallery({
  script,
  onScript,
  fontsReady,
  onOpen,
}: {
  script: StoryScript | null;
  onScript: (next: StoryScript | null) => void;
  fontsReady: boolean;
  onOpen: (postId: string) => void;
}) {
  const [pillar, setPillar] = useState<string>('');
  const [todo, setTodo] = useState(false);
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  const channels = channelsOf(script);
  const rows = useMemo(() => mapRows(script, POSTS), [script]);
  const shown = pillar ? rows.filter((r) => r.topic.id === pillar) : rows;
  const leaves = shown.flatMap(leavesOf);

  const covers = useMemo(() => {
    if (!fontsReady) return new Map<string, string>();
    return new Map(POSTS.map((p) => [p.id, paintCover(assemble(p, script, POSTS), 0.08).toDataURL('image/png')]));
  }, [fontsReady, script]);

  const visible = (r: MapRow): boolean => !todo || (r.children.length ? r.children.some(visible) : hasWork(r.topic));
  const lines: MapRow[] = [];
  const walk = (r: MapRow) => {
    if (!visible(r)) return;
    lines.push(r);
    if (!folded[r.topic.id] || todo) r.children.forEach(walk);
  };
  shown.forEach(walk);

  const cycle = (row: MapRow, channel: string) => {
    const base: StoryScript = script ?? { kind: SCRIPT_KIND, version: 1, posts: {} };
    onScript(withCell(base, row, channel, nextState(stateOf(row.topic, channel)), today()));
  };

  const count = (s: CellState) => leaves.reduce((n, r) => n + channels.filter((c) => stateOf(r.topic, c.id) === s).length, 0);
  const proposed = flatten(rows).filter((r) => r.topic.proposed).length;
  const posts = flatten(rows).filter((r) => r.post).length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-4 pt-2">
        <div className="min-w-0">
          <p className="m-0 font-mono text-2xs uppercase tracking-[0.12em] text-muted">Storytelling</p>
          <h1 className="m-0 font-serif text-4xl leading-none text-ink">
            {script?.series || 'Map of subjects'}
          </h1>
          <p className="m-0 mt-1.5 text-sm text-muted">
            {leaves.length} subjects · {posts} made as posts · {count('publie')} published · {count('pret')} ready ·{' '}
            {count('encours')} in progress · {count('idee')} ideas
            {proposed ? ` · ${proposed} proposed, to keep or drop` : ''}
          </p>
        </div>
        <div className="ml-auto">
          <ScriptControls script={script} onScript={onScript} compact />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {[{ id: '', title: 'All' }, ...rows.map((r) => r.topic)].map((p) => (
          <button
            key={p.id || 'all'}
            type="button"
            aria-pressed={pillar === p.id}
            onClick={() => setPillar(p.id)}
            className={`touch-row rounded-full border px-3 py-1 text-sm cursor-pointer transition-colors ${
              pillar === p.id ? 'bg-ink text-paper border-ink' : 'bg-surface border-line hover:border-line-strong'
            }`}
          >
            {p.title}
          </button>
        ))}
        <label className="inline-flex items-center gap-2 text-sm text-muted cursor-pointer ml-1">
          <input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} />
          Still to do
        </label>
        <span className="ml-auto flex flex-wrap gap-3 text-xs text-muted">
          {(['idee', 'encours', 'pret', 'publie', 'non'] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <Mark s={s} />
              {STATE_LABEL[s]}
            </span>
          ))}
        </span>
      </div>

      <div className="overflow-x-auto rounded-paper-lg border border-line bg-surface">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] bg-surface text-left font-mono text-2xs uppercase tracking-[0.1em] text-muted font-normal px-3 py-2 border-b border-line min-w-[19rem]">
                Subject
              </th>
              {channels.map((c) => (
                <th key={c.id} scope="col" className="text-left font-normal px-3 py-2 border-b border-l border-line min-w-[7.5rem] align-bottom" title={c.voice}>
                  <span className="block text-sm font-semibold text-ink">{c.name}</span>
                  {c.format ? <span className="block text-xs text-muted truncate max-w-[9rem]">{c.format}</span> : null}
                  <span className="block mt-1.5">
                    <CoverageBar rows={leaves} channel={c.id} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((r) => {
              const parent = r.children.length > 0;
              const L = parent ? leavesOf(r) : [];
              const top = r.depth === 0;
              const cover = r.post ? covers.get(r.post.id) : undefined;
              return (
                <tr key={r.topic.id} className={top ? 'bg-paper-2' : ''}>
                  <th scope="row" className={`sticky left-0 z-[1] text-left font-normal border-b border-line px-3 py-1.5 ${top ? 'bg-paper-2' : 'bg-surface'}`}>
                    <div className="flex items-center gap-2" style={{ paddingLeft: `${r.depth * 1.1}rem` }}>
                      <button
                        type="button"
                        aria-label={folded[r.topic.id] ? `Unfold ${r.topic.title}` : `Fold ${r.topic.title}`}
                        aria-expanded={!folded[r.topic.id]}
                        onClick={() => setFolded((f) => ({ ...f, [r.topic.id]: !f[r.topic.id] }))}
                        className={`w-5 h-5 grid place-items-center rounded text-muted text-3xs cursor-pointer hover:bg-paper-2 ${parent ? '' : 'invisible'}`}
                      >
                        {folded[r.topic.id] ? '▶' : '▼'}
                      </button>
                      {r.post ? (
                        cover ? (
                          <img src={cover} alt="" className="w-6 h-[2.65rem] rounded-[3px] border border-line object-cover shrink-0" />
                        ) : (
                          <span className="w-6 h-[2.65rem] rounded-[3px] border border-line bg-paper-2 shrink-0" />
                        )
                      ) : null}
                      <span className="flex flex-col min-w-0">
                        {r.post ? (
                          <button
                            type="button"
                            onClick={() => onOpen(r.post!.id)}
                            className="text-left text-ink font-medium truncate max-w-[18rem] cursor-pointer hover:text-accent-ink underline-offset-[3px] hover:underline"
                            title={`Open ${r.post.number}`}
                          >
                            <span className="font-mono text-2xs text-muted mr-1.5">{r.post.number}</span>
                            {script?.posts[r.post.id]?.title ?? r.topic.title}
                          </button>
                        ) : (
                          <span className={`truncate max-w-[18rem] ${top ? 'font-semibold text-ink' : 'text-ink'}`}>{r.topic.title}</span>
                        )}
                        {r.topic.hook && !top ? <span className="text-xs text-muted truncate max-w-[18rem]">{r.topic.hook}</span> : null}
                      </span>
                      {r.topic.proposed ? (
                        <span className="ml-1 rounded-full border border-warn-line bg-warn-wash text-warn text-3xs px-1.5 whitespace-nowrap">proposed</span>
                      ) : null}
                      {parent ? <span className="ml-auto pl-2 font-mono text-2xs text-muted">{L.length}</span> : null}
                    </div>
                  </th>
                  {channels.map((c) =>
                    parent ? (
                      <td key={c.id} className="border-b border-l border-line px-3 py-1.5 align-middle">
                        <span className="flex flex-col items-center gap-1">
                          <CoverageBar rows={L} channel={c.id} />
                          <span className="font-mono text-3xs text-muted tabular-nums">
                            {coverage(L, c.id).publie}/{L.filter((l) => stateOf(l.topic, c.id) && stateOf(l.topic, c.id) !== 'non').length}
                          </span>
                        </span>
                      </td>
                    ) : (
                      <td key={c.id} className="border-b border-l border-line text-center align-middle">
                        <button
                          type="button"
                          onClick={() => cycle(r, c.id)}
                          aria-label={`${r.topic.title} on ${c.name}: ${stateOf(r.topic, c.id) ? STATE_LABEL[stateOf(r.topic, c.id)!] : 'nothing yet'}. Click for the next state.`}
                          title={`${stateOf(r.topic, c.id) ? STATE_LABEL[stateOf(r.topic, c.id)!] : 'Nothing yet'}${r.topic.cells?.[c.id]?.date ? ` · ${r.topic.cells[c.id].date}` : ''} — click for the next state`}
                          className="touch-row inline-grid place-items-center w-9 h-9 rounded-control cursor-pointer hover:bg-paper-2"
                        >
                          <Mark s={stateOf(r.topic, c.id)} />
                        </button>
                      </td>
                    ),
                  )}
                </tr>
              );
            })}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={channels.length + 1} className="px-3 py-6 text-center text-muted">
                  Nothing left to do here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!script?.topics?.length ? (
        <p className="m-0 text-xs text-muted leading-relaxed">
          The map reads your subjects from your script. Without them, it lists the posts of the series; load a script that
          names its pillars, subjects and channels to see the whole map.
        </p>
      ) : null}
    </div>
  );
}
