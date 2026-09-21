/**
 * "Your packs" — importing a folder of purchased looks into this browser's
 * vault, saying what it all WEIGHS, and forgetting what is not worth keeping.
 *
 * The gesture is deliberately two-step: pick the folder, then LOOK at what was
 * read — the categories, the cameras, the counts — and name the pack before
 * anything is stored. A pack is a library you will pick from for years, and
 * the ten seconds spent here are what stop it arriving as 25 files called
 * `AUTHENTIC_LUT_*`.
 *
 * A purchased look never reaches the deployed site, a document or a shared
 * file (`docs/lut-packs.md` §3). It does reach an instance the author keeps
 * the pack on — their own server, on their own gesture ("Keep on …", step 6 of
 * the plan) — which is what lets a phone grade with a look bought on a Mac.
 *
 * ## The weight, and the two gestures beside it
 *
 * Every row says what it costs, here and on that instance
 * (`pack-weight.ts`), because the maintainer's pack is 41 MB of lattices for
 * cameras he mostly does not own. Two different verbs answer that, and the
 * difference is the point:
 *
 * - a **tick** puts a category or a look away — presentation only, the bytes
 *   stay and a grade already wearing it still renders (§6);
 * - **forget** reclaims the bytes, here and on the instance, and is the only
 *   one of the two that a document can notice.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { pickDirectoryTree } from '../sources/file-sources';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import InfoDot from '../ui/InfoDot';
import useDialogKeys from '../ui/use-dialog-keys';
import { flattenPack, prettyName, type LutPackIndex, type PackLook } from './lut-pack';
import { cubeEntries, importPackFromFolder, type ImportFailure } from './pack-import';
import type { PackHost } from './pack-remote';
import { storedLatticeSizes } from './pack-store';
import {
  adoptRemotePack,
  keepPackOn,
  packKeepers,
  removePack,
  remotePacksNotHere,
  setPackHidden,
} from './pack-vault';
import {
  formatBytes,
  instanceWeights,
  lookWeight,
  lookWeightLabel,
  lookWeightNote,
  looksBytes,
  packWeight,
  vaultWeight,
  type LatticeSizes,
} from './pack-weight';
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

export default function LutPackImportModal({ onClose, onImported }: LutPackImportModalProps) {
  const packs = useLutPacks();
  // MEASURED off the stored buffers, not read off the indexes, which record
  // what each `.cube` weighed — four times its encoded lattice
  // (`pack-weight.ts`). Re-read whenever the packs change, so an import or a
  // forget moves the numbers rather than leaving a stale total on screen.
  const [sizes, setSizes] = useState<LatticeSizes>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    void storedLatticeSizes().then((next) => {
      if (!cancelled) setSizes(next);
    });
    return () => {
      cancelled = true;
    };
  }, [packs]);
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
              Looks you bought — kept in this browser, never in an exported file.
            </p>
          </div>
          <IconButton label="Close" variant="ghost" onClick={onClose} disabled={!!progress}>
            {Icons.close}
          </IconButton>
        </div>

        <div className="flex-1 min-h-0 overflow-auto -mr-1 pr-1 flex flex-col gap-4">
          {/* What this browser already holds, and what it costs. */}
          {packs.length > 0 && <VaultSection packs={packs} hosts={hosts} sizes={sizes} />}

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
                {picked.files.length} looks in “{picked.rootName || 'the folder'}” ·{' '}
                {formatBytes(pickedBytes)} to read
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
                {done.looks} looks in the vault
                {done.stored ? ` · ${formatBytes(done.stored)} written` : ''}
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
            Stored in this browser, and on the instance you keep a pack on — nowhere else.
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
 * Everything the vault holds, with its total above it.
 *
 * The total is NOT the sum of the rows, and the arithmetic lives in
 * `pack-weight.ts` for exactly that reason: both stores are content-addressed,
 * so a lattice two packs happen to share is one stored copy and is counted
 * once. A screen that added its own rows up would over-report it.
 */
function VaultSection({
  packs,
  hosts,
  sizes,
}: {
  packs: readonly LutPackIndex[];
  hosts: readonly PackHost[];
  sizes: LatticeSizes;
}) {
  const total = vaultWeight(packs, sizes);
  const instances = instanceWeights(packs, sizes);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap">
        <h3 className="m-0 font-mono text-2xs tracking-[0.16em] uppercase text-muted">
          In this browser
        </h3>
        <span className="font-mono text-2xs text-muted tabular-nums">
          {formatBytes(total.here)} here
          {[...instances].map(([host, bytes]) => ` · ${formatBytes(bytes)} on ${host}`)}
          {total.unweighed > 0 && ` · ${total.unweighed} not weighed`}
        </span>
      </div>
      {packs.map((pack) => (
        <PackRow key={pack.id} pack={pack} hosts={hosts} sizes={sizes} />
      ))}
    </section>
  );
}

/**
 * One pack in the vault: what it holds, what it weighs, what shows in the
 * pickers, and the verb that forgets it.
 *
 * Hiding is PRESENTATION — the looks stay stored and a grade already wearing
 * a hidden one still renders (`docs/lut-packs.md` §6). It is the answer to a
 * pack whose cameras you do not own: 25 looks of which you shoot four. The
 * weight beside it is the answer to the other half of that sentence, the one
 * hiding cannot give: the bytes those looks are still costing.
 */
