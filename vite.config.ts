import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// --- Built-in LUT discovery -------------------------------------------------
//
// Static hosting (GitHub Pages) can't list a directory at runtime, so we scan
// `public/luts` (recursively, any nesting) at build/dev time and expose the
// result as the `virtual:luts` module. Folder names become groups; filenames
// become labels. Drop a `.cube` into any sub-folder and it shows up in the
// picker — no code to edit.

const LUTS_DIR = fileURLToPath(new URL('./public/luts', import.meta.url));
const VIRTUAL_ID = 'virtual:luts';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

interface LutEntry {
  /** Stable id from the path, e.g. `apple/AppleLog.cube` → `apple-applelog`. */
  id: string;
  /** Label from the filename: underscores/hyphens → spaces, words capitalised. */
  name: string;
  /** Posix folder path relative to `luts/` (`''` for files at the root). */
  group: string;
  /** Posix path relative to `luts/`, used to build the fetch URL. */
  file: string;
}

function prettify(stem: string): string {
  return (
    stem
      .split(/[\s_-]+/)
      .filter(Boolean)
      // Fix only the first letter so deliberate casing (Rec709, DLog) survives.
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ') || stem
  );
}

function scanLuts(): LutEntry[] {
  const out: LutEntry[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // luts/ may not exist yet
    }
    for (const entry of entries) {
      // Skip hidden files and macOS AppleDouble sidecars.
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cube')) {
        const rel = path.relative(LUTS_DIR, full).split(path.sep).join('/');
        const groupDir = path.posix.dirname(rel);
        out.push({
          id: rel.replace(/\.cube$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
          name: prettify(entry.name.replace(/\.cube$/i, '')),
          group: groupDir === '.' ? '' : groupDir,
          file: rel,
        });
      }
    }
  };
  walk(LUTS_DIR);
  out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return out;
}

function lutsManifestPlugin(): Plugin {
  return {
    name: 'luts-manifest',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export default ${JSON.stringify(scanLuts())};`;
      }
    },
    configureServer(server) {
      // Re-scan and reload when a `.cube` is added or removed during dev.
      const refresh = (file: string) => {
        if (!file.toLowerCase().endsWith('.cube')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(LUTS_DIR);
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}

// --- House style (dev server only) ------------------------------------------
//
// Trips' settings sheet and the Studio's project settings can save the open
// trip's or project's look as the one every NEW one starts from
// (`src/shared/roadtrip/house-style.ts`, `src/shared/projects/house-style.ts`).
// A browser cannot write into the repository, so the dev server does: one
// FIXED file per target, written on a POST and removed on a DELETE — the
// request names a key of the table below, never a path. `apply: 'serve'` keeps
// the endpoint out of `vite build`: the deployed site is static and only ever
// reads the committed files. The app fetches it at the root, outside `base`,
// because this middleware runs before Vite's own.

const HOUSE_STYLES: Record<string, { file: string; kind: string }> = {
  trip: {
    file: fileURLToPath(new URL('./src/shared/roadtrip/house-style.json', import.meta.url)),
    kind: 'atelier.trip-house-style',
  },
  project: {
    file: fileURLToPath(new URL('./src/shared/projects/house-style.json', import.meta.url)),
    kind: 'atelier.project-house-style',
  },
};
const HOUSE_STYLE_ROUTE = '/__atelier/house-style';
const HOUSE_STYLE_MAX_BYTES = 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > HOUSE_STYLE_MAX_BYTES) {
        reject(new Error('The house style is larger than 1 MB.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function houseStylePlugin(): Plugin {
  return {
    name: 'house-style-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(HOUSE_STYLE_ROUTE, async (req, res) => {
        const reply = (status: number, body: Record<string, unknown>) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        // Same origin only: another site open in the same browser must not be
        // able to rewrite a file in the repository through the dev server. A
        // cross-origin JSON POST is preflighted, and the preflight gets a 405.
        let origin: string | null = null;
        try {
          origin = req.headers.origin ? new URL(req.headers.origin).host : null;
        } catch {
          origin = 'invalid';
        }
        if (origin !== null && origin !== req.headers.host) {
          reply(403, { error: 'Refused: the request did not come from this dev server.' });
          return;
        }
        // Mounted on the route, so `req.url` is what follows it: `/trip`, `/project`.
        const key = (req.url ?? '').replace(/^\/+|[?#].*$/g, '');
        const target = Object.hasOwn(HOUSE_STYLES, key) ? HOUSE_STYLES[key] : null;
        if (!target) {
          reply(404, { error: `No house style is called “${key}”.` });
          return;
        }
        const where = path.relative(process.cwd(), target.file).split(path.sep).join('/');
        try {
          if (req.method === 'DELETE') {
            await rm(target.file, { force: true });
            reply(200, { path: where });
            return;
          }
          if (req.method !== 'POST') {
            reply(405, { error: 'POST a house style, or DELETE it.' });
            return;
          }
          if (!req.headers['content-type']?.startsWith('application/json')) {
            reply(415, { error: 'Send the house style as application/json.' });
            return;
          }
          const file: unknown = JSON.parse(await readBody(req));
          const valid =
            typeof file === 'object' &&
            file !== null &&
            (file as { kind?: unknown }).kind === target.kind &&
            Number.isInteger((file as { version?: unknown }).version) &&
            typeof (file as { style?: unknown }).style === 'object' &&
            (file as { style?: unknown }).style !== null;
          if (!valid) {
            reply(400, { error: 'That is not a house style.' });
            return;
          }
          await writeFile(target.file, `${JSON.stringify(file, null, 2)}\n`);
          reply(200, { path: where });
        } catch (error) {
          // A body that is not JSON is the caller's fault; a failed write is ours.
          reply(error instanceof SyntaxError ? 400 : 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
  };
}

// The GitHub Pages base path is `/<repo>/` (served from
// https://<user>.github.io/<repo>/). In CI we read the real repository name
// from `GITHUB_REPOSITORY` (`owner/repo`, set automatically by GitHub Actions)
// so the base can never drift out of sync with the repo name — a hardcoded
// value previously did, and Pages 404'd every asset. Locally (`dev`/`preview`)
// `GITHUB_REPOSITORY` is unset, so we fall back to the repo name. Set
// `BASE_PATH` to override — e.g. `/` when serving from a custom domain.
const REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'atelier';
const BASE = process.env.BASE_PATH ?? `/${REPO}/`;

export default defineConfig({
  plugins: [react(), tailwindcss(), lutsManifestPlugin(), houseStylePlugin()],
  base: BASE,
  // ffmpeg.wasm (the HEVC→H.264 transcode fallback) spins up a module worker and
  // is loaded lazily; don't let dev pre-bundling rewrite its worker URL, and emit
  // ES-format workers so the production build matches.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  worker: { format: 'es' },
});
