import { describe, expect, it, vi } from 'vitest';
import { WinnowClient } from '../sources/winnow/client';
import { DEFAULT_GUIDES } from '../overlay/guides';
import { PROJECT_DOC_VERSION, createProjectDoc, type ProjectDoc } from './project-types';
import {
  fromWireDoc,
  listRemoteProjects,
  pullProject,
  pushProject,
  toWireDoc,
  type RemoteSource,
} from './project-remote';

const HOST = 'winnow.example';
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

function remote(fetchImpl: FetchLike): RemoteSource {
  return {
    sourceId: HOST,
    label: HOST,
    client: new WinnowClient({ baseUrl: `https://${HOST}`, auth: { mode: 'cookie' } }, fetchImpl),
    maxBytes: null,
  };
}

/** A project with everything a machine binds: a handle stand-in, a thumbnail, media refs. */
function project(): ProjectDoc {
  const doc = createProjectDoc('Vol du soir', '9:16', [], DEFAULT_GUIDES);
  doc.sourceId = HOST;
  doc.media = {
    dirHandle: { name: 'clips' } as unknown as ProjectDoc['media']['dirHandle'],
    files: [{ name: 'DJI_0001.MP4', size: 10, lastModified: 1, hash: 'abc' }],
    activeId: 'dji_0001',
    trims: { dji_0001: { start: 1, end: 5, duration: 9 } },
  };
  doc.thumbnail = new Blob(['jpeg']);
  return doc;
}

describe('the wire shape', () => {
  it('sends everything but what is this machine’s: source, handle, thumbnail', () => {
    const wire = toWireDoc(project());
    expect(wire).not.toHaveProperty('sourceId');
    expect(wire).not.toHaveProperty('thumbnail');
    expect(wire.media).not.toHaveProperty('dirHandle');
    // The media LIST travels — that is how the project finds its clips elsewhere.
    expect(wire.media.files[0].hash).toBe('abc');
    expect(wire.media.trims.dji_0001.start).toBe(1);
    expect(wire.media.activeId).toBe('dji_0001');
    expect(JSON.parse(JSON.stringify(wire))).not.toHaveProperty('thumbnail');
  });

  it('stamps id and source from the request and keeps the mirror’s handle and thumbnail', () => {
    const local = project();
    const body = { ...toWireDoc(project()), id: 'lying', sourceId: 'elsewhere' };
    const doc = fromWireDoc(body, 'real-id', HOST, local);
    expect(doc.id).toBe('real-id');
    expect(doc.sourceId).toBe(HOST);
    expect(doc.media.dirHandle).toBe(local.media.dirHandle);
    expect(doc.thumbnail).toBe(local.thumbnail);
    expect(doc.media.files[0].hash).toBe('abc');
  });

  it('a copy with no mirror has no handle and no thumbnail — never a fabricated one', () => {
    const doc = fromWireDoc(toWireDoc(project()), 'p1', HOST);
    expect(doc.media.dirHandle).toBeNull();
    expect(doc.thumbnail).toBeNull();
  });

  it('migrates an older stored copy like an older stored project', () => {
    const body = { ...toWireDoc(project()), version: 11 } as Record<string, unknown>;
    delete body.scenes;
    const doc = fromWireDoc(body, 'p1', HOST);
    expect(doc.version).toBe(PROJECT_DOC_VERSION);
    expect(doc.scenes).toEqual([]);
  });

  it('refuses a body that is not a project', () => {
    expect(() => fromWireDoc({ hello: 'world' }, 'p1', HOST)).toThrow(/not a project/);
    expect(() => fromWireDoc(null, 'p1', HOST)).toThrow(/not a project/);
  });
});

describe('pushProject / pullProject / listRemoteProjects', () => {
  it('PUTs under kind project with the held etag', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ etag: 'e2', updated_at: 'x' }, { etag: 'e2' }));
    const doc = project();
    const rec = await pushProject(remote(fetchImpl), doc, null, 5);
    expect(rec.status).toBe('synced');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe(`/api/apps/atelier/docs/${doc.id}`);
    const body = JSON.parse(init.body as string);
    expect(body.kind).toBe('project');
    expect(body.version).toBe(PROJECT_DOC_VERSION);
    expect(body.doc.media).not.toHaveProperty('dirHandle');
  });

  it('a pull keeps this device’s handle on the fetched copy', async () => {
    const local = project();
    const row = { id: local.id, kind: 'project', version: PROJECT_DOC_VERSION, updated_at: 'u', etag: 'e2', doc: { ...toWireDoc(local), name: 'Renamed there' } };
    const r = await pullProject(remote(async () => ok(row, { etag: 'e2' })), local.id, 'e1', local);
    expect(r.kind).toBe('fetched');
    if (r.kind === 'fetched') {
      expect(r.doc.name).toBe('Renamed there');
      expect(r.doc.media.dirHandle).toBe(local.media.dirHandle);
      expect(r.etag).toBe('e2');
    }
  });

  it('lists by kind and skips a row that is not a project', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      ok({
        docs: [
          { id: 'p1', kind: 'project', version: PROJECT_DOC_VERSION, updated_at: 'u', etag: 'e1', doc: toWireDoc(project()) },
          { id: 'junk', kind: 'project', version: 1, updated_at: 'u', etag: 'e2', doc: { nope: 1 } },
        ],
      }),
    );
    const rows = await listRemoteProjects(remote(fetchImpl));
    expect(rows.map((r) => r.doc.id)).toEqual(['p1']);
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('kind')).toBe('project');
  });
});
