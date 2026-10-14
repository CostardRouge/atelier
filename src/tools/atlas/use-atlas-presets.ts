import { useCallback, useState } from 'react';
import { readPresets, removePreset, savePreset, type AtlasPreset } from './atlas-presets';
import type { AtlasSettings } from './atlas-settings';

const KEY = 'atelier.atlas.presets';

function readStored(): AtlasPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? readPresets(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function write(list: readonly AtlasPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: the presets hold for the session */
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p_${Math.random().toString(36).slice(2)}`;
}

export interface AtlasPresets {
  list: readonly AtlasPreset[];
  /** Keep the dials under `name` — replacing a preset of that name. False for an empty name. */
  save: (name: string, settings: AtlasSettings) => boolean;
  remove: (id: string) => void;
}

/**
 * The named presets (`atlas-presets.ts`), kept on this browser like the dials
 * themselves — written at once, since a save is one click, never a drag.
 */
export function useAtlasPresets(): AtlasPresets {
  const [list, setList] = useState<AtlasPreset[]>(readStored);
  const save = useCallback((name: string, settings: AtlasSettings) => {
    const next = savePreset(readStored(), name, settings, Date.now(), newId);
    if (!next) return false;
    write(next);
    setList(next);
    return true;
  }, []);
  const remove = useCallback((id: string) => {
    const next = removePreset(readStored(), id);
    write(next);
    setList(next);
  }, []);
  return { list, save, remove };
}
