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

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { pickDirectoryTree } from '../sources/file-sources';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import useDialogKeys from '../ui/use-dialog-keys';
import { prettyName, type LutPackIndex } from './lut-pack';
import { cubeEntries, importPackFromFolder, type ImportFailure } from './pack-import';
import { removePack } from './pack-vault';
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
                      {pack.looks.length} looks
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void removePack(pack.id)}
                    title="Forget this pack and its looks on this device"
                  >
                    Forget
                  </Button>
                </div>
              ))}
            </section>
          )}

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
