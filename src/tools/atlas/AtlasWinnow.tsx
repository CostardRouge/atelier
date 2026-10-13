import { useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { assetRemoteId, splitAssetsBySource } from '../../shared/library/asset-source';
import { materialize } from '../../shared/sources/winnow/materialize';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import WinnowPicker from '../../shared/sources/winnow/picker/WinnowPicker';
import { heldLog } from '../../shared/sources/winnow/picker/flight-logs';
import { logStateOf } from '../../shared/sources/winnow/picker/pick-filter';
import type { PickerHost } from '../../shared/sources/winnow/picker/picker-host';
import { todayIso } from '../../shared/roadtrip/trip-days';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';

/**
 * Flight Atlas's door to a connected Winnow: the shared picker, opened for
 * FLIGHTS — a span of days (the last one used there), only the clips that
 * carry a DJI log (asked of the server as clips, then narrowed to those with
 * a `.srt`), the Logbook with every track read, everything ticked — and an
 * add that brings each clip's `.srt` ALONE, never its video. The logs land in
 * the Library like any file; the Library selects what it adds, so the atlas
 * draws them at once.
 *
 * Drawn only while an instance is connected; the panel's file and folder
 * buttons stay the way in for logs on disk.
 */
export default function AtlasWinnow({ onAdd }: { onAdd: (files: File[]) => void }) {
  const { connection, client } = useWinnowConnection();
  const lib = useAssetLibrary();
  const [open, setOpen] = useState(false);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;

  // The clips whose log the Library already holds — drawn, never ticked twice.
  const held = useMemo(() => {
    const out = new Set<string>();
    if (!connection) return out;
    for (const a of splitAssetsBySource(lib.assets).remote.get(connection.id) ?? []) {
      const rid = assetRemoteId(a);
      if (rid && a.parts.srt) out.add(rid);
    }
    return out;
  }, [lib.assets, connection]);

  const host = useMemo<PickerHost | null>(
    () =>
      connection && client
        ? {
            title: `Add flights from ${connection.id}`,
            destination: 'Library · Flight Atlas',
            start: { day: todayIso(), scope: 'span', view: 'book', tracks: true },
            held: (row) => held.has(`${connection.id}/${row.id}`),
            heldLabel: 'in library',
            // A log is a few hundred kilobytes of text: ticking every flight costs little.
            openTicks: 'all',
            accepts: (row) => logStateOf(row) === 'with',
            narrow: { mediaType: 'video' },
            extras: () => <span className="font-mono text-2xs text-muted">logs only · text, never the video</span>,
            actions: [
              {
                key: 'add',
                label: (n) => (n ? `Add ${n} flight${n === 1 ? '' : 's'}` : 'Add flights'),
                run: async (rows, { signal, progress }) => {
                  const files: File[] = [];
                  try {
                    for (const [i, row] of rows.entries()) {
                      if (signal.aborted) break;
                      progress(`${i + 1}/${rows.length} · ${row.filename}`);
                      files.push(...(await materialize(client, connection.id, row, { fidelity: 'log', signal, reuse: heldLog })));
                    }
                  } finally {
                    if (files.length) onAddRef.current(files);
                  }
                  return !signal.aborted;
                },
              },
            ],
          }
        : null,
    [connection, client, held],
  );

  if (!connection || !client || !host) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title={`Pick flights on ${connection.id}: only each clip's .srt is downloaded`}>
        {Icons.download} From {connection.id}
      </Button>
      {open && <WinnowPicker connection={connection} client={client} host={host} onClose={() => setOpen(false)} />}
    </>
  );
}
