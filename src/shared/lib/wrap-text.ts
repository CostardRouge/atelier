/**
 * Greedy word wrapping onto a character budget.
 *
 * The overlay engine draws a text element as ONE line and never wraps — which
 * is right for a readout and wrong for a sentence. The call-to-action card is
 * the first place the suite sets a sentence, and without this its body ran off
 * both edges of the frame.
 *
 * The budget is a character COUNT rather than a measured width, so this stays
 * pure and testable: the caller estimates it from the font size and the frame,
 * and errs low. An extra line break costs a little space; an overflowing line
 * costs the words themselves.
 *
 * Pure and DOM-free.
 */

/**
 * Split `text` into lines of at most `maxChars` characters, breaking on
 * spaces. Line breaks the author typed are kept — they are a decision, not
 * whitespace. A single word longer than the budget is left whole rather than
 * cut: a broken URL is worse than one that overhangs, and the caller can see
 * it happen.
 */
export function wrapText(text: string, maxChars: number): string[] {
  const budget = Math.max(1, Math.floor(maxChars));
  const out: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= budget) {
        line += ` ${word}`;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }

  // A trailing blank paragraph is the author pressing return at the end; it
  // reserves space nobody asked for.
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * How many characters of a proportional sans face fit across `widthPx` at
 * `fontPx`. Deliberately pessimistic — 0.55 em per character against a real
 * average nearer 0.5 — because wrapping one word early is invisible and
 * wrapping one word late runs off the frame.
 */
export function charBudget(widthPx: number, fontPx: number): number {
  if (fontPx <= 0) return 1;
  return Math.max(1, Math.floor(widthPx / (fontPx * 0.55)));
}
