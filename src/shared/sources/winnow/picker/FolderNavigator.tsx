import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WinnowSession } from '../client';
import IconButton from '../../../ui/IconButton';
import Segmented from '../../../ui/Segmented';
import { Icons } from '../../../ui/icons';
import { localPref, useLocalPref } from '../../../ui/local-pref';
import { useIsCompact } from '../../../ui/use-layout-mode';
import {
  folderTree,
  chainTo,
  matchFolders,
  matchRanges,
  orderFolders,
  parentLabel,
  shortDays,
  trailTo,
  type FolderNode,
  type FolderOrder,
} from './folder-tree';

/**
 * The picker's FOLDER scope (lab 2026-11-24, https://claude.ai/artifact/VPiyiFjZCwnaWQJFE1jZMa,
 * his picks 1A 2a 3a 4a 5a 6a 7a): the trigger names the open folder as
 * `parent › name`, and opens a NAVIGATOR over the picker's body — one filter,
 * the folders opened last, a breadcrumb, and three views over the tree rebuilt
 * from the paths (`folder-tree.ts`): Columns (the Finder's, a preview at the
 * end), List (a tree that unfolds), Icons (covers). On a phone it is a full
 * sheet whose list goes one level per screen. Only a real Winnow folder opens
 * in the grid; a parent is something you go into.
 */

type WideView = 'columns' | 'list' | 'icons';
type PhoneView = 'stack' | 'icons';

const wideViewPref = localPref<WideView>(
  'atelier.winnow.picker.folders',
  (raw) => (raw === 'list' || raw === 'icons' ? raw : 'columns'),
  (v) => (v === 'columns' ? null : v),
);
const phoneViewPref = localPref<PhoneView>(
  'atelier.winnow.picker.folders.phone',
  (raw) => (raw === 'icons' ? 'icons' : 'stack'),
  (v) => (v === 'stack' ? null : v),
);
const orderPref = localPref<FolderOrder>(
  'atelier.winnow.picker.folders.order',
  (raw) => (raw === 'name' ? 'name' : 'time'),
  (v) => (v === 'time' ? null : v),
);

export default function FolderPicker({
  sessions,
  current,
  onPick,
  openFirst,
  thumb,
  recent,
  rootLabel,
}: {
  sessions: WinnowSession[] | null;
  current: WinnowSession | null;
  onPick: (s: WinnowSession) => void;
  /** Open on arrival when no folder is chosen yet. */
  openFirst: boolean;
  /** A media's thumbnail URL — a folder's covers are its `sample_assets`. */
  thumb: (id: number) => string;
  /** The folders opened last on this instance, newest first. */
  recent: readonly number[];
  /** The breadcrumb's first step: the instance. */
  rootLabel: string;
}) {
  const [open, setOpen] = useState(openFirst);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const phone = useIsCompact();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || trigger.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Claimed, so the picker closes the navigator and not itself.
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Over the picker's body: from under the trigger to the card's foot, the
  // card's width less its padding. Measured, as the card is not our parent.
  const [box, setBox] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || phone) return;
    const place = () => {
      const t = trigger.current?.getBoundingClientRect();
      const card = trigger.current?.closest('[data-picker-card]')?.getBoundingClientRect();
      if (!t || !card) return;
      setBox({
        top: t.bottom + 8,
        left: card.left + 16,
        width: card.width - 32,
        height: Math.max(240, card.bottom - 16 - (t.bottom + 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, phone]);

  const choose = (s: WinnowSession) => {
    onPick(s);
    setOpen(false);
  };

  const parent = current ? parentLabel(current.source_path).split(' › ').pop() : '';
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={current?.source_path}
        className="w-full h-8 flex items-center gap-1.5 px-2.5 rounded-paper border border-line bg-paper text-left text-sm cursor-pointer hover:bg-paper-2"
      >
        <span className="text-muted [&_svg]:w-3.5 [&_svg]:h-3.5">{Icons.folder}</span>
        <span className="flex-1 min-w-0 truncate">
          {current ? (
            <>
              {parent ? <span className="text-muted">{parent} › </span> : null}
              {current.name}
            </>
          ) : (
            'Choose a folder'
          )}
        </span>
        <span className="text-3xs text-faint" aria-hidden="true">
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          phone ? (
            <div
              ref={panel}
              role="dialog"
              aria-label="Pick a folder"
              className="fixed inset-0 z-[60] flex flex-col bg-surface pt-[max(0.75rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]"
            >
              <div className="flex-none flex items-center gap-2 px-3 pb-2 border-b border-line">
                <h3 className="m-0 flex-1 text-base font-medium">Pick a folder</h3>
                <IconButton label="Close" onClick={() => setOpen(false)}>
                  {Icons.close}
                </IconButton>
              </div>
              <Navigator sessions={sessions} current={current} onPick={choose} thumb={thumb} recent={recent} rootLabel={rootLabel} phone />
            </div>
          ) : (
            <div
              ref={panel}
              role="dialog"
              aria-label="Pick a folder"
              style={box ?? { visibility: 'hidden' }}
              className="fixed z-[60] flex flex-col rounded-paper border border-line-strong bg-surface shadow-paper overflow-hidden"
            >
              <Navigator sessions={sessions} current={current} onPick={choose} thumb={thumb} recent={recent} rootLabel={rootLabel} />
            </div>
          ),
          document.body,
        )}
    </div>
  );
}

