import { useEffect, useState } from 'react';
import { ownModelInfo, useOwnModelVersion, type OwnModelInfo } from './own-model-vault';

/**
 * The model of his own this device holds, for a row or a verb to read:
 * `undefined` while the vault is asked, `null` when there is none. Re-read
 * whenever the vault changes (a load, a forget).
 */
export function useOwnModel(): OwnModelInfo | null | undefined {
  const version = useOwnModelVersion();
  const [info, setInfo] = useState<OwnModelInfo | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void ownModelInfo().then((i) => {
      if (alive) setInfo(i);
    });
    return () => {
      alive = false;
    };
  }, [version]);
  return info;
}
