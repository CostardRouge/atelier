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
