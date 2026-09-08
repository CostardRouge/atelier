import { useState } from 'react';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { prunePins } from '../../shared/roadtrip/trip-cover';
import type { TripCover, TripDoc } from '../../shared/roadtrip/trip-types';
import CoverPanel from './CoverPanel';

interface TripCoverModalProps {
  trip: TripDoc;
  onCancel: () => void;
  onSave: (cover: TripCover) => void;
}

/**
 * The gallery's way into `CoverPanel`: a cover is looked at in the gallery, so
 * it is reachable from the card there. The panel's other home is the trip's
 * details sheet, where the trip's own properties are edited — see `CoverPanel`.
 */
export default function TripCoverModal({ trip, onCancel, onSave }: TripCoverModalProps) {
  const [cover, setCover] = useState<TripCover>(trip.cover);
  const save = () => onSave(prunePins(trip, cover));

  useDialogKeys({ onCancel, onConfirm: save });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Cover for ${trip.name}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[34rem] max-h-[90dvh] flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-6 overflow-auto">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">Cover</h2>
          <p className="m-0 mt-1 text-[0.82rem] text-muted">
            How {trip.name || 'this trip'} shows itself in the gallery.
          </p>
        </div>

        <CoverPanel trip={trip} value={cover} onChange={setCover} />

        <div className="flex items-center justify-end gap-4 pt-4 border-t border-line">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 border-0 bg-transparent text-[0.84rem] text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
