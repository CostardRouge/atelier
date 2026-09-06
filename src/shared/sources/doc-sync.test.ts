import { describe, expect, it } from 'vitest';
import {
  REMOTE_IDLE_MS,
  describeAgo,
  newSyncRecord,
  pillText,
  reduceSync,
  shouldFlush,
  type SyncRecord,
  type SyncStatus,
} from './doc-sync';

const HOST = 'winnow.steeve.website';

const synced = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  id: 't1',
  sourceId: HOST,
  etag: 'e1',
  syncedAt: 1_000,
  dirtyAt: null,
  pushStartedAt: null,
  status: 'synced',
  error: null,
  theirs: null,
  ...over,
});

describe('newSyncRecord', () => {
  it('starts dirty and never pushed — a new remote trip has to go up once', () => {
    const r = newSyncRecord('t1', HOST, 5);
    expect(r).toMatchObject({ status: 'dirty', etag: null, dirtyAt: 5, syncedAt: null });
  });
});

describe('reduceSync — the ordinary round trip', () => {
  it('an edit makes a synced record dirty, stamped with the edit', () => {
    const r = reduceSync(synced(), { type: 'edited', now: 2_000 });
    expect(r.status).toBe('dirty');
    expect(r.dirtyAt).toBe(2_000);
    expect(r.etag).toBe('e1');
  });

  it('a later edit moves the stamp — the idle clock counts from the LAST keystroke', () => {
    let r = reduceSync(synced(), { type: 'edited', now: 2_000 });
    r = reduceSync(r, { type: 'edited', now: 3_000 });
    expect(r.dirtyAt).toBe(3_000);
  });

  it('a push in flight is `saving`, and success lands on `synced` with the new etag', () => {
    let r = reduceSync(synced(), { type: 'edited', now: 2_000 });
    r = reduceSync(r, { type: 'pushStarted', now: 7_000 });
    expect(r.status).toBe('saving');
    r = reduceSync(r, { type: 'pushOk', etag: 'e2', now: 7_400 });
    expect(r).toMatchObject({ status: 'synced', etag: 'e2', syncedAt: 7_400, dirtyAt: null });
    expect(r.pushStartedAt).toBeNull();
  });

  it('an edit DURING the push keeps the record dirty after the push lands', () => {
    // The push carried the older snapshot; the mirror has moved on since.
    let r = reduceSync(synced(), { type: 'edited', now: 2_000 });
    r = reduceSync(r, { type: 'pushStarted', now: 7_000 });
    r = reduceSync(r, { type: 'edited', now: 7_200 });
    expect(r.status).toBe('saving');
    r = reduceSync(r, { type: 'pushOk', etag: 'e2', now: 7_400 });
    expect(r.status).toBe('dirty');
    expect(r.dirtyAt).toBe(7_200);
    expect(r.etag).toBe('e2');
  });

  it('a pull replaces the mirror and settles the record', () => {
    const r = reduceSync(synced({ status: 'dirty', dirtyAt: 5 }), { type: 'pulled', etag: 'e9', now: 9 });
    expect(r).toMatchObject({ status: 'synced', etag: 'e9', syncedAt: 9, dirtyAt: null });
  });
});

describe('reduceSync — every failure lands on its own status', () => {
  const inFlight = () =>
    reduceSync(reduceSync(synced(), { type: 'edited', now: 2_000 }), { type: 'pushStarted', now: 3_000 });

  it.each([
    ['unreachable', 'offline'],
    ['unauthenticated', 'unauthenticated'],
    ['forbidden', 'forbidden'],
    ['conflict', 'conflict'],
    ['notfound', 'gone'],
    ['protocol', 'dirty'],
  ] as const)('%s → %s, keeping the edit', (kind, status) => {
    const r = reduceSync(inFlight(), { type: 'pushFailed', kind, message: 'why' });
    expect(r.status).toBe(status);
    expect(r.dirtyAt).toBe(2_000);
    expect(r.pushStartedAt).toBeNull();
    expect(r.error).toBe('why');
  });

  it('a conflict remembers the server’s copy — the pill and "keep mine" need it', () => {
    const r = reduceSync(inFlight(), {
      type: 'pushFailed',
      kind: 'conflict',
      theirs: { etag: 'e7', updatedAt: '2026-09-06T14:02:00Z' },
    });
    expect(r.theirs).toEqual({ etag: 'e7', updatedAt: '2026-09-06T14:02:00Z' });
  });

  it('a non-conflict failure carries no "theirs"', () => {
    const r = reduceSync(inFlight(), { type: 'pushFailed', kind: 'unreachable' });
    expect(r.theirs).toBeNull();
  });
});

