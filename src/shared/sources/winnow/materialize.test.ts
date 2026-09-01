import { describe, expect, it } from 'vitest';
import { WinnowClient, type WinnowAssetRow } from './client';
import { identityFor, materialize, plannedFiles } from './materialize';
import { hashedMediaRef, knownIdentity, mediaHash } from '../../projects/media-identity';

const BASE = 'https://winnow.example';

const row = (over: Partial<WinnowAssetRow> = {}): WinnowAssetRow => ({
  id: 42,
  filename: 'DJI_0001.MP4',
  ext: 'mp4',
  media_type: 'video',
  captured_at: '2025-07-09T08:30:00.000Z',
  capture_date: '2025-07-09',
  width: 3840,
  height: 2160,
  duration_s: 12,
  file_size: 500_000_000,
  content_hash: 'abc123',
  gps_lat: null,
  gps_lon: null,
  camera_model: 'DJI Mini 4 Pro',
  derivative_status: 'ready',
  has_telemetry: true,
  sidecars: [{ id: 7, kind: 'srt', filename: 'DJI_0001.SRT' }],
  ...over,
});

function clientServing(bytes: Record<string, number>) {
  return new WinnowClient({ baseUrl: BASE, auth: { mode: 'cookie' } }, async (url) => {
    const n = bytes[new URL(url).pathname];
    if (n === undefined) return new Response('', { status: 404 });
    return new Response(new Uint8Array(n));
  });
}

describe('plannedFiles', () => {
  const c = clientServing({});
  it('names a video proxy after the original base name, as .mp4, with its .srt', () => {
    expect(plannedFiles(c, row(), 'proxy')).toEqual([
      { url: `${BASE}/api/assets/42/proxy`, name: 'DJI_0001.mp4', type: 'video/mp4' },
      { url: `${BASE}/api/sidecars/7/download`, name: 'DJI_0001.SRT', type: 'text/plain' },
    ]);
  });
  it('names a photo proxy .webp — the decodable half of a RAW', () => {
    const photo = row({ filename: 'DSC00123.ARW', media_type: 'photo', sidecars: [] });
    expect(plannedFiles(c, photo, 'proxy')).toEqual([
      { url: `${BASE}/api/assets/42/proxy`, name: 'DSC00123.webp', type: 'image/webp' },
    ]);
  });
  it('keeps the exact original filename for the original', () => {
    expect(plannedFiles(c, row(), 'original')[0]).toEqual({
      url: `${BASE}/api/assets/42/download`,
      name: 'DJI_0001.MP4',
      type: '',
    });
  });
  it('ignores Sony xml/thm companions — nothing here reads them', () => {
    const sony = row({ sidecars: [{ id: 1, kind: 'xml', filename: 'C0001M01.XML' }] });
    expect(plannedFiles(c, sony, 'proxy')).toHaveLength(1);
  });
});

describe('identityFor', () => {
  it('scopes the asset id to its source and carries the content hash', () => {
    expect(identityFor('winnow.example', row())).toEqual({
      assetId: 'winnow.example/42',
      hash: 'abc123',
    });
  });
  it('omits a hash Winnow does not have rather than writing null', () => {
    expect(identityFor('winnow.example', row({ content_hash: null }))).toEqual({
      assetId: 'winnow.example/42',
    });
  });
});

describe('materialize', () => {
  it('fetches the clip and its log, dated at capture, vouched with the ORIGINAL hash', async () => {
    const c = clientServing({ '/api/assets/42/proxy': 10, '/api/sidecars/7/download': 3 });
    const seen: string[] = [];
    const files = await materialize(c, 'winnow.example', row(), {
      fidelity: 'proxy',
      onFile: (f, i, n) => seen.push(`${i}/${n} ${f.name}`),
    });
    expect(files.map((f) => f.name)).toEqual(['DJI_0001.mp4', 'DJI_0001.SRT']);
    expect(files[0].lastModified).toBe(Date.parse('2025-07-09T08:30:00.000Z'));
    expect(seen).toEqual(['1/2 DJI_0001.mp4', '2/2 DJI_0001.SRT']);

    // The proxy's own bytes are nobody's identity: the ref carries Winnow's.
    expect(knownIdentity(files[0])).toEqual({ assetId: 'winnow.example/42', hash: 'abc123' });
    expect(await mediaHash(files[0])).toBe('abc123');
    expect(await hashedMediaRef(files[0])).toMatchObject({
      name: 'DJI_0001.mp4',
      assetId: 'winnow.example/42',
      hash: 'abc123',
    });
  });

  it('surfaces a missing rendition as an error instead of a silent gap', async () => {
    const c = clientServing({});
    await expect(
      materialize(c, 'winnow.example', row({ sidecars: [] }), { fidelity: 'proxy' }),
    ).rejects.toMatchObject({ kind: 'protocol', status: 404 });
  });
});
