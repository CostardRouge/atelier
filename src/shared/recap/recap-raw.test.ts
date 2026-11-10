import { describe, expect, it } from 'vitest';
import type { RecapDoc, RecapPicture } from './recap-doc';
import { autoMaterialOf, isRawPicture, materialIsAuto, materialLabel, pictureMaterial, printKey, rawCount, withRawMaterial } from './recap-raw';

const dji: RecapPicture = { key: 'local:dji', origin: 'local', name: 'DJI_0001.DNG', kind: 'photo', day: null, width: 8064, height: 4536, renderEdge: 960 };
const sony: RecapPicture = { key: 'local:sony', origin: 'local', name: 'DSC01.ARW', kind: 'photo', day: null, width: 7040, height: 4688, renderEdge: 7008 };
const remote: RecapPicture = { key: 'winnow:a:1', origin: 'winnow', instance: 'a', asset: 1, name: 'DJI_0002.DNG', kind: 'photo', day: null, width: 8064, height: 4536 };
const jpeg: RecapPicture = { key: 'local:j', origin: 'local', name: 'IMG.JPG', kind: 'photo', day: null };
const doc = (raw: RecapDoc['raw'] = null, pictures: RecapPicture[] = [dji, sony, remote, jpeg]) => ({ raw, pictures }) as unknown as RecapDoc;

describe('recap RAW material', () => {
  it('knows a RAW still by its name', () => {
    expect(isRawPicture(dji)).toBe(true);
    expect(isRawPicture(jpeg)).toBe(false);
    expect(isRawPicture({ ...dji, kind: 'video' })).toBe(false);
  });
  it('Auto: a local DJI DNG on its sensor, a Sony ARW and a Winnow DNG on their render', () => {
    expect(autoMaterialOf(dji)).toBe('sensor');
    expect(autoMaterialOf(sony)).toBe('render');
    expect(autoMaterialOf(remote)).toBe('render');
  });
  it('a picture made before its render edge was recorded stays on its render', () => {
    expect(autoMaterialOf({ ...dji, renderEdge: undefined })).toBe('render');
  });
  it('the picture wins, then the recap, then Auto; a JPEG is always its render', () => {
    expect(pictureMaterial({ ...dji, material: 'render' }, doc('sensor'))).toBe('render');
    expect(pictureMaterial(remote, doc('sensor'))).toBe('sensor');
    expect(pictureMaterial(dji, doc())).toBe('sensor');
    expect(pictureMaterial(jpeg, doc('sensor'))).toBe('render');
  });
  it('says when the material is Auto’s', () => {
    expect(materialIsAuto(dji, doc())).toBe(true);
    expect(materialIsAuto({ ...dji, material: 'sensor' }, doc())).toBe(false);
    expect(materialIsAuto(dji, doc('render'))).toBe(false);
  });
  it('keeps the sensor’s print beside the render’s', () => {
    expect(printKey('local:dji', 'render')).toBe('local:dji');
    expect(printKey('local:dji', 'sensor')).toBe('local:dji#sensor');
  });
  it('for every RAW: sets the recap’s choice and clears the pictures’ own', () => {
    const d = withRawMaterial(doc(null, [{ ...dji, material: 'render' }, remote]), 'sensor');
    expect(d.raw).toBe('sensor');
    expect(d.pictures.every((p) => p.material === undefined)).toBe(true);
    expect(pictureMaterial(d.pictures[0], d)).toBe('sensor');
  });
  it('counts the RAWs and names a material for its origin', () => {
    expect(rawCount(doc())).toBe(3);
    expect(materialLabel('render', 'winnow')).toBe('Proxy');
    expect(materialLabel('render', 'local')).toBe('Camera render');
    expect(materialLabel('sensor', 'local')).toBe('Sensor');
  });
});
