import { useMemo, useRef } from 'react';
import { WinnowClient } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import WinnowPicker from '../../shared/sources/winnow/picker/WinnowPicker';
import type { PickerHost } from '../../shared/sources/winnow/picker/picker-host';
import { rowDay } from '../../shared/sources/winnow/picker/span';
import type { CountedSpan } from '../../shared/story/sources';

/**
 * The wall's pictures, chosen in the Winnow picker — the same modal as
 * Develop's *Add a day*, the Library's *browse all* and Flight Atlas's
 * flights, hosted by Storytelling (his ask, 2026-11-01: « réutiliser
 * l'importateur de médias de Develop »). It opens on the SPAN the series
 * counts; its rail filters by body (the drone, a phone), by type, by
 * extension (no PNG, no screenshot), by Winnow's verdicts and stars, and
 * opens with nothing ticked. Nothing is fetched: the verb
 * hands back ids and days, and the wall's cache brings the thumbnails.
 */
export default function WallPicker({
  connection,
  span,
  chosen,
  onAdd,
  onClose,
}: {
  connection: WinnowConnection;
  /** The days the series counts — where the picker opens. */
  span: CountedSpan;
  /** The asset ids already chosen for the wall. */
  chosen: readonly number[];
  onAdd: (picked: [number, string][]) => void;
  onClose: () => void;
}) {
  const add = useRef(onAdd);
  add.current = onAdd;
  const client = useMemo(() => new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }), [connection]);
  // A host rebuilt per render re-derives the picker's rows on every one: it is keyed on what it reads.
  const spanKey = `${span.from}|${span.to}`;
  const chosenKey = chosen.join(',');
  const host = useMemo<PickerHost>(() => {
    const [from, to] = spanKey.split('|');
    const held = new Set(chosenKey ? chosenKey.split(',').map(Number) : []);
    return {
      title: `The wall's pictures from ${connection.id}`,
      destination: 'Wall',
      start: { day: from, scope: 'span', span: { from, to } },
      anchor: { span: { from, to }, label: 'the counted days', publisher: 'Storytelling' },
      held: (row) => held.has(row.id),
      heldLabel: 'on the wall',
      // Nothing ticked on open: the wall is made by FILTERING, then All or ⚑ Picks — a row ticked on
      // open stays ticked when a filter hides it (the picker counts it « hidden » and still adds it),
      // so a PNG ticked before the .jpg filter would reach the wall.
      openTicks: 'none',
      actions: [
        {
          key: 'add',
          label: (n) => (n ? `Put ${n} on the wall` : 'Put on the wall'),
          run: async (rows) => {
            add.current(rows.flatMap((r): [number, string][] => {
              const day = rowDay(r);
              return day ? [[r.id, day]] : [];
            }));
            return true;
          },
        },
      ],
    };
  }, [connection.id, spanKey, chosenKey]);

  return <WinnowPicker connection={connection} client={client} host={host} onClose={onClose} />;
}
