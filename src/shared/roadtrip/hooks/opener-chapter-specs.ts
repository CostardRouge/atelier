/**
 * The chapters of each opener's panel, in the order the panel draws them —
 * which is also their NUMBER (`opener-chapters.ts`). A chapter's `id` is the
 * `chapter` its `Group`s carry in the variant's panel.
 *
 * Keys are the options each chapter's rows write; words are its rows' labels
 * and choices, so a search for «colour» or «vitesse» lands on a chapter.
 */

import { EASINGS, type HookEasing } from './easing';
import { TICK_KITS, type TickKit } from './tick-kits';
import { sourceStops } from './stop-source';
import { mapOptions } from './map-plan';
import { SHOWCASE_RECIPES } from './showcase-plan';
import { say, type OpenerChapter } from './opener-chapters';

const kit = (v: unknown) => (typeof v === 'string' && v in TICK_KITS ? TICK_KITS[v as TickKit].label : null);
const easing = (v: unknown) => (typeof v === 'string' && v in EASINGS ? EASINGS[v as HookEasing].label : null);
const seconds = say.num((n) => `${n.toFixed(1)} s`);
const percent = say.num((n) => `${Math.round(n * 100)}%`);
const cap = (v: unknown) => (typeof v === 'string' && v ? v[0].toUpperCase() + v.slice(1).replace(/-/g, ' ') : null);

const STOPS_ON = say.one({ places: 'Legs', custom: 'Your map', pictures: 'Photos' });
const GROUP_KEYS = ['groupKm', 'groupVisits', 'groupName'] as const;
const GROUP_WORDS = ['Group nearby places', 'Within', 'Which', 'Named'];
const CAMERA_KEYS = ['camera', 'followZoom', 'viewKm', 'zoom', 'pullBack', 'orientation', 'smoothing', 'lookAhead', 'turnSmoothing', 'maxTurn', 'openWide', 'endWide'];
const CAMERA_WORDS = ['Camera', 'Whole', 'Follow', 'Preset', 'Calm', 'Navigation', 'Documentary', 'View width', 'Zoom', 'Pull back', 'Orientation', 'North up', 'Heading up', 'Wide shots', 'Smoothing', 'Look ahead', 'Turning'];
const CAMERA_FACTS = [
  { key: 'camera', say: say.one({ whole: 'Whole', follow: 'Follow' }) },
  { key: 'orientation', say: say.one({ heading: 'heading up' }) },
];
const SOUND_FACTS = [
  { key: 'sound', say: (v: unknown) => (v === true ? 'Tick' : v === false ? 'Silent' : null) },
  { key: 'kit', say: kit, when: (read: Readonly<Record<string, unknown>>) => read.sound !== false },
];
const SOUND_WORDS = ['Tick', 'Sound', 'Voice', 'Ratchet', 'Woodblock', 'Typewriter', 'Shutter', 'Pitch', 'Volume', 'Mix in', 'Audio'];
const CARD_KEYS = [
  'badgeWhen', 'cardEntrance', 'cardFace', 'cardGround', 'cardLabelKm', 'cardLabelName', 'cardLabels', 'cardLook',
  'cardStampFill', 'cardStampMode', 'cardStampOnce', 'cardStampPlace', 'cardStampState',
];
const CARD_WORDS = ['Summary card', 'Face', 'Trace', 'Ticket', 'Passport', 'Sheet', 'Stamp', 'Dashboard', 'Look', 'Ground', 'Title', 'Subtitle', 'Says', 'Places', 'Stamps', 'Codes', 'Entrance', 'Badge'];

