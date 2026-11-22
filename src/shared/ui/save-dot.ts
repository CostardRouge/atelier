/**
 * What a document's local save state looks like in a bar (`SaveDot.tsx`):
 * a dot's colour, the sentence behind it, and a word only when the author
 * must act. One table for every editor, so "saved" is the same green dot in
 * the Studio, Recap, Mosaic and Flight Atlas. (pure)
 */

/** `unsaved`: edits waiting for the save that is coming. `failed`: the browser refused to store them. */
export type SaveDotState = 'saved' | 'saving' | 'unsaved' | 'failed';

export interface SaveDotFace {
  dot: string;
  sentence: string;
  /** Drawn beside the dot — only for a state the author must act on. */
  word: string | null;
}

export function saveDotFace(state: SaveDotState, noun: string): SaveDotFace {
  switch (state) {
    case 'saved':
      return { dot: 'bg-ok', sentence: `Saved — every change to this ${noun} is kept on this device as you go`, word: null };
    case 'saving':
      return { dot: 'bg-warn-bright animate-pulse', sentence: 'Saving…', word: null };
    case 'unsaved':
      return { dot: 'bg-line-strong', sentence: 'Edited — saving in a moment', word: null };
    case 'failed':
      return {
        dot: 'bg-danger',
        sentence: `Not saved — the browser refused to store this ${noun} (a private window, or the disk is full); your edits are still on screen`,
        word: 'Not saved',
      };
  }
}
