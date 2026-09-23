import { describe, expect, it } from 'vitest';
import type { LutPackIndex, PackLook } from './lut-pack';
import { encodedBytes } from './pack-codec';
import {
  blobBytes,
  forgotten,
  formatBytes,
  freedBlobs,
  freedHashes,
  hashBytes,
  instanceWeights,
  lookBytes,
  lookWeight,
  lookWeightLabel,
  lookWeightNote,
  looksBytes,
  packWeight,
  vaultWeight,
  type LookWeight,
} from './pack-weight';

function look(partial: Partial<PackLook> & { id: string }): PackLook {
  return {
    label: partial.id,
    node: '',
    file: `${partial.id}.cube`,
    family: 'rec709',
    ...partial,
  };
}

function pack(partial: Partial<LutPackIndex> & { id: string }): LutPackIndex {
  return { name: partial.id, author: '', tree: [], looks: [], hidden: [], ...partial };
}

/** A 65³ look, the size the maintainer's own pack ships. */
const SIXTY_FIVE = encodedBytes(65);
/** A 33³ one, the size of an uploaded cube. */
const THIRTY_THREE = encodedBytes(33);

describe('lookBytes', () => {
  it('measures the stored buffer when this device holds it', () => {
    const l = look({ id: 'a', hash: 'h1', lattice: 65 });
    expect(lookBytes(l, new Map([['h1', 12345]]))).toBe(12345);
  });

  it('derives the size from the grid when the bytes are not here', () => {
    const l = look({ id: 'a', hash: 'h1', lattice: 65 });
    expect(lookBytes(l, new Map())).toBe(SIXTY_FIVE);
    expect(SIXTY_FIVE).toBe(40 + 65 ** 3 * 6);
  });

  it('says nothing rather than guessing when the index records no grid', () => {
    expect(lookBytes(look({ id: 'a', hash: 'h1' }), new Map())).toBeNull();
  });
});

describe('lookWeight', () => {
  const kept = pack({
    id: 'pk',
    sourceId: 'winnow.example',
    looks: [look({ id: 'a', hash: 'h1', blob: 'b1', lattice: 65 })],
  });

  it('is measured and here when the vault holds the bytes', () => {
    expect(lookWeight(kept, kept.looks[0], new Map([['h1', SIXTY_FIVE]]))).toEqual({
      bytes: SIXTY_FIVE,
      measured: true,
      where: 'here',
    });
  });

  it('is on the instance when a blob says the push sent it there', () => {
    expect(lookWeight(kept, kept.looks[0], new Map())).toEqual({
      bytes: SIXTY_FIVE,
      measured: false,
      where: 'instance',
    });
  });

  it('is nowhere when the pack is local-only and the bytes are gone', () => {
    const local = pack({ id: 'pk', looks: [look({ id: 'a', hash: 'h1', lattice: 65 })] });
    expect(lookWeight(local, local.looks[0], new Map()).where).toBe('nowhere');
  });

  it('is nowhere when a look was never pushed, even on a kept pack', () => {
    const half = pack({
      id: 'pk',
      sourceId: 'winnow.example',
      looks: [look({ id: 'a', hash: 'h1', lattice: 65 })],
    });
    expect(lookWeight(half, half.looks[0], new Map()).where).toBe('nowhere');
  });
});

describe('looksBytes', () => {
  it('weighs a branch, counting a shared lattice once', () => {
    const looks = [
      look({ id: 'a', hash: 'h1', lattice: 65 }),
      look({ id: 'b', hash: 'h1', lattice: 65 }),
      look({ id: 'c', hash: 'h2', lattice: 33 }),
    ];
    expect(looksBytes(looks, new Map([['h1', SIXTY_FIVE]]))).toBe(SIXTY_FIVE + THIRTY_THREE);
  });

  it('adds nothing for a look nothing can weigh', () => {
    expect(looksBytes([look({ id: 'a' })], new Map())).toBe(0);
  });

  it('keeps two hashless looks apart rather than folding them together', () => {
    const looks = [look({ id: 'a', lattice: 33 }), look({ id: 'b', lattice: 33 })];
    expect(looksBytes(looks, new Map())).toBe(THIRTY_THREE * 2);
  });
});

