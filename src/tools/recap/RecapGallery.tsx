import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '../../shared/media/save';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { RECIPES, TEMPLATES, cleanRecapTitle, createRecapDoc, withRecap, type RecapDoc, type RecapTemplate } from '../../shared/recap/recap-doc';
import { monthName, shortDate } from '../../shared/recap/recap-days';
import { RECAP_FILE_ACCEPT, RECAP_FILE_EXTENSION, backupFileName, parseRecapFile, recapFileName, serializeRecapFile, toRecapFile } from '../../shared/recap/recap-file';
import type { RecapSummary } from '../../shared/recap/recap-summary';
import { todayIso } from '../../shared/roadtrip/trip-days';
import { pickFile } from '../../shared/sources/file-sources';
import { DEFAULT_SOURCE_ID, sourceById, type SourceInfo } from '../../shared/sources/source';
import { sourceLabel } from '../../shared/sources/document-gallery';
import { uniqueDocName } from '../../shared/sources/doc-name';
import AbsentSourceNotes from '../../shared/sources/AbsentSourceNotes';
import { useDocumentGallery } from '../../shared/sources/use-document-gallery';
import Button from '../../shared/ui/Button';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import ImportDocumentModal from '../../shared/ui/ImportDocumentModal';
import LoadingState from '../../shared/ui/LoadingState';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import { focusOnMount } from '../../shared/ui/focus';
import { Icons } from '../../shared/ui/icons';
import { pageScroll } from '../../shared/ui/page-scroll';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useSurface } from '../../shared/ui/use-surface';
import NewRecapDialog, { type NewRecapChoice } from './NewRecapDialog';
import TemplatePreview from './TemplatePreview';
import { RECAP_DOC_KIND, deleteRemoteRecap, fetchRemoteRecap, listRemoteRecaps, mirrorRecap, moveRecap, pushRecap, type RemoteRecapRow } from './recap-remote';
import { askPersistence, deleteRecap, deleteSyncRecord, getSyncRecord, getThumb, listRecaps, mediaStorage, putRecap } from './recap-store';

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1_048_576).toFixed(n < 10 * 1_048_576 ? 1 : 0)} MB`;
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

/** "October 2026", "4 Nov 2026", "Week of 26 Oct 2026" — what a recap is about, on its card. */
export function aboutLine(doc: RecapDoc): string {
  if (doc.template === 'month') return `${monthName(doc.anchor)} ${doc.anchor.slice(0, 4)}`;
  if (doc.template === 'week') return `Week of ${shortDate(doc.anchor)}`;
  if (doc.template === 'onThisDay') return shortDate(doc.anchor);
  return doc.range ? `${shortDate(doc.range.from)} → ${shortDate(doc.range.to)}` : 'every picture';
}

function RecapCover({ doc }: { doc: RecapDoc }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let alive = true;
    void getThumb(doc.id).then((b) => alive && setBlob(b));
    return () => {
      alive = false;
    };
  }, [doc.id, doc.updatedAt]);
  const url = useObjectUrl(blob);
  return (
    <div className="w-full aspect-[4/5] flex items-center justify-center bg-frame overflow-hidden">
      {url ? <img src={url} alt="" className="block h-full w-auto object-contain" /> : <TemplatePreview template={doc.template} anchor={doc.anchor} height={180} />}
    </div>
  );
}

function RecapCard({
  doc,
  isOpen,
  remoteOnly = false,
  summary,
  moveTargets = [],
  busy,
  onOpen,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
  onMove,
}: {
  doc: RecapDoc;
  isOpen: boolean;
  remoteOnly?: boolean;
  summary?: RecapSummary;
  moveTargets?: readonly SourceInfo[];
  busy: string | null;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMove?: (to: string) => void;
}) {
  const compact = useIsCompact();
  const [confirming, setConfirming] = useState<{ kind: 'delete' } | { kind: 'rename' } | { kind: 'move'; to: SourceInfo } | null>(null);
  const [draft, setDraft] = useState(doc.title);
  const pictures = summary?.pictures ?? doc.pictures.length;
  const items: OverflowItem[] = [
    { id: 'open', label: isOpen ? 'Resume' : remoteOnly ? 'Open here' : 'Open', onSelect: onOpen },
    ...(!remoteOnly
      ? [
          { id: 'rename', label: 'Rename…', onSelect: () => (setDraft(doc.title), setConfirming({ kind: 'rename' })) },
          {
            id: 'next',
            label: doc.template === 'month' ? 'Same, next month' : doc.template === 'week' ? 'Same, next week' : 'Duplicate',
            title: 'The same layout and settings, its own pictures — a recap a month, in two clicks',
            onSelect: onDuplicate,
          },
          { id: 'export', label: `Export ${RECAP_FILE_EXTENSION}`, title: 'The recap on disk — a backup, and how it reaches another machine', onSelect: onExport },
          ...moveTargets.map((target) => ({
            id: `move:${target.id}`,
            label: target.id === DEFAULT_SOURCE_ID ? 'Keep on this device only…' : `Keep on ${sourceLabel(target.id)}…`,
            onSelect: () => setConfirming({ kind: 'move', to: target }),
          })),
        ]
      : []),
    { id: 'delete', label: 'Delete…', danger: true, onSelect: () => setConfirming({ kind: 'delete' }) },
  ];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${doc.title}`}
      data-doc-id={doc.id}
      aria-disabled={busy !== null}
      onClick={(e) => {
        if (busy !== null) return;
        if ((e.target as HTMLElement).closest('button, select, input, a, [role="menu"], [role="alertdialog"]')) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          if (busy === null) onOpen();
        }
      }}
      className={`group relative flex flex-col bg-surface border rounded-paper-lg shadow-paper-soft cursor-pointer transition-[box-shadow,border-color] duration-300 ease-paper hover:shadow-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        isOpen ? 'border-accent' : 'border-line hover:border-line-strong'
      } ${remoteOnly ? 'opacity-75' : ''}`}
    >
      <div className="rounded-t-paper-lg overflow-hidden leading-[0]">
        <RecapCover doc={doc} />
      </div>
      <div className={`flex flex-col ${compact ? 'gap-1 p-2.5' : 'gap-1.5 p-[0.8rem_1rem_0.9rem]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={`m-0 flex-1 min-w-0 font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${compact ? 'text-sm' : 'text-base'}`} title={doc.title}>
            {doc.title}
          </h3>
          {isOpen && <span className="flex-none font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] bg-accent-wash text-accent-ink">open</span>}
          {busy === null && <OverflowMenu label={`More actions for ${doc.title}`} items={items} className="-mr-1.5" />}
        </div>
        <p className={`m-0 text-ink-soft ${compact ? 'text-2xs' : 'text-xs'}`}>
          {RECIPES[doc.template].label} · {aboutLine(doc)}
        </p>
        <p className={`m-0 font-mono tabular-nums text-muted ${compact ? 'text-3xs' : 'text-2xs'}`}>{pictures ? `${pictures.toLocaleString()} picture${pictures === 1 ? '' : 's'}` : 'no pictures yet'}</p>
        {remoteOnly && <p className="m-0 font-mono text-2xs text-faint">on {sourceLabel(doc.sourceId)} · not yet on this device</p>}
        {busy && (
          <p className="m-0 font-mono text-2xs text-muted" role="status">
            {busy}
          </p>
        )}
      </div>
      {confirming?.kind === 'delete' && (
        <ConfirmDialog title={`Delete “${doc.title}”?`} confirmLabel="Delete" danger onCancel={() => setConfirming(null)} onConfirm={() => (setConfirming(null), onDelete())}>
          <p>
            Its choices and settings go with it{doc.sourceId === DEFAULT_SOURCE_ID ? '' : `, here and on ${sourceLabel(doc.sourceId)}`}. The copies of pictures no other recap uses are forgotten by this device; your
            pictures themselves stay where they are.
          </p>
        </ConfirmDialog>
      )}
      {confirming?.kind === 'rename' && (
        <ConfirmDialog
          title="Rename the recap"
          confirmLabel="Rename"
          cancelLabel="Cancel"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const clean = cleanRecapTitle(draft);
            setConfirming(null);
            if (clean && clean !== doc.title) onRename(clean);
          }}
        >
          <input
            aria-label="Title"
            value={draft}
            ref={(el) => {
              if (el) requestAnimationFrame(() => focusOnMount(el));
            }}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full h-10 px-3 rounded-control border border-line-strong bg-paper text-ink text-base focus:outline-none focus:border-accent"
          />
        </ConfirmDialog>
      )}
      {confirming?.kind === 'move' && (
        <ConfirmDialog
          title={confirming.to.id === DEFAULT_SOURCE_ID ? `Keep “${doc.title}” on this device only?` : `Keep “${doc.title}” on ${sourceLabel(confirming.to.id)}?`}
          confirmLabel="Move"
          cancelLabel="Cancel"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const to = confirming.to.id;
            setConfirming(null);
            onMove?.(to);
          }}
        >
          <p>
            {confirming.to.id === DEFAULT_SOURCE_ID
              ? 'It will be kept in this browser alone, and taken off the instance.'
              : 'It will reopen from any device connected to that instance, every choice included; another device fetches its Winnow pictures again and asks for its local files and sound.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** One template of the catalogue: its card plays what it does while hovered or focused. */
function TemplateCard({ template, onPick }: { template: RecapTemplate; onPick: () => void }) {
  const [live, setLive] = useState(false);
  const compact = useIsCompact();
  const recipe = RECIPES[template];
  const anchor = todayIso();
  return (
    <button
      type="button"
      onClick={onPick}
      onPointerEnter={() => setLive(true)}
      onPointerLeave={() => setLive(false)}
      onFocus={() => setLive(true)}
      onBlur={() => setLive(false)}
      className="group flex flex-col text-left bg-surface border border-line rounded-paper-lg overflow-hidden shadow-paper-soft hover:border-line-strong hover:shadow-paper transition-[box-shadow,border-color] duration-300 ease-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className={`flex items-center justify-center bg-paper-2 ${compact ? 'h-[150px]' : 'h-[190px]'}`}>
        <TemplatePreview template={template} anchor={anchor} height={compact ? 130 : 168} playing={live} />
      </span>
      <span className="flex flex-col gap-0.5 p-[0.7rem_0.9rem_0.8rem]">
        <span className="text-sm font-semibold">{recipe.label}</span>
        <span className="text-xs text-ink-soft">{recipe.rule}</span>
      </span>
    </button>
  );
}

/**
 * The Recap instrument's front door: the CATALOGUE of templates first — each
 * card the real painter playing its entrance on hover — then the recaps this
 * device keeps (and an instance, when one keeps recaps), over the plumbing
 * every gallery shares (`use-document-gallery.ts`). A click on a template asks
 * what it is about (a month, a week, a day, a period) and opens it.
 */
export default function RecapGallery({ openRecapId, onOpen }: { openRecapId: string | null; onOpen: (doc: RecapDoc) => void }) {
  useSurface('darkroom');
  const compact = useIsCompact();
  const [importing, setImporting] = useState(false);
  const [asking, setAsking] = useState<RecapTemplate | null>(null);
  const [storage, setStorage] = useState<{ prints: number; clips: number; bytes: number } | null>(null);
  const gallery = useDocumentGallery<RecapDoc, RemoteRecapRow>({
    kind: RECAP_DOC_KIND,
    noun: 'recap',
    listLocal: listRecaps,
    listRemote: listRemoteRecaps,
    putDoc: putRecap,
    pushNew: (remote, doc) => pushRecap(remote, doc, null),
    getRecord: getSyncRecord,
    deleteRecord: deleteSyncRecord,
    deleteRemote: deleteRemoteRecap,
    deleteLocal: deleteRecap,
    mirror: mirrorRecap,
    fetchRemote: fetchRemoteRecap,
    move: moveRecap,
  });
  const { docs: recaps, documentSources, refresh, groups, absent, busy, notice, setNotice, createOn } = gallery;
  const listedCount = groups.reduce((n, g) => n + g.items.length + g.remoteOnly.length, 0);
  useEffect(() => {
    void mediaStorage().then(setStorage);
  }, [recaps]);

  const namesIn = useCallback(
    (sourceId: string): string[] => {
      const group = groups.find((g) => g.id === sourceId);
      return group ? [...group.items, ...group.remoteOnly.map((r) => r.doc)].map((m) => m.title) : [];
    },
    [groups],
  );

  const create = useCallback(
    async (choice: NewRecapChoice) => {
      setAsking(null);
      setNotice(null);
      let doc = createRecapDoc(choice.template, choice.sourceId, { anchor: choice.anchor });
      if (choice.range) doc = withRecap(doc, { range: choice.range });
      const base = choice.template === 'month' ? `${monthName(doc.anchor)} ${doc.anchor.slice(0, 4)}` : `${RECIPES[choice.template].label} · ${aboutLine(doc)}`;
      doc = { ...doc, title: uniqueDocName(base, namesIn(choice.sourceId)) };
      if (await createOn(doc, 'created')) onOpen(doc);
    },
    [setNotice, namesIn, createOn, onOpen],
  );

  /** The same recap moved on: next month, next week, or a plain copy. */
  const duplicate = useCallback(
    async (doc: RecapDoc) => {
      const anchor = doc.template === 'month' ? shiftAnchor(doc.anchor, 'month') : doc.template === 'week' ? shiftAnchor(doc.anchor, 'week') : doc.anchor;
      const fresh = createRecapDoc(doc.template, DEFAULT_SOURCE_ID, { anchor });
      const copy: RecapDoc = {
        ...structuredClone(doc),
        id: fresh.id,
        sourceId: DEFAULT_SOURCE_ID,
        anchor,
        picks: anchor === doc.anchor ? doc.picks : {},
        cleared: anchor === doc.anchor ? doc.cleared : [],
        captions: anchor === doc.anchor ? doc.captions : {},
        createdAt: fresh.createdAt,
        updatedAt: fresh.updatedAt,
      };
      const title = doc.template === 'month' ? `${monthName(anchor)} ${anchor.slice(0, 4)}` : doc.template === 'week' ? `${RECIPES.week.label} · ${aboutLine(copy)}` : `${doc.title} copy`;
      copy.title = uniqueDocName(title, namesIn(DEFAULT_SOURCE_ID));
      if (await createOn(copy, 'created')) onOpen(copy);
    },
    [createOn, namesIn, onOpen],
  );

  const handleImportRef = useRef<(sourceId: string) => Promise<void>>(async () => {});
  const startImport = useCallback(() => {
    if (documentSources.length > 1) setImporting(true);
    else void handleImportRef.current(DEFAULT_SOURCE_ID);
  }, [documentSources.length]);

  usePublishSectionBar(
    useMemo(
      () =>
        compact
          ? { sections: [{ id: 'import', label: 'Import' }], active: null, label: 'Recaps', role: 'actions' as const, onSelect: () => startImport() }
          : null,
      [compact, startImport],
    ),
  );

  async function importFromFile(picked: File, targetSourceId: string) {
    setNotice(null);
    const sourceId = documentSources.some((s) => s.id === targetSourceId) ? targetSourceId : DEFAULT_SOURCE_ID;
    const parsed = parseRecapFile(await picked.text(), sourceId);
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    let made = 0;
    for (const doc of parsed.recaps) if (await createOn(doc, 'imported')) made += 1;
    setNotice(made ? `${made} recap${made === 1 ? '' : 's'} imported.` : 'Nothing was imported.');
    refresh();
  }
  handleImportRef.current = async (target: string) => {
    const picked = await pickFile(RECAP_FILE_ACCEPT);
    if (picked) await importFromFile(picked, target);
  };

  async function handleRename(doc: RecapDoc, title: string) {
    if (doc.sourceId !== DEFAULT_SOURCE_ID) {
      onOpen(doc);
      return;
    }
    if (!(await putRecap({ ...doc, title, updatedAt: Date.now() }))) setNotice('This browser refused to store the new title.');
    refresh();
  }

  const exportOne = (doc: RecapDoc) => downloadBlob(new Blob([serializeRecapFile(toRecapFile([doc]))], { type: 'application/json' }), recapFileName(doc.title));
  const backup = async () => downloadBlob(new Blob([serializeRecapFile(toRecapFile(await listRecaps()))], { type: 'application/json' }), backupFileName());

  return (
    <section className={`${pageScroll} ${compact ? 'pt-3' : ''}`} aria-label="Recaps">
      <h1 className="sr-only">Recaps</h1>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-serif text-2xl leading-none" aria-hidden="true">
          New recap
        </span>
        <span className="text-sm text-muted">Pick a template — each card plays what it does.</span>
        <span className="flex-1" />
        {!compact && (
          <Button onClick={startImport} icon={Icons.import} title={`Import recaps from a ${RECAP_FILE_EXTENSION} file`}>
            Import
          </Button>
        )}
      </div>
      <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4'}>
        {TEMPLATES.map((t) => (
          <TemplateCard key={t} template={t} onPick={() => setAsking(t)} />
        ))}
      </div>

      {notice && (
        <p className="m-0 text-xs text-ink-soft" role="status">
          {notice}
        </p>
      )}
      <AbsentSourceNotes absent={absent} />

      {recaps === null ? (
        <LoadingState label="Loading recaps…" />
      ) : (
        <div className="flex flex-col gap-6 pb-4 pt-2">
          {groups.map(({ id, items, list, remoteOnly }) => {
            const source = sourceById(id);
            const count = items.length + remoteOnly.length;
            const moveTargets = documentSources.filter((s) => s.id !== id);
            if (!count && id === DEFAULT_SOURCE_ID && listedCount === 0) return null;
            return (
              <section key={id} aria-label={`Recaps on ${source?.label ?? id}`}>
                <p className="m-0 mb-3 font-mono text-2xs tracking-[0.14em] uppercase text-muted">
                  {id === DEFAULT_SOURCE_ID ? 'your recaps · on this device' : `on ${source?.label ?? id}`}
                  <span className="text-faint"> · </span>
                  <span className="tabular-nums">{count}</span>
                  {!source && <span className="text-faint"> · not connected</span>}
                  {list?.status === 'loading' && <span className="text-faint"> · checking…</span>}
                  {list?.status === 'failed' && <span className="text-faint normal-case tracking-normal"> · {list.text}</span>}
                </p>
                {count === 0 ? (
                  <p className="m-0 text-xs text-faint">Nothing kept here yet — a recap’s ⋯ keeps it here.</p>
                ) : (
                  <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5'}>
                    {items.map((doc) => (
                      <RecapCard
                        key={doc.id}
                        doc={doc}
                        isOpen={doc.id === openRecapId}
                        moveTargets={moveTargets}
                        busy={busy[doc.id] ?? null}
                        onOpen={() => onOpen(doc)}
                        onRename={(title) => void handleRename(doc, title)}
                        onDuplicate={() => void duplicate(doc)}
                        onExport={() => exportOne(doc)}
                        onDelete={() => void gallery.remove(doc, null)}
                        onMove={(to) => void gallery.moveTo(doc, to)}
                      />
                    ))}
                    {remoteOnly.map((row) => (
                      <RecapCard
                        key={row.doc.id}
                        doc={row.doc}
                        isOpen={false}
                        remoteOnly
                        summary={row.summary}
                        busy={busy[row.doc.id] ?? null}
                        onOpen={() => void gallery.mirrorRemote(row).then((doc) => doc && onOpen(doc))}
                        onRename={() => undefined}
                        onDuplicate={() => undefined}
                        onExport={() => undefined}
                        onDelete={() => void gallery.remove(row.doc, row.etag)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border border-line rounded-paper bg-surface text-xs text-muted">
            <span className="min-w-0">
              Kept on this device{storage && storage.prints + storage.clips > 0 ? ` · ${storage.prints} picture${storage.prints === 1 ? '' : 's'}, ${storage.clips} clip${storage.clips === 1 ? '' : 's'}, ${formatBytes(storage.bytes)}` : ''}
            </span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => void askPersistence()} title="Ask the browser not to clear this site's data on its own">
              Keep it durable
            </Button>
            <Button size="sm" variant="ghost" icon={Icons.download} onClick={() => void backup()} title="Every recap in one file — the copy that survives a cleared browser">
              Back up everything
            </Button>
          </div>
        </div>
      )}

      {asking && <NewRecapDialog template={asking} sources={documentSources} onCancel={() => setAsking(null)} onCreate={(c) => void create(c)} />}
      {importing && (
        <ImportDocumentModal
          title="Import a recap file"
          blurb={`Makes new recaps from a ${RECAP_FILE_EXTENSION} file — it never overwrites one you already have.`}
          sources={documentSources}
          onCancel={() => setImporting(false)}
          onChooseFile={(target) => {
            setImporting(false);
            void handleImportRef.current(target);
          }}
        />
      )}
    </section>
  );
}

/** The next month's 1st, or the next week's first day. */
function shiftAnchor(anchor: string, by: 'month' | 'week'): string {
  if (by === 'week') {
    const ms = Date.parse(`${anchor}T00:00:00Z`) + 7 * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7));
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}
