/**
 * The arithmetic behind the agent commands that write a roll's OWN settings
 * and a picture's border (`develop.exportSettings`, `develop.border`): a patch
 * merged onto what is stored, read back through the very reader a stored roll
 * goes through (`readRollExport`, `readBorder`), and REFUSED when any field it
 * names reads back as something else — the rule of `patchRecord`
 * (`develop-record-commands.ts`), extended to nested settings: the reader's
 * clamp is never silent, and the refusal says the value it would have kept.
 *
 * Pure and DOM-free.
 */

import { CommandError } from '../commands/registry';
import { DEFAULT_BORDER, readBorder, type RollBorder } from './border-layout';
import { DEFAULT_TARGET, MAX_TARGETS } from './export-targets';
import { readRollExport, type RollExport } from './roll-types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The first place where `back` does not hold what `asked` asked for, as a
 * dotted path, or null when every asked field came back. Only the fields
 * ASKED are compared: the reader filling a default the agent never named is
 * not a refusal.
 */
export function subsetMismatch(asked: unknown, back: unknown, path = ''): string | null {
  if (typeof asked === 'number' && typeof back === 'number') return Math.abs(asked - back) <= 1e-9 ? null : path;
  if (Array.isArray(asked)) {
    if (!Array.isArray(back) || back.length !== asked.length) return path;
    for (let i = 0; i < asked.length; i++) {
      const at = subsetMismatch(asked[i], back[i], `${path}[${i}]`);
      if (at !== null) return at;
    }
    return null;
  }
  if (isRecord(asked)) {
    if (!isRecord(back)) return path;
    for (const [k, v] of Object.entries(asked)) {
      const at = subsetMismatch(v, back[k], path ? `${path}.${k}` : k);
      if (at !== null) return at;
    }
    return null;
  }
  return JSON.stringify(asked) === JSON.stringify(back) ? null : path;
}

function readAt(value: unknown, path: string): unknown {
  let at: unknown = value;
  for (const part of path.split(/\.|\[(\d+)\]/).filter(Boolean)) {
    at = isRecord(at) || Array.isArray(at) ? (at as Record<string, unknown>)[part] : undefined;
  }
  return at;
}

function refuse(label: string, path: string, asked: unknown, back: unknown): never {
  const name = path ? `${label}.${path}` : label;
  throw new CommandError('invalid', `${name} = ${JSON.stringify(readAt(asked, path))} cannot be stored — it reads back as ${JSON.stringify(readAt(back, path))}`);
}

const EXPORT_KEYS = ['targets', 'replace', 'hdr', 'hdrStops', 'metadata', 'watermark', 'timelapse'] as const;

/**
 * `current` with `patch` written over it. Top-level fields replace; an object
 * field (`metadata`, `watermark`, `timelapse`) is merged one level; `targets`
 * is the whole list, each entry merged onto the target at its index (or a new
 * full-size JPEG), so `[{}, {"size": …}]` keeps the first and adds a second.
 */
export function patchRollExport(current: RollExport, patch: unknown): RollExport {
  if (!isRecord(patch)) throw new CommandError('invalid', 'settings must be an object of the export’s fields');
  const unknown = Object.keys(patch).filter((k) => !(EXPORT_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new CommandError('invalid', `no export field ${unknown.join(', ')} — the fields are ${EXPORT_KEYS.join(', ')}`);
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'targets') {
      if (!Array.isArray(v) || v.length === 0 || v.length > MAX_TARGETS) {
        throw new CommandError('invalid', `targets must be a list of 1 to ${MAX_TARGETS} targets`);
      }
      merged.targets = v.map((t, i) => {
        if (!isRecord(t)) throw new CommandError('invalid', `targets[${i}] must be an object`);
        return { ...(current.targets[i] ?? DEFAULT_TARGET), ...t };
      });
    } else if (isRecord(v) && isRecord(current[k as keyof RollExport])) {
      merged[k] = { ...(current[k as keyof RollExport] as object), ...v };
    } else {
      merged[k] = v;
    }
  }
  const out = readRollExport(merged);
  const at = subsetMismatch(patch, out);
  if (at !== null) refuse('export', at, patch, out);
  return out;
}

/** `current` (or the default border) with `patch` written over it — `margin` merged — or null to take it off. */
export function patchBorder(current: RollBorder | null | undefined, patch: unknown): RollBorder | null {
  if (patch === null) return null;
  if (!isRecord(patch)) throw new CommandError('invalid', 'border must be an object (aspect, fill, margin) or null to take it off');
  const unknown = Object.keys(patch).filter((k) => !['aspect', 'fill', 'margin'].includes(k));
  if (unknown.length) throw new CommandError('invalid', `no border field ${unknown.join(', ')} — the fields are aspect, fill, margin`);
  const base = current ?? DEFAULT_BORDER;
  const merged = { ...base, ...patch, margin: { ...base.margin, ...(isRecord(patch.margin) ? patch.margin : {}) } };
  const out = readBorder(merged);
  const at = subsetMismatch(patch, out);
  if (at !== null) refuse('border', at, patch, out);
  return out;
}
