import { useMemo, useRef, useState } from 'react';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import WinnowPicker from '../../shared/sources/winnow/picker/WinnowPicker';
import { addFlightLogs } from '../../shared/sources/winnow/picker/flight-logs';
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
 * add that brings each clip's `.srt` ALONE, never its video, into the open
 * atlas (its text kept with it on this device, its Winnow id beside it).
 *
 * Drawn only while an instance is connected; the panel's file and folder
 * buttons stay the way in for logs on disk.
 */
export default function AtlasWinnow({ onAdd, held }: { onAdd: (files: File[]) => void; held: ReadonlySet<string> }) {
  const { connection, client } = useWinnowConnection();
  const [open, setOpen] = useState(false);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;

  const host = useMemo<PickerHost | null>(
    () =>
      connection && client
        ? {
            title: `Add flights from ${connection.id}`,
            destination: 'this atlas',
            start: { day: todayIso(), scope: 'span', view: 'book', tracks: true },
            held: (row) => held.has(`${connection.id}/${row.id}`),
            heldLabel: 'in this atlas',
            // A log is a few hundred kilobytes of text: ticking every flight costs little.
            openTicks: 'all',
            accepts: (row) => logStateOf(row) === 'with',
            narrow: { mediaType: 'video' },
            extras: () => <span className="font-mono text-2xs text-muted">logs only · text, never the video</span>,
            actions: [
              {
                key: 'add',
                label: (n) => (n ? `Add ${n} flight${n === 1 ? '' : 's'}` : 'Add flights'),
                run: (rows, ctx) => addFlightLogs(client, connection.id, rows, (files) => onAddRef.current(files), ctx),
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
