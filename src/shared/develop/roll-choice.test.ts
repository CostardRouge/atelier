import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { renditionsOf } from '../media/renditions';
import {
  departsFromRoll,
  followsRoll,
  ontoRollSensor,
  ownChoice,
  readRollChoice,
  resolveRollChoice,
  roleOfRow,
  rollChoiceFor,
} from './roll-choice';

const photo = (over: { rendition?: string | null; develop?: typeof DEFAULT_DEVELOP | null; name?: string } = {}) => ({
  ref: { name: over.name ?? 'DSC08463.ARW' },
  rendition: over.rendition ?? null,
  develop: over.develop ?? null,
});
const onSensor = { ...DEFAULT_DEVELOP, base: 'gain' as const, rawGain: 1.4 };
const brighter = { ...DEFAULT_DEVELOP, exposure: 0.5 };

describe('a picture’s own choice', () => {
  it('reads the sensor from the base and a file from the rendition', () => {
    expect(ownChoice(photo())).toBeNull();
    expect(ownChoice(photo({ develop: onSensor }))).toBe('sensor');
    expect(ownChoice(photo({ rendition: 'delivered:dsc08463.arw' }))).toBe('delivered');
    expect(ownChoice(photo({ rendition: 'proxy' }))).toBe('proxy');
    // The base wins over a rendition left standing under it.
    expect(ownChoice(photo({ rendition: 'delivered:dsc08463.arw', develop: onSensor }))).toBe('sensor');
  });

  it('follows the roll only where it chose nothing, and never as a clip', () => {
    expect(followsRoll('delivered', photo())).toBe(true);
    expect(followsRoll(null, photo())).toBe(false);
    expect(followsRoll('delivered', photo({ rendition: 'proxy' }))).toBe(false);
    expect(followsRoll('sensor', photo({ name: 'DJI_0210.MP4' }))).toBe(false);
  });

  it('departs only from a roll that has a choice, and only by a different role', () => {
    expect(departsFromRoll(null, photo({ rendition: 'delivered:x.jpg' }))).toBe(false);
    expect(departsFromRoll('delivered', photo({ rendition: 'delivered:x.jpg' }))).toBe(false);
    expect(departsFromRoll('delivered', photo({ develop: onSensor }))).toBe(true);
    expect(departsFromRoll('sensor', photo({ rendition: 'proxy' }))).toBe(true);
    expect(departsFromRoll('sensor', photo())).toBe(false);
  });

  it('never hands the sensor to numbers set on the render', () => {
    expect(rollChoiceFor('sensor', photo())).toEqual({ choice: 'sensor', reason: null });
    const refused = rollChoiceFor('sensor', photo({ develop: brighter }));
    expect(refused.choice).toBeNull();
    expect(refused.reason).toMatch(/set on the render/);
    // The camera's file is the same 8-bit material: the numbers travel.
    expect(rollChoiceFor('delivered', photo({ develop: brighter }))).toEqual({ choice: 'delivered', reason: null });
    expect(rollChoiceFor('delivered', photo({ rendition: 'proxy' }))).toEqual({ choice: null, reason: null });
  });

  it('reads a stored value back as one of the two roles, else nothing', () => {
    expect(readRollChoice('delivered')).toBe('delivered');
    expect(readRollChoice('sensor')).toBe('sensor');
    expect(readRollChoice('proxy')).toBeNull();
    expect(readRollChoice(undefined)).toBeNull();
    expect(readRollChoice(42)).toBeNull();
  });
});

describe('a batch onto a picture on the roll’s sensor', () => {
  it('keeps it there with a sensor’s numbers, its gain left to be metered', () => {
    // On the opening curve the stage and the export put a roll's sensor on, or the batch's own.
    expect(ontoRollSensor('sensor', photo(), true, brighter)).toEqual({ ...brighter, base: 'gain', rawGain: null, rawProfile: 'pending', baseCurve: { kind: 'standard' } });
    expect(ontoRollSensor('sensor', photo(), true, { ...brighter, baseCurve: { kind: 'linear' } })?.baseCurve).toEqual({ kind: 'linear' });
  });

  it('leaves everything else as the batch wrote it', () => {
    // Numbers made on a render, a roll on the camera file, a picture with a choice of its own, nothing at all.
    expect(ontoRollSensor('sensor', photo(), false, brighter)).toBe(brighter);
    expect(ontoRollSensor('delivered', photo(), true, brighter)).toBe(brighter);
    expect(ontoRollSensor('sensor', photo({ rendition: 'proxy' }), true, brighter)).toBe(brighter);
    expect(ontoRollSensor('sensor', photo(), true, null)).toBeNull();
  });
});

