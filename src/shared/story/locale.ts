/**
 * The language a series is told in (`StoryScript.lang`, 2026-10-31: he
 * publishes in English, « toute la communication que j'ai faite jusqu'à
 * maintenant est en anglais »; French stays the default so a script without
 * the field reads as before). It governs how numbers and days are written and
 * the few words the blocks draw themselves; every other word is his script's.
 * Set once per frame by the composer from the episode (`setLang`), like the
 * map and the wall.
 */
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];

const LOCALE: Record<Lang, string> = { fr: 'fr-FR', en: 'en-US' };

let LANG: Lang = 'fr';
export function setLang(lang: Lang | null | undefined): void {
  LANG = lang === 'en' ? 'en' : 'fr';
}
export const currentLang = (): Lang => LANG;

/** A number the way the language writes it: « 98 412 », « 98,412 ». (pure) */
export const numberText = (n: number, lang: Lang = LANG): string => Math.round(n).toLocaleString(LOCALE[lang]);

/** A day, short: « 03 sept. », « Sep 3 ». (pure) */
export const dayText = (iso: string, lang: Lang = LANG): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(LOCALE[lang], lang === 'fr' ? { day: '2-digit', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The words the blocks draw of their own, in each language — the French ones as the labs chose them. */
/** A month as a wall's band names it: « Sep 2025 » / « sept. 2025 ». */
export const monthText = (iso: string, lang: Lang = LANG) =>
  new Date(`${iso.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString(LOCALE[lang], { month: 'short', year: 'numeric', timeZone: 'UTC' });

const WORDS = {
  fr: {
    nextEpisode: 'ÉPISODE SUIVANT',
    season: 'SAISON',
    before: 'AVANT',
    after: 'APRÈS',
    midnight: 'MINUIT',
    feb11: '11 FÉV.',
    feb12: '12 FÉV.',
    copied: 'copiés',
    files: 'fichiers',
    wrongClock: 'horloge fausse',
    camera: 'appareil',
    noPosition: 'jours sans position',
    photos: 'photos',
    toSortThisMonth: 'photos à trier ce mois-ci',
  },
  en: {
    nextEpisode: 'NEXT EPISODE',
    season: 'SEASON',
    before: 'BEFORE',
    after: 'AFTER',
    midnight: 'MIDNIGHT',
    feb11: 'FEB 11',
    feb12: 'FEB 12',
    copied: 'copied',
    files: 'files',
    wrongClock: 'wrong clock',
    camera: 'camera',
    noPosition: 'days without a position',
    photos: 'photos',
    toSortThisMonth: 'photos to sort this month',
  },
} as const;

export type Word = keyof (typeof WORDS)['fr'];

/** One of the blocks' own words, in the series' language. */
export const word = (w: Word, lang: Lang = LANG): string => WORDS[lang][w];
