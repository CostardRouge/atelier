import { beforeEach, describe, expect, it } from 'vitest';
import { writeFilmSettings } from './emulsion';
import {
  FILM_SOURCE,
  clearFilmCubeCache,
  filmCubeFor,
  filmLayerFromSaved,
  isFilmLayer,
  newFilmLayer,
  withFilmSettings,
} from './film-layer';
import { filmSettingsFor } from './stocks';
import type { SavedLutLayer } from '../lut/use-lut-stack';

const saved = (over: Partial<SavedLutLayer> = {}): SavedLutLayer => ({
  id: 'f1',
  source: FILM_SOURCE,
  name: 'whatever',
  customText: writeFilmSettings(filmSettingsFor('negative-portrait')),
  intensity: 0.8,
  enabled: true,
  ...over,
});

beforeEach(() => clearFilmCubeCache());

describe('the film cube cache', () => {
  it('generates once per distinct settings and hands the same cube back', () => {
    const a = filmSettingsFor('reversal-vivid');
    const first = filmCubeFor(a);
    expect(filmCubeFor(filmSettingsFor('reversal-vivid'))).toBe(first);
    a.response.dye = 40;
    expect(filmCubeFor(a)).not.toBe(first);
  });

  it('names the cube after where the settings stand', () => {
    const s = filmSettingsFor('reversal-neutral');
    expect(filmCubeFor(s).title).toBe('Reversal · neutral');
    s.response.coupling = 50;
    expect(filmCubeFor(s).title).toBe('Reversal · neutral · adjusted');
  });
});

describe('filmLayerFromSaved', () => {
  it('rebuilds a stored film layer with its strength and switch, named from its settings', () => {
    const layer = filmLayerFromSaved(saved({ enabled: false }));
    expect(layer).toMatchObject({
      id: 'f1',
      source: FILM_SOURCE,
      name: 'Negative · portrait',
      intensity: 0.8,
      enabled: false,
    });
    expect(layer!.lut.size).toBe(33);
  });

  it('is nothing for a layer that is not film, or whose text is not settings', () => {
    expect(filmLayerFromSaved(saved({ source: 'custom' }))).toBeNull();
    expect(filmLayerFromSaved(saved({ customText: null }))).toBeNull();
    expect(filmLayerFromSaved(saved({ customText: 'LUT_3D_SIZE 2' }))).toBeNull();
  });

  it('reads a departed stock back as departed', () => {
    const s = filmSettingsFor('cross-process');
    s.response.dye = 0;
    expect(filmLayerFromSaved(saved({ customText: writeFilmSettings(s) }))!.name).toBe(
      'Cross-process · adjusted',
    );
  });
});

describe('newFilmLayer and withFilmSettings', () => {
  it('seeds a full-strength, enabled layer and the text that restores it', () => {
    const { layer, text } = newFilmLayer('n1', 'mono-panchromatic');
    expect(layer).toMatchObject({ id: 'n1', source: FILM_SOURCE, intensity: 1, enabled: true });
    expect(isFilmLayer(layer)).toBe(true);
    expect(filmLayerFromSaved({ ...layer, customText: text })).toMatchObject({ name: layer.name });
  });

  it('keeps the layer identity, strength and switch while swapping the numbers', () => {
    const { layer } = newFilmLayer('n1', 'reversal-vivid');
    const dimmed = { ...layer, intensity: 0.4, enabled: false };
    const next = filmSettingsFor('negative-consumer');
    const { layer: swapped, text } = withFilmSettings(dimmed, next);
    expect(swapped).toMatchObject({ id: 'n1', intensity: 0.4, enabled: false, name: 'Negative · consumer' });
    expect(swapped.lut).not.toBe(layer.lut);
    expect(text).toBe(writeFilmSettings(next));
  });
});
