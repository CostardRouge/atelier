import { useEffect, useMemo, useState } from 'react';
import type { LibraryHalf, WinnowClient } from '../shared/sources/winnow/client';
import type { WinnowConnection } from '../shared/sources/winnow/store';
import { materialize, type Fidelity } from '../shared/sources/winnow/materialize';
import { readBrowseState, writeBrowseState } from '../shared/sources/winnow/browse-state';
import WinnowPicker from '../shared/sources/winnow/picker/WinnowPicker';
import type { PickerAnchor, PickerHost } from '../shared/sources/winnow/picker/picker-host';
import Segmented from '../shared/ui/Segmented';
import { formatBytes } from '../shared/lib/format';

/**
 * The Library's *browse all*: the Winnow picker, hosted by the sidebar
 * (`docs/winnow-day-sheet-verdicts.md` §7, the Library column of its table).
 *
 * - It opens where the sidebar is looking — the day AND the half — and marks
 *   in its month what the active tool has open, like the sidebar's stepper.
 * - What the pool already holds is drawn *in library* and cannot be ticked.
 * - Nothing is ticked on open: an add here DOWNLOADS, and a list nobody just
 *   looked at must not cost gigabytes on an Enter.
 * - The verb fetches each ticked row as a file (`materialize`) at the chosen
 *   fidelity — proxies by default, originals with their weight said — and
 *   hands them to the Library. A Cancel stops the run and keeps what landed.
 * - Closing it moves nothing: the sidebar keeps following its tool (his
 *   question 3 of §7.4, answered by the recommendation).
 */
export default function LibraryPicker({
  connection,
  client,
  day,
  half,
  anchor,
  inLibrary,
  onAdd,
  onClose,
}: {
  connection: WinnowConnection;
  client: WinnowClient;
  day: string;
  half: LibraryHalf | null;
  anchor: PickerAnchor | null;
  /** `"<host>/<id>"` → the Library asset id it became. */
  inLibrary: ReadonlyMap<string, string>;
  onAdd: (files: File[]) => void;
  onClose: () => void;
}) {
  const [fidelity, setFidelity] = useState<Fidelity>(() => readBrowseState(connection.id)?.fidelity ?? 'proxy');
  // A preference of this instance's place, beside the rail the picker keeps
  // there: read back and written whole, so neither overwrites the other.
  useEffect(() => {
    const stored = readBrowseState(connection.id);
    if (stored && stored.fidelity !== fidelity) writeBrowseState(connection.id, { ...stored, fidelity });
  }, [connection.id, fidelity]);

  const host = useMemo<PickerHost>(
    () => ({
      title: `Add from ${connection.id}`,
      destination: 'Library',
      start: { day, half },
      anchor,
      held: (row) => inLibrary.has(`${connection.id}/${row.id}`),
      heldLabel: 'in library',
      openTicks: 'none',
      extras: (ticked) => {
        const bytes = ticked.reduce((sum, r) => sum + (r.file_size ?? 0), 0);
        return (
          <span className="inline-flex items-center gap-2 max-[820px]:w-full max-[820px]:justify-between">
            <Segmented
              label="Bring"
              size="sm"
              value={fidelity}
              onChange={setFidelity}
              options={[
                { id: 'proxy', label: 'Proxies', title: "Winnow's editing rendition: WebP photo, H.264 video — fast; exports can fetch originals later" },
                { id: 'original', label: 'Originals', title: 'The full files — every byte through the tunnel' },
              ]}
            />
            {fidelity === 'original' && (
              <span className="font-mono text-2xs text-muted tabular-nums">
                {ticked.length ? `${formatBytes(bytes)} to download` : 'full-size files'}
              </span>
            )}
          </span>
        );
      },
      actions: [
        {
          key: 'add',
          label: (n) => (n ? `Add ${n} to library` : 'Add to library'),
          run: async (rows, { signal, progress }) => {
            const files: File[] = [];
            try {
              for (const [i, row] of rows.entries()) {
                if (signal.aborted) break;
                progress(`${i + 1}/${rows.length} · ${row.filename}`);
                files.push(...(await materialize(client, connection.id, row, { fidelity, signal })));
              }
            } finally {
              // Stopped or failed half-way: what landed is still worth having,
              // like a cancelled export's files.
              if (files.length) onAdd(files);
            }
            return !signal.aborted;
          },
        },
      ],
    }),
    [connection.id, client, day, half, anchor, inLibrary, fidelity, onAdd],
  );

  return <WinnowPicker connection={connection} client={client} host={host} onClose={onClose} />;
}
