import HouseStyleControls, { type HouseStyleRow } from '../../shared/ui/HouseStyleControls';
import { presetById } from '../../shared/overlay/title-styles';
import { CAR_COLOURS } from '../../shared/roadtrip/car-spec';
import {
  HOUSE_STYLE_PATH,
  houseStyleFrom,
  type TripHouseStyle,
} from '../../shared/roadtrip/house-style';
import { bundledHouseStyle } from '../../shared/roadtrip/house-style-bundle';
import { POST_KINDS, type TripDoc } from '../../shared/roadtrip/trip-types';

/** What each block of the style will actually say. */
function rowsOf(style: TripHouseStyle): HouseStyleRow[] {
  const colour = CAR_COLOURS.find((c) => c.hex.toLowerCase() === style.car.color.toLowerCase());
  const looks = style.grade.layers.map((layer) => layer.name);
  return [
    {
      label: 'Title style',
      value: style.theme ? (presetById(style.theme.presetId)?.name ?? style.theme.presetId) : 'None',
    },
    {
      label: 'Words',
      value: [style.badgeWords.day, style.badgeWords.days, style.badgeWords.of, style.badgeWords.at].join(' · '),
    },
    { label: 'Closing card', value: style.cta.headline.trim() || '(no headline)' },
    {
      label: 'New pieces',
      value: POST_KINDS.map(
        (k) => `${k.label}: ${style.hookDefaults[k.id] ? 'saved look' : 'factory'}`,
      ).join(' · '),
    },
    { label: 'Grade', value: looks.length ? looks.join(' + ') : 'None' },
    { label: 'Car', value: colour?.name ?? style.car.color },
  ];
}

/** ⚙ Trip → House style: the trip's look as the one every new trip starts from. */
export default function HouseStylePanel({ trip }: { trip: TripDoc }) {
  const { file, uploadedLooks } = houseStyleFrom(trip);
  const committed = bundledHouseStyle();
  return (
    <HouseStyleControls
      target="trip"
      path={HOUSE_STYLE_PATH}
      file={file}
      rows={rowsOf(file.style)}
      leftOut={
        uploadedLooks.length
          ? [
              `Left out: ${uploadedLooks.join(', ')} — an uploaded look carries its whole .cube. Drop the file in public/luts/ to ship it as a built-in.`,
            ]
          : []
      }
      committed={committed !== null}
      same={committed !== null && JSON.stringify(committed) === JSON.stringify(file.style)}
    >
      <p>
        Every new trip starts from this trip’s look — its words, title style, closing
        card, the look saved for each kind of piece, its grade and its car. Never its
        name, dates, legs or pieces, nor the pictures an opener was given. Trips that
        already exist never change.
      </p>
      <p>
        Saving writes <code>{HOUSE_STYLE_PATH}</code> in the repository: commit it and
        the deployed site’s new trips start there too. This section only exists on the
        dev server.
      </p>
    </HouseStyleControls>
  );
}
