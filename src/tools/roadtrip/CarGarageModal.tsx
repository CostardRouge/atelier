import { useState } from 'react';
import { describeCar, sameCarSpec, type CarSpec } from '../../shared/roadtrip/car-spec';
import { carModel } from '../../shared/roadtrip/hooks/car-registry';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import Button from '../../shared/ui/Button';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import CarGaragePanel from './CarGaragePanel';

interface CarGarageModalProps {
  trip: TripDoc;
  onCancel: () => void;
  /** The car as dressed — the caller writes it to the trip. */
  onDone: (car: CarSpec) => void;
}

/**
 * The garage as a sheet of its own, opened from the piece: the Virée opener's
 * panel says "Configure the car…" and this is where it lands, the car on its
 * turntable at a size the inspector column cannot give it.
 *
 * A DRAFT, unlike the trip settings pane, which writes on every switch: the
 * sheet is opened while a map is being composed, and a car half-dressed
 * behind a stage that redraws on every flag is a distraction — Done writes
 * the trip once, Escape and Cancel leave it as it was. The panel inside is
 * the same `CarGaragePanel` as the settings pane, so the two homes can never
 * drift. No portal: `PostEditor` renders it beside the other trip-wide sheets,
 * outside the panel host, and it stacks over the stage like them.
 */
export default function CarGarageModal({ trip, onCancel, onDone }: CarGarageModalProps) {
  const [draft, setDraft] = useState<CarSpec>(trip.car);
  const changed = !sameCarSpec(draft, trip.car);
  const done = () => (changed ? onDone(draft) : onCancel());
  useDialogKeys({ onCancel, onConfirm: done });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Garage · ${trip.name}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[68rem] h-[min(90dvh,48rem)] flex flex-col overflow-hidden bg-surface border border-line rounded-paper-lg shadow-paper max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0">
        <div className="flex-none flex items-baseline gap-3 px-6 pt-[1.4rem] pb-3.5 border-b border-line">
          <h2 className="m-0 flex-none whitespace-nowrap font-serif text-2xl">Garage</h2>
          <span className="min-w-0 font-mono text-2xs text-muted truncate" title={describeCar(draft, carModel(draft.model).name)}>
            {trip.name}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close the garage"
            className="flex-none w-7 h-7 grid place-items-center rounded-full border border-line text-base leading-none text-muted cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5">
          <CarGaragePanel value={draft} onChange={setDraft} />
        </div>

        <div className="flex-none flex items-center gap-3 px-6 py-3.5 border-t border-line bg-surface max-[820px]:pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <span className="min-w-0 text-xs text-muted truncate">
            Every Virée of this trip drives this car.
          </span>
          <span className="flex-1" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={done}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
