import { describe, expect, it } from 'vitest';
import { recordingContext } from '../story/recording-context';
import { createRecapDoc, withPictures, withRecap, withTextStyle } from './recap-doc';
import { layoutRecap } from './recap-layout';
import { filledOf, planFilm } from './recap-motion';
import { paintRecap } from './recap-paint';
import { resolveRecap } from './recap-slots';
import { TEXT_PRESETS, presetStyle, readTextStyle, readTextStyles, rolesOf } from './recap-text';

function ops(doc: ReturnType<typeof createRecapDoc>) {
  const r = resolveRecap(doc);
  const layout = layoutRecap(doc, r);
  const rec = recordingContext(1080, 1920);
  paintRecap(rec.ctx, 1080, doc, r, layout, planFilm(doc, layout, () => null, filledOf(r)), { still: () => ({ image: {} as CanvasImageSource, width: 4, height: 3 }) }, { t: 99, page: 0 });
  return rec.ops;
}

describe('recap text styles', () => {
  it('reads the suite’s title styles as presets, and Recap’s own', () => {
    const ids = TEXT_PRESETS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['neutral', 'or-cine', 'pixel-crt', 'plein-cadre', 'outline', 'soft-shadow']));
    const red = presetStyle('plein-cadre')!;
    expect(red).toMatchObject({ font: 'space', weight: 700, colour: '#f01d0e', upper: true, preset: 'plein-cadre' });
    expect(presetStyle('or-cine')!.glow).toBeGreaterThan(0);
    expect(presetStyle('nope')).toBeNull();
  });

  it('reads an untrusted style with every value clamped', () => {
    const st = readTextStyle({ font: 'comic', size: 9, weight: 1234, colour: 'red', outline: 4, shadowY: -9, preset: 'nope' });
    expect(st).toMatchObject({ font: 'auto', size: 3, weight: 900, colour: null, outline: 0.25, shadowY: -0.5, preset: null });
    expect(readTextStyles({ heading: { size: 2 }, bogus: { size: 2 } })).toEqual({ heading: expect.objectContaining({ size: 2 }) });
    expect(rolesOf('month')).toContain('weekdays');
    expect(rolesOf('onThisDay')).toContain('labels');
  });

  it('draws each text in its own style: face, weight, colour, outline, size', () => {
    let doc = withPictures(createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 }), [{ key: 'a', origin: 'local', name: 'a', kind: 'photo', day: '2026-10-02' }]);
    doc = withTextStyle(doc, 'heading', presetStyle('plein-cadre'));
    const red = ops(doc).find((o) => o.includes('"OCTOBER"'))!;
    expect(red).toContain('700');
    expect(red).toContain('Space Grotesk');
    expect(red).toContain('#f01d0e');
    doc = withTextStyle(doc, 'weekdays', presetStyle('outline'));
    expect(ops(doc).some((o) => o.startsWith('strokeText "MONDAY"'))).toBe(true);
    const plain = ops(withRecap(doc, { texts: {} })).find((o) => o.includes('"OCTOBER"'))!;
    const big = ops(withTextStyle(doc, 'heading', { size: 2 })).find((o) => o.includes('"OCTOBER"'))!;
    const px = (o: string) => Number(/ (\d+)px /.exec(o)![1]);
    expect(px(big)).toBeGreaterThan(px(plain) * 1.8);
  });
});
