import { useMemo, useRef, useState } from 'react';
import type { MosaicDoc, MosaicTile } from '../../shared/mosaic/mosaic-doc';
import type { WinnowAssetRow, WinnowClient } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import WinnowPicker from '../../shared/sources/winnow/picker/WinnowPicker';
import type { PickerHost } from '../../shared/sources/winnow/picker/picker-host';
import { todayIso } from '../../shared/roadtrip/trip-days';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { spanOfRows, tileOfRow } from './mosaic-rows';

/**
 * The mosaic's door to a connected Winnow (`docs/mosaic.md` §4.1): the
 * shared picker, opened on a SPAN of days — the mosaic's own, else the last
 * one used there —, photos and clips, everything but the rejects ticked (the
 * point is volume), and an add that brings REFERENCES only: nothing is
 * fetched here, the editor measures what was added right after
 * (`measure-pool.ts`). A mosaic whose pictures come from another instance
 * says so instead of offering the door — a tile's id means nothing there.
 */
export default function MosaicPicker({
  doc,
  connection,
  client,
  onAdd,
  open: openControlled,
  onOpenChange,
  trigger = true,
}: {
  doc: MosaicDoc;
  connection: WinnowConnection;
  client: WinnowClient;
  onAdd: (tiles: MosaicTile[], instance: string, span: { from: string; to: string } | undefined) => void;
  /** Opened from elsewhere (a phone's ⋯): the owner holds the state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False draws no button — the owner's menu is the door. */
  trigger?: boolean;
}) {
  const [openOwn, setOpenOwn] = useState(false);
  const open = openControlled ?? openOwn;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOpenOwn(v));
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const other = doc.instance && doc.instance !== connection.id ? doc.instance : null;

  const held = useMemo(() => new Set(doc.tiles.map((t) => t.id)), [doc.tiles]);
  const host = useMemo<PickerHost>(
    () => ({
      title: `Add from ${connection.id}`,
      destination: /^mosaic\b/i.test(doc.title) ? doc.title : `Mosaic · ${doc.title || 'untitled'}`,
      start: { day: todayIso(), scope: 'span', span: doc.span ?? null },
      held: (row) => held.has(row.id),
      heldLabel: 'in this mosaic',
      // Hundreds or thousands are the point: everything but the rejects.
      openTicks: 'all',
      accepts: (row: WinnowAssetRow) => row.media_type === 'photo' || row.media_type === 'video',
      extras: () => <span className="font-mono text-2xs text-muted">references only · each picture’s colours are measured next</span>,
      actions: [
        {
          key: 'add',
          label: (n) => (n ? `Add ${n.toLocaleString()} to the mosaic` : 'Add to the mosaic'),
          run: async (rows) => {
            onAddRef.current(rows.map(tileOfRow), connection.id, spanOfRows(rows));
            return true;
          },
        },
      ],
    }),
    [connection.id, doc.title, doc.span, held],
  );

  if (other) {
    if (!trigger) return null;
    return (
      <span className="font-mono text-2xs text-muted" title={`Its pictures come from ${other}; connect that instance on Sources to add more`}>
        pictures from {other}
      </span>
    );
  }
  return (
    <>
      {trigger && (
        <Button size="sm" variant="ghost" icon={Icons.plus} onClick={() => setOpen(true)} title={`Pick pictures on ${connection.id}: references only, measured next`}>
          From {connection.id}
        </Button>
      )}
      {open && <WinnowPicker connection={connection} client={client} host={host} onClose={() => setOpen(false)} />}
    </>
  );
}