/** Virée — the stops, then the line, the pictures, the vehicle, the map, time, camera, the recap and the sound. */
export const DRIVE_CHAPTERS: readonly OpenerChapter[] = [
  {
    id: 'stops',
    title: 'Stops',
    keys: ['stopsOn', ...GROUP_KEYS],
    words: ['Stops', 'Legs', 'Your map', 'Photos', 'Pick them on a map', 'Places', ...GROUP_WORDS],
    facts: [{ key: 'stopsOn', say: STOPS_ON }, { key: 'groupKm', say: say.num((n) => (n > 0 ? `grouped within ${n} km` : '')) }],
  },
  {
    id: 'road',
    title: 'Road',
    keys: ['path', 'ahead', 'trail', 'trailColor', 'aheadColor', 'lineWidth'],
    words: ['Path', 'Curved', 'Straight', 'Ahead', 'Dashed', 'Faint', 'Hidden', 'Trail', 'Colours', 'Colour', 'Line', 'Width'],
    facts: [
      { key: 'path', say: say.one({ curved: 'Curved', straight: 'Straight' }) },
      { key: 'ahead', say: say.one({ dashed: 'dashed ahead', faint: 'faint ahead', hidden: 'nothing ahead' }) },
      { key: 'trail', say: say.on('trail') },
    ],
  },
  {
    id: 'pictures',
    title: 'Pictures',
    keys: ['pictures', 'includePieces', 'secondsPerPicture', 'cardSize', 'cardsStay', 'pauseEverywhere'],
    words: ['Pictures', 'Photos', 'Shown as', 'Prints', 'Fill', 'Behind', 'None', 'Choose pictures', 'Per picture', 'Print size', 'Afterwards', 'Pauses', 'Days already told'],
    facts: [
      { key: 'pictures', say: say.one({ cards: 'Prints', fill: 'Fill', backdrop: 'Behind', none: 'None' }) },
      { key: 'secondsPerPicture', say: seconds },
    ],
  },
  {
    id: 'vehicle',
    title: 'Vehicle',
    keys: ['boarding', 'carSize', 'tilt'],
    words: ['Vehicle', 'Car', 'Drives', 'Boat', 'Ferry', 'Boarding', 'Paint', 'Colour', 'Configure', 'Garage', 'Size', 'Camera elevation'],
    facts: [
      { key: 'vehicle', say: (v) => (v === 'trip' || v === undefined ? 'The trip’s' : cap(v)) },
      { key: 'carSize', say: percent },
    ],
  },
  {
    id: 'map',
    title: 'Map',
    keys: ['ground', 'plate', 'basemapOpacity', 'paperColor', 'inkColor', 'graticule', 'vignette', 'position', 'size', 'dots', 'labels', 'placeStyle', 'labelSize', 'compass', 'scaleBar', 'distance'],
    words: ['Map', 'Ground', 'Paper', 'OSM map', 'OpenStreetMap', 'Tiles', 'Picture', 'Plate', 'Ink', 'Colour', 'Latitude', 'Longitude', 'Darkened edges', 'Where', 'Top', 'Middle', 'Bottom', 'Size', 'Dots', 'Names', 'Written as', 'Name size', 'Compass', 'Scale bar', 'Distance', 'km', 'mi'],
    facts: [
      { key: 'ground', say: say.one({ paper: 'Paper', tiles: 'OSM map', picture: 'Picture' }) },
      { key: 'position', say: say.one({ top: 'top', middle: 'middle', bottom: 'bottom' }) },
      { key: 'labels', say: say.one({ ends: 'the two ends named', all: 'every stop named' }) },
    ],
  },
  {
    id: 'motion',
    title: 'Motion',
    keys: ['driveSeconds', 'fit', 'easing', 'delaySeconds', 'arriveSeconds', 'end', 'captionFollows'],
    words: ['Motion', 'Driving', 'Speed', 'Duration', 'Fit to the slide', 'Easing', 'Settle', 'Brake', 'Even', 'Wind up', 'Glide', 'Hold first', 'At the end', 'Then', 'Reveal the picture', 'Stay on the map', 'Badge follows'],
    facts: [
      { key: 'driveSeconds', say: seconds },
      { key: 'easing', say: easing },
      { key: 'end', say: say.one({ reveal: 'then the picture', stay: 'stays on the map' }) },
    ],
  },
  {
    id: 'camera',
    title: 'Camera',
    keys: CAMERA_KEYS,
    words: CAMERA_WORDS,
    facts: CAMERA_FACTS,
  },
  {
    id: 'recap',
    title: 'Recap',
    keys: ['pace', 'waitStays', 'summary', 'milestones', 'ribbon', 'dayPictures', ...CARD_KEYS],
    words: ['Recap', 'Counter', 'Pace', 'Calendar', 'Road', 'Long stays', 'On the way', 'Milestones', 'Ribbon of days', 'Pictures on their day', ...CARD_WORDS],
    facts: [
      { key: 'summary', say: say.on('Summary card') },
      { key: 'milestones', say: say.on('milestones') },
      { key: 'ribbon', say: say.on('ribbon') },
    ],
    unmet: (_options, ctx) => (ctx.counterMode === undefined ? 'This slide draws no badge counter.' : null),
  },
  {
    id: 'sound',
    title: 'Sound',
    keys: ['sound', 'kit', 'shutter', 'dayTicks', 'tickPitch', 'tickVolume', 'mixWithClip'],
    words: [...SOUND_WORDS, 'Days'],
    facts: SOUND_FACTS,
  },
];

