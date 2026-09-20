/**
 * "Your packs" — importing a folder of purchased looks into this browser's
 * vault, and forgetting one.
 *
 * The gesture is deliberately two-step: pick the folder, then LOOK at what was
 * read — the categories, the cameras, the counts — and name the pack before
 * anything is stored. A pack is a library you will pick from for years, and
 * the ten seconds spent here are what stop it arriving as 25 files called
 * `AUTHENTIC_LUT_*`.
 *
 * Nothing leaves the machine: the files are read, encoded and stored locally
 * (`docs/lut-packs.md` §3 — a purchased look may never reach the deployed
 * site, a document or a shared file). Keeping a pack on a Winnow so a phone
 * can read it is step V5 of the plan, and this screen will say so then.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { pickDirectoryTree } from '../sources/file-sources';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import useDialogKeys from '../ui/use-dialog-keys';
import { flattenNodes, prettyName, type LutPackIndex } from './lut-pack';
import { cubeEntries, importPackFromFolder, type ImportFailure } from './pack-import';
import type { PackHost } from './pack-remote';
import {
  adoptRemotePack,
  keepPackOn,
  packKeepers,
  removePack,
  remotePacksNotHere,
  setPackHidden,
} from './pack-vault';
import { subscribeWinnowConnections } from '../sources/winnow/store';
import { useLutPacks } from './use-lut-packs';

interface Picked {
  rootName: string;
  files: { path: string; file: File }[];
}

interface LutPackImportModalProps {
  onClose: () => void;
  /** Called with the pack that was just imported, so a picker can open on it. */
  onImported?: (index: LutPackIndex) => void;
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `pk_${crypto.randomUUID()}`
    : `pk_${Math.random().toString(36).slice(2)}`;
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

