import { describe, expect, it } from 'vitest';
import {
  PROJECT_HOUSE_STYLE_KIND,
  applyProjectHouseStyle,
  projectHouseStyleFrom,
  readProjectHouseStyle,
  serializeProjectHouseStyle,
} from './house-style';
import { PROJECT_DOC_VERSION, createProjectDoc, type ProjectDoc } from './project-types';
import { DEFAULT_GUIDES } from '../overlay/guides';
import { createTextElement, defaultElementsPreset } from '../overlay/overlay-types';
import { createIntroScene } from '../overlay/scenes';
import { createOutroCard } from '../overlay/outro-card';
import { themeFromPreset } from '../overlay/title-styles';
import { HOOK_ELEMENT_PREFIX, HOOK_SCENE_ID } from '../roadtrip/hook-scene';

/** A project with a look worth keeping — and a clip, a name and a Trips send that must not travel. */
function styledProject(): ProjectDoc {
  const doc = createProjectDoc('Vol du soir', '4:5', defaultElementsPreset(), DEFAULT_GUIDES);
  const title = { ...createTextElement('Signature'), id: 'title' };
  const hook = { ...createTextElement('Australie · Jour 3'), id: `${HOOK_ELEMENT_PREFIX}name` };
  return {
    ...doc,
    settings: { aspectId: '4:5', timeShift: { minutes: 60, days: 0 }, timeScale: { mode: 'manual', scale: 0.25 } },
    elements: [...doc.elements, title, hook],
    theme: themeFromPreset('or-cine'),
    scenes: [createIntroScene(2.5), { ...createIntroScene(4), id: HOOK_SCENE_ID }],
    outro: createOutroCard('See you on the road'),
    lutStack: [
      { id: 'l1', source: 'builtin:classic-warm', name: 'Warm', customText: null, intensity: 0.7, enabled: true },
      { id: 'l2', source: 'custom', name: 'Mine.cube', customText: 'LUT_3D_SIZE 2', intensity: 1, enabled: true },
      { id: 'l3', source: 'film', name: 'Reversal · vivid', customText: '{"stock":"reversal-vivid","response":{}}', intensity: 1, enabled: true },
    ],
    outputTransform: 'rec709-to-srgb',
    exportPrefs: { fileName: 'vol-du-soir', variants: doc.exportPrefs.variants },
    media: { ...doc.media, files: [{ name: 'DJI_0001.MP4', size: 1, lastModified: 1 }], activeId: 'DJI_0001' },
  };
}

