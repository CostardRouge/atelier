/**
 * Delivery of finished exports: one download helper and one output-naming
 * convention for the whole suite (`clip.mp4` + `overlay` → `clip-overlay.mp4`).
 */

/** `clip.mp4` + `graded` → `clip-graded.mp4`. */
export function outputName(sourceName: string, suffix: string): string {
  return `${sourceName.replace(/\.[^.]+$/, '')}-${suffix}.mp4`;
}

/** Trigger a browser download for a finished blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Keep the URL alive long enough for the download to start.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