describe('reduceSync — the held states wait for a person', () => {
  const held = (status: SyncStatus): SyncRecord =>
    synced({ status, dirtyAt: 2_000, theirs: status === 'conflict' ? { etag: 'e7', updatedAt: null } : null });

  it.each(['conflict', 'gone', 'forbidden'] as const)('an edit does not move %s', (status) => {
    const r = reduceSync(held(status), { type: 'edited', now: 4_000 });
    expect(r.status).toBe(status);
    expect(r.dirtyAt).toBe(4_000);
  });

  it('keep mine adopts the server’s etag and goes back to dirty — the next push is accepted', () => {
    const r = reduceSync(held('conflict'), { type: 'resolvedKeepMine' });
    expect(r).toMatchObject({ status: 'dirty', etag: 'e7', theirs: null, dirtyAt: 2_000 });
  });

  it('take theirs is a pull: settled on the server’s copy, local edits dropped', () => {
    const r = reduceSync(held('conflict'), { type: 'resolvedTakeTheirs', etag: 'e7', now: 5 });
    expect(r).toMatchObject({ status: 'synced', etag: 'e7', dirtyAt: null, theirs: null, syncedAt: 5 });
  });
});

describe('shouldFlush', () => {
  const dirtyAt = (t: number, status: SyncStatus = 'dirty') => synced({ status, dirtyAt: t });

  it('waits out the idle delay, then fires', () => {
    expect(shouldFlush(dirtyAt(1_000), 1_000 + REMOTE_IDLE_MS - 1)).toBe(false);
    expect(shouldFlush(dirtyAt(1_000), 1_000 + REMOTE_IDLE_MS)).toBe(true);
  });

  it('takes a custom delay', () => {
    expect(shouldFlush(dirtyAt(1_000), 1_500, 400)).toBe(true);
    expect(shouldFlush(dirtyAt(1_000), 1_300, 400)).toBe(false);
  });

  it('never fires on a clean record', () => {
    expect(shouldFlush(synced(), 1e9)).toBe(false);
  });

  it('retries after offline and after a lost session — only trying can tell they are back', () => {
    expect(shouldFlush(dirtyAt(1_000, 'offline'), 1e9)).toBe(true);
    expect(shouldFlush(dirtyAt(1_000, 'unauthenticated'), 1e9)).toBe(true);
  });

  it('holds on forbidden, conflict and gone — a person has to act', () => {
    expect(shouldFlush(dirtyAt(1_000, 'forbidden'), 1e9)).toBe(false);
    expect(shouldFlush(dirtyAt(1_000, 'conflict'), 1e9)).toBe(false);
    expect(shouldFlush(dirtyAt(1_000, 'gone'), 1e9)).toBe(false);
  });

  it('never starts a second push while one is in flight', () => {
    expect(shouldFlush(dirtyAt(1_000, 'saving'), 1e9)).toBe(false);
  });
});

describe('describeAgo', () => {
  it('rounds to the unit a person would say', () => {
    expect(describeAgo(10_000)).toBe('just now');
    expect(describeAgo(2 * 60_000)).toBe('2 min ago');
    expect(describeAgo(3 * 3_600_000)).toBe('3 h ago');
    expect(describeAgo(86_400_000)).toBe('1 day ago');
    expect(describeAgo(2 * 86_400_000)).toBe('2 days ago');
  });
});

describe('pillText — every status prints the line it really means', () => {
  const now = 1_000 + 2 * 60_000;

  it('synced says where and when', () => {
    expect(pillText(synced(), HOST, now)).toBe(`saved to ${HOST} · 2 min ago`);
  });

  it('dirty says a save is coming, or why the last one did not land', () => {
    expect(pillText(synced({ status: 'dirty', dirtyAt: 5 }), HOST, now)).toBe(
      `unsaved changes — saving to ${HOST} shortly`,
    );
    expect(pillText(synced({ status: 'dirty', dirtyAt: 5, error: 'answered 500' }), HOST, now)).toBe(
      `could not save to ${HOST}: answered 500 — kept on this device, will retry`,
    );
  });

  it('saving', () => {
    expect(pillText(synced({ status: 'saving' }), HOST, now)).toBe(`saving to ${HOST}…`);
  });

  it('offline keeps the edit here and says it will retry', () => {
    expect(pillText(synced({ status: 'offline' }), HOST, now)).toBe(
      'offline — kept on this device, will retry',
    );
  });

  it('a lost session says where to sign in', () => {
    expect(pillText(synced({ status: 'unauthenticated' }), HOST, now)).toBe(
      `sign in to ${HOST} to keep saving`,
    );
  });

  it('forbidden names the account, not the network', () => {
    expect(pillText(synced({ status: 'forbidden' }), HOST, now)).toBe(
      `this account cannot save on ${HOST} — kept on this device`,
    );
  });

  it('a conflict says WHEN the other device wrote, in the reader’s clock', () => {
    const stamp = '2026-09-06T14:02:00Z';
    const d = new Date(stamp);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const r = synced({ status: 'conflict', theirs: { etag: 'e7', updatedAt: stamp } });
    expect(pillText(r, HOST, now)).toBe(`refused: changed on another device at ${hhmm}`);
  });

  it('a conflict with no timestamp still says what happened', () => {
    const r = synced({ status: 'conflict', theirs: { etag: 'e7', updatedAt: null } });
    expect(pillText(r, HOST, now)).toBe('refused: changed on another device');
  });

  it('gone', () => {
    expect(pillText(synced({ status: 'gone' }), HOST, now)).toBe(`deleted on ${HOST}`);
  });
});
