/**
 * The pictures this tab SENT to an agent, this session — every image a
 * command answered through the bridge (a contact sheet, a sum-up card, a
 * snapshot of a picture), kept so the person can see what the agent saw: the
 * real renders, on their own photographs, that the bench's made-up material
 * cannot show (`docs/memory/agent-commands.md`).
 *
 * Module state, like the tasks: it survives a route change and nothing else.
 * Never written to storage — a sent preview is a copy of someone's picture,
 * and the journal is a window on the session, not an archive. Bounded: the
 * newest `SENT_MAX` stay, the oldest go first.
 */

import type { ImageResult } from './registry';

export interface SentImage {
  /** Increasing within the session. */
  seq: number;
  at: number;
  command: string;
  params: unknown;
  blob: Blob;
  width: number;
  height: number;
  note?: string;
}

/** How many sent pictures are kept; a contact sheet is a few hundred kB. */
export const SENT_MAX = 24;

let sent: readonly SentImage[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Whether a command's answer is a picture. */
export function isImageResult(v: unknown): v is ImageResult {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'image' && typeof (v as { data?: unknown }).data === 'string';
}

/** Keep a picture a command answered with; newest first, `SENT_MAX` at most. */
export function recordSent(command: string, params: unknown, result: ImageResult, at = Date.now()): void {
  let blob: Blob;
  try {
    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blob = new Blob([bytes], { type: result.mimeType });
  } catch {
    return;
  }
  const entry: SentImage = { seq: ++seq, at, command, params, blob, width: result.width, height: result.height, ...(result.note ? { note: result.note } : {}) };
  sent = [entry, ...sent].slice(0, SENT_MAX);
  emit();
}

/** What was sent, newest first. */
export function sentImages(): readonly SentImage[] {
  return sent;
}

export function subscribeSent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget everything sent this session. */
export function clearSent(): void {
  if (!sent.length) return;
  sent = [];
  emit();
}