describe('packWeight', () => {
  it('adds up what is here and what the instance holds', () => {
    const p = pack({
      id: 'pk',
      sourceId: 'winnow.example',
      looks: [
        look({ id: 'a', hash: 'h1', blob: 'b1', lattice: 65 }),
        look({ id: 'b', hash: 'h2', blob: 'b2', lattice: 33 }),
      ],
    });
    const w = packWeight(p, new Map([['h1', SIXTY_FIVE]]));
    expect(w).toEqual({
      here: SIXTY_FIVE,
      hereLooks: 1,
      instance: SIXTY_FIVE + THIRTY_THREE,
      instanceLooks: 2,
      looks: 2,
      unweighed: 0,
    });
  });

  it('counts a lattice two looks share exactly once, on both sides', () => {
    const p = pack({
      id: 'pk',
      sourceId: 'winnow.example',
      looks: [
        look({ id: 'a', hash: 'h1', blob: 'b1', lattice: 65 }),
        look({ id: 'b', hash: 'h1', blob: 'b1', lattice: 65 }),
      ],
    });
    const w = packWeight(p, new Map([['h1', SIXTY_FIVE]]));
    expect(w.here).toBe(SIXTY_FIVE);
    expect(w.hereLooks).toBe(1);
    expect(w.instance).toBe(SIXTY_FIVE);
    expect(w.looks).toBe(2);
  });

  it('nothing is on an instance while the pack is kept nowhere', () => {
    const p = pack({ id: 'pk', looks: [look({ id: 'a', hash: 'h1', blob: 'b1', lattice: 65 })] });
    expect(packWeight(p, new Map()).instance).toBe(0);
  });

  it('counts a look it cannot weigh rather than treating it as empty', () => {
    const p = pack({ id: 'pk', looks: [look({ id: 'a', hash: 'h1' }), look({ id: 'b' })] });
    const w = packWeight(p, new Map());
    expect(w.unweighed).toBe(2);
    expect(w.here).toBe(0);
  });
});

describe('vaultWeight', () => {
  it('is not the sum of the packs when two of them share a look', () => {
    const shared = look({ id: 'a', hash: 'h1', blob: 'b1', lattice: 65 });
    const one = pack({ id: 'p1', looks: [shared] });
    const two = pack({ id: 'p2', looks: [{ ...shared, id: 'b' }] });
    const sizes = new Map([['h1', SIXTY_FIVE]]);
    expect(packWeight(one, sizes).here + packWeight(two, sizes).here).toBe(SIXTY_FIVE * 2);
    expect(vaultWeight([one, two], sizes).here).toBe(SIXTY_FIVE);
  });
});

describe('instanceWeights', () => {
  it('answers per instance, and leaves a local-only pack out', () => {
    const packs = [
      pack({
        id: 'p1',
        sourceId: 'a.example',
        looks: [look({ id: 'a', hash: 'h1', blob: 'b1', lattice: 65 })],
      }),
      pack({
        id: 'p2',
        sourceId: 'b.example',
        looks: [look({ id: 'b', hash: 'h2', blob: 'b2', lattice: 33 })],
      }),
      pack({ id: 'p3', looks: [look({ id: 'c', hash: 'h3', blob: 'b3', lattice: 65 })] }),
    ];
    const weights = instanceWeights(packs, new Map());
    expect([...weights]).toEqual([
      ['a.example', SIXTY_FIVE],
      ['b.example', THIRTY_THREE],
    ]);
  });
});

describe('freedHashes', () => {
  const two = () => [
    pack({
      id: 'p1',
      looks: [
        look({ id: 'a', hash: 'h1' }),
        look({ id: 'b', hash: 'h2' }),
        look({ id: 'c', hash: 'h2' }),
      ],
    }),
    pack({ id: 'p2', looks: [look({ id: 'x', hash: 'h1' })] }),
  ];

  it('frees a hash nothing else names', () => {
    const packs = [pack({ id: 'p1', looks: [look({ id: 'a', hash: 'h1' })] })];
    expect(freedHashes(packs, 'p1', ['a'])).toEqual({ free: ['h1'], shared: [] });
  });

  it('keeps a lattice ANOTHER PACK names — the rule the feature turns on', () => {
    expect(freedHashes(two(), 'p1', ['a'])).toEqual({ free: [], shared: ['h1'] });
  });

  it('keeps a lattice another look of the SAME pack names', () => {
    expect(freedHashes(two(), 'p1', ['b'])).toEqual({ free: [], shared: ['h2'] });
  });

  it('frees it once both looks naming it go', () => {
    expect(freedHashes(two(), 'p1', ['b', 'c'])).toEqual({ free: ['h2'], shared: [] });
  });

  it('frees everything the whole pack alone names', () => {
    const freed = freedHashes(two(), 'p1', ['a', 'b', 'c']);
    expect(freed.free).toEqual(['h2']);
    expect(freed.shared).toEqual(['h1']);
  });

  it('answers nothing for a look with no hash at all', () => {
    const packs = [pack({ id: 'p1', looks: [look({ id: 'a' })] })];
    expect(freedHashes(packs, 'p1', ['a'])).toEqual({ free: [], shared: [] });
  });
});

