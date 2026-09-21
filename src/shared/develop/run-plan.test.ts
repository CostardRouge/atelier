import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { addPictures, createRollDoc, patchPicture, type RollPicture } from './roll-types';
import { planPicture, planRun, type PictureFacts } from './run-plan';
import type { SensorSource } from './sensor-source';

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${n} B`);

function file(name: string, bytes = 100): File {
  return new File([new Uint8Array(bytes)], name);
}

const src = (reach: SensorSource['reach'], name: string, bytes: number, held: boolean): SensorSource => ({
  reach,
  name,
  bytes,
  key: null,
  held: held ? file(name, bytes) : null,
  fetch: null,
});

let n = 0;
function roll(names: string[]) {
  n = 0;
  return addPictures(createRollDoc('R4', 'local', 1000, 'r1'), names.map((name) => ({ name, size: 1, lastModified: 1 })), 2000, () => `p${++n}`);
}

const plain = (f: File | null, extra: Partial<PictureFacts> = {}): PictureFacts => ({
  file: f,
  proxy: false,
  sensor: null,
  delivered: null,
  original: null,
  ...extra,
});

describe('planPicture', () => {
  const p = (extra: Partial<RollPicture> = {}): RollPicture => ({ ...roll(['DSC08463.JPG']).pictures[0], ...extra });

  it('leaves from the sensor when the picture is developed on it, and says the fetch', () => {
    const onRaw = p({ develop: { ...DEFAULT_DEVELOP, base: 'gain', rawGain: 1 } });
    const plan = planPicture(onRaw, plain(file('DSC08463.webp'), { proxy: true, sensor: src('companion', 'DSC08463.ARW', 34.6e6, false) }), false);
    expect(plan).toMatchObject({ kind: 'sensor', from: 'DSC08463.ARW', fetchBytes: 34.6e6 });
    expect(plan.line).toContain('34600000 B to fetch');
  });

  it('leaves from the file chosen above the photograph', () => {
    const chosen = p({ rendition: 'delivered:dsc08463.jpg' });
    const plan = planPicture(chosen, plain(file('DSC08463.webp'), { proxy: true, delivered: src('original', 'DSC08463.JPG', 9e6, true) }), false);
    expect(plan).toMatchObject({ kind: 'delivered', from: 'DSC08463.JPG', fetchBytes: 0 });
    expect(plan.line).toContain('in hand');
  });

  it('leaves from the proxy otherwise, with Auto’s arithmetic said as a maybe', () => {
    const plan = planPicture(p(), plain(file('DSC08463.webp'), { proxy: true, original: { name: 'DSC08463.JPG', bytes: 9e6, held: false } }), false);
    expect(plan).toMatchObject({ kind: 'proxy', fetchBytes: 0, maybeBytes: 9e6 });
    expect(plan.line).toContain('fetched where the frame asks');
  });

  it('proxies only: everything leaves from what is in hand, a RAW base set aside and said', () => {
    const onRaw = p({ develop: { ...DEFAULT_DEVELOP, base: 'gain', rawGain: 1 } });
    const plan = planPicture(onRaw, plain(file('DSC08463.webp'), { proxy: true, sensor: src('companion', 'DSC08463.ARW', 34.6e6, false) }), true);
    expect(plan).toMatchObject({ kind: 'proxy', from: 'DSC08463.webp', fetchBytes: 0, maybeBytes: 0 });
    expect(plan.line).toContain('RAW base set aside');
  });

  it('says a picture that is not in hand', () => {
    expect(planPicture(p(), plain(null), false)).toMatchObject({ kind: 'missing', from: null });
  });
});

describe('planRun', () => {
  it('counts each source and the bytes, in one sentence', () => {
    const r = roll(['A.JPG', 'B.JPG', 'C.JPG', 'D.JPG']);
    const withRaw = patchPicture(r, 'p1', { develop: { ...DEFAULT_DEVELOP, base: 'gain', rawGain: 1 } });
    const doc = patchPicture(withRaw, 'p2', { rendition: 'delivered:b.jpg' });
    const facts: Record<string, PictureFacts> = {
      p1: plain(file('A.webp'), { proxy: true, sensor: src('companion', 'A.DNG', 60e6, false) }),
      p2: plain(file('B.webp'), { proxy: true, delivered: src('original', 'B.JPG', 9e6, false) }),
      p3: plain(file('C.webp'), { proxy: true, original: { name: 'C.JPG', bytes: 8e6, held: false } }),
      p4: plain(null),
    };
    const plan = planRun(doc.pictures, (p) => facts[p.id], false, fmt);
    expect(plan.total).toBe(4);
    expect(plan.fetchBytes).toBe(69e6);
    expect(plan.maybeBytes).toBe(8e6);
    expect(plan.summary).toBe(
      '4 pictures · 1 from the sensor · 1 from the file chosen · 1 from the proxy · 1 not in hand · 69 MB to fetch · up to 8 MB more where a frame asks',
    );
    expect(plan.pictures[0].line).toBe('A.JPG ← A.DNG, the sensor’s data (60 MB to fetch)');
    expect(plan.pictures[3].line).toBe('D.JPG — not in hand, left out');
  });

  it('proxies only fetches nothing and says how many bases it sets aside', () => {
    const r = patchPicture(roll(['A.JPG', 'B.JPG']), 'p1', { develop: { ...DEFAULT_DEVELOP, base: 'gain', rawGain: 1 } });
    const plan = planRun(r.pictures, (p) => plain(file(`${p.ref.name}.webp`), { proxy: true, sensor: src('original', 'A.DNG', 60e6, false) }), true, fmt);
    expect(plan.fetchBytes).toBe(0);
    expect(plan.summary).toBe('2 pictures · 2 from the proxy · proxies only, 1 RAW base set aside');
  });
});
