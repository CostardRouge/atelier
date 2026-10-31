import { afterEach, describe, expect, it } from 'vitest';
import { currentLang, dayText, numberText, setLang, word } from './locale';

afterEach(() => setLang('fr'));

describe('locale', () => {
  it('writes numbers the way each language groups them', () => {
    expect(numberText(98412, 'en')).toBe('98,412');
    expect(numberText(98412, 'fr').replace(/\s/g, ' ')).toBe('98 412');
    expect(numberText(12.6, 'en')).toBe('13');
  });

  it('writes a day the way each language does, whatever the clock’s zone', () => {
    expect(dayText('2025-09-03', 'en')).toBe('Sep 3');
    expect(dayText('2025-09-03', 'fr')).toBe('03 sept.');
  });

  it('holds the language a post is drawn in, French unless told English', () => {
    expect(currentLang()).toBe('fr');
    setLang('en');
    expect(word('nextEpisode')).toBe('NEXT EPISODE');
    expect(numberText(1000)).toBe('1,000');
    setLang(undefined);
    expect(currentLang()).toBe('fr');
    expect(word('nextEpisode')).toBe('ÉPISODE SUIVANT');
  });
});
