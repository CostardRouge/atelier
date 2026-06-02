import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync } from 'node:fs';
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

// The GitHub repo name, and therefore the GitHub Pages base path
// (https://<user>.github.io/<REPO>/). Single source of truth so renaming the
// project is a one-line change. NOTE: this must match the actual repo name when
// deploying — rename the GitHub repo to `atelier` before merging to `main`, or
// Pages will 404 on every asset.
const REPO = 'atelier';

export default defineConfig({
  plugins: [react(), lutsManifestPlugin()],
  base: `/${REPO}/`,
});
