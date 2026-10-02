import { useMemo, useRef } from 'react';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { sameMediaRef } from '../../shared/develop/roll-types';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import { rowMediaRef } from '../../shared/sources/winnow/materialize';
import WinnowPicker from '../../shared/sources/winnow/picker/WinnowPicker';
import type { PickerHost } from '../../shared/sources/winnow/picker/picker-host';

/**
 * A roll's *Add a day*: the Winnow picker, hosted by Develop
 * (`docs/winnow-day-sheet-verdicts.md` §7, the Develop column of its table).
 *
 * - It opens on the open picture's day; its month marks that day and the
 *   span of days the roll already covers.
 * - What the roll holds is drawn *on the roll* (`sameMediaRef`: asset id,
 *   else content hash, else name) and cannot be ticked twice.
 * - A culled day opens with its PICKS ticked — the whole point of the ask:
 *   a day culled in Winnow is added in one gesture. An unculled day ticks
 *   everything the roll lacks but the rejects.
 * - The verb adds REFERENCES (`rowMediaRef`): nothing is fetched here, the
 *   roll fetches each picture when it is opened (`develop-media.md`).
 */
export default function RollPicker({
  connection,
  client,
  rollName,
  day,
  rollSpan,
  held,
  onAdd,
  onClose,
}: {
  connection: WinnowConnection;
  client: WinnowClient;
  rollName: string;
  /** The open picture's day — where the picker opens. */
  day: string;
  /** The first and last days the roll's pictures were shot, when it holds any. */
  rollSpan: { from: string; to: string } | null;
  /** The refs already on the roll. */
  held: readonly SavedMediaRef[];
  onAdd: (refs: SavedMediaRef[], sourceId: string) => void;
  onClose: () => void;
}) {
  // Read at the click, so a host rebuilt per render is not what keeps the
  // picker's rows re-derived.
  const add = useRef(onAdd);
  add.current = onAdd;
  const host = useMemo<PickerHost>(() => {
    // The common case first: a picture fetched from this instance carries its
    // `host/id`, so most rows answer without the hash-then-name walk.
    const heldIds = new Set(held.flatMap((r) => (r.assetId ? [r.assetId] : [])));
    return {
      title: `Add from ${connection.id}`,
      // A roll named after its kind (the default, `Roll · Oct 1`) says it once.
      destination: /^roll\b/i.test(rollName) ? rollName : `Roll · ${rollName || 'untitled'}`,
      start: { day },
      anchor: {
        span: { from: day, to: day },
        label: 'the open picture',
        publisher: 'Develop',
        within: rollSpan ? { span: rollSpan, label: "the roll's days" } : null,
      },
      held: (row) => {
        const ref = rowMediaRef(connection.id, row);
        return (ref.assetId !== undefined && heldIds.has(ref.assetId)) || held.some((h) => sameMediaRef(h, ref));
      },
      heldLabel: 'on the roll',
      openTicks: 'picks',
      // A roll develops photographs and clips; nothing else is listed.
      accepts: (row) => row.media_type === 'photo' || row.media_type === 'video',
      actions: [
        {
          key: 'add',
          label: (n) => (n ? `Add ${n} to the roll` : 'Add to the roll'),
          run: async (rows) => {
            add.current(
              rows.map((r) => rowMediaRef(connection.id, r)),
              connection.id,
            );
            return true;
          },
        },
      ],
    };
  }, [connection.id, rollName, day, rollSpan, held]);

  return <WinnowPicker connection={connection} client={client} host={host} onClose={onClose} />;
}
