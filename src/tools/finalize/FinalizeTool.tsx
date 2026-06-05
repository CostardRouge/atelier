import { useMemo, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import { formatBytes } from '../../shared/lib/format';
import {
  exportSummary,
  includesAsset,
  planExport,
  type ExportCriterion,
} from './export-plan';
import { canExport, pickDirectory, writeItems, type WriteResult } from './write-files';
import Thumb from './Thumb';

const CRITERIA: { value: ExportCriterion; label: string }[] = [
  { value: 'picks', label: '✓ Picks' },
  { value: 'rated3', label: '★3+' },
  { value: 'rated4', label: '★4+' },
  { value: 'rated5', label: '★5' },
];

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
  const [criterion, setCriterion] = useState<ExportCriterion>('rated4');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const supported = canExport();

  const workingSet = useMemo(
    () => selectedUsableAssets(['photo', 'video'], lib.assets, lib.selection),
    [lib.assets, lib.selection],
  );

  const counts = useMemo(() => {
    const c: Record<ExportCriterion, number> = {
      picks: 0,
      rated3: 0,
      rated4: 0,
      rated5: 0,
    };
    for (const a of workingSet) {
      const v = lib.verdicts.get(a.id);
      for (const k of Object.keys(c) as ExportCriterion[]) {
        if (includesAsset(v, k)) c[k] += 1;
      }
    }
    return c;
  }, [workingSet, lib.verdicts]);

  const included = useMemo(
    () => workingSet.filter((a) => includesAsset(lib.verdicts.get(a.id), criterion)),
    [workingSet, lib.verdicts, criterion],
  );
  const items = useMemo(
    () => planExport(workingSet, lib.verdicts, criterion),
    [workingSet, lib.verdicts, criterion],
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
          {CRITERIA.map((o) => {
            const active = o.value === criterion;
            return (
              <button
                key={o.value}
                type="button"
                disabled={writing}
                onClick={() => setCriterion(o.value)}
                aria-pressed={active}
                className={`text-[0.76rem] font-semibold px-[0.7rem] py-[0.3rem] rounded-full border transition-[border-color,color,background-color] duration-200 ease-paper disabled:opacity-50 ${
                  active
                    ? 'bg-ink text-paper border-ink'
                    : 'bg-paper text-ink-soft border-line-strong hover:border-accent hover:text-accent-ink'
                }`}
              >
                {o.label}
                <span className={active ? 'text-paper/60' : 'text-faint'}>
                  {' '}
                  {counts[o.value]}
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
            Nothing clears this bar yet — rate or flag assets in Cull, or lower the threshold.
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
