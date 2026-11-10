/**
 * One opener's own settings, as its host shows them: the variant's panel read
 * as numbered CHAPTERS (`opener-chapters.ts`) — an index, then one chapter at
 * a time, the one last open on this device, «All» a tap away — or the panel
 * whole for a variant with no chapters.
 *
 * Lifted out of Trips' picker (2026-11-10) so another instrument that plays
 * an opener (Recap's Opener section) mounts the SAME panel rather than a copy
 * of it: the host chooses the variant and hands the things a panel may not do
 * itself (`HookPanelHost`); everything under the choice is drawn here.
 */

import { useMemo, useState } from 'react';
import { ChapterFoot, ChapterHead, ChapterIndex, type ChapterRow } from '../../ui/Chapters';
import { ChapterScope } from './panel-ui';
import { chapterChanged, chapterSummary, numbered, resetChapter, searchChapters } from './opener-chapters';
import { useOpenerChapter } from './opener-chapter-pref';
import type { HookContext, HookOptions, HookPanelHost, HookVariant } from './hook-variant';

interface OpenerPanelProps {
  variant: HookVariant;
  /** What the variant was given — its defaults are merged under it here, never by the caller. */
  options: HookOptions | undefined;
  /** What the variant was prepared against — also what a row reads to say a real value. */
  ctx: HookContext;
  host?: HookPanelHost;
  onChange: (options: HookOptions) => void;
}

export default function OpenerPanel({ variant, options, ctx, host, onChange }: OpenerPanelProps) {
  const Panel = variant.Panel;
  // A host re-renders on every frame of its transport's clock. A variant's
  // panel computes the whole road (Virée: the route, the plan, the vehicles,
  // the coast) when it renders, so it must render when what it SHOWS changes
  // and never per frame — the element is memoised on its options, its context
  // and its host, which the caller keeps stable.
  const panel = useMemo(
    () => (Panel ? <Panel options={options ?? {}} ctx={ctx} host={host} onChange={onChange} /> : null),
    [Panel, options, ctx, host, onChange],
  );

  const [openId, setOpenId] = useOpenerChapter(variant.id);
  const chapters = variant.chapters;
  const rows = useMemo<ChapterRow[]>(() => {
    if (!chapters) return [];
    const read = { ...variant.defaults, ...(options ?? {}) };
    return numbered(chapters).map(({ n, chapter }) => ({
      id: chapter.id,
      n,
      title: chapter.title,
      summary: chapterSummary(chapter, read),
      changed: chapterChanged(chapter, options ?? {}, variant.defaults),
      unmet: chapter.unmet?.(options ?? {}, ctx) ?? null,
    }));
  }, [variant, chapters, options, ctx]);
  // A search over the chapters' rows: «colour» or «ahead» names the chapter it
  // lives in, with the words that matched. Only where there are enough
  // chapters for searching to beat reading them.
  const [query, setQuery] = useState('');
  const searchable = rows.length >= 5;
  const found = useMemo<ChapterRow[] | null>(() => {
    if (!searchable || !chapters || !query.trim()) return null;
    const byId = new Map(rows.map((row) => [row.id, row]));
    return searchChapters(chapters, query).flatMap((hit) => {
      const row = byId.get(hit.chapter.id);
      return row ? [{ ...row, matched: hit.words }] : [];
    });
  }, [searchable, chapters, query, rows]);
  const openIndex = rows.findIndex((row) => row.id === openId);
  const openRow = openIndex >= 0 ? rows[openIndex] : null;
  const scope = useMemo(() => ({ open: openRow?.id ?? null, title: openRow?.title }), [openRow?.id, openRow?.title]);
  const resetOpen = () => {
    const chapter = chapters?.find((c) => c.id === openRow?.id);
    if (chapter) onChange(resetChapter(chapter, options ?? {}, variant.defaults));
  };

  if (!chapters || !rows.length) return panel;
  return (
    <div className="flex flex-col gap-3">
      {openRow && <ChapterHead row={openRow} of={rows.length} onBack={() => setOpenId(null)} onReset={resetOpen} />}
      <ChapterScope.Provider value={scope}>{panel}</ChapterScope.Provider>
      {openRow ? (
        <ChapterFoot prev={rows[openIndex - 1] ?? null} next={rows[openIndex + 1] ?? null} onOpen={setOpenId} />
      ) : (
        <>
          {searchable && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${variant.name}’s settings…`}
              aria-label={`Search ${variant.name}’s settings`}
              className="w-full font-sans h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-sm text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          )}
          {found && !found.length ? (
            <p className="m-0 text-xs text-muted">Nothing called «{query.trim()}» — try colour, speed, names, camera.</p>
          ) : (
            <ChapterIndex rows={found ?? rows} onOpen={setOpenId} label={`${variant.name} settings`} />
          )}
        </>
      )}
    </div>
  );
}
