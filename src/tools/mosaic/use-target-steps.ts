import { useCallback, useEffect, useRef, useState } from 'react';
import { withCrop, withTarget, type MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import { EMPTY_TARGETS, stepBack, stepForward, visited, withCurrentCrop, type TargetHistory, type TargetStep } from '../../shared/mosaic/target-history';

export interface TargetSteps {
  canBack: boolean;
  canForward: boolean;
  back: () => void;
  forward: () => void;
}

/**
 * Previous and next over the targets visited (`target-history.ts`): the
 * hook WATCHES the document's target — whatever changed it — and records
 * the one left; a step back or forward goes through the editor's one
 * change funnel with the step's crop, and is not recorded as a visit.
 */
export function useTargetSteps(doc: MosaicDoc, change: (fn: (d: MosaicDoc) => MosaicDoc) => void): TargetSteps {
  const [history, setHistory] = useState<TargetHistory>(EMPTY_TARGETS);
  const historyRef = useRef(history);
  historyRef.current = history;
  // The target on screen and the crop it wears now — what a step away leaves behind.
  const current = useRef<TargetStep | null>(doc.target === undefined ? null : { id: doc.target, ...(doc.crop ? { crop: doc.crop } : {}) });
  // A target the hook itself is going to: its arrival is not a visit.
  const stepping = useRef<number | null>(null);
  const tilesRef = useRef(doc.tiles);
  tilesRef.current = doc.tiles;

  useEffect(() => {
    const target = doc.target;
    const from = current.current;
    if (target === undefined) return;
    if (from && from.id === target) {
      current.current = withCurrentCrop(from, doc.crop);
      return;
    }
    if (stepping.current === target) stepping.current = null;
    else setHistory((h) => visited(h, from, target));
    current.current = { id: target, ...(doc.crop ? { crop: doc.crop } : {}) };
  }, [doc.target, doc.crop]);

  const known = useCallback((id: number) => tilesRef.current.some((t) => t.id === id && t.grid), []);
  const go = useCallback(
    (move: typeof stepBack) => {
      const cur = current.current;
      if (!cur) return;
      const r = move(historyRef.current, cur, known);
      if (!r) return;
      stepping.current = r.to.id;
      setHistory(r.history);
      change((d) => withCrop(withTarget(d, r.to.id), r.to.crop));
    },
    [change, known],
  );
  const back = useCallback(() => go(stepBack), [go]);
  const forward = useCallback(() => go(stepForward), [go]);
  const cur = current.current;
  return {
    canBack: Boolean(cur && stepBack(history, cur, known)),
    canForward: Boolean(cur && stepForward(history, cur, known)),
    back,
    forward,
  };
}
