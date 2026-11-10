import type { ReactNode } from 'react';
import OverflowMenu, { type OverflowItem } from './OverflowMenu';

/**
 * The picture IN HAND, as one card: what it is, the one thing to do with it,
 * and the rest (2026-11-10, his report on Recap's place: a filled pill, two
 * bare words, a centred third and an orange link — four verbs in four
 * dresses beside a thumbnail too small to judge).
 *
 * - the picture, large enough to recognise (two fifths of the card), with a
 *   `mark` burnt on its foot for what is unusual about it;
 * - its `name` — plain, or the MENU that chooses which file it is read from
 *   (a RAW's camera render or its sensor: the host passes that chip) — and a
 *   `meta` word in mono;
 * - ONE `primary` control across the column (`DevelopDoor`, or the verb that
 *   fills an empty place);
 * - the `verbs`: at most two quiet buttons of one dress, sharing the row;
 * - what is rare or destructive behind ⋯ (`menu`).
 *
 * Hick: one obvious verb and two quiet ones instead of five equals.
 * Similarity: one dress per rank. Fitts: the primary is the widest target.
 */
export default function PictureCard({
  thumb,
  mark,
  name,
  meta,
  primary,
  verbs,
  menu,
  menuLabel = 'More for this picture',
}: {
  /** The picture, filling its frame (`w-full h-full`), or the words of an empty place. */
  thumb: ReactNode;
  /** One short line over the picture's foot — «from 12 Nov · chosen by hand». */
  mark?: ReactNode;
  name?: ReactNode;
  meta?: ReactNode;
  primary?: ReactNode;
  verbs?: ReactNode;
  menu?: readonly OverflowItem[];
  menuLabel?: string;
}) {
  return (
    <div className="flex gap-3 min-w-0">
      <div className="relative flex-none w-[40%] max-w-44 aspect-[4/3] rounded-control overflow-hidden bg-paper-2">
        {thumb}
        {mark && (
          <span className="absolute inset-x-0 bottom-0 px-1.5 pt-3 pb-1 bg-gradient-to-t from-frame/80 to-transparent font-mono text-3xs leading-tight text-on-media truncate">
            {mark}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-1.5">
        {(name || meta) && (
          <div className="flex items-baseline gap-2 min-w-0 min-h-5">
            <span className="flex-1 min-w-0 truncate font-mono text-2xs text-ink-soft">{name}</span>
            {meta && <span className="flex-none font-mono text-2xs text-muted tabular-nums">{meta}</span>}
          </div>
        )}
        {primary}
        {(verbs || (menu && menu.length > 0)) && (
          <div className="flex items-center gap-1 min-w-0 [&>button]:flex-1 [&>button]:min-w-0">
            {verbs}
            {menu && menu.length > 0 && <OverflowMenu label={menuLabel} size="sm" items={menu} />}
          </div>
        )}
      </div>
    </div>
  );
}