/** The Itinerary — the stops, its pictures, the map's box, the line, the places, time, camera, extras, sound. */
export const MAP_CHAPTERS: readonly OpenerChapter[] = [
  {
    id: 'stops',
    title: 'Stops',
    keys: ['stopsOn', 'includePieces', ...GROUP_KEYS],
    words: ['Stops', 'Legs', 'Your map', 'Photos', 'Pick them on a map', 'Places', 'Days already told', ...GROUP_WORDS],
    facts: [{ key: 'stopsOn', say: STOPS_ON }, { key: 'groupKm', say: say.num((n) => (n > 0 ? `grouped within ${n} km` : '')) }],
  },
  {
    id: 'pictures',
    title: 'Pictures',
    keys: ['media', 'mediaSize', 'mediaFade', 'mediaFrame', 'pinKeep', 'pinStem', 'mediaDim'],
    words: ['Pictures', 'Photos', 'Shown as', 'Pinned at the stop', 'On a card', 'Filling the frame', 'Strip', 'Size', 'Arrival', 'Mount', 'On paper', 'Bare', 'Pins', 'Stem', 'Dim'],
    facts: [{ key: 'media', say: say.one({ off: 'None', pin: 'Pinned', card: 'On a card', backdrop: 'Filling the frame', strip: 'A strip' }) }],
  },
  {
    id: 'frame',
    title: 'Frame',
    keys: ['position', 'align', 'size', 'offsetX', 'offsetY', 'plate', 'plateOpacity', 'plateColor', 'graticule', 'basemap', 'basemapOpacity'],
    words: ['Frame', 'Where', 'Top', 'Middle', 'Bottom', 'Align', 'Left', 'Centre', 'Right', 'Size', 'Moved', 'Put it back', 'Plate', 'Plate depth', 'Plate colour', 'Colour', 'Grid', 'OpenStreetMap', 'Background', 'Tiles'],
    facts: [
      { key: 'position', say: say.one({ top: 'Top', middle: 'Middle', bottom: 'Bottom' }) },
      { key: 'align', say: say.one({ left: 'left', center: 'centre', right: 'right' }) },
      { key: 'size', say: percent },
    ],
  },
  {
    id: 'path',
    title: 'Path',
    keys: ['lineWidth', 'curve', 'pathColor', 'aheadColor', 'aheadStyle', 'underlay'],
    words: ['Path', 'Line', 'Width', 'Bow', 'Curve', 'Colours', 'Colour', 'Ahead', 'Dashed', 'Faint', 'Hidden', 'Underlay'],
    facts: [
      { key: 'curve', say: say.num((n) => (n > 0 ? `bow ${Math.round(n * 100)}%` : 'Straight')) },
      { key: 'aheadStyle', say: say.one({ dashed: 'dashed ahead', faint: 'faint ahead', hidden: 'nothing ahead' }) },
    ],
  },
  {
    id: 'places',
    title: 'Places',
    keys: ['dots', 'dotSize', 'numbers', 'labels', 'placeStyle', 'labelSize', 'context'],
    words: ['Places', 'Dots', 'Dot size', 'Numbers', 'Names', 'Written as', 'Name size', 'Trip’s places', 'Every stop', 'Where the pen is'],
    facts: [
      { key: 'dots', say: say.on('Dots') },
      { key: 'numbers', say: say.on('numbered') },
      { key: 'labels', say: say.one({ ends: 'the two ends named', current: 'named where the pen is', passed: 'named once passed', all: 'every stop named' }) },
    ],
  },
  {
    id: 'motion',
    title: 'Motion',
    keys: ['draw', 'drawSeconds', 'fit', 'dwellSeconds', 'easing', 'delaySeconds', 'pen'],
    words: ['Motion', 'Travel', 'Speed', 'Duration', 'Fit to the slide', 'Wait', 'Easing', 'Hold first', 'Pen', 'Dot', 'Plane', 'Bare line'],
    facts: [
      { key: 'draw', say: (v) => (v === false ? 'Still map' : null) },
      { key: 'drawSeconds', say: seconds },
      { key: 'pen', say: say.one({ dot: 'a dot', plane: 'a plane', none: 'bare line' }) },
    ],
  },
  {
    id: 'camera',
    title: 'Camera',
    keys: CAMERA_KEYS.filter((k) => !['followZoom', 'orientation', 'turnSmoothing', 'maxTurn'].includes(k)),
    words: CAMERA_WORDS.filter((w) => !['Orientation', 'North up', 'Heading up', 'Turning'].includes(w)),
    facts: CAMERA_FACTS.slice(0, 1),
    unmet: (options, ctx) => {
      const o = mapOptions(options);
      if (!o.draw) return 'The map does not travel: turn Travel on in Motion.';
      const stops = o.stopsOn === 'custom' ? o.stops.length : sourceStops(o, ctx).length;
      return stops < 2 ? 'A camera follows the pen between two stops or more.' : null;
    },
  },
  {
    id: 'extras',
    title: 'Extras',
    keys: ['compass', 'distance', 'nameInBadge'],
    words: ['Extras', 'Compass', 'North arrow', 'Distance', 'km', 'mi', 'In the badge', 'Caption'],
    facts: [
      { key: 'compass', say: say.on('Compass') },
      { key: 'distance', say: say.one({ km: 'km', mi: 'mi' }) },
    ],
  },
  {
    id: 'sound',
    title: 'Sound',
    keys: ['sound', 'kit', 'tickPitch', 'tickVolume', 'mixWithClip'],
    words: SOUND_WORDS,
    facts: SOUND_FACTS,
  },
];

