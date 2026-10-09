import { describe, expect, it } from 'vitest';
import { addGpxToRoad, gpxTime, looksLikeGpx, mergeGpx, readGpx } from './gpx';

// Invented points.
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Test drive</name></metadata>
  <trk><name>Day 1</name><trkseg>
    <trkpt lat="-30.0" lon="120.0"><ele>310</ele><time>2025-07-01T08:00:00Z</time></trkpt>
    <trkpt lon='120.1' lat='-30.0'><time>2025-07-01T08:10:00.500Z</time></trkpt>
    <trkpt lat="-30.0" lon="120.2"><time>2025-07-01T18:20:00+10:00</time></trkpt>
    <trkpt lat="-30.0" lon="120.3"></trkpt>
    <trkpt lat="95" lon="120.3"><time>2025-07-01T08:40:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

describe('readGpx', () => {
  it('keeps the timed points in time order and counts the rest', () => {
    const read = readGpx('drive.gpx', GPX);
    if ('error' in read) throw new Error(read.error);
    expect(read.fixes.map((f) => f.lon)).toEqual([120, 120.1, 120.2]);
    expect(read.fixes[0].time).toBe(Date.UTC(2025, 6, 1, 8) / 1000);
    expect(read.fixes[2].time).toBe(Date.UTC(2025, 6, 1, 8, 20) / 1000);
    expect(read.untimed).toBe(1);
    expect(read.skipped).toBe(1);
    expect(read.name).toBe('Test drive');
  });

  it('reads a time with no zone as UTC, and a prefixed or self-closing point', () => {
    expect(gpxTime('2025-07-01T08:00:00')).toBe(Date.UTC(2025, 6, 1, 8) / 1000);
    expect(gpxTime('nope')).toBeNull();
    const odd = `<gpx:gpx><gpx:wpt lat="1" lon="2"/><gpx:rtept lat="1" lon="3"><gpx:time>2025-01-01T00:00:00Z</gpx:time></gpx:rtept></gpx:gpx>`;
    const read = readGpx('x.xml', odd);
    if ('error' in read) throw new Error(read.error);
    expect(read.fixes).toHaveLength(1);
    expect(read.untimed).toBe(1);
  });

  it('refuses a planned route and what is not GPX, with the reason', () => {
    const route = '<gpx><rte><rtept lat="1" lon="2"></rtept></rte></gpx>';
    expect(readGpx('plan.gpx', route)).toEqual({ error: 'plan.gpx has no times: a planned route cannot be put on the trip’s clock.' });
    expect(readGpx('notes.json', '{"a":1}')).toEqual({ error: 'notes.json is not a GPX file.' });
    expect(looksLikeGpx('track.xml', '<?xml version="1.0"?>\n<gpx>')).toBe(true);
    expect(readGpx('empty.gpx', '<gpx></gpx>')).toEqual({ error: 'empty.gpx holds no point.' });
  });

  it('merges a file a day into one journey, the same instant once', () => {
    const a = readGpx('a.gpx', GPX);
    const b = readGpx('b.gpx', GPX.replace(/2025-07-01/g, '2025-07-02'));
    if ('error' in a || 'error' in b) throw new Error('unread');
    const one = mergeGpx([b, a, a]);
    expect(one.fixes).toHaveLength(6);
    expect(one.fixes[0].time).toBeLessThan(one.fixes[5].time);
  });
});

describe('addGpxToRoad', () => {
  const span = { startDate: '2025-07-01', endDate: '2025-07-03' };

  it('makes a road from GPX alone, then adds nothing the second time', () => {
    const first = addGpxToRoad(null, [{ name: 'drive.gpx', body: GPX }], span, 1);
    expect(first.road!.source).toBe('gpx');
    expect(first.added).toBe(3);
    expect(first.note).toBe('3 fixes added from drive.gpx.');
    const again = addGpxToRoad(first.road, [{ name: 'drive.gpx', body: GPX }], span, 2);
    expect(again.added).toBe(0);
    expect(again.road).toBe(first.road);
    expect(again.note).toMatch(/^Nothing added from drive.gpx/);
  });

  it('says each file it refused', () => {
    const out = addGpxToRoad(null, [{ name: 'plan.gpx', body: '<gpx><rtept lat="1" lon="2"></rtept></gpx>' }], span, 1);
    expect(out.road).toBeNull();
    expect(out.errors).toHaveLength(1);
    expect(out.note).toMatch(/planned route/);
  });
});
