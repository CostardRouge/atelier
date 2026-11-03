import { DOCS_APP, WinnowError } from '../../shared/sources/winnow/client';
import { afterPull, newSyncRecord, reduceSync, type PullOutcome, type SyncEvent, type SyncRecord } from '../../shared/sources/doc-sync';
import { failureOf, outcomeEvent, putDocOnce, remoteFor, type RemoteSource } from '../../shared/sources/doc-remote';
import { readScriptSummary, scriptSummary, STORY_DOC_KIND, STORY_DOC_VERSION, type ScriptSummary } from '../../shared/story/script-remote';
import { parseScript, type StoryScript } from '../../shared/story/story-script';

/**
 * The driver of a script kept on a Winnow (`script-remote.ts`) — the twin of
 * Trips' and Mosaic's over the same plumbing (`doc-remote.ts`) and reducer
 * (`doc-sync.ts`). Its bookkeeping, one `SyncRecord` per series id, is kept in
 * `localStorage` beside the script (a few hundred bytes), never in the
 * script: in the file it would travel to the other device and lie there.
 */
const KEY = 'atelier.storytelling.remote.v1';

type Records = Record<string, SyncRecord>;
let records: Records = read();
const listeners = new Set<() => void>();

function read(): Records {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Records) : {};
  } catch {
    return {};
  }
}

function write(next: Records): void {
  records = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage refused: the record lives in this tab; the next open pulls and finds out.
  }
  listeners.forEach((fn) => fn());
}

export function subscribeSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const syncRecords = (): Records => records;
export const syncRecordOf = (id: string | undefined): SyncRecord | null => (id ? (records[id] ?? null) : null);

export function putRecord(rec: SyncRecord): void {
  write({ ...records, [rec.id]: rec });
}
export function dropRecord(id: string): void {
  const next = { ...records };
  delete next[id];
  write(next);
}
export function reduceRecord(id: string, event: SyncEvent): SyncRecord | null {
  const was = records[id];
  if (!was) return null;
  const next = reduceSync(was, event);
  putRecord(next);
  return next;
}

/** The instance a script may be kept on, or null when it is not connected here or keeps no scripts. */
export const scriptRemoteFor = (sourceId: string): RemoteSource | null => remoteFor(sourceId, STORY_DOC_KIND);

/** A stored body back into a script; a body that is not one is refused in words. */
export function fromWire(raw: unknown, id: string): StoryScript {
  const parsed = parseScript(raw);
  if (!parsed.ok) throw new WinnowError('protocol', `The copy of this series kept there is not a script this Atelier reads: ${parsed.reason}`);
  return { ...parsed.script, id };
}

/**
 * Push the script, guarded by the etag the record holds, reducing the record
 * around the request: an edit made while it is out keeps it dirty.
 */
export async function pushScript(remote: RemoteSource, script: StoryScript): Promise<SyncRecord> {
  const id = script.id!;
  const rec = records[id] ?? newSyncRecord(id, remote.sourceId, Date.now());
  putRecord(reduceSync(rec, { type: 'pushStarted', now: Date.now() }));
  const outcome = await putDocOnce(remote, STORY_DOC_KIND, id, STORY_DOC_VERSION, script, rec.etag, scriptSummary(script) as unknown as Record<string, unknown>);
  return reduceRecord(id, outcomeEvent(outcome, Date.now()))!;
}

/** The copy there, unless ours is still it. Never throws. */
export async function pullScript(remote: RemoteSource, id: string, ifNoneMatch: string | null): Promise<PullOutcome<StoryScript>> {
  try {
    const r = await remote.client.getDoc(DOCS_APP, id, ifNoneMatch);
    if (r === 'not-modified') return { kind: 'current' };
    return { kind: 'fetched', doc: fromWire(r.row.doc, id), etag: r.row.etag, updatedAt: r.row.updated_at };
  } catch (err) {
    return { kind: 'failed', failure: failureOf(err) };
  }
}

/**
 * Open the kept copy against this browser's: what to take (a newer copy over
 * a clean mirror) and the record's next state — a conflict when both moved.
 */
export async function resumeScript(remote: RemoteSource, id: string): Promise<StoryScript | null> {
  const rec = records[id];
  if (!rec) return null;
  const pulled = await pullScript(remote, id, rec.etag);
  const { take, event } = afterPull(rec, pulled);
  if (event) reduceRecord(id, event);
  return take;
}

export interface KeptSeries {
  id: string;
  summary: ScriptSummary;
  updatedAt: string;
}

/** The series this account keeps there, by their summaries. Throws the client's error. */
export async function listKeptScripts(remote: RemoteSource): Promise<KeptSeries[]> {
  const rows = remote.summaries
    ? await remote.client.listDocSummaries(DOCS_APP, STORY_DOC_KIND)
    : await remote.client.listDocs(DOCS_APP, STORY_DOC_KIND);
  return rows.flatMap((row) => {
    const r = row as { id: string; updated_at: string; summary?: unknown; doc?: unknown };
    const summary = readScriptSummary(r.summary) ?? (r.doc !== undefined ? (() => {
      const p = parseScript(r.doc);
      return p.ok ? scriptSummary(p.script) : null;
    })() : null);
    return summary ? [{ id: r.id, summary, updatedAt: r.updated_at }] : [];
  });
}

/** One kept series in full, as this browser's mirror from now on. Throws the client's error. */
export async function takeKeptScript(remote: RemoteSource, id: string): Promise<StoryScript> {
  const r = await remote.client.getDoc(DOCS_APP, id);
  if (r === 'not-modified') throw new WinnowError('protocol', `${remote.label} answered 304 to an unconditional GET.`);
  const script = fromWire(r.row.doc, id);
  const rec = records[id] ?? newSyncRecord(id, remote.sourceId, Date.now());
  putRecord(reduceSync({ ...rec, sourceId: remote.sourceId }, { type: 'pulled', etag: r.row.etag, now: Date.now() }));
  return script;
}
