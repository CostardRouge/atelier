/**
 * A blob as a `data:` URL — for a file that carries pictures INSIDE its JSON
 * (the training file). A browser reads it through `FileReader`; null when the
 * bytes cannot be read, so a caller keeps its row rather than losing it.
 */
export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}
