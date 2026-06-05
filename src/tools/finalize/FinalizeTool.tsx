import { useMemo, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import { formatBytes } from '../../shared/lib/format';
import {
  EXPORT_BUCKETS,
  exportSummary,
  includesAsset,
  matchesBucket,
  planExport,
  type ExportBucket,
} from './export-plan';
import { canExport, pickDirectory, writeItems, type WriteResult } from './write-files';
import Thumb from './Thumb';

const bucketLabel = (b: ExportBucket): string =>
  b === 'pick' ? '✓ Picks' : `★${b}`;

type Status =
  | { kind: 'idle' }
  | { kind: 'writing'; done: number; total: number; name: string }
  | { kind: 'done'; result: WriteResult }
  | { kind: 'error'; message: string };

/**
 * Finalize — the last step of the pipeline. Copy the keepers (by an adjustable
 * threshold) out of the in-browser library into a real album folder the user
 * picks, via the File System Access API. Flat, original names, nothing leaves
 * the machine.
 */
export default function FinalizeTool() {
  const lib = useAssetLibrary();
  // Several buckets can be ticked at once; export is their union.
  const [selection, setSelection] = useState<Set<ExportBucket>>(
    () => new Set<ExportBucket>(['pick', 4, 5]),
  );
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const supported = canExport();

  const toggleBucket = (b: ExportBucket) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  const workingSet = useMemo(
    () => selectedUsableAssets(['photo', 'video'], lib.assets, lib.selection),
    [lib.assets, lib.selection],
  );

  const counts = useMemo(() => {
    const c = new Map<ExportBucket, number>(EXPORT_BUCKETS.map((b) => [b, 0]));
    for (const a of workingSet) {
      const v = lib.verdicts.get(a.id);
      for (const b of EXPORT_BUCKETS) {
        if (matchesBucket(v, b)) c.set(b, (c.get(b) ?? 0) + 1);
      }
    }
    return c;
  }, [workingSet, lib.verdicts]);

  const included = useMemo(
    () => workingSet.filter((a) => includesAsset(lib.verdicts.get(a.id), selection)),
    [workingSet, lib.verdicts, selection],
  );
  const items = useMemo(
    () => planExport(workingSet, lib.verdicts, selection),
    [workingSet, lib.verdicts, selection],
  );
  const summary = useMemo(() => exportSummary(items), [items]);

  const writing = status.kind === 'writing';

  async function handleExport() {
    if (items.length === 0) return;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await pickDirectory();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // cancelled
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    setStatus({ kind: 'writing', done: 0, total: items.length, name: '' });
    try {
      const result = await writeItems(dir, items, (done, total, name) =>
        setStatus({ kind: 'writing', done, total, name }),
      );
      setStatus({ kind: 'done', result });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-3" aria-label="Finalize">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-wrap items-center gap-1.5">
          {EXPORT_BUCKETS.map((b) => {
            const active = selection.has(b);
            return (
              <button
                key={String(b)}
                type="button"
                disabled={writing}
                onClick={() => toggleBucket(b)}
                aria-pressed={active}
                className={`text-[0.76rem] font-semibold px-[0.7rem] py-[0.3rem] rounded-full border transition-[border-color,color,background-color] duration-200 ease-paper disabled:opacity-50 ${
                  active
                    ? 'bg-ink text-paper border-ink'
                    : 'bg-paper text-ink-soft border-line-strong hover:border-accent hover:text-accent-ink'
                }`}
              >
                {bucketLabel(b)}
                <span className={active ? 'text-paper/60' : 'text-faint'}>
                  {' '}
                  {counts.get(b) ?? 0}
                </span>
              </button>
            );
          })}
        </div>
        <p className="font-mono text-[0.72rem] text-muted tracking-[0.04em] m-0">
          {workingSet.length === 0
            ? 'nothing selected'
            : `${summary.assets} assets · ${summary.files} files · ${formatBytes(summary.bytes)}`}
        </p>
      </div>

      {/* preview of what will be exported */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-paper border border-line bg-surface p-2">
        {workingSet.length === 0 ? (
          <p className="text-muted font-mono text-[0.8rem] text-center p-6 m-0">
            Select photos or videos in the Library, then cull them to pick the keepers.
          </p>
        ) : included.length === 0 ? (
          <p className="text-muted font-mono text-[0.8rem] text-center p-6 m-0">
            Nothing ticked matches — pick the ratings/picks to export above, or cull more in Cull.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1.5 content-start">
            {included.map((a) => (
              <Thumb
                key={a.id}
                asset={a}
                meta={lib.meta.get(a.id)}
                onEnsure={() => lib.ensureMeta(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* export bar */}
      <div className="flex-none flex items-center gap-4 flex-wrap">
        <button
          type="button"
          onClick={handleExport}
          disabled={!supported || writing || items.length === 0}
          className="text-[0.85rem] font-semibold px-4 py-2 rounded-full bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
        >
          {writing ? 'Exporting…' : 'Choose folder & export →'}
        </button>

        {!supported && (
          <span className="font-mono text-[0.72rem] text-accent-ink">
            Folder export needs a Chromium browser (Chrome / Edge).
          </span>
        )}

        {status.kind === 'writing' && (
          <span className="flex-1 min-w-[160px] flex items-center gap-2">
            <span className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
              <span
                className="block h-full bg-accent transition-[width] duration-150"
                style={{ width: `${(status.done / Math.max(1, status.total)) * 100}%` }}
              />
            </span>
            <span className="font-mono text-[0.68rem] text-muted whitespace-nowrap">
              {status.done}/{status.total}
            </span>
          </span>
        )}

        {status.kind === 'done' && (
          <span className="font-mono text-[0.72rem] text-ink-soft">
            ✓ Exported {status.result.written} file
            {status.result.written === 1 ? '' : 's'} ({formatBytes(status.result.bytes)})
            {status.result.errors.length > 0 &&
              ` · ${status.result.errors.length} failed`}
          </span>
        )}

        {status.kind === 'error' && (
          <span className="font-mono text-[0.72rem] text-accent-ink">
            Export failed: {status.message}
          </span>
        )}
      </div>
    </section>
  );
}
