import { useEffect, useState } from 'react';

/**
 * Manage an object URL for a file across changes/unmount — the one way the
 * suite turns a `File` into something a `<video>`/`<img>` can load. Pass null
 * to release (the previous URL is always revoked).
 */
export function useObjectUrl(file: File | null): string | null {
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