describe('freedBlobs', () => {
  it('speaks in blobs, never in source hashes', () => {
    const packs = [
      pack({
        id: 'p1',
        sourceId: 'a.example',
        looks: [look({ id: 'a', hash: 'h1', blob: 'b1' })],
      }),
    ];
    expect(freedBlobs(packs, 'p1', ['a'], 'a.example')).toEqual({ free: ['b1'], shared: [] });
  });

  it('only the packs kept on THAT instance have a say over its files', () => {
    const packs = [
      pack({ id: 'p1', sourceId: 'a.example', looks: [look({ id: 'a', hash: 'h1', blob: 'b1' })] }),
      // Same lattice, kept somewhere else: it is another file store, so it
      // cannot hold this instance's copy alive.
      pack({ id: 'p2', sourceId: 'b.example', looks: [look({ id: 'x', hash: 'h1', blob: 'b1' })] }),
    ];
    expect(freedBlobs(packs, 'p1', ['a'], 'a.example')).toEqual({ free: ['b1'], shared: [] });
    // Kept on the SAME instance, and the bytes stay.
    const together = packs.map((p) => ({ ...p, sourceId: 'a.example' }));
    expect(freedBlobs(together, 'p1', ['a'], 'a.example')).toEqual({ free: [], shared: ['b1'] });
  });

  it('asks for nothing when the look was never pushed', () => {
    const packs = [
      pack({ id: 'p1', sourceId: 'a.example', looks: [look({ id: 'a', hash: 'h1' })] }),
    ];
    expect(freedBlobs(packs, 'p1', ['a'], 'a.example')).toEqual({ free: [], shared: [] });
  });
});

describe('what a forget gives back', () => {
  it('weighs the freed hashes off the MEASURED sizes', () => {
    const sizes = new Map([
      ['h1', SIXTY_FIVE],
      ['h2', THIRTY_THREE],
    ]);
    expect(hashBytes(['h1', 'h2'], sizes)).toBe(SIXTY_FIVE + THIRTY_THREE);
    // A hash this device does not hold gives nothing back here, which is the
    // truth rather than a zero to hide.
    expect(hashBytes(['h3'], sizes)).toBe(0);
  });

  it('weighs the freed blobs off the grid sizes the indexes record', () => {
    const packs = [
      pack({
        id: 'p1',
        sourceId: 'a.example',
        looks: [
          look({ id: 'a', hash: 'h1', blob: 'b1', lattice: 65 }),
          look({ id: 'b', hash: 'h2', blob: 'b2' }),
        ],
      }),
    ];
    expect(blobBytes(['b1'], packs)).toBe(SIXTY_FIVE);
    // No grid recorded: nothing is invented for it.
    expect(blobBytes(['b2'], packs)).toBe(0);
    expect(blobBytes(['nope'], packs)).toBe(0);
  });
});

describe('forgotten', () => {
  it('reports both figures when both gave something back', () => {
    expect(
      forgotten({ here: SIXTY_FIVE, instance: SIXTY_FIVE, keptOn: 'winnow.example', shared: 0 }),
    ).toBe('1.6 MB back here and 1.6 MB on winnow.example.');
  });

  it('names only this device for a local-only pack', () => {
    expect(forgotten({ here: THIRTY_THREE, instance: 0, keptOn: null, shared: 0 })).toBe(
      '211 KB back here.',
    );
  });

  it('says WHY nothing came back rather than printing a zero', () => {
    expect(forgotten({ here: 0, instance: 0, keptOn: null, shared: 1 })).toBe(
      'no bytes came back: another look holds the same lattice.',
    );
    expect(forgotten({ here: 0, instance: 0, keptOn: null, shared: 0 })).toBe(
      'it held no bytes here.',
    );
  });
});

describe('lookWeightLabel', () => {
  it('says the size, and a word for bytes that are not on this device', () => {
    expect(lookWeightLabel({ bytes: SIXTY_FIVE, measured: true, where: 'here' })).toBe('1.6 MB');
    expect(lookWeightLabel({ bytes: SIXTY_FIVE, measured: false, where: 'instance' })).toBe(
      '1.6 MB there',
    );
    expect(lookWeightLabel({ bytes: SIXTY_FIVE, measured: false, where: 'nowhere' })).toBe(
      '1.6 MB missing',
    );
  });

  it('draws a dash rather than a zero when nothing can weigh it', () => {
    expect(lookWeightLabel({ bytes: null, measured: false, where: 'nowhere' })).toBe('—');
  });

  it('names the instance in the note, and never invents one', () => {
    const away: LookWeight = { bytes: 1, measured: false, where: 'instance' };
    expect(lookWeightNote(away, 'winnow.example')).toContain('winnow.example');
    expect(lookWeightNote(away, null)).toContain('the instance');
    expect(lookWeightNote({ bytes: 1, measured: true, where: 'here' }, null)).toBe(
      'In this browser’s vault.',
    );
  });
});

describe('formatBytes', () => {
  it('reads the way an OS prints it', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(THIRTY_THREE)).toBe('211 KB');
    expect(formatBytes(SIXTY_FIVE)).toBe('1.6 MB');
    expect(formatBytes(SIXTY_FIVE * 25)).toBe('39.3 MB');
    expect(formatBytes(2 * 1073741824)).toBe('2.00 GB');
  });

  it('never prints a negative or a NaN weight', () => {
    expect(formatBytes(-1)).toBe('0 KB');
    expect(formatBytes(Number.NaN)).toBe('0 KB');
  });
});