export default function LutPackImportModal({ onClose, onImported }: LutPackImportModalProps) {
  const packs = useLutPacks();
  // Not `useSyncExternalStore`: `packKeepers()` builds fresh objects on every
  // call, which that hook reads as a changed snapshot and re-renders forever.
  // A subscription that SETS state keeps one array per change.
  const [hosts, setHosts] = useState<PackHost[]>(() => packKeepers());
  useEffect(() => subscribeWinnowConnections(() => setHosts(packKeepers())), []);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number; file: string } | null>(null);
  const [failed, setFailed] = useState<ImportFailure[]>([]);
  const [done, setDone] = useState<{ looks: number; stored: number; reused: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useDialogKeys({ onCancel: progress ? () => {} : onClose });

  const pick = useCallback(async () => {
    setError(null);
    setDone(null);
    setFailed([]);
    try {
      const tree = await pickDirectoryTree();
      const files = cubeEntries(tree.files);
      if (!files.length) {
        setPicked(null);
        if (tree.files.length) setError('No .cube file in that folder.');
        return;
      }
      setPicked({ rootName: tree.rootName, files });
      setName((n) => n || prettyName(tree.rootName || 'Pack'));
    } catch (e) {
      setError((e as Error).message || 'That folder could not be read.');
    }
  }, []);

  const run = useCallback(async () => {
    if (!picked) return;
    setError(null);
    setProgress({ done: 0, total: picked.files.length, file: '' });
    try {
      const result = await importPackFromFolder(picked.files, {
        id: uid(),
        name: name.trim() || prettyName(picked.rootName || 'Pack'),
        author: author.trim(),
        url: url.trim() || undefined,
        onProgress: setProgress,
      });
      setFailed(result.failed);
      setDone({ looks: result.index.looks.length, stored: result.stored, reused: result.reused });
      setPicked(null);
      onImported?.(result.index);
    } catch (e) {
      setError((e as Error).message || 'The import stopped.');
    } finally {
      setProgress(null);
    }
  }, [picked, name, author, url, onImported]);

  // The preview is built from the paths alone, before a byte is stored.
  const preview = picked
    ? picked.files.reduce<Map<string, number>>((map, { path }) => {
        const parts = path.split('/');
        const key = parts.length > 1 ? parts.slice(0, -1).join(' · ') : '—';
        map.set(key, (map.get(key) ?? 0) + 1);
        return map;
      }, new Map())
    : null;
  const pickedBytes = picked?.files.reduce((sum, f) => sum + f.file.size, 0) ?? 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Your LUT packs"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !progress) onClose();
      }}
    >
      <div className="w-full max-w-[42rem] max-h-[min(88dvh,46rem)] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6 pb-5 min-h-0 max-[820px]:max-w-none max-[820px]:h-[var(--app-h,100dvh)] max-[820px]:max-h-none max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:px-4 max-[820px]:pt-[max(1rem,env(safe-area-inset-top))] max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 font-serif text-2xl">Your packs</h2>
            <p className="m-0 mt-1 text-sm text-muted">
              Looks you bought, kept in this browser — never uploaded, never in an exported file.
            </p>
          </div>
          <IconButton label="Close" variant="ghost" onClick={onClose} disabled={!!progress}>
            {Icons.close}
          </IconButton>
        </div>

        <div className="flex-1 min-h-0 overflow-auto -mr-1 pr-1 flex flex-col gap-4">
          {/* What this browser already holds. */}
          {packs.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="m-0 font-mono text-2xs tracking-[0.16em] uppercase text-muted">
                In this browser
              </h3>
              {packs.map((pack) => (
                <PackRow key={pack.id} pack={pack} hosts={hosts} />
              ))}
            </section>
          )}

          {/* What an instance holds that this browser does not — the other
              half of keeping a pack somewhere: a phone that has never seen
              the pack takes its index here, and its looks follow as pictures
              ask for them. */}
          {hosts.map((host) => (
            <ElsewhereSection key={host.sourceId} host={host} />
          ))}

          {/* The pick, then what was read. */}
          {!picked && !progress && (
            <section className="flex flex-col gap-2 items-start">
              <Button onClick={() => void pick()}>Choose a pack folder…</Button>
              <p className="m-0 text-xs text-muted">
                The folder the pack came in, with its categories inside. Everything that is not a
                <code className="mx-1">.cube</code> is left where it is.
              </p>
            </section>
          )}

          {picked && !progress && (
            <section className="flex flex-col gap-3">
              <h3 className="m-0 font-mono text-2xs tracking-[0.16em] uppercase text-muted">
                {picked.files.length} looks in “{picked.rootName || 'the folder'}” · {mb(pickedBytes)} to read
              </h3>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
                <label className="text-xs text-muted" htmlFor="pack-name">Pack</label>
                <input
                  id="pack-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="AUTHENTIC"
                  className="font-sans text-xs max-[820px]:text-base h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-ink"
                />
                <label className="text-xs text-muted" htmlFor="pack-author">Author</label>
                <input
                  id="pack-author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Who made it"
                  className="font-sans text-xs max-[820px]:text-base h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-ink"
                />
                <label className="text-xs text-muted" htmlFor="pack-url">Link</label>
                <input
                  id="pack-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Where you bought it (optional)"
                  className="font-sans text-xs max-[820px]:text-base h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-ink"
                />
              </div>
              <ul className="m-0 p-0 list-none flex flex-col gap-1">
                {[...(preview ?? [])].map(([label, count]) => (
                  <li key={label} className="flex justify-between gap-3 text-xs text-ink-soft">
                    <span className="truncate">{label}</span>
                    <span className="font-mono text-muted tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button onClick={() => void run()}>Import {picked.files.length} looks</Button>
                <Button variant="ghost" onClick={() => setPicked(null)}>
                  Choose another folder
                </Button>
              </div>
            </section>
          )}

          {progress && (
            <section className="flex flex-col gap-2">
              <p className="m-0 text-sm text-ink">
                Reading {progress.done + 1} of {progress.total}…
              </p>
              <div className="h-1.5 rounded-full bg-paper-2 overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width] duration-150"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <p className="m-0 font-mono text-2xs text-muted truncate">{progress.file}</p>
            </section>
          )}

          {done && (
            <section className="flex flex-col gap-1">
              <p className="m-0 text-sm text-ok">
                {done.looks} looks in the vault{done.stored ? ` · ${mb(done.stored)} written` : ''}
                {done.reused ? ` · ${done.reused} already here` : ''}.
              </p>
              <p className="m-0 text-xs text-muted">
                They are in the look picker now, under the pack’s name.
              </p>
            </section>
          )}

          {failed.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="m-0 font-mono text-2xs tracking-[0.16em] uppercase text-warn">
                {failed.length} not taken
              </h3>
              {failed.map((f) => (
                <p key={f.file} className="m-0 text-xs text-ink-soft">
                  <span className="font-mono text-2xs">{f.file}</span> — {f.reason}
                </p>
              ))}
            </section>
          )}

          {error && <p className="m-0 text-xs text-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="m-0 text-xs text-muted">
            Stored in this browser only. Reading them on your phone comes with the vault’s sync.
          </p>
          <Button variant="ghost" onClick={onClose} disabled={!!progress}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One pack in the vault: what it holds, what shows in the pickers, and the
 * verb that forgets it.
 *
 * Hiding is PRESENTATION — the looks stay stored and a grade already wearing
 * a hidden one still renders (`docs/lut-packs.md` §6). It is the answer to a
 * pack whose cameras you do not own: 25 looks of which you shoot four.
 */
function PackRow({ pack, hosts }: { pack: LutPackIndex; hosts: readonly PackHost[] }) {
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState<{ done: number; total: number; bytes: number } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const hidden = new Set(pack.hidden);
  const keptOn = pack.sourceId ?? null;
  // Somewhere to put it: an instance that keeps documents AND files. One
  // instance is the common case, so the verb names it rather than asking.
  const target = hosts.find((h) => h.sourceId === keptOn) ?? hosts[0] ?? null;

  const keep = async () => {
    if (!target) return;
    setPushError(null);
    setPush({ done: 0, total: 0, bytes: 0 });
    try {
      const result = await keepPackOn(pack.id, target.sourceId, setPush);
      if (result.missingLocally.length) {
        setPushError(
          `${result.missingLocally.length} looks are not in this browser, so they were not sent.`,
        );
      }
    } catch (e) {
      setPushError((e as Error).message || 'The instance refused it.');
    } finally {
      setPush(null);
    }
  };
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void setPackHidden(pack.id, [...next]);
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-2 border border-line rounded-control bg-paper">
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-ink truncate">
            {pack.name || 'Pack'}
            {pack.author && <span className="text-muted"> · {pack.author}</span>}
          </span>
          <span className="block font-mono text-2xs text-muted">
            {pack.looks.length} looks
            {hidden.size > 0 && ` · ${pack.looks.length - visibleCount(pack)} hidden`}
            {keptOn && ` · kept on ${keptOn}`}
          </span>
        </span>
        {target && !push && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void keep()}
            title={
              keptOn
                ? `Send what ${target.sourceId} is missing`
                : `Keep this pack on ${target.sourceId}, so your other devices can use it`
            }
          >
            {keptOn ? 'Push' : `Keep on ${target.sourceId}`}
          </Button>
        )}
        {push && (
          <span className="font-mono text-2xs text-muted">
            {push.total ? `${push.done}/${push.total}` : 'Checking…'}
          </span>
        )}
        {pack.tree.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Done' : 'What shows…'}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void removePack(pack.id)}
          title="Forget this pack and its looks on this device"
        >
          Forget
        </Button>
      </div>

      {pushError && <p className="m-0 text-xs text-warn">{pushError}</p>}

      {open && (
        <ul className="m-0 p-0 list-none flex flex-col gap-1 border-t border-line pt-2">
          {flattenNodes(pack.tree).map(({ node, depth }) => (
            <li key={node.id}>
              <label
                className="flex items-center gap-2 text-xs text-ink-soft"
                style={{ paddingLeft: `${depth * 0.9}rem` }}
              >
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={!hidden.has(node.id)}
                  onChange={() => toggle(node.id)}
                />
                <span className="flex-1 min-w-0 truncate">{node.label}</span>
                {/* What the node HOLDS, not what shows: a count that fell to
                    zero the moment you unticked it would read as a category
                    that lost its looks. */}
                <span className="font-mono text-2xs text-muted tabular-nums">
                  {branchCount(pack, node.id)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function branchCount(pack: LutPackIndex, nodeId: string): number {
  return pack.looks.filter((l) => l.node === nodeId || l.node.startsWith(`${nodeId}/`)).length;
}

function visibleCount(pack: LutPackIndex): number {
  const hidden = new Set(pack.hidden);
  return pack.looks.filter(
    (l) => !hidden.has(l.id) && ![...hidden].some((h) => l.node === h || l.node.startsWith(`${h}/`)),
  ).length;
}

/**
 * The packs an instance holds that this browser does not. Adding one copies
 * its INDEX only — 40 MB of lattices is not something to download because a
 * list was opened; they follow one at a time, as pictures ask for them.
 */
function ElsewhereSection({ host }: { host: PackHost }) {
  const [there, setThere] = useState<LutPackIndex[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const packs = useLutPacks();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    remotePacksNotHere(host)
      .then((list) => {
        if (!cancelled) setThere(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message || 'That instance did not answer.');
      });
    return () => {
      cancelled = true;
    };
    // The list is re-asked whenever this browser's packs change: adopting one
    // must take it off the "elsewhere" list.
  }, [host, packs]);

  if (error) {
    return (
      <p className="m-0 text-xs text-muted">
        {host.sourceId} — {error}
      </p>
    );
  }
  if (!there?.length) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 font-mono text-2xs tracking-[0.16em] uppercase text-muted">
        On {host.sourceId}
      </h3>
      {there.map((pack) => (
        <div
          key={pack.id}
          className="flex items-center gap-3 px-3 py-2 border border-line rounded-control bg-paper"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-ink truncate">
              {pack.name || 'Pack'}
              {pack.author && <span className="text-muted"> · {pack.author}</span>}
            </span>
            <span className="block font-mono text-2xs text-muted">
              {pack.looks.length} looks · its looks download as you use them
            </span>
          </span>
          <Button
            size="sm"
            disabled={busy === pack.id}
            onClick={() => {
              setBusy(pack.id);
              void adoptRemotePack(pack, host.sourceId).finally(() => setBusy(null));
            }}
          >
            {busy === pack.id ? 'Adding…' : 'Add here'}
          </Button>
        </div>
      ))}
    </section>
  );
}