function Navigator({
  sessions,
  current,
  onPick,
  thumb,
  recent,
  rootLabel,
  phone = false,
}: {
  sessions: WinnowSession[] | null;
  current: WinnowSession | null;
  onPick: (s: WinnowSession) => void;
  thumb: (id: number) => string;
  recent: readonly number[];
  rootLabel: string;
  phone?: boolean;
}) {
  const [wide, setWide] = useLocalPref(wideViewPref, 'columns');
  const [small, setSmall] = useLocalPref(phoneViewPref, 'stack');
  const [order, setOrder] = useLocalPref(orderPref, 'time');
  const view: WideView | PhoneView = phone ? small : wide;
  const tree = useMemo(() => folderTree(sessions ?? []), [sessions]);
  const startChain = useMemo(() => (current ? chainTo(tree, current.id) : null), [tree, current]);

  const [query, setQuery] = useState('');
  // Where Columns, Icons and the phone's list stand: the open folder's parent.
  const [cwd, setCwd] = useState('');
  const [peek, setPeek] = useState<number | null>(current?.id ?? null);
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !sessions) return;
    seeded.current = true;
    if (startChain) {
      setCwd(startChain.length > 1 ? startChain[startChain.length - 2].path : '');
      setUnfolded(new Set(startChain.slice(0, -1).map((n) => n.path)));
    } else if (tree.children[0]) {
      setUnfolded(new Set([tree.children[0].path]));
    }
  }, [sessions, startChain, tree]);

  const trail = useMemo(() => trailTo(tree, cwd) ?? [], [tree, cwd]);
  const here = trail.length ? trail[trail.length - 1] : tree;
  const kids = (n: FolderNode) => orderFolders(n.children, order);
  const byId = useMemo(() => new Map((sessions ?? []).map((s) => [s.id, s])), [sessions]);
  const recents = recent.map((id) => byId.get(id)).filter((s): s is WinnowSession => !!s);
  const hits = useMemo(() => (query.trim() ? matchFolders(sessions ?? [], query) : null), [sessions, query]);

  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!phone) input.current?.focus({ preventScroll: true });
  }, [phone]);
  const colsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = colsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cwd, peek, view]);

  const go = (path: string) => {
    setCwd(path);
    setPeek(null);
  };
  const isOn = (n: FolderNode) => !!n.session && n.session.id === current?.id;

  if (sessions === null) return <p className="m-0 p-4 font-mono text-2xs text-muted">asking…</p>;
  if (sessions.length === 0) return <p className="m-0 p-4 text-xs text-muted">No folder in this half of the library.</p>;

  let body: ReactNode;
  if (hits) {
    body =
      hits.length === 0 ? (
        <p className="m-0 p-4 text-sm text-muted">No folder matches “{query.trim()}”. Words are matched in the path, the device and the days.</p>
      ) : (
        <div className="flex flex-col py-1">
          <p className="m-0 px-3 py-1.5 font-mono text-3xs text-muted">
            {hits.length} folder{hits.length === 1 ? '' : 's'} match{hits.length === 1 ? 'es' : ''}
          </p>
          {hits.map((s) => {
            const chain = chainTo(tree, s.id);
            const leaf = chain ? chain[chain.length - 1] : undefined;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick(s)}
                className={`${ROW} ${phone ? 'min-h-12' : 'min-h-10'} py-1.5 ${s.id === current?.id ? ROW_ON : ''}`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block truncate">
                    <Marked text={s.name} query={query} />
                  </span>
                  <span className="block truncate font-mono text-3xs text-muted">
                    <Marked text={parentLabel(s.source_path)} query={query} />
                    {s.device_hint ? (
                      <>
                        {' · '}
                        <Marked text={s.device_hint} query={query} />
                      </>
                    ) : null}
                  </span>
                </span>
                <Facts node={leaf} hideDays={phone} />
              </button>
            );
          })}
        </div>
      );
  } else if (view === 'list') {
    const rows: ReactNode[] = [];
    const walk = (n: FolderNode, depth: number) => {
      for (const k of kids(n)) {
        const leaf = !!k.session;
        const isOpen = unfolded.has(k.path);
        rows.push(
          <button
            key={k.path}
            type="button"
            aria-expanded={leaf ? undefined : isOpen}
            onClick={() => {
              if (leaf) onPick(k.session!);
              else
                setUnfolded((u) => {
                  const next = new Set(u);
                  if (next.has(k.path)) next.delete(k.path);
                  else next.add(k.path);
                  return next;
                });
            }}
            style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
            className={`${ROW} h-8 ${isOn(k) ? ROW_ON : ''}`}
          >
            <span className="w-3 flex-none text-3xs text-muted text-center" aria-hidden="true">
              {leaf ? '' : isOpen ? '▾' : '▸'}
            </span>
            <Glyph leaf={leaf} />
            <span className="flex-1 min-w-0 truncate">{k.name}</span>
            <span className="flex-none font-mono text-3xs text-faint truncate max-w-[9rem]">
              {leaf ? (k.session!.device_hint ?? '') : folders(k.sessions.length)}
            </span>
            <Facts node={k} />
          </button>,
        );
        if (!leaf && isOpen) walk(k, depth + 1);
      }
    };
    walk(tree, 0);
    body = <div className="flex flex-col py-1">{rows}</div>;
  } else if (view === 'icons') {
    body = (
      <>
        <Crumbs trail={trail} rootLabel={rootLabel} onGo={go} />
        <div className={`grid gap-3 p-3 ${phone ? 'grid-cols-2' : 'grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]'}`}>
          {kids(here).map((k) => {
            const leaf = !!k.session;
            return (
              <button
                key={k.path}
                type="button"
                title={k.path}
                onClick={() => (leaf ? onPick(k.session!) : go(k.path))}
                className={`flex flex-col gap-1.5 p-1.5 rounded-paper border text-left cursor-pointer ${
                  isOn(k) ? 'border-accent bg-accent-wash' : 'border-transparent hover:border-line hover:bg-paper'
                }`}
              >
                <Covers node={k} thumb={thumb} />
                <span className="text-xs font-medium leading-snug line-clamp-2">{k.name}</span>
                <span className="flex items-center gap-1.5 font-mono text-3xs text-muted tabular-nums">
                  <span className="truncate">
                    {k.count.toLocaleString('en-US')} · {leaf ? shortDays(k.from, k.to) : folders(k.sessions.length)}
                  </span>
                  <Ring share={k.sorted} />
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  } else if (view === 'stack') {
    body = (
      <>
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-line text-sm min-h-11">
          {trail.length ? (
            <>
              <button
                type="button"
                onClick={() => go(trail.length > 1 ? trail[trail.length - 2].path : '')}
                className="h-9 px-2 rounded-paper border-0 bg-transparent text-accent-ink font-medium cursor-pointer truncate max-w-[50%]"
              >
                ‹ {trail.length > 1 ? trail[trail.length - 2].name : 'All folders'}
              </button>
              <span className="text-faint">·</span>
              <span className="truncate font-medium px-1">{here.name}</span>
            </>
          ) : (
            <span className="px-2 font-medium">All folders</span>
          )}
        </div>
        <div className="flex flex-col">
          {kids(here).map((k) => {
            const leaf = !!k.session;
            return (
              <button
                key={k.path}
                type="button"
                onClick={() => (leaf ? onPick(k.session!) : go(k.path))}
                className={`${ROW} min-h-12 py-1.5 ${isOn(k) ? ROW_ON : ''}`}
              >
                <Glyph leaf={leaf} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{k.name}</span>
                  <span className="block truncate font-mono text-3xs text-muted">
                    {shortDays(k.from, k.to)} · {leaf ? (k.session!.device_hint ?? '') : folders(k.sessions.length)}
                  </span>
                </span>
                <span className="flex-none font-mono text-2xs text-ink-soft tabular-nums">{k.count.toLocaleString('en-US')}</span>
                {leaf ? <Ring share={k.sorted} /> : <span className="flex-none text-muted [&_svg]:w-4 [&_svg]:h-4">{Icons.chevronRight}</span>}
              </button>
            );
          })}
        </div>
      </>
    );
  } else {
    // Columns: one per level down to where we stand, then the preview.
    const levels = [tree, ...trail];
    const peeked = peek !== null ? chainTo(tree, peek) : null;
    const peekLeaf = peeked && peeked.length >= 1 && peeked[peeked.length - 1];
    const peekParent = peeked ? (peeked.length > 1 ? peeked[peeked.length - 2].path : '') : null;
    const showPeek = peekLeaf && peekParent === here.path ? peekLeaf : null;
    body = (
      <div className="flex flex-col h-full min-h-0">
        <Crumbs trail={trail} rootLabel={rootLabel} onGo={go} />
        <div ref={colsRef} className="flex-1 min-h-0 flex overflow-x-auto">
          {levels.map((level, i) => (
            <div key={level.path || '/'} className="flex-none w-max min-w-[7rem] max-w-[20rem] border-r border-line overflow-y-auto py-1">
              {kids(level).map((k) => {
                const leaf = !!k.session;
                const inTrail = !leaf && trail[i]?.path === k.path;
                const peeking = leaf && k.session!.id === showPeek?.session?.id && i === levels.length - 1;
                return (
                  <button
                    key={k.path}
                    type="button"
                    onClick={() => {
                      if (leaf) {
                        setCwd(level.path);
                        setPeek(k.session!.id);
                      } else go(k.path);
                    }}
                    onDoubleClick={() => leaf && onPick(k.session!)}
                    className={`${ROW} h-8 pr-2 ${inTrail || peeking ? ROW_ON : ''}`}
                  >
                    <Glyph leaf={leaf} />
                    <span className="flex-1 min-w-0 truncate pr-2">{k.name}</span>
                    <span className="flex-none font-mono text-3xs text-ink-soft tabular-nums">{k.count.toLocaleString('en-US')}</span>
                    {leaf ? <Ring share={k.sorted} /> : <span className="flex-none text-muted [&_svg]:w-3 [&_svg]:h-3">{Icons.chevronRight}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="flex-1 min-w-[14rem] p-3 bg-paper flex flex-col gap-2.5 overflow-y-auto">
            {showPeek?.session ? (
              <Preview node={showPeek} thumb={thumb} onOpen={() => onPick(showPeek.session!)} />
            ) : (
              <p className="m-auto font-mono text-2xs text-muted tabular-nums text-center">
                {here.sessions.length} folder{here.sessions.length === 1 ? '' : 's'} · {here.count.toLocaleString('en-US')} media
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-none flex flex-wrap items-center gap-2 p-2.5 border-b border-line">
        <label className="flex-1 min-w-[10rem] h-8 pointer-coarse:h-10 flex items-center gap-1.5 px-2 rounded-paper border border-line-strong bg-paper">
          <span className="text-muted [&_svg]:w-3.5 [&_svg]:h-3.5" aria-hidden="true">
            {Icons.search}
          </span>
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits?.[0]) {
                e.preventDefault();
                onPick(hits[0]);
              } else if (e.key === 'Escape' && query) {
                // The first Escape empties the filter; the next closes.
                e.preventDefault();
                e.nativeEvent.stopImmediatePropagation();
                setQuery('');
              }
            }}
            placeholder="Filter folders: name, month, device…"
            aria-label="Filter folders"
            className="flex-1 min-w-0 border-0 bg-transparent outline-none text-sm"
          />
        </label>
        {phone ? (
          <Segmented
            label="View"
            size="sm"
            value={small}
            onChange={setSmall}
            options={[
              { id: 'stack', label: 'List' },
              { id: 'icons', label: 'Icons' },
            ]}
          />
        ) : (
          <Segmented
            label="View"
            size="sm"
            value={wide}
            onChange={setWide}
            options={[
              { id: 'columns', label: 'Columns' },
              { id: 'list', label: 'List' },
              { id: 'icons', label: 'Icons' },
            ]}
          />
        )}
        <Segmented
          label="Order"
          size="sm"
          value={order}
          onChange={setOrder}
          options={[
            { id: 'time', label: 'Newest', title: 'The newest shot first, as Winnow lists them' },
            { id: 'name', label: 'A–Z' },
          ]}
        />
      </div>
      {!hits && recents.length ? (
        <div className="flex-none flex items-center gap-1.5 px-2.5 py-2 border-b border-line overflow-x-auto">
          <span className="flex-none mr-1 text-3xs uppercase tracking-wider text-muted">Recent</span>
          {recents.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.source_path}
              onClick={() => onPick(s)}
              className={`flex-none flex items-center gap-1.5 max-w-[14rem] h-7 pointer-coarse:h-9 pl-0.5 pr-2.5 rounded-full border text-xs cursor-pointer ${
                s.id === current?.id ? 'border-accent bg-accent-wash' : 'border-line bg-paper hover:border-line-strong'
              }`}
            >
              <Thumb id={s.sample_assets?.[0]?.id} thumb={thumb} className="w-6 h-6 pointer-coarse:w-8 pointer-coarse:h-8 rounded-full" />
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{body}</div>
    </div>
  );
}

const ROW =
  'w-full flex items-center gap-2 px-3 border-0 bg-transparent text-left text-sm cursor-pointer hover:bg-paper-2';
const ROW_ON = 'bg-accent-wash shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-accent-wash';

function Crumbs({ trail, rootLabel, onGo }: { trail: FolderNode[]; rootLabel: string; onGo: (path: string) => void }) {
  return (
    <nav aria-label="Where you are" className="flex-none flex items-center gap-0.5 px-2 py-1 border-b border-line text-xs overflow-x-auto whitespace-nowrap">
      {[{ name: rootLabel, path: '' }, ...trail].map((n, i, all) => (
        <span key={n.path || '/'} className="flex items-center gap-0.5">
          {i > 0 ? <span className="text-faint">›</span> : null}
          <button
            type="button"
            onClick={() => onGo(n.path)}
            aria-current={i === all.length - 1 ? 'location' : undefined}
            className={`h-7 px-1.5 rounded-[4px] border-0 bg-transparent cursor-pointer hover:bg-paper-2 ${
              i === all.length - 1 ? 'text-ink font-medium' : 'text-ink-soft'
            }`}
          >
            {n.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

function Facts({ node, hideDays = false }: { node: FolderNode | undefined; hideDays?: boolean }) {
  if (!node) return null;
  return (
    <>
      {hideDays ? null : (
        <span className="flex-none font-mono text-3xs text-muted tabular-nums whitespace-nowrap">{shortDays(node.from, node.to)}</span>
      )}
      <span className="flex-none w-12 text-right font-mono text-3xs text-ink-soft tabular-nums">{node.count.toLocaleString('en-US')}</span>
      <Ring share={node.sorted} />
    </>
  );
}

/** How much of a folder is sorted in Winnow, as a little pie (his pick 7a). */
function Ring({ share }: { share: number | null }) {
  if (share === null) return <span className="flex-none w-3" aria-hidden="true" />;
  const pct = Math.round(share * 100);
  return (
    <span
      role="img"
      aria-label={`${pct}% sorted in Winnow`}
      title={`${pct}% sorted in Winnow`}
      className="flex-none w-3 h-3 rounded-full"
      style={{ background: `conic-gradient(var(--color-ink-soft) ${share * 360}deg, var(--color-line) 0)` }}
    />
  );
}

function Glyph({ leaf }: { leaf: boolean }) {
  return (
    <span className={`flex-none [&_svg]:w-3.5 [&_svg]:h-3.5 ${leaf ? 'text-faint' : 'text-muted'}`} aria-hidden="true">
      {leaf ? Icons.image : Icons.folder}
    </span>
  );
}

function Thumb({ id, thumb, className = '' }: { id: number | undefined; thumb: (id: number) => string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (id === undefined || failed) return <span className={`block flex-none bg-paper-2 ${className}`} aria-hidden="true" />;
  return <img src={thumb(id)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className={`block flex-none object-cover bg-paper-2 ${className}`} />;
}

/** A leaf: its first picture. A parent: one picture from each of its four newest folders. */
function Covers({ node, thumb }: { node: FolderNode; thumb: (id: number) => string }) {
  if (node.session) {
    return (
      <span className="block aspect-[4/3] rounded-[4px] overflow-hidden">
        <Thumb id={node.session.sample_assets?.[0]?.id} thumb={thumb} className="w-full h-full" />
      </span>
    );
  }
  const four = node.sessions.slice(0, 4);
  return (
    <span className="relative grid grid-cols-2 grid-rows-2 gap-0.5 aspect-[4/3] rounded-[4px] overflow-hidden bg-line">
      {[0, 1, 2, 3].map((i) => (
        <Thumb key={i} id={four[i]?.sample_assets?.[0]?.id} thumb={thumb} className="w-full h-full" />
      ))}
      <span className="absolute left-0 top-0 w-[38%] h-[10%] rounded-br-[4px] bg-surface/85" aria-hidden="true" />
    </span>
  );
}

function Preview({ node, thumb, onOpen }: { node: FolderNode; thumb: (id: number) => string; onOpen: () => void }) {
  const s = node.session!;
  const pct = node.sorted === null ? null : Math.round(node.sorted * 100);
  const samples = s.sample_assets ?? [];
  return (
    <>
      {samples.length ? (
        <div className="grid grid-cols-4 gap-1">
          {samples.slice(0, 8).map((a) => (
            <Thumb key={a.id} id={a.id} thumb={thumb} className="w-full aspect-[4/3] rounded-[3px]" />
          ))}
        </div>
      ) : null}
      <b className="text-sm font-medium leading-snug break-words">{s.name}</b>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">Days</dt>
        <dd className="m-0 font-mono text-2xs">{shortDays(node.from, node.to)}</dd>
        <dt className="text-muted">Media</dt>
        <dd className="m-0 font-mono text-2xs tabular-nums">{s.asset_count.toLocaleString('en-US')}</dd>
        {s.device_hint ? (
          <>
            <dt className="text-muted">Device</dt>
            <dd className="m-0 font-mono text-2xs">{s.device_hint}</dd>
          </>
        ) : null}
        {pct !== null ? (
          <>
            <dt className="text-muted">Sorted</dt>
            <dd className="m-0 font-mono text-2xs tabular-nums">{pct}%</dd>
          </>
        ) : null}
      </dl>
      {pct !== null ? (
        <span className="block h-1.5 rounded-sm bg-line overflow-hidden" aria-hidden="true">
          <span className="block h-full bg-ink-soft" style={{ width: `${pct}%` }} />
        </span>
      ) : null}
      <span className="flex-1" />
      <button
        type="button"
        onClick={onOpen}
        className="h-9 px-3.5 rounded-paper border border-ink bg-ink text-paper text-sm font-medium cursor-pointer hover:opacity-90"
      >
        Open this folder
      </button>
    </>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query);
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <mark key={a} className="bg-transparent text-accent-ink font-semibold underline underline-offset-2 decoration-1">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

const folders = (n: number) => `${n} folder${n === 1 ? '' : 's'}`;
