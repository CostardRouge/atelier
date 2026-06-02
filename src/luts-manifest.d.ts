/**
 * `virtual:luts` — the build-time scan of `public/luts` for `.cube` files,
 * produced by the `luts-manifest` Vite plugin (see vite.config.ts). Discovered
 * at build, baked into the bundle, so it works on static hosting with no
 * runtime directory listing.
 */
declare module 'virtual:luts' {
  export interface LutManifestEntry {
    /** Stable id from the path, e.g. `apple/AppleLog.cube` → `apple-applelog`. */
    id: string;
    /** Display label derived from the filename. */
    name: string;
    /** Posix folder path relative to `luts/` (`''` for files at the root). */
    group: string;
    /** Posix path relative to `luts/`. */
    file: string;
  }
  const luts: LutManifestEntry[];
  export default luts;
}
