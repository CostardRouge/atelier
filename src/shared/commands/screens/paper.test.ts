import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCREEN_DARK, SCREEN_LIGHT, type ScreenPalette } from './paper';

const css = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8');

/** A token's value inside one CSS block. */
function token(block: string, name: string): string | null {
  return block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1].toLowerCase() ?? null;
}

const KEYS: Record<keyof ScreenPalette, string> = { paper: 'paper', ink: 'ink', muted: 'muted', line: 'line', accent: 'accent' };

describe('the screens’ palette', () => {
  it('is the light theme’s tokens', () => {
    const theme = css.slice(css.indexOf('@theme'), css.indexOf("html[data-theme='dark']"));
    for (const [key, name] of Object.entries(KEYS)) expect([key, SCREEN_LIGHT[key as keyof ScreenPalette]]).toEqual([key, token(theme, name)]);
  });

  it('is the dark theme’s tokens', () => {
    const start = css.indexOf("html[data-theme='dark']");
    const dark = css.slice(start, css.indexOf('}', start));
    for (const [key, name] of Object.entries(KEYS)) expect([key, SCREEN_DARK[key as keyof ScreenPalette]]).toEqual([key, token(dark, name)]);
  });
});
