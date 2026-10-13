import { describe, expect, it } from 'vitest';
import { packPreview, previewAsk, RoadPreviewer, strayOf, unpackPreview } from './road-preview';
import { DEFAULT_ROAD_DRIVE, makeTripRoad, roadDriveOf, tripRoadLine, type RoadDrive, type RoadFix } from './road-track';

const T0 = 1_751_300_000; // invented, mid-2025
const span = { startDate: '2025-06-30', endDate: '2025-07-01' };

/** Two hours east at 80 km/h, a fix a minute, 40 m off the road side to side. */
function noisy(): RoadFix[] {
  const out: RoadFix[] = [];
  const kmLon = 111.32 * Math.cos((-31.5 * Math.PI) / 180);
  for (let m = 0; m <= 120; m++) out.push({ t: T0 + m * 60, lat: -31.5 + (m % 2 ? 40 : -40) / 110574, lon: 128 + (80 * m) / 60 / kmLon });
  return out;
}

describe('the Road pane’s preview', () => {
  const road = makeTripRoad(noisy(), span, null, 1)!;

  it('draws the very line the trip reads once written, for every drive', () => {
    const previewer = new RoadPreviewer();
    for (const style of ['fixes', 'driver', 'ribbon'] as const) {
      const drive: RoadDrive = { ...DEFAULT_ROAD_DRIVE, style };
      const preview = previewer.preview(previewAsk(road, 'moves', 100, drive));
      const written = { ...road, mode: 'moves' as const, detail: 100, drive };
      expect(preview.line).toEqual(tripRoadLine(written));
    }
  });

  it('says each mode’s kilometres, and how far the drive strays from the fixes', () => {
    const preview = new RoadPreviewer().preview(previewAsk(road, 'raw', 0, roadDriveOf(road)));
    expect(preview.modes.raw.km).toBeGreaterThan(155);
    expect(preview.modes.raw.points).toBe(121);
    expect(preview.fixes[0]).toHaveLength(121);
    // The ribbon leaves the zigzag: off the fixes on average, never further than its corridor.
    expect(preview.stray!.meanM).toBeGreaterThan(10);
    expect(preview.stray!.maxM).toBeLessThan(100);
    // As recorded, every fix is ON the line.
    const plain = new RoadPreviewer().preview(previewAsk(road, 'raw', 0, { ...DEFAULT_ROAD_DRIVE, style: 'fixes' }));
    expect(plain.stray!.maxM).toBeLessThan(1);
  });

  it('draws nothing as the crow flies, and still counts every mode', () => {
    const preview = new RoadPreviewer().preview(previewAsk(road, 'crow', 100, DEFAULT_ROAD_DRIVE));
    expect(preview.line.pieces).toEqual([]);
    expect(preview.stray).toBeNull();
    expect(preview.modes.stages.km).toBeGreaterThan(150);
  });

  it('crosses the worker’s boundary intact', () => {
    const preview = new RoadPreviewer().preview(previewAsk(road, 'moves', 100, DEFAULT_ROAD_DRIVE));
    const { packed, transfer } = packPreview(preview);
    expect(transfer.length).toBe(packed.line.pieces.length + packed.recorded.length + packed.fixes.length);
    const back = unpackPreview(structuredClone(packed));
    expect(back).toEqual(preview);
    // A line as recorded has no counted km on its points, and gets none back.
    const plain = new RoadPreviewer().preview(previewAsk(road, 'moves', 100, { ...DEFAULT_ROAD_DRIVE, style: 'fixes' }));
    expect(unpackPreview(packPreview(plain).packed).line.pieces[0][0]).not.toHaveProperty('km');
  });

  it('measures a stray of a known size', () => {
    const line = [
      { t: 0, lat: 0, lon: 0 },
      { t: 1, lat: 0, lon: 1 },
    ];
    const fixes = [
      { t: 0, lat: 0.001, lon: 0.5 },
      { t: 1, lat: -0.002, lon: 0.6 },
    ];
    const stray = strayOf([fixes], [line], [line])!;
    expect(stray.maxM).toBeCloseTo(221.1, 0);
    expect(stray.meanM).toBeCloseTo(165.9, 0);
  });
});