describe('resolveRollChoice — the camera’s file', () => {
  it('takes the Sony’s full-size render over its proxy', () => {
    const rows = renditionsOf({
      open: { name: 'DSC08463.webp', here: true, pixels: { width: 2048, height: 1365 } },
      openIsProxy: true,
      others: [{ name: 'DSC08463.ARW', assetId: 'w/1', render: { width: 7008, height: 4672 }, sensor: { width: 7040, height: 4688 } }],
    });
    const answer = resolveRollChoice(rows, 'delivered');
    expect(answer.row?.id).toBe('delivered:dsc08463.arw');
    expect(answer.reason).toBeNull();
  });

  it('keeps a lone DJI DNG on its proxy: its render is 960 × 540', () => {
    const rows = renditionsOf({
      open: { name: 'DJI_0202.webp', here: true, pixels: { width: 2048, height: 1152 } },
      openIsProxy: true,
      others: [{ name: 'DJI_0202.DNG', assetId: 'w/2', render: { width: 960, height: 540 }, sensor: { width: 8064, height: 4536 } }],
    });
    const answer = resolveRollChoice(rows, 'delivered');
    expect(answer.row).toBeNull();
    expect(answer.pending).toBe(false);
    expect(answer.reason).toBe('its camera render is 960 × 540, smaller than the proxy');
  });

  it('decides nothing while the render inside the RAW is unmeasured', () => {
    const rows = renditionsOf({
      open: { name: 'DJI_0202.webp', here: true, pixels: { width: 2048, height: 1152 } },
      openIsProxy: true,
      others: [{ name: 'DJI_0202.DNG', assetId: 'w/2' }],
    });
    expect(resolveRollChoice(rows, 'delivered')).toMatchObject({ row: null, pending: true });
  });

  it('waits for the proxy’s own size before comparing a render with it', () => {
    const rows = renditionsOf({
      open: { name: 'DSC08463.webp', here: true },
      openIsProxy: true,
      others: [{ name: 'DSC08463.ARW', assetId: 'w/1', render: { width: 7008, height: 4672 } }],
    });
    expect(resolveRollChoice(rows, 'delivered')).toMatchObject({ row: null, pending: true });
  });

  it('prefers a DJI’s JPEG to the small render inside its DNG', () => {
    const rows = renditionsOf({
      open: { name: 'DJI_0203.webp', here: true, pixels: { width: 2048, height: 1152 } },
      openIsProxy: true,
      others: [
        { name: 'DJI_0203.JPG', assetId: 'w/3', pixels: { width: 8064, height: 4536 } },
        { name: 'DJI_0203.DNG', assetId: 'w/4', render: { width: 960, height: 540 } },
      ],
    });
    expect(resolveRollChoice(rows, 'delivered').row?.id).toBe('delivered:dji_0203.jpg');
  });

  it('takes an unmeasured camera file — a proxy is a downscale of it', () => {
    const rows = renditionsOf({
      open: { name: 'P1010042.webp', here: true, pixels: { width: 2048, height: 1536 } },
      openIsProxy: true,
      others: [{ name: 'P1010042.JPG', assetId: 'w/5' }],
    });
    expect(resolveRollChoice(rows, 'delivered').row?.id).toBe('delivered:p1010042.jpg');
  });

  it('lands a local file with no proxy on itself', () => {
    const rows = renditionsOf({ open: { name: 'P1010042.JPG', here: true, pixels: { width: 5184, height: 3888 } } });
    expect(resolveRollChoice(rows, 'delivered').row?.id).toBe('delivered:p1010042.jpg');
  });
});

describe('resolveRollChoice — the sensor', () => {
  it('lands on the sensor row where the capture has a RAW', () => {
    const rows = renditionsOf({
      open: { name: 'DJI_0202.webp', here: true, pixels: { width: 2048, height: 1152 } },
      openIsProxy: true,
      others: [{ name: 'DJI_0202.DNG', assetId: 'w/2', render: { width: 960, height: 540 } }],
    });
    const answer = resolveRollChoice(rows, 'sensor');
    expect(answer.row?.role).toBe('sensor');
    expect(roleOfRow(answer.row!)).toBe('sensor');
  });

  it('says so where there is none', () => {
    const rows = renditionsOf({ open: { name: 'IMG_4021.JPG', here: true } });
    expect(resolveRollChoice(rows, 'sensor')).toEqual({ row: null, reason: 'no RAW in this capture', pending: false });
  });
});
