import { useCallback, useEffect, useState } from 'react';
import type { LutStack } from '../lut/use-lut-stack';
import { DEFAULT_DEVELOP, isDefaultDevelop, type DevelopKey, type DevelopSettings } from './develop';

export interface DevelopDraft {
  draft: DevelopSettings;
  /** Replace every number at once — a paste, a preset, "As shot". */
  setDraft: (next: DevelopSettings) => void;
  /** One slider. */
  set: (key: DevelopKey, value: number) => void;
  /**
   * Any other field at once — a curve, the levels. The record stopped being
   * flat numbers, and `set` is for the sliders it names.
   */
  patch: (partial: Partial<DevelopSettings>) => void;
  /** Nothing moved: what Done hands back as null. */
  asShot: boolean;
  /** The draft as the host stores it: null when it is as shot. */
  result: () => DevelopSettings | null;
}

/**
 * The numbers being dialled, before a host keeps them.
 *
 * The draft RIDES the host's stack (`stack.setDevelop`) while the workbench is
 * mounted, so the preview bakes through the deferred path the strength slider
 * already uses, and the host's own renderers keep reading the STORED value
 * through `composeWith` until it is written. Unmounting puts the stack back.
 *
 * `value` is read once: a host that shows another picture under a mounted
 * workbench (the Develop tool's filmstrip) remounts it with a `key` per
 * picture, so a draft never leaks from one photograph onto the next — the
 * never-inherit rule.
 */
export function useDevelopDraft(value: DevelopSettings | null, stack: LutStack): DevelopDraft {
  const [draft, setDraftState] = useState<DevelopSettings>(value ?? DEFAULT_DEVELOP);
  const { setDevelop } = stack;
  useEffect(() => {
    setDevelop(draft);
  }, [draft, setDevelop]);
  useEffect(() => () => setDevelop(null), [setDevelop]);

  const setDraft = useCallback((next: DevelopSettings) => setDraftState({ ...DEFAULT_DEVELOP, ...next }), []);
  const set = useCallback((key: DevelopKey, v: number) => setDraftState((d) => ({ ...d, [key]: v })), []);
  const patch = useCallback(
    (partial: Partial<DevelopSettings>) => setDraftState((d) => ({ ...d, ...partial })),
    [],
  );
  const asShot = isDefaultDevelop(draft);
  const result = useCallback(() => (isDefaultDevelop(draft) ? null : draft), [draft]);
  return { draft, setDraft, set, patch, asShot, result };
}

/**
 * What a verb, a preset or a copy just did, told for a moment and then gone —
 * one line the footer (or the tool's status) reads.
 */
export function useTold(ms = 2400): [string | null, (message: string) => void] {
  const [told, setTold] = useState<string | null>(null);
  useEffect(() => {
    if (!told) return;
    const t = window.setTimeout(() => setTold(null), ms);
    return () => window.clearTimeout(t);
  }, [told, ms]);
  return [told, setTold];
}
