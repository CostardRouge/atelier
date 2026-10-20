/**
 * Audience measurement, the browser half (`shared/lib/audience.ts` has the
 * rules): loads the Umami tracker once, only for a build that measures and a
 * visitor whose browser does not say no, and sends the views the shell counts
 * — the home page and a tool's opening (`countedPath`), nothing else.
 *
 * The tracker's automatic tracking stays off: the hash router never reloads
 * the document, so left to itself Umami would count one view per tab, with
 * the hash — a trip, a day, a project — in the address. Every view is sent
 * from here, at the counted address, the previous view as its referrer; a
 * view sent before the tracker has loaded waits in a bounded queue.
 */

import {
  audienceSettings,
  countedPath,
  declines,
  OPT_OUT_KEY,
  type AudienceSettings,
} from '../shared/lib/audience';

type Payload = Record<string, unknown>;
interface Umami {
  track(build: (base: Payload) => Payload): unknown;
}
declare global {
  interface Window {
    umami?: Umami;
  }
}

type Status = 'idle' | 'loading' | 'ready' | 'off';
let status: Status = 'idle';
let queue: Array<(umami: Umami) => void> = [];
/** The last view sent: the same screen twice in a row counts once, and it is the next view's referrer. */
let last: string | null = null;
/** Views that never got a tracker (offline, blocked) cannot grow the queue past this. */
const MAX_QUEUE = 10;
/** The title every view reports: the site's, not the screen's, which a document could name. */
const TITLE = 'Atelier';

function settings(): AudienceSettings | null {
  return audienceSettings(import.meta.env as Record<string, string | boolean | undefined>, import.meta.env.PROD);
}

function browserDeclines(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  let optedOut = false;
  try {
    optedOut = Boolean(localStorage.getItem(OPT_OUT_KEY));
  } catch {
    // Storage refused: nothing to honour there.
  }
  return declines({
    doNotTrack: nav.doNotTrack ?? (window as Window & { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl,
    optedOut,
  });
}

function stop(): void {
  status = 'off';
  queue = [];
}

function flush(): void {
  if (status !== 'loading') return;
  const umami = window.umami;
  if (!umami) {
    stop();
    return;
  }
  status = 'ready';
  const waiting = queue;
  queue = [];
  for (const send of waiting) send(umami);
}

/**
 * Loads the tracker, once, unless the build does not measure or the visitor
 * said no — then nothing is ever requested. Appended as an async script, so
 * an unreachable analytics server never delays the app.
 */
function start(): void {
  if (status !== 'idle') return;
  const cfg = settings();
  if (!cfg || browserDeclines()) {
    stop();
    return;
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = cfg.src;
  Object.assign(script.dataset, {
    websiteId: cfg.website,
    domains: cfg.domains,
    autoTrack: 'false',
    doNotTrack: 'true',
    excludeSearch: 'true',
    excludeHash: 'true',
  });
  script.addEventListener('load', flush, { once: true });
  script.addEventListener('error', stop, { once: true });
  status = 'loading';
  document.head.append(script);
}

function send(fn: (umami: Umami) => void): void {
  if (status === 'idle') start();
  if (status === 'off') return;
  const umami = window.umami;
  if (status === 'ready' && umami) {
    fn(umami);
    return;
  }
  if (queue.length < MAX_QUEUE) queue.push(fn);
}

/** What the legal notice says about this browser: the build does not count, the browser said no, the person did, or it counts. */
export type AudienceState = 'off' | 'declined' | 'opted-out' | 'on';

export function audienceState(): AudienceState {
  if (!settings()) return 'off';
  let optedOut = false;
  try {
    optedOut = Boolean(localStorage.getItem(OPT_OUT_KEY));
  } catch {
    // Storage refused: no choice could have been kept.
  }
  if (optedOut) return 'opted-out';
  return browserDeclines() ? 'declined' : 'on';
}

/**
 * The legal notice's switch. Writes Umami's own opt-out key, which the
 * tracker reads before every send too, so stopping is immediate; counting
 * again lets a tracker already here go on, and one never loaded start with
 * the next view.
 */
export function setOptOut(off: boolean): void {
  try {
    if (off) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // Storage refused: the choice cannot be kept, and nothing is counted anyway (`stop` below, or no key to read).
  }
  if (off) {
    stop();
    return;
  }
  if (status === 'off') status = window.umami ? 'ready' : 'idle';
}

/** Where the visitor came from, when it is another site: its origin and path, never its query or fragment. */
function externalReferrer(): string {
  try {
    const ref = new URL(document.referrer);
    return ref.origin === location.origin ? '' : `${ref.origin}${ref.pathname}`;
  } catch {
    return '';
  }
}

/**
 * The screen on show, as the shell knows it: the home page, or a tool by its
 * id. Called on every route; a screen that is not counted (`countedPath`)
 * sends nothing, and the same screen twice in a row counts once.
 */
export function countScreen(screen: { tool?: string; home: boolean }): void {
  const path = countedPath(screen);
  if (path === null || path === last) return;
  const referrer = last ?? externalReferrer();
  last = path;
  send((umami) => umami.track((base) => ({ ...base, url: path, referrer, title: TITLE })));
}