/** Défilé — what it stops on, the sweep, the tape, the sound. */
export const SCRUB_CHAPTERS: readonly OpenerChapter[] = [
  {
    id: 'stops',
    title: 'Stops',
    keys: ['stopsOn', 'mode', 'runUpDays', 'maxStops', 'flash'],
    words: ['Stops', 'Stops on', 'Pieces’ days', 'Picked pictures', 'Starts', 'Day 1', 'Days back', 'Most stops', 'Flash', 'Pictures'],
    facts: [
      { key: 'stopsOn', say: say.one({ pieces: 'Pieces’ days', picked: 'Picked pictures' }) },
      { key: 'mode', say: say.one({ 'from-start': 'from day 1', 'run-up': 'a few days back' }) },
    ],
  },
  {
    id: 'sweep',
    title: 'Sweep',
    keys: ['sweepSeconds', 'fit', 'easing', 'delaySeconds'],
    words: ['Sweep', 'Length', 'Duration', 'Speed', 'Fit to the slide', 'Motion', 'Easing', 'Hold first'],
    facts: [{ key: 'sweepSeconds', say: seconds }, { key: 'easing', say: easing }],
  },
  {
    id: 'tape',
    title: 'Tape',
    keys: ['tape', 'tapeWidth', 'edgeOffset', 'offsetX', 'offsetY', 'tickColor', 'passedColor', 'tickOpacity', 'tickHeight', 'tickGap', 'headStyle', 'headGlow', 'showTrack', 'tapeBackground', 'backgroundOpacity', 'edgeFade'],
    words: ['Tape', 'Runs', 'Bottom', 'Top', 'Width', 'From edge', 'Colours', 'Colour', 'Opacity', 'Height', 'Spacing', 'Head', 'Bar', 'Dot', 'Needle', 'Glow', 'Track', 'Band', 'Band depth', 'Ends'],
    facts: [
      { key: 'tape', say: say.one({ bottom: 'Bottom', top: 'Top' }) },
      { key: 'headStyle', say: say.one({ bar: 'a bar', dot: 'a dot', needle: 'a needle' }) },
    ],
  },
  {
    id: 'sound',
    title: 'Sound',
    keys: ['sound', 'kit', 'tickPitch', 'pitchDrift', 'tickVolume', 'mixWithClip'],
    words: [...SOUND_WORDS, 'Drift', 'Steady', 'Climbing', 'Falling'],
    facts: SOUND_FACTS,
  },
];

