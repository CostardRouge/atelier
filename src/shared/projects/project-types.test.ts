import { describe, expect, it } from 'vitest';
import {
  createProjectDoc,
  migrateProjectDoc,
  PROJECT_DOC_VERSION,
  type ProjectDoc,
} from './project-types';
import { defaultElementsPreset } from '../overlay/overlay-types';
import { DEFAULT_GUIDES } from '../overlay/guides';
import { themeFromPreset } from '../overlay/title-styles';

function v1Doc(): ProjectDoc {
  const doc = createProjectDoc('legacy', '16:9', defaultElementsPreset(), DEFAULT_GUIDES);
  // Simulate a phase-2 document: version 1, no theme field at all.
  const stored: Record<string, unknown> = { ...doc, version: 1 };
  delete stored.theme;
  return stored as unknown as ProjectDoc;
}

describe('migrateProjectDoc', () => {
  it('brings a v1 document to the current version with a null theme', () => {
    const migrated = migrateProjectDoc(v1Doc());
    expect(migrated.version).toBe(PROJECT_DOC_VERSION);
    expect(migrated.theme).toBeNull();
    // v3: the export matrix defaults to the one source-faithful variant.
    expect(migrated.exportPrefs.fileName).toBeNull();
    expect(migrated.exportPrefs.variants).toHaveLength(1);
    expect(migrated.exportPrefs.variants[0].aspectId).toBe('source');
    // v4: no look was set, so the grade stack is empty.
    expect(migrated.lutStack).toEqual([]);
    // v5: no correction, which is exactly what an old project meant.
    expect(migrated.settings.timeShift).toEqual({ minutes: 0, days: 0 });
    // v6: no output transform, so the grade is delivered exactly as authored.
    expect(migrated.outputTransform).toBe('none');
    // v7: the source cadence, the only one an old export could produce.
    expect(migrated.exportPrefs.variants[0].frameRate).toBe('source');
  });

  it('gives a pre-v7 variant the source frame rate, keeping its other choices', () => {
    const doc = v1Doc();
    const stored = {
      ...doc,
      version: 6,
      exportPrefs: {
        fileName: 'vol',
        variants: [
          { id: 'a', aspectId: '9:16', resolution: 1080, overlays: false },
        ],
      },
    } as unknown as ProjectDoc;
    const [v] = migrateProjectDoc(stored).exportPrefs.variants;
    expect(v.frameRate).toBe('source');
    expect(v.aspectId).toBe('9:16');
    expect(v.resolution).toBe(1080);
    expect(v.overlays).toBe(false);
  });

  it('keeps a capture-time correction that is already set', () => {
    const doc = v1Doc();
    doc.settings = { ...doc.settings, timeShift: { minutes: -90, days: 1 } };
    expect(migrateProjectDoc(doc).settings.timeShift).toEqual({
      minutes: -90,
      days: 1,
    });
  });

  it('carries a v3 single look into a one-layer stack', () => {
    const doc = v1Doc();
    doc.lut = {
      selected: 'kodak-2383',
      customName: null,
      customText: null,
      intensity: 0.6,
    };
    const migrated = migrateProjectDoc(doc);
    expect(migrated.lutStack).toHaveLength(1);
    expect(migrated.lutStack[0].source).toBe('builtin:kodak-2383');
    expect(migrated.lutStack[0].intensity).toBe(0.6);
    expect(migrated.lutStack[0].enabled).toBe(true);
  });

  it('carries a v3 custom look, and drops one whose text is gone', () => {
    const withText = v1Doc();
    withText.lut = {
      selected: 'custom',
      customName: 'mine.cube',
      customText: 'LUT_3D_SIZE 2',
      intensity: 1,
    };
    expect(migrateProjectDoc(withText).lutStack[0].source).toBe('custom');

    const orphan = v1Doc();
    orphan.lut = {
      selected: 'custom',
      customName: 'gone.cube',
      customText: null,
      intensity: 1,
    };
    expect(migrateProjectDoc(orphan).lutStack).toEqual([]);
  });

  it("leaves an older document's grade untouched, transform off", () => {
    // A saved project must look on reopen exactly as it did when it was
    // closed — never re-encode someone's grade behind their back.
    const stored: Record<string, unknown> = {
      ...createProjectDoc('pre-transform', '16:9', [], DEFAULT_GUIDES),
      version: 5,
    };
    delete stored.outputTransform;
    const migrated = migrateProjectDoc(stored as unknown as ProjectDoc);
    expect(migrated.version).toBe(PROJECT_DOC_VERSION);
    expect(migrated.outputTransform).toBe('none');
  });

  it('keeps an output transform a document already carries', () => {
    const doc = createProjectDoc('graded', '16:9', [], DEFAULT_GUIDES);
    doc.outputTransform = 'rec709-to-srgb';
    const stored = { ...doc, version: 5 } as ProjectDoc;
    expect(migrateProjectDoc(stored).outputTransform).toBe('rec709-to-srgb');
  });

  it('is idempotent and leaves current documents untouched', () => {
    const doc = createProjectDoc('now', '9:16', [], DEFAULT_GUIDES);
    doc.theme = themeFromPreset('or-cine');
    const migrated = migrateProjectDoc(doc);
    expect(migrated).toBe(doc);
    expect(migrated.theme?.presetId).toBe('or-cine');
  });
});

describe('createProjectDoc with a template', () => {
  it('copies the portable half including the theme, but never the media', () => {
    const source = createProjectDoc('src', '9:16', defaultElementsPreset(), DEFAULT_GUIDES);
    source.theme = themeFromPreset('pixel-crt');
    source.media = {
      dirHandle: null,
      files: [{ name: 'a.mp4', size: 1, lastModified: 1 }],
      activeId: 'a',
    };
    const copy = createProjectDoc('copy', '1:1', [], DEFAULT_GUIDES, source);
    expect(copy.theme?.presetId).toBe('pixel-crt');
    expect(copy.elements).toHaveLength(source.elements.length);
    expect(copy.media.files).toHaveLength(0);
    expect(copy.settings.aspectId).toBe('1:1'); // the modal's choice wins
    // Deep copy — mutating the copy's theme never touches the source.
    copy.theme!.style.color = '#000001';
    expect(source.theme!.style.color).not.toBe('#000001');
  });
});
