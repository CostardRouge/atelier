import { describe, expect, it } from 'vitest';
import {
  openingRendition,
  renditionById,
  renditionsOf,
  type CaptureInput,
} from './renditions';

/** Chrome 152 in the maintainer's desktop app, measured 2026-09-21. */
const chrome = (name: string) => /\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(name);
/** WebKit, which draws HEIF as well. */
const webkit = (name: string) => chrome(name) || /\.(heic|heif|hif)$/i.test(name);

const ids = (input: CaptureInput) => renditionsOf(input).map((r) => r.id);

describe('renditionsOf', () => {
  it('gives a lone JPEG one delivered row', () => {
    const rows = renditionsOf({ open: { name: 'DJI_0025.JPG', bytes: 5e6, here: true, pixels: { width: 2171, height: 2058 } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'delivered:dji_0025.jpg', role: 'delivered', reach: 'file', blocked: null });
  });

  it('gives a RAW TWO rows — its camera render and its sensor', () => {
    // The maintainer's A7C II: the render inside the file is full size.
    const rows = renditionsOf({
      open: {
        name: 'DSC08463.ARW',
        bytes: 34.6e6,
        here: true,
        render: { width: 7008, height: 4672 },
        sensor: { width: 7040, height: 4688 },
      },
    });
    expect(rows.map((r) => [r.role, r.reach])).toEqual([
      ['delivered', 'embedded'],
      ['sensor', 'sensor'],
    ]);
    expect(rows[0].pixels).toEqual({ width: 7008, height: 4672 });
    expect(rows[1].pixels).toEqual({ width: 7040, height: 4688 });
  });

  it('says the same thing about a DJI DNG, whose two rows are 8.4× apart', () => {
    const rows = renditionsOf({
      open: {
        name: 'dji_fly_0242_photo.DNG',
        here: true,
        render: { width: 960, height: 540 },
        sensor: { width: 8064, height: 4536 },
      },
    });
    expect(rows[0].pixels).toEqual({ width: 960, height: 540 });
    expect(rows[1].pixels).toEqual({ width: 8064, height: 4536 });
  });

  it('puts a source proxy first and keeps the capture file’s own rows', () => {
    const rows = renditionsOf({
      open: { name: 'DSC08463.webp', bytes: 4e5, here: true, pixels: { width: 2048, height: 1365 } },
      openIsProxy: true,
      others: [{ name: 'DSC08463.ARW', bytes: 34.6e6, assetId: 'winnow/12', render: { width: 7008, height: 4672 } }],
    });
    expect(rows.map((r) => r.id)).toEqual(['proxy', 'delivered:dsc08463.arw', 'sensor:dsc08463.arw']);
    expect(rows[0].here).toBe(true);
    expect(rows[1].here).toBe(false);
    expect(rows[1].assetId).toBe('winnow/12');
  });

  it('drops a HEIF this browser cannot draw when the ARW beside it already can', () => {
    // The measured Sony pair: both are 7008 × 4672, and only one is reachable.
    const input: CaptureInput = {
      open: { name: 'DSC07666.HIF', bytes: 12.6e6, here: true },
      others: [{ name: 'DSC07666.ARW', bytes: 34.6e6, here: true, render: { width: 7008, height: 4672 } }],
      canDraw: chrome,
    };
    expect(ids(input)).toEqual(['delivered:dsc07666.arw', 'sensor:dsc07666.arw']);
  });

  it('keeps that HEIF, blocked and saying why, when nothing else is drawable', () => {
    const rows = renditionsOf({ open: { name: 'DSC07666.HIF', bytes: 12.6e6, here: true }, canDraw: chrome });
    expect(rows).toHaveLength(1);
    expect(rows[0].reach).toBe('decoder');
    expect(rows[0].blocked).toBe('this browser does not draw HIF');
  });

  it('keeps it on a browser that draws it, and then it is not blocked at all', () => {
    const rows = renditionsOf({
      open: { name: 'DSC07666.HIF', bytes: 12.6e6, here: true, pixels: { width: 7008, height: 4672 } },
      others: [{ name: 'DSC07666.ARW', here: true, render: { width: 7008, height: 4672 } }],
      canDraw: webkit,
    });
    expect(rows.filter((r) => r.role === 'delivered').map((r) => r.reach)).toEqual(['file', 'embedded']);
    expect(rows.every((r) => r.blocked === null)).toBe(true);
  });

  it('keeps a blocked row that is MEASURABLY bigger than what is drawable', () => {
    const rows = renditionsOf({
      open: { name: 'IMG_1.JPG', here: true, pixels: { width: 1600, height: 1200 } },
      others: [{ name: 'IMG_1.HIF', here: true, pixels: { width: 7008, height: 4672 } }],
      canDraw: chrome,
    });
    expect(rows.map((r) => r.id)).toEqual(['delivered:img_1.jpg', 'delivered:img_1.hif']);
    expect(rows[1].blocked).toBe('this browser does not draw HIF');
  });

  it('orders by role, then by the pixels that were measured, unmeasured last', () => {
    const rows = renditionsOf({
      open: { name: 'A.webp', here: true, pixels: { width: 2048, height: 1365 } },
      openIsProxy: true,
      others: [
        { name: 'A.ARW', render: { width: 7008, height: 4672 }, sensor: { width: 7040, height: 4688 } },
        { name: 'A.JPG', pixels: { width: 3000, height: 2000 } },
      ],
    });
    expect(rows.map((r) => r.role)).toEqual(['proxy', 'delivered', 'delivered', 'sensor']);
    expect(rows[1].name).toBe('A.JPG');
    expect(rows[2].name).toBe('A.ARW');
  });

  it('says a RAW that carries no render at all, rather than hiding the row', () => {
    const rows = renditionsOf({ open: { name: 'X.NEF', here: true, render: null } });
    expect(rows[0].blocked).toBe('this file carries no render a browser can draw');
    expect(rows[1].role).toBe('sensor');
  });

  it('never lists one file twice, whatever a caller passes', () => {
    const rows = renditionsOf({
      open: { name: 'A.ARW', here: true },
      others: [{ name: 'a.arw' }, { name: 'A.ARW' }],
    });
    expect(rows).toHaveLength(2);
  });
});

describe('renditionById', () => {
  it('finds a stored choice, and answers null for one this capture no longer has', () => {
    const rows = renditionsOf({ open: { name: 'DSC08463.ARW', here: true, render: { width: 7008, height: 4672 } } });
    expect(renditionById(rows, 'sensor:dsc08463.arw')?.role).toBe('sensor');
    expect(renditionById(rows, 'sensor:gone.arw')).toBeNull();
    expect(renditionById(rows, null)).toBeNull();
  });
});

describe('openingRendition', () => {
  it('opens on the proxy when there is one', () => {
    const rows = renditionsOf({
      open: { name: 'A.webp', here: true, pixels: { width: 2048, height: 1365 } },
      openIsProxy: true,
      others: [{ name: 'A.ARW', assetId: 'winnow/9', render: { width: 7008, height: 4672 } }],
    });
    expect(openingRendition(rows)?.id).toBe('proxy');
  });

  it('opens on a file in hand before one that would have to be fetched', () => {
    const rows = renditionsOf({
      open: { name: 'A.ARW', here: true, render: { width: 7008, height: 4672 } },
      others: [{ name: 'A.JPG', assetId: 'winnow/9', pixels: { width: 3000, height: 2000 } }],
    });
    expect(openingRendition(rows)?.name).toBe('A.ARW');
  });

  it('never opens on the sensor, and never on a blocked row', () => {
    const rows = renditionsOf({ open: { name: 'DSC07666.HIF', here: true }, canDraw: chrome });
    expect(openingRendition(rows)).toBeNull();
  });
});
