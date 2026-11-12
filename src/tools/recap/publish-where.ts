/**
 * Where a recap of each TEMPLATE went the last time, on this device (his
 * pick, lab 18 Q5): the accounts ticked when Publish opens are the last ones
 * he sent that template to. A convenience kept in `localStorage`; storage
 * refused, the choice lasts the visit.
 */

const KEY = 'atelier.recap.publish.where.v1';

function all(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function readWhere(template: string): string[] | null {
  const ids = all()[template];
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : null;
}

export function writeWhere(template: string, channelIds: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...all(), [template]: [...channelIds] }));
  } catch {
    /* kept for this visit only */
  }
}

/**
 * *Send again* in the gallery's Planned: the recap opens on Export › Publish,
 * the accounts that failed ticked. A note left in `sessionStorage` for the
 * editor that opens next — READ, never taken: React mounts an editor twice
 * while developing and a second read must find it too, so it simply runs out
 * after a few seconds.
 */
const SEND_AGAIN_KEY = 'atelier.recap.sendAgain';
const FRESH_MS = 8000;

export function askSendAgain(recapId: string, channelIds: readonly string[]): void {
  try {
    sessionStorage.setItem(SEND_AGAIN_KEY, JSON.stringify({ recap: recapId, channels: [...channelIds], at: Date.now() }));
  } catch {
    /* the recap then opens on its usual tab, with its usual accounts */
  }
}

/** The accounts asked for this recap a moment ago ([] = none named), or null when nothing was asked. */
export function sendAgainAsked(recapId: string, now: number = Date.now()): string[] | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SEND_AGAIN_KEY) ?? 'null') as { recap?: unknown; channels?: unknown; at?: unknown } | null;
    if (!raw) return null;
    if (typeof raw.at !== 'number' || now - raw.at > FRESH_MS) {
      sessionStorage.removeItem(SEND_AGAIN_KEY);
      return null;
    }
    if (raw.recap !== recapId || !Array.isArray(raw.channels)) return null;
    return raw.channels.filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}
