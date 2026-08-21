import { describe, expect, it } from 'vitest';
import {
  PROJECT_FILE_KIND,
  applyProjectFile,
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
  toProjectFile,
} from './project-file';
import { PROJECT_DOC_VERSION, createProjectDoc, type ProjectDoc } from './project-types';
import { DEFAULT_GUIDES } from '../overlay/guides';
import { defaultElementsPreset } from '../overlay/overlay-types';

function sampleDoc(): ProjectDoc {
  const doc = createProjectDoc(
    'Vol du soir',
    '9:16',
    defaultElementsPreset(),
    DEFAULT_GUIDES,
  );
  doc.settings.timeShift = { minutes: 90, days: -1 };
  doc.lutStack = [
    {
      id: 'l1',
      source: 'custom',
      name: 'Mon look.cube',
      customText: 'LUT_3D_SIZE 2\n0 0 0\n1 1 1\n',
      intensity: 0.6,
      enabled: true,
    },
  ];
  doc.outputTransform = 'rec709-to-srgb';
  doc.exportPrefs = {
    fileName: 'sunset',
    variants: [
      { id: 'v1', aspectId: '9:16', resolution: 1080, frameRate: 30, overlays: true },
    ],
  };
  // Bound half: must never travel. Trims included — in/out points are seconds
  // into THIS footage and mean nothing under another media.
  doc.media = {
    dirHandle: null,
    files: [{ name: 'DJI_0001.MP4', size: 12, lastModified: 3 }],
    activeId: 'DJI_0001',
    trims: { DJI_0001: { start: 2, end: 9, duration: 12 } },
  };
  doc.thumbnail = null;
  doc.durationSeconds = 42;
  return doc;
}

describe('toProjectFile', () => {
  it('leaves the cadence correction behind — it belongs to one clip', () => {
    const doc = sampleDoc();
    doc.settings = {
      ...doc.settings,
      timeScale: { mode: 'manual', scale: 0.25, clipId: 'dji_0001' },
    };
    const file = toProjectFile(doc, Date.parse('2026-08-21T10:00:00Z'));
    expect(file.settings.timeScale).toBeUndefined();
    expect(serializeProjectFile(file)).not.toContain('timeScale');
    // …and the document it came from is untouched.
    expect(doc.settings.timeScale?.scale).toBe(0.25);
  });

  it('carries the portable half and nothing bound to this machine', () => {
    const file = toProjectFile(sampleDoc(), Date.parse('2026-08-21T10:00:00Z'));
    expect(file.kind).toBe(PROJECT_FILE_KIND);
    expect(file.version).toBe(PROJECT_DOC_VERSION);
    expect(file.name).toBe('Vol du soir');
    expect(file.exportedAt).toBe('2026-08-21T10:00:00.000Z');
    expect(file.settings.aspectId).toBe('9:16');
    expect(file.elements.length).toBeGreaterThan(0);
    expect(file.exportPrefs.fileName).toBe('sunset');
    // No bound field leaks in, whatever the serializer sees.
    const json = serializeProjectFile(file);
    expect(json).not.toContain('DJI_0001');
    expect(json).not.toContain('dirHandle');
    expect(json).not.toContain('thumbnail');
    expect(json).not.toContain('trims');
  });

  it('inlines a custom look so the grade travels with the file', () => {
    const file = toProjectFile(sampleDoc());
    expect(file.lutStack[0].customText).toContain('LUT_3D_SIZE');
  });

  it('deep-copies, so later edits to the project do not mutate the file', () => {
    const doc = sampleDoc();
    const file = toProjectFile(doc);
    doc.elements[0].x = 0.99;
    expect(file.elements[0].x).not.toBe(0.99);
  });
});

