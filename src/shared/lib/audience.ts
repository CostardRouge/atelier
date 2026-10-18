/**
 * Audience measurement, the DOM-free half: what the build reports to, whether
 * a visitor's browser says no, and which screen is counted at which address.
 * The half that loads the tracker and sends is `app/audience.ts`.
 *
 * Umami, self-hosted by the maintainer (the same instance as his other
 * sites), no cookie, no cross-site identifier. The suite is measured LIGHTLY,
 * his word: the home page's view and the opening of a tool, nothing else —
 * never a document, a route inside a tool, a file name or a position.
 *
 * Nothing here is secret: it all ends up in the bundle. The website id is in
 * the code, overridden by `VITE_UMAMI_WEBSITE_ID` at build time; an EMPTY id
 * is the kill switch (no script, no request), and a host outside the two
 * allowed ones (localhost, a fork, a preview) loads the tracker but never
 * counts.
 */

export interface AudienceSettings {
  /** The tracker's address. */
  src: string;
  /** The site's key in the Umami dashboard. */
  website: string;
  /** Hosts allowed to report, comma-separated (the tracker's `data-domains`). */
  domains: string;
}

/** The maintainer's instance, its tracker named /insight: filter lists block /script.js. */
export const AUDIENCE_SRC = 'https://insight.steevepommier.com/insight';
/** Atelier's key in that dashboard; `VITE_UMAMI_WEBSITE_ID` overrides it, empty switches measurement off. */
export const AUDIENCE_WEBSITE_ID = '9ec2b45f-ff04-4c9a-86c2-9ffee05da3d0';
/** The site's own domain and its GitHub Pages address; anything else (localhost, a fork) never counts. */
export const AUDIENCE_DOMAINS = ['atelier.steeve.website', 'costardrouge.github.io'] as const;
/** Umami's own opt-out key: the tracker checks it before every send too. */
export const OPT_OUT_KEY = 'umami.disabled';

type Env = Record<string, string | boolean | undefined>;

const list = (value: string): string[] =>
  value
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

/**
 * This build's settings, or null for no measurement: production builds only
 * (`npm run dev` and the tests never count) unless `VITE_UMAMI_DEV=true`;
 * nothing with an empty `VITE_UMAMI_WEBSITE_ID`.
 */
export function audienceSettings(env: Env, production: boolean): AudienceSettings | null {
  if (!production && env.VITE_UMAMI_DEV !== 'true') return null;
  const website = String(env.VITE_UMAMI_WEBSITE_ID ?? AUDIENCE_WEBSITE_ID).trim();
  if (!website) return null;
  let src: string = AUDIENCE_SRC;
  try {
    const custom = new URL(String(env.VITE_UMAMI_SRC ?? '').trim() || AUDIENCE_SRC);
    if (custom.protocol === 'https:' || custom.protocol === 'http:') src = custom.href;
  } catch {
    // An unusable address keeps the default tracker.
  }
  const domains =
    typeof env.VITE_UMAMI_DOMAINS === 'string' ? list(env.VITE_UMAMI_DOMAINS) : [...AUDIENCE_DOMAINS];
  return { src, website, domains: domains.join(',') };
}

/** What a browser says about being measured. */
export interface PrivacySignals {
  /** `navigator.doNotTrack` (or the window's / IE's spelling). */
  doNotTrack?: string | null;
  /** `navigator.globalPrivacyControl`. */
  globalPrivacyControl?: boolean;
  /** `localStorage['umami.disabled']` is set. */
  optedOut: boolean;
}

/** The visitor said no: Do Not Track, Global Privacy Control (which Umami ignores on its own), or the opt-out key. */
export function declines(signals: PrivacySignals): boolean {
  const dnt = signals.doNotTrack;
  return signals.globalPrivacyControl === true || dnt === '1' || dnt === 'yes' || signals.optedOut;
}

/**
 * The address a screen is counted at, or null for a screen that is not
 * counted: the home page is `/`, a tool is `/<its id>` whatever the route
 * inside it (`/roadtrip/<trip>/<day>` counts as `/roadtrip`), and the
 * shell's reading pages (sources, agents) are not counted at all.
 */
export function countedPath(screen: { tool?: string; home: boolean }): string | null {
  if (screen.tool) return `/${screen.tool}`;
  return screen.home ? '/' : null;
}
