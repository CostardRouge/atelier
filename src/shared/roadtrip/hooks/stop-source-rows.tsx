/**
 * The Stops rows every map opener shares (2026-10-08): where the stops come
 * from — the legs, your own map, the photos — and the editor over them. On
 * the legs and the photos the editor SHOWS the list the opener will draw;
 * editing it makes it your own map.
 */

import Button from '../../ui/Button';
import Segmented from '../../ui/Segmented';
import { FieldRow, SwitchRow } from '../../ui/Inspector';
import type { HookPanelHost } from './hook-variant';
import StopsEditor, { type StopsEditorProps } from './stops-editor';
import { ownStops, type StopSource, type StopSourceOptions, type StopSourcePatch } from './stop-source';
import type { MapStop } from './stops';

interface Props {
  value: StopSourceOptions;
  onChange: (patch: StopSourcePatch) => void;
  /** The stops the source gives (`sourceStops`) — the list the opener draws. */
  resolved: readonly MapStop[];
  host?: HookPanelHost;
  /** Everything the editor needs but its list. */
  editor: Omit<StopsEditorProps, 'stops' | 'onChange' | 'host'>;
  /** Names the choice for assistive tech: what the opener joins. */
  label: string;
  /** Offer the told days' pictures on the legs here (Virée offers it with its pictures). */
  pieces?: boolean;
}

const HINTS: Record<StopSource, string> = {
  places: 'The legs’ places with coordinates, the trip so far up to this piece’s day. A place gets coordinates when you look it up in the trip’s legs.',
  custom: 'The places you put on the map below, in your order — any place, on the trip’s legs or not.',
  pictures: 'Each picked picture shot with a position is a stop, in the order they were shot; one without rides with the stop before it.',
};

export function StopSourceRows({ value, onChange, resolved, host, editor, label, pieces = false }: Props) {
  const own = value.stopsOn === 'custom';
  const located = value.picked.filter((p) => p.coords).length;
  const choose = host?.choosePictures
    ? async () => {
        const next = await host.choosePictures?.(value.picked, { includeThisDay: true });
        if (next) onChange({ picked: next });
      }
    : null;
  return (
    <>
      <FieldRow label="Stops" align="start" hint={HINTS[value.stopsOn]}>
        <Segmented
          size="sm"
          fill
          label={label}
          value={value.stopsOn}
          onChange={(stopsOn) => onChange({ stopsOn })}
          options={[
            { id: 'places', label: 'Legs' },
            { id: 'custom', label: 'Your map' },
            { id: 'pictures', label: 'Photos' },
          ]}
        />
      </FieldRow>
      {value.stopsOn === 'pictures' && (
        <FieldRow label="Photos" hint={value.picked.length ? `${located} of ${value.picked.length} picked carry a position.` : undefined}>
          {choose ? (
            <Button size="sm" variant={value.picked.length ? 'default' : 'primary'} onClick={() => void choose()}>
              {value.picked.length ? 'Change pictures…' : 'Choose pictures…'}
            </Button>
          ) : (
            <span className="text-xs text-muted">The picture chooser is not available here.</span>
          )}
        </FieldRow>
      )}
      {pieces && value.stopsOn === 'places' && (
        <SwitchRow
          label="Also the pictures of the days already told"
          name="Show the told days’ pictures"
          checked={value.includePieces}
          onChange={(includePieces) => onChange({ includePieces })}
          hint="The photo each piece is made from, at the place where the leg of its day ends."
        />
      )}
      {!own && resolved.length > 0 && (
        <p className="m-0 text-xs text-muted">
          {resolved.length} {resolved.length === 1 ? 'stop' : 'stops'} taken from the {value.stopsOn === 'places' ? 'legs' : 'photos'}. Edit one and the list
          becomes your own map.
        </p>
      )}
      <StopsEditor
        {...editor}
        host={host}
        stops={own ? value.stops : resolved}
        onChange={(stops) => onChange(own ? { stops: [...stops] } : ownStops(value.stopsOn, stops))}
      />
    </>
  );
}
