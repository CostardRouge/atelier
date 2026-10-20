import { AUDIENCE_SRC } from '../shared/lib/audience';

/**
 * The facts the legal notice (`LegalNotice.tsx`, `#/legal`) states about
 * what leaves the browser, kept apart from the page so `legal.test.ts` can
 * hold them to the code: every host the notice names must be the one its
 * module contacts, and every third-party host a module names must be in
 * this list — a new request is a new line of the notice, or the test says so.
 *
 * The list is the README's "network exceptions" callout, in the notice's
 * words (`docs/memory/local-first.md` carries each one's reasoning). A
 * connected Winnow and the agent bridge are not here: one is a host the
 * person types, the other is the loopback address.
 */
export interface NetworkException {
  /** What the notice calls it. */
  name: string;
  /** The host contacted. */
  host: string;
  /** The module that holds the address, relative to the repository root. */
  module: string;
  /** When the request happens, and what leaves — one sentence, no markup. */
  when: string;
}

/** The counter's host, read from the one place the address lives. */
export const MEASUREMENT_HOST = new URL(AUDIENCE_SRC).host;

export const NETWORK_EXCEPTIONS: readonly NetworkException[] = [
  {
    name: 'OpenStreetMap map tiles',
    host: 'tile.openstreetmap.org',
    module: 'src/shared/map/track-map.ts',
    when:
      'Only once you turn a map background on, on this device — in Flight Map, Composer, Flight Atlas, the map of a trip or an opener that draws it. The tiles tell that server which area you look at; they are kept on this device for a month, and every frame they appear in credits © OpenStreetMap contributors.',
  },
  {
    name: 'OpenStreetMap place search',
    host: 'nominatim.openstreetmap.org',
    module: 'src/shared/map/geocode.ts',
    when:
      'Only once you turn it on, and only when you press Search for a place in Trips: the words you typed leave, nothing else — never a photo, a position or a trip.',
  },
  {
    name: 'The ffmpeg.wasm core',
    host: 'unpkg.com',
    module: 'src/shared/media/transcode.ts',
    when:
      'About 31 MB, fetched the first time you ask to convert a clip your browser cannot play, then kept by the browser’s cache. Nothing of yours leaves: the conversion runs in this browser.',
  },
  {
    name: 'Lensfun lens profiles',
    host: 'raw.githubusercontent.com',
    module: 'src/shared/lens/lensfun-source.ts',
    when:
      'Only once you turn it on in Develop’s Lens section: one maker’s file at a time, nothing of yours in the request; what is kept on this device is the matched camera and lens.',
  },
  {
    name: 'Audience measurement',
    host: MEASUREMENT_HOST,
    module: 'src/shared/lib/audience.ts',
    when: 'The counter described below — loaded when the site opens, unless your browser says no or you switched it off.',
  },
];