describe('parseProjectFile', () => {
  it('round-trips a serialized project', () => {
    const file = toProjectFile(sampleDoc());
    const parsed = parseProjectFile(serializeProjectFile(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.name).toBe('Vol du soir');
    expect(parsed.file.settings.timeShift).toEqual({ minutes: 90, days: -1 });
    expect(parsed.file.lutStack[0].intensity).toBe(0.6);
    expect(parsed.file.outputTransform).toBe('rec709-to-srgb');
    expect(parsed.file.exportPrefs.variants[0].frameRate).toBe(30);
    expect(parsed.file.elements).toEqual(file.elements);
  });

  it('rejects text that is not JSON', () => {
    const parsed = parseProjectFile('not json at all');
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining('valid JSON') });
  });

  it('rejects a JSON file that is not ours', () => {
    const parsed = parseProjectFile('{"hello":"world"}');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('not an Atelier project file');
  });

  it('rejects a file from a newer format rather than half-reading it', () => {
    const file = { ...toProjectFile(sampleDoc()), version: PROJECT_DOC_VERSION + 1 };
    const parsed = parseProjectFile(JSON.stringify(file));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('newer version');
  });

  it('rejects a file with no elements list or no format', () => {
    const file = toProjectFile(sampleDoc());
    const noElements = parseProjectFile(
      JSON.stringify({ ...file, elements: undefined }),
    );
    expect(noElements.ok).toBe(false);
    const noFormat = parseProjectFile(JSON.stringify({ ...file, settings: {} }));
    expect(noFormat.ok).toBe(false);
  });

  it('replays the document migrations for an older file', () => {
    // A v6-era file: variants had no explicit frame rate, and nothing had a
    // capture-time shift before v5.
    const file = toProjectFile(sampleDoc());
    const old = {
      ...file,
      version: 4,
      settings: { aspectId: '16:9' },
      exportPrefs: {
        fileName: null,
        variants: [{ id: 'v1', aspectId: 'source', resolution: 'source', overlays: true }],
      },
    };
    const parsed = parseProjectFile(JSON.stringify(old));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.version).toBe(PROJECT_DOC_VERSION);
    expect(parsed.file.settings.timeShift).toEqual({ minutes: 0, days: 0 });
    expect(parsed.file.exportPrefs.variants[0].frameRate).toBe('source');
    expect(parsed.file.outputTransform).toBe('rec709-to-srgb');
  });

  it('fills in optional halves a file left out', () => {
    const minimal = {
      kind: PROJECT_FILE_KIND,
      version: PROJECT_DOC_VERSION,
      settings: { aspectId: '1:1' },
      elements: [],
    };
    const parsed = parseProjectFile(JSON.stringify(minimal));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.name).toBe('');
    expect(parsed.file.theme).toBeNull();
    expect(parsed.file.lutStack).toEqual([]);
    expect(parsed.file.outputTransform).toBe('none');
    expect(parsed.file.exportPrefs.variants).toHaveLength(1);
    expect(parsed.file.guides).toEqual(DEFAULT_GUIDES);
  });
});

describe('applyProjectFile', () => {
  it('replaces the portable half and keeps identity, media, trims and name', () => {
    const file = toProjectFile(sampleDoc());
    const target = createProjectDoc('Autre projet', '16:9', [], DEFAULT_GUIDES);
    target.media = {
      dirHandle: null,
      files: [{ name: 'OTHER.MP4', size: 1, lastModified: 1 }],
      activeId: 'OTHER',
      trims: { OTHER: { start: 1, end: 4, duration: 6 } },
    };
    const next = applyProjectFile(target, file, 1000);

    expect(next.id).toBe(target.id);
    expect(next.name).toBe('Autre projet');
    expect(next.createdAt).toBe(target.createdAt);
    expect(next.updatedAt).toBe(1000);
    expect(next.media.files[0].name).toBe('OTHER.MP4');
    // The imported settings say nothing about this footage's in/out points.
    expect(next.media.trims).toEqual({ OTHER: { start: 1, end: 4, duration: 6 } });

    expect(next.settings.aspectId).toBe('9:16');
    expect(next.elements).toEqual(file.elements);
    expect(next.lutStack[0].name).toBe('Mon look.cube');
    expect(next.exportPrefs.fileName).toBe('sunset');
  });

  it('deep-copies, so the imported file cannot be mutated through the project', () => {
    const file = toProjectFile(sampleDoc());
    const next = applyProjectFile(
      createProjectDoc('X', '16:9', [], DEFAULT_GUIDES),
      file,
    );
    next.elements[0].x = 0.42;
    expect(file.elements[0].x).not.toBe(0.42);
  });
});

describe('projectFileName', () => {
  it('slugs the project name and keeps the double extension', () => {
    expect(projectFileName('Vol du soir')).toBe('vol-du-soir.atelier.json');
    expect(projectFileName('Été — Nice #2')).toBe('ete-nice-2.atelier.json');
  });

  it('falls back when the name has nothing to slug', () => {
    expect(projectFileName('   ')).toBe('project.atelier.json');
    expect(projectFileName('★')).toBe('project.atelier.json');
  });
});