describe('the Studio house style', () => {
  it('carries the portable look and nothing of the project, its clip or its format', () => {
    const { file } = projectHouseStyleFrom(styledProject());
    expect(Object.keys(file.style).sort()).toEqual(
      ['elements', 'exportPrefs', 'guides', 'lutStack', 'lutFilm', 'outputTransform', 'outro', 'scenes', 'theme'].sort(),
    );
    expect(file.style.theme?.presetId).toBe('or-cine');
    expect(file.style.outputTransform).toBe('rec709-to-srgb');
    expect(file.style.exportPrefs.fileName).toBeNull();
    const text = serializeProjectHouseStyle(file);
    // A variant has its own `aspectId` ("source"); the project's format lives in `settings`.
    for (const bound of ['Vol du soir', 'vol-du-soir', 'DJI_0001', 'timeShift', 'timeScale', '"settings"']) {
      expect(text).not.toContain(bound);
    }
  });

  it('leaves behind what Trips sent, and keeps the author’s own intro and outro', () => {
    const snapshot = projectHouseStyleFrom(styledProject());
    const { style } = snapshot.file;
    expect(style.elements.some((el) => el.id.startsWith(HOOK_ELEMENT_PREFIX))).toBe(false);
    expect(style.elements.some((el) => el.id === 'title')).toBe(true);
    expect(style.scenes.map((s) => s.id)).toEqual(['intro']);
    expect(style.outro).not.toBeNull();
    expect(snapshot.leftTrips).toBe(true);

    const sentOutro = styledProject();
    sentOutro.outro = { ...createOutroCard('Made with Atelier'), elements: [{ ...createTextElement('x'), id: `${HOOK_ELEMENT_PREFIX}cta` }] };
    expect(projectHouseStyleFrom(sentOutro).file.style.outro).toBeNull();

    const clean = { ...styledProject(), scenes: [createIntroScene()], elements: defaultElementsPreset() };
    expect(projectHouseStyleFrom(clean).leftTrips).toBe(false);
  });

  it('leaves an uploaded look out of the grade, and says which', () => {
    const snapshot = projectHouseStyleFrom(styledProject());
    expect(snapshot.file.style.lutStack.map((l) => l.name)).toEqual(['Warm', 'Reversal · vivid']);
    expect(snapshot.uploadedLooks).toEqual(['Mine.cube']);
    // A film stock carries text too — settings, not a cube — and stays in the style.
    expect(snapshot.file.style.lutStack.map((l) => l.id)).toEqual(['l1', 'l3']);
  });

  it('writes the same text for the same project', () => {
    const project = styledProject();
    expect(serializeProjectHouseStyle(projectHouseStyleFrom(project).file)).toBe(
      serializeProjectHouseStyle(projectHouseStyleFrom(project).file),
    );
  });

  it('reads back what it wrote', () => {
    const { file } = projectHouseStyleFrom(styledProject());
    expect(file.kind).toBe(PROJECT_HOUSE_STYLE_KIND);
    expect(file.version).toBe(PROJECT_DOC_VERSION);
    expect(readProjectHouseStyle(JSON.parse(serializeProjectHouseStyle(file)))).toEqual(file.style);
  });

  it('refuses what is not a house style, or one from a newer build', () => {
    const { file } = projectHouseStyleFrom(styledProject());
    expect(readProjectHouseStyle(null)).toBeNull();
    expect(readProjectHouseStyle({ ...file, kind: 'atelier.trip-house-style' })).toBeNull();
    expect(readProjectHouseStyle({ ...file, version: PROJECT_DOC_VERSION + 1 })).toBeNull();
    expect(readProjectHouseStyle({ ...file, style: { ...file.style, elements: 'none' } })).toBeNull();
  });

  it('migrates a file written by an older build', () => {
    // v10 variants had no speed; v11 gives every one an explicit 1.
    const { file } = projectHouseStyleFrom(styledProject());
    const variants = file.style.exportPrefs.variants.map((v) => {
      const old: Record<string, unknown> = { ...v };
      delete old.speed;
      return old;
    });
    const old = { ...file, version: 10, style: { ...file.style, exportPrefs: { fileName: null, variants } } };
    const style = readProjectHouseStyle(JSON.parse(JSON.stringify(old)));
    expect(style?.exportPrefs.variants.every((v) => v.speed === 1)).toBe(true);
  });

  it('dresses a new project, and only its look', () => {
    const style = projectHouseStyleFrom(styledProject()).file.style;
    const doc = createProjectDoc('Plage', '9:16', [], DEFAULT_GUIDES);
    const dressed = applyProjectHouseStyle(doc, style);
    expect(dressed).toMatchObject({ id: doc.id, name: 'Plage', settings: doc.settings, media: doc.media });
    expect(dressed.theme?.presetId).toBe('or-cine');
    expect(dressed.scenes.map((s) => s.id)).toEqual(['intro']);
    // A copy: composing in the new project must not rewrite the style it came from.
    dressed.elements.pop();
    expect(dressed.elements.length).toBe(style.elements.length - 1);
    expect(applyProjectHouseStyle(doc, null)).toBe(doc);
  });

  it('reads the committed file, when there is one', () => {
    const found = import.meta.glob<unknown>('./house-style.json', { eager: true, import: 'default' });
    for (const raw of Object.values(found)) expect(readProjectHouseStyle(raw)).not.toBeNull();
  });
});