/** The recap card — its stops and the card itself. */
export const CARD_CHAPTERS: readonly OpenerChapter[] = [
  {
    id: 'stops',
    title: 'Stops',
    keys: ['stopsOn', 'includePieces'],
    words: ['Stops', 'Legs', 'Your map', 'Photos', 'Places'],
    facts: [{ key: 'stopsOn', say: STOPS_ON }],
  },
  {
    id: 'card',
    title: 'Card',
    keys: CARD_KEYS.filter((k) => k !== 'badgeWhen'),
    words: CARD_WORDS.filter((w) => w !== 'Badge'),
    facts: [
      { key: 'cardFace', say: cap },
      { key: 'cardLook', say: (v) => (v === 'trip' ? 'the trip’s look' : null) },
    ],
  },
];

/** Vitrine — a recipe, the place, the motion, the vehicle, the words. */
export const SHOWCASE_CHAPTERS: readonly OpenerChapter[] = [
  {
    id: 'start',
    title: 'Start from',
    keys: [],
    words: ['Start from', 'Recipe', 'Preset'],
    facts: [{ key: 'place', say: () => `${SHOWCASE_RECIPES.length} ready-made scenes` }],
  },
  {
    id: 'place',
    title: 'Place',
    keys: ['place', 'variants', 'time', 'weather', 'frame'],
    words: ['Place', 'Variant', 'Hour', 'Dawn', 'Noon', 'Sunset', 'Night', 'Weather', 'Dry', 'Rain', 'Mist', 'Framing', 'Full frame', 'Diorama'],
    facts: [{ key: 'place', say: cap }, { key: 'time', say: cap }, { key: 'weather', say: (v) => (v === 'dry' ? null : cap(v)) }],
  },
  {
    id: 'motion',
    title: 'Motion',
    keys: ['entry', 'end', 'look'],
    words: ['Motion', 'Entrance', 'Drives in', 'Exploded', 'Drops in', 'Drawn', 'Light sweep', 'Stop-motion', 'Ending', 'Look', 'Colour', 'Blueprint', 'Riso'],
    facts: [{ key: 'entry', say: cap }, { key: 'look', say: cap }],
  },
  {
    id: 'vehicle',
    title: 'Vehicle',
    keys: [],
    words: ['Vehicle', 'Car', 'Stages', 'Paint', 'Colour', 'Configure', 'Garage'],
    facts: [{ key: 'vehicle', say: (v) => (v === 'trip' || v === undefined ? 'The trip’s' : cap(v)) }],
  },
  {
    id: 'words',
    title: 'Words',
    keys: ['badge'],
    words: ['Words', 'Place line', 'Caption', 'Badge', 'After the entrance', 'Throughout', 'Hidden'],
    facts: [{ key: 'badge', say: say.one({ after: 'badge after the entrance', always: 'badge throughout', never: 'no badge' }) }],
  },
];
