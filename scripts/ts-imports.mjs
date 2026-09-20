/**
 * Let a `scripts/*.mjs` generator import the app's OWN TypeScript modules.
 *
 * Node strips types on its own since 22.18, so a `.ts` file already loads —
 * but it will not resolve the extensionless specifiers TypeScript is written
 * with (`./interpolate`), and the whole point of a generator here is to run
 * the very code the browser runs rather than a second copy of the arithmetic.
 * This adds the one missing piece: try `.ts`, `.tsx`, then `/index.ts`.
 *
 * USAGE (see `gen-lut-thumbs.mjs`):
 *
 *     import { registerTsImports } from './ts-imports.mjs';
 *     registerTsImports();
 *     const { parseCube } = await import('../src/shared/lib/cube-parser.ts');
 *
 * The import has to be dynamic and come AFTER the call: static imports are
 * all resolved before any of the module body runs.
 *
 * Only modules whose imports are values-free of the DOM will load, which is
 * the same line `vitest.config.ts` draws — pure logic in its own module. That
 * is a feature: if a generator cannot import it, it did not belong in a
 * generator.
 */
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  const parent = context.parentURL;
  if (parent && /\\.tsx?$/.test(parent) && /^[.]{1,2}\\//.test(specifier)) {
    const asIs = new URL(specifier, parent);
    if (!existsSync(fileURLToPath(asIs))) {
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const candidate = new URL(specifier + ext, parent);
        if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
      }
    }
  }
  return next(specifier, context);
}
`;

let registered = false;

/**
 * Install the resolver, once. Throws with something readable if this Node
 * cannot read TypeScript at all — the alternative is a stack trace about an
 * unexpected token in a file that is perfectly valid.
 */
export function registerTsImports() {
  if (registered) return;
  if (!process.features.typescript) {
    throw new Error(
      `This script runs the app's own TypeScript modules, which needs Node 22.18 or newer ` +
        `(this is ${process.version}). Re-run it under a current Node — nvm use 22.`,
    );
  }
  register(`data:text/javascript,${encodeURIComponent(HOOK)}`, pathToFileURL(import.meta.url));
  registered = true;
  // `existsSync` is imported here only so a typo in the hook above fails at
  // load rather than on the first bare specifier.
  void existsSync;
}
