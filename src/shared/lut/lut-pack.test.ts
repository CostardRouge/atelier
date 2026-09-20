import { describe, expect, it } from 'vitest';
import {
  buildPackIndex,
  familyFor,
  flattenNodes,
  isHidden,
  lookIn,
  lookLabel,
  looksUnder,
  nodeLabelPath,
  prettyName,
  readPackRef,
  slug,
  stripNodePrefix,
  visibleLooks,
  writePackRef,
  type PackFileEntry,
} from './lut-pack';

/**
 * The pack the plan is written against, file for file (`docs/lut-packs.md`
 * §2): three categories, one of them with no camera level, brands written
 * two different ways, and four files that are not looks at all.
 */
const AUTHENTIC: PackFileEntry[] = [
  { path: 'Conversion LUTs/Apple/APPLE_APPLE LOG.cube' },
  { path: 'Conversion LUTs/Canon/CANON_CLOG2.cube' },
  { path: 'Conversion LUTs/Canon/CANON_CLOG3.cube' },
  { path: 'Conversion LUTs/DJI/DJI_DLOG.cube' },
  { path: 'Conversion LUTs/Nikon/NIKON_NLOG.cube' },
  { path: 'Conversion LUTs/Panasonic/PANASONIC_VLOG.cube' },
  { path: 'Conversion LUTs/Sony/Sony_SLOG2_SGAMMUT.cube' },
  { path: 'Conversion LUTs/Sony/Sony_SLOG3_SGAMMUT3.CINE.cube' },
  { path: 'Creative LUT/AUTHENTIC_LUT.cube' },
  { path: 'One Click LUT/APPLE/AUTHENTIC_LUT_Apple_LOG.cube' },
  { path: 'One Click LUT/BLACKMAGIC/AUTHENTIC_LUT_FILM_GEN_5.cube' },
  { path: 'One Click LUT/CANON/AUTHENTIC_LUT_C-LOG.cube' },
  { path: 'One Click LUT/CANON/AUTHENTIC_LUT_C-LOG2.cube' },
  { path: 'One Click LUT/CANON/AUTHENTIC_LUT_C-LOG3.cube' },
  { path: 'One Click LUT/DJI/AUTHENTIC_LUT_D-LOG.cube' },
  { path: 'One Click LUT/FUJIFILM/AUTHENTIC_LUT_F-LOG.cube' },
  { path: 'One Click LUT/FUJIFILM/AUTHENTIC_LUT_F-LOG2.cube' },
  { path: 'One Click LUT/INSTA360/AUTHENTIC_LUT_I-LOG(CHAUD).cube' },
  { path: 'One Click LUT/INSTA360/AUTHENTIC_LUT_I-LOG(FROID).cube' },
  { path: 'One Click LUT/NIKON/AUTHENTIC_LUT_N-LOG.cube' },
  { path: 'One Click LUT/PANASONIC/AUTHENTIC_LUT_V-LOG.cube' },
  { path: 'One Click LUT/SAMSUNG/AUTHENTIC_LUT_Samsung_LOG.cube' },
  { path: 'One Click LUT/SONY/AUTHENTIC_LUT_S-LOG2.cube' },
  { path: 'One Click LUT/SONY/AUTHENTIC_LUT_S-LOG3_S-GAMUT3.CINE.cube' },
  { path: 'One Click LUT/SONY/AUTHENTIC_LUT_S-LOG3_S-GAMUT3.cube' },
  { path: 'Overlays/Vision 200T.mp4' },
  { path: 'Overlays/Vision 500T.mp4' },
  { path: 'tutorial.mp4' },
  { path: '.DS_Store' },
];

const authentic = () =>
  buildPackIndex(AUTHENTIC, {
    id: 'pk_test',
    name: 'AUTHENTIC',
    author: 'Victor Jimenes',
    url: 'https://victorjim.gumroad.com/l/authentic_lut',
  });

