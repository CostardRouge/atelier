import { useEffect, useState } from 'react';

/**
 * Manage an object URL for a file/blob across changes/unmount — the one way
 * the suite turns a `File` (or a stored `Blob`, e.g. a project thumbnail) into
 * something a `<video>`/`<img>` can load. Pass null to release (the previous
 * URL is always revoked).
 */
export function useObjectUrl(file: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [file]);
  return url;
}
