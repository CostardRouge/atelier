import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './version';

describe('APP_VERSION', () => {
  it("is package.json's version, the one CHANGELOG.md is checked against", () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