describe('buildPackIndex', () => {
  it('keeps the looks and leaves everything else out', () => {
    const index = authentic();
    expect(index.looks).toHaveLength(25);
    expect(index.looks.some((l) => l.file.endsWith('.mp4'))).toBe(false);
  });

  it('reads three categories, and a camera level only where there is one', () => {
    const index = authentic();
    expect(index.tree.map((n) => n.label)).toEqual(['Conversion', 'Creative', 'One Click']);

    const conversion = index.tree[0];
    expect(conversion.children?.map((n) => n.label)).toEqual([
      'Apple',
      'Canon',
      'DJI',
      'Nikon',
      'Panasonic',
      'Sony',
    ]);
    // Creative holds one look and no camera folder: no children at all.
    expect(index.tree[1].children).toBeUndefined();
    expect(index.looks.find((l) => l.node === 'creative')?.label).toBe('AUTHENTIC');
  });

  it('writes one brand per camera however the folders spell it', () => {
    const index = authentic();
    const labels = flattenNodes(index.tree).map(({ node }) => node.label);
    // `Apple` and `APPLE`, `Sony` and `SONY` are the same camera in two
    // categories — and each category has its own node, so two each, not four.
    expect(labels.filter((l) => l === 'Apple')).toHaveLength(2);
    expect(labels.filter((l) => l === 'Sony')).toHaveLength(2);
    expect(labels).not.toContain('APPLE');
    expect(labels).not.toContain('Insta360 '.trim() + 'x');
    expect(labels).toContain('Insta360');
    expect(labels).toContain('Fujifilm');
    expect(labels).toContain('Blackmagic');
  });

  it('names a look the way its maker writes the format, without the pack or the camera', () => {
    const index = authentic();
    const labelOf = (file: string) => index.looks.find((l) => l.file === file)?.label;

    expect(labelOf('One Click LUT/SONY/AUTHENTIC_LUT_S-LOG3_S-GAMUT3.CINE.cube')).toBe(
      'S-Log3 S-Gamut3.Cine',
    );
    expect(labelOf('One Click LUT/SONY/AUTHENTIC_LUT_S-LOG2.cube')).toBe('S-Log2');
    expect(labelOf('Conversion LUTs/Canon/CANON_CLOG3.cube')).toBe('C-Log3');
    expect(labelOf('Conversion LUTs/Apple/APPLE_APPLE LOG.cube')).toBe('Apple Log');
    expect(labelOf('One Click LUT/BLACKMAGIC/AUTHENTIC_LUT_FILM_GEN_5.cube')).toBe('Film Gen 5');
    // A parenthesised remark becomes a suffix, in English.
    expect(labelOf('One Click LUT/INSTA360/AUTHENTIC_LUT_I-LOG(CHAUD).cube')).toBe('I-Log · warm');
    expect(labelOf('One Click LUT/INSTA360/AUTHENTIC_LUT_I-LOG(FROID).cube')).toBe('I-Log · cold');
    // The camera the file repeats from its folder goes — unless dropping it
    // leaves a word that says nothing, because `Apple Log` IS the format.
    expect(labelOf('One Click LUT/APPLE/AUTHENTIC_LUT_Apple_LOG.cube')).toBe('Apple Log');
    expect(labelOf('One Click LUT/SAMSUNG/AUTHENTIC_LUT_Samsung_LOG.cube')).toBe('Samsung Log');
  });

  it('gives every look a stable, path-shaped id and keeps them distinct', () => {
    const index = authentic();
    const ids = index.looks.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('one-click/dji/d-log');
    expect(ids).toContain('conversion/sony/s-log3-s-gamut3-cine');
    // Building the same folder twice gives the same ids — a re-import has to
    // land on the references documents already hold.
    expect(authentic().looks.map((l) => l.id)).toEqual(ids);
  });

  it('numbers a collision rather than losing a look', () => {
    const index = buildPackIndex(
      [{ path: 'Creative/Sunset.cube' }, { path: 'Creative/SUNSET.cube' }],
      { id: 'pk', name: 'Pack' },
    );
    expect(index.looks.map((l) => l.id)).toEqual(['creative/sunset', 'creative/sunset-2']);
  });

  it('marks conversion and one-click looks as log, creative ones as Rec.709', () => {
    const index = authentic();
    const family = (id: string) => lookIn(index, id)?.family;
    expect(family('conversion/dji/d-log')).toBe('log');
    expect(family('one-click/sony/s-log2')).toBe('log');
    expect(index.looks.find((l) => l.node === 'creative')?.family).toBe('rec709');
  });

  it('cautions that the pack’s DJI looks are D-Log, not D-Log M', () => {
    const index = authentic();
    const dji = index.tree[0].children?.find((n) => n.label === 'DJI');
    expect(dji?.hint).toMatch(/not D-Log M/);
    // Nothing is hidden or renamed over it — the looks are all still there.
    expect(looksUnder(index, 'conversion/dji')).toHaveLength(1);
    expect(index.tree[0].children?.find((n) => n.label === 'Sony')?.hint).toBeUndefined();
  });

  it('flattens a folder deeper than a camera into that camera’s label', () => {
    const index = buildPackIndex([{ path: 'Conversion/Sony/A7SIII/SLOG3.cube' }], {
      id: 'pk',
      name: 'Pack',
    });
    expect(index.looks[0].node).toBe('conversion/sony-a7siii');
    expect(nodeLabelPath(index.tree, index.looks[0].node)).toEqual(['Conversion', 'Sony · A7SIII']);
  });

  it('takes a look sitting at the pack’s root', () => {
    const index = buildPackIndex([{ path: 'Golden Hour.cube' }], { id: 'pk', name: 'Pack' });
    expect(index.looks[0]).toMatchObject({ node: '', id: 'golden-hour', family: 'rec709' });
  });

  it('carries what the importer measured', () => {
    const index = buildPackIndex(
      [{ path: 'Creative/Look.cube', bytes: 7_414_899, lattice: 65, hash: 'abc' }],
      { id: 'pk', name: 'Pack' },
    );
    expect(index.looks[0]).toMatchObject({ bytes: 7_414_899, lattice: 65, hash: 'abc' });
  });
});