function PackRow({
  pack,
  hosts,
  sizes,
}: {
  pack: LutPackIndex;
  hosts: readonly PackHost[];
  sizes: LatticeSizes;
}) {
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

  const weight = packWeight(pack, sizes);

  return (
    <div className="flex flex-col gap-2 px-3 py-2 border border-line rounded-control bg-paper">
      {/* Wrapping, not squeezing: the verbs drop to their own line on a phone
          rather than crushing a name and a weight into nothing. */}
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        <span className="flex-1 min-w-[11rem]">
          <span className="block text-sm font-medium text-ink truncate">
            {pack.name || 'Pack'}
            {pack.author && <span className="text-muted"> · {pack.author}</span>}
          </span>
          <span className="block font-mono text-2xs text-muted">
            {pack.looks.length} looks · {formatBytes(weight.here)} here
            {keptOn && ` · ${formatBytes(weight.instance)} on ${keptOn}`}
            {weight.unweighed > 0 && ` · ${weight.unweighed} not weighed`}
            {hidden.size > 0 && ` · ${pack.looks.length - visibleCount(pack)} hidden`}
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
        {/* On the LOOKS, not on the tree: a pack with no categories at all —
            "My looks", where every upload lands — still has looks to weigh
            and to forget, and used to offer no way in. */}
        {pack.looks.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Done' : 'Looks…'}
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
        <div className="flex flex-col gap-2 border-t border-line pt-2">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <h4 className="m-0 font-mono text-2xs tracking-[0.16em] uppercase text-muted">
              What shows, and what it weighs
            </h4>
            <InfoDot about="showing a look and forgetting one">
              <p>
                A tick decides what the look pickers offer. It is presentation only: the bytes stay,
                and a grade already wearing an unticked look still renders.
              </p>
              <p>
                A weight reading <code>there</code> is a look whose bytes are not in this browser —
                it downloads by itself when a picture asks for it.
              </p>
            </InfoDot>
          </div>
          <ul className="m-0 p-0 list-none flex flex-col gap-1">
            {flattenPack(pack).map((entry) =>
              entry.kind === 'node' ? (
                <li key={`n:${entry.node.id}`}>
                  <label
                    className="flex items-center gap-2 text-xs text-ink-soft"
                    style={{ paddingLeft: `${entry.depth * 0.9}rem` }}
                  >
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={!hidden.has(entry.node.id)}
                      onChange={() => toggle(entry.node.id)}
                    />
                    <span className="flex-1 min-w-0 truncate">{entry.node.label}</span>
                    {/* What the node HOLDS, not what shows: a count that fell to
                        zero the moment you unticked it would read as a category
                        that lost its looks. */}
                    <span className="font-mono text-2xs text-muted tabular-nums">
                      {branchLooks(pack, entry.node.id).length}
                    </span>
                    <span className="font-mono text-2xs text-muted tabular-nums">
                      {formatBytes(looksBytes(branchLooks(pack, entry.node.id), sizes))}
                    </span>
                  </label>
                </li>
              ) : (
                <LookRow
                  key={`l:${entry.look.id}`}
                  pack={pack}
                  look={entry.look}
                  depth={entry.depth}
                  sizes={sizes}
                  hidden={hidden.has(entry.look.id)}
                  onToggle={() => toggle(entry.look.id)}
                />
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One look: whether the pickers offer it, and what its lattice weighs.
 *
 * Its own component, and NOT wrapped in a `<label>` the way a node row is,
 * because the verb that forgets a look lands beside the tick: a button inside
 * a label toggles the label's own control on every press, so the text carries
 * an explicit `htmlFor` instead and the button stays a sibling.
 */
function LookRow({
  pack,
  look,
  depth,
  sizes,
  hidden,
  onToggle,
}: {
  pack: LutPackIndex;
  look: PackLook;
  depth: number;
  sizes: LatticeSizes;
  hidden: boolean;
  onToggle: () => void;
}) {
  const id = `pack-look-${pack.id}-${look.id}`;
  const weight = lookWeight(pack, look, sizes);

  return (
    <li
      className="flex items-center gap-2 text-xs text-ink-soft"
      style={{ paddingLeft: `${depth * 0.9}rem` }}
    >
      <input
        id={id}
        type="checkbox"
        className="accent-accent flex-none"
        checked={!hidden}
        onChange={onToggle}
      />
      <label htmlFor={id} className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer">
        <span className="flex-1 min-w-0 truncate text-muted">{look.label}</span>
        <span
          className={`font-mono text-2xs tabular-nums ${
            weight.where === 'here' ? 'text-ink-soft' : 'text-muted'
          }`}
          title={lookWeightNote(weight, pack.sourceId ?? null)}
        >
          {lookWeightLabel(weight)}
        </span>
      </label>
    </li>
  );
}

/** The looks a node holds, its descendants included — hidden ones counted. */
function branchLooks(pack: LutPackIndex, nodeId: string): PackLook[] {
  return pack.looks.filter((l) => l.node === nodeId || l.node.startsWith(`${nodeId}/`));
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
