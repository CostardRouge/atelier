import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Two things the design tokens forbid in a className, caught at lint time
 * because nothing else can see them:
 *
 * - an arbitrary text size (`text-[0.78rem]`): the suite once carried 43 of
 *   them; the scale is Tailwind's named sizes plus `2xs`/`3xs` (`index.css`);
 * - a raw hex colour (`text-[#9a3a23]`): every colour is a token, and the
 *   state colours (`danger`, `ok`, `warn`, `info`) exist for what the hexes
 *   used to say by hand.
 */
const ARBITRARY_TEXT_SIZE = /\btext-\[[0-9.]+(rem|px)\]/;
const RAW_HEX_COLOUR = /\b(text|bg|border|decoration|ring|fill|stroke|outline|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/;

const tokenRules = [
  {
    selector: `Literal[value=${ARBITRARY_TEXT_SIZE}]`,
    message: 'Use a named text size (text-xs, text-sm, text-2xs…), never text-[…rem].',
  },
  {
    selector: `TemplateElement[value.raw=${ARBITRARY_TEXT_SIZE}]`,
    message: 'Use a named text size (text-xs, text-sm, text-2xs…), never text-[…rem].',
  },
  {
    selector: `Literal[value=${RAW_HEX_COLOUR}]`,
    message: 'Use a colour token (danger, ok, warn, info, muted…), never a raw hex.',
  },
  {
    selector: `TemplateElement[value.raw=${RAW_HEX_COLOUR}]`,
    message: 'Use a colour token (danger, ok, warn, info, muted…), never a raw hex.',
  },
];

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
    },
    rules: {
      'no-restricted-syntax': ['error', ...tokenRules],
    },
  },
);
