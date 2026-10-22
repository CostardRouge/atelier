/**
 * Taking pictures off the roll from the KEYBOARD (2026-10-22, his pick B on a
 * computer and E on a phone or an iPad, lab
 * https://claude.ai/artifact/Bc1DDfFrNVFMC2U7oQoicf). Pure: what Delete or
 * Backspace aims at, the question's words, and how the question is answered
 * from the keys.
 *
 * The key always ASKS — a key is easily hit — but the question is one the
 * keyboard can answer: a second Delete or Enter takes the pictures, Escape
 * keeps them. That is allowed here and refused to a destructive dialog
 * elsewhere (`ConfirmDialog`) because a removal is one undoable write: the
 * files stay where they are and ⌘Z puts the pictures back with their work.
 */

import { pictureEdits, pictureLabel, type RollPicture } from '../../shared/develop/roll-types';

/** What the key takes: the marked pictures while the selection holds any, else the open one. */
export function removeTargets(at: { selecting: boolean; selectedIds: readonly string[]; openId: string | null }): string[] {
  if (at.selecting && at.selectedIds.length > 0) return [...at.selectedIds];
  return at.openId ? [at.openId] : [];
}

export interface RemoveWords {
  title: string;
  /** What leaves with them, and that the files stay. */
  body: string;
  /** The way back, with this machine's chord. */
  back: string;
}

/** The question's words for these pictures; `chord` is the undo key as this keyboard writes it. */
export function removeWords(pictures: readonly RollPicture[], chord: string): RemoveWords {
  if (pictures.length === 1) {
    const p = pictures[0];
    const edits = pictureEdits(p);
    return {
      title: `Take ${pictureLabel(p)} off the roll?`,
      body: edits.length
        ? `What was done to it goes with it — ${edits.join(', ')}. The file stays where it is.`
        : 'It carries no work. The file stays where it is.',
      back: `${chord} puts it back.`,
    };
  }
  const worked = pictures.filter((p) => pictureEdits(p).length > 0).length;
  return {
    title: `Take ${pictures.length} pictures off the roll?`,
    body: worked
      ? `What was done to them goes with them — ${worked} of them carry work. The files stay where they are.`
      : 'None of them carries work. The files stay where they are.',
    back: `${chord} puts them back.`,
  };
}

/** The undo chord as this machine's keyboard writes it (`UndoRedo`'s reading). */
export function undoChord(userAgent: string): string {
  return /Mac|iP(hone|ad|od)/.test(userAgent) ? '⌘Z' : 'Ctrl+Z';
}

export interface RemoveKeyPress {
  key: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** The press lands on a button, which Enter already clicks. */
  onButton: boolean;
}

/**
 * How the open question reads a key: Escape keeps; Delete or Backspace
 * (once, not held — the press that opened it must not also answer it) and
 * Enter take. A chord is nobody's here, and Enter on a focused button is
 * that button's own click.
 */
export function removeDialogKey(press: RemoveKeyPress): 'confirm' | 'cancel' | null {
  if (press.metaKey || press.ctrlKey || press.altKey) return null;
  if (press.key === 'Escape') return 'cancel';
  if (press.shiftKey || press.repeat) return null;
  if (press.key === 'Delete' || press.key === 'Backspace') return 'confirm';
  if (press.key === 'Enter') return press.onButton ? null : 'confirm';
  return null;
}
