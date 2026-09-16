/**
 * A WORKING PREVIEW — the copy of a local picture a roll keeps so it can be
 * developed while the file itself is away (F5 of `docs/develop-tool.md` §9;
 * the maintainer's Q2: local pictures only, per roll, opt-in, its weight
 * said). Lightroom calls the same thing a smart preview.
 *
 * A preview is handed around as an ordinary `File` named like the picture,
 * so every block that takes a file takes it; this module is how anything
 * that must tell the difference (the fidelity chip, the export) does.
 */

/** The long edge a working preview is made at — a Winnow proxy's. */
export const WORKING_PREVIEW_EDGE = 2048;
/** JPEG quality of a working preview. */
export const WORKING_PREVIEW_QUALITY = 0.82;
/** What one preview weighs, roughly, for the sentence said BEFORE any is made. */
export const WORKING_PREVIEW_ESTIMATE_BYTES = 450_000;

const previews = new WeakSet<File>();

/** A `File` for a stored preview, marked as one. */
export function workingPreviewFile(blob: Blob, name: string, lastModified: number): File {
  const file = new File([blob], name, { type: blob.type || 'image/jpeg', lastModified });
  previews.add(file);
  return file;
}

export function isWorkingPreview(file: File | null | undefined): boolean {
  return Boolean(file && previews.has(file));
}

/** Where a roll's opt-in is kept: this device's, like the previews themselves. */
export function workingPreviewsKey(rollId: string): string {
  return `atelier.develop.previews.${rollId}`;
}
