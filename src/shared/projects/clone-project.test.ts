import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from '../develop/develop';
import { DEFAULT_GUIDES } from '../overlay/guides';
import { defaultElementsPreset } from '../overlay/overlay-types';
import { cloneProject } from './clone-project';
import { createProjectDoc, type ProjectDoc } from './project-types';

function sample(): ProjectDoc {
  const doc = createProjectDoc('Vol du soir', '9:16', defaultElementsPreset(), DEFAULT_GUIDES);
  doc.sourceId = 'winnow.example';
  doc.createdAt = 1;
  doc.updatedAt = 2;
  doc.durationSeconds = 41;
  doc.outro = { lines: ['Merci'], qr: null } as unknown as ProjectDoc['outro'];
  doc.media = {
    dirHandle: { name: 'clips' } as unknown as ProjectDoc['media']['dirHandle'],
    files: [{ name: 'DJI_0001.MP4', size: 10, lastModified: 1, hash: 'abc' }],
    activeId: 'dji_0001',
    trims: { dji_0001: { start: 1, end: 5, duration: 9 } },
    develops: { dji_0001: { settings: { ...DEFAULT_DEVELOP, exposure: 0.7 }, hash: 'abc' } },
    renditions: { dji_0001: 'delivered:DJI_0001.MP4' },
  };
  doc.thumbnail = new Blob(['jpeg']);
  return doc;
}

describe('cloneProject', () => {
  it('is a new document: fresh id and timestamps, the target source, the chosen name', () => {
    const project = sample();
    const copy = cloneProject(project, { name: '  Vol du soir (2) ', sourceId: 'local', now: 99 });
    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toBe('Vol du soir (2)');
    expect(copy.sourceId).toBe('local');
    expect(copy.createdAt).toBe(99);
    expect(copy.updatedAt).toBe(99);
  });

  it('carries every other field of the original — a field forgotten is a field lost', () => {
    const project = sample();
    const copy = cloneProject(project, { name: 'x', sourceId: 'local' });
    const identity = new Set(['id', 'name', 'sourceId', 'createdAt', 'updatedAt']);
    for (const key of Object.keys(project) as (keyof ProjectDoc)[]) {
      if (identity.has(key)) continue;
      expect(copy[key], key).toEqual(project[key]);
    }
  });

  it('keeps the trims, developments and renditions of the clips', () => {
    const copy = cloneProject(sample(), { name: 'x', sourceId: 'local' });
    expect(copy.media.trims.dji_0001).toEqual({ start: 1, end: 5, duration: 9 });
    expect(copy.media.develops.dji_0001.settings.exposure).toBe(0.7);
    expect(copy.media.renditions).toEqual({ dji_0001: 'delivered:DJI_0001.MP4' });
  });

  it('keeps this device’s folder handle and thumbnail as the very same objects', () => {
    const project = sample();
    const copy = cloneProject(project, { name: 'x', sourceId: 'local' });
    expect(copy.media.dirHandle).toBe(project.media.dirHandle);
    expect(copy.thumbnail).toBe(project.thumbnail);
  });

  it('shares nothing mutable with the original', () => {
    const project = sample();
    const copy = cloneProject(project, { name: 'x', sourceId: 'local' });
    copy.elements.pop();
    copy.media.files.push({ name: 'b.MP4', size: 1, lastModified: 1 });
    copy.media.trims.other = { start: 0, end: 1, duration: 2 };
    copy.exportPrefs.fileName = 'renamed';
    expect(project.elements.length).toBeGreaterThan(copy.elements.length);
    expect(project.media.files).toHaveLength(1);
    expect(project.media.trims.other).toBeUndefined();
    expect(project.exportPrefs.fileName).not.toBe('renamed');
  });

  it('clones a project that has no handle and no thumbnail', () => {
    const project = sample();
    project.media.dirHandle = null;
    project.thumbnail = null;
    const copy = cloneProject(project, { name: 'x', sourceId: 'local' });
    expect(copy.media.dirHandle).toBeNull();
    expect(copy.thumbnail).toBeNull();
  });
});