describe('hiding', () => {
  it('hides a whole node, or one look, and never loses either', () => {
    const index = { ...authentic(), hidden: ['conversion/canon', 'one-click/sony/s-log2'] };
    expect(isHidden(index, lookIn(index, 'conversion/canon/c-log2')!)).toBe(true);
    expect(isHidden(index, lookIn(index, 'one-click/sony/s-log2')!)).toBe(true);
    expect(isHidden(index, lookIn(index, 'one-click/canon/c-log2')!)).toBe(false);
    expect(index.looks).toHaveLength(25);
    expect(visibleLooks(index)).toHaveLength(22);
  });

  it('hides a category and everything under it', () => {
    const index = { ...authentic(), hidden: ['one-click'] };
    expect(visibleLooks(index).some((l) => l.node.startsWith('one-click'))).toBe(false);
    expect(looksUnder(index, 'conversion')).toHaveLength(8);
  });
});

describe('labels and references', () => {
  it('names a look for a stack, pack and node included', () => {
    const index = authentic();
    expect(lookLabel(index, lookIn(index, 'one-click/dji/d-log')!)).toBe(
      'AUTHENTIC · One Click · DJI · D-Log',
    );
  });

  it('round-trips a reference and refuses junk', () => {
    const ref = { pack: 'pk_1', look: 'one-click/dji/d-log', hash: 'ab12' };
    expect(readPackRef(writePackRef(ref))).toEqual(ref);
    expect(writePackRef(ref).length).toBeLessThan(200);
    expect(readPackRef(null)).toBeNull();
    expect(readPackRef('{"size":33}')).toBeNull();
    expect(readPackRef('not json')).toBeNull();
    // A reference written before hashes existed still names its look.
    expect(readPackRef('{"pack":"pk_1","look":"a/b"}')).toEqual({
      pack: 'pk_1',
      look: 'a/b',
      hash: '',
    });
  });
});

describe('name helpers', () => {
  it('prettyName drops filler and the pack’s own name', () => {
    expect(prettyName('AUTHENTIC_LUT_D-LOG.cube', ['authentic'])).toBe('D-Log');
    expect(prettyName('One Click LUT')).toBe('One Click');
    expect(prettyName('Conversion LUTs')).toBe('Conversion');
  });

  it('stripNodePrefix drops the folder’s camera, never the meaning', () => {
    expect(stripNodePrefix('Sony S-Log3 S-Gamut3.Cine', 'Sony')).toBe('S-Log3 S-Gamut3.Cine');
    expect(stripNodePrefix('Apple Log', 'Apple')).toBe('Apple Log');
    expect(stripNodePrefix('C-Log3', 'Canon')).toBe('C-Log3');
    expect(stripNodePrefix('Sony', 'Sony')).toBe('Sony');
    expect(stripNodePrefix('Travel', undefined)).toBe('Travel');
  });

  it('prettyName never answers with nothing', () => {
    expect(prettyName('LUT.cube')).toBe('LUT');
    expect(prettyName('  ')).toBe('  ');
  });

  it('slug folds punctuation and accents', () => {
    expect(slug('S-LOG3_S-GAMUT3.CINE.cube')).toBe('s-log3-s-gamut3-cine');
    expect(slug('Été (chaud)')).toBe('ete-chaud');
    expect(slug('///')).toBe('x');
  });

  it('familyFor reads the category', () => {
    expect(familyFor('Conversion LUTs')).toBe('log');
    expect(familyFor('One Click LUT')).toBe('log');
    expect(familyFor('Creative LUT')).toBe('rec709');
    expect(familyFor('Moody')).toBe('rec709');
  });
});
