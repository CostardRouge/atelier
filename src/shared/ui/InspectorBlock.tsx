import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';

/** Every section's title band sticks under the head while its section scrolls (lab 13); the scroller sets `--bands-top`. */
export const STICKY_BANDS =
  '[&_section[data-section]>div:first-child]:sticky [&_section[data-section]>div:first-child]:top-[var(--bands-top)] [&_section[data-section]>div:first-child]:z-[2] [&_section[data-section]>div:first-child]:bg-surface';

/**
 * An instrument's inspector as a BLOCK (lab 13, built first on Recap;
 * `frontend.md` «An instrument's inspector»): a surface card beside the
 * stage, its `head` — the tabs, or whatever chooses what is shown — pinned
 * at its top, the sections scrolling under it with every title band sticky,
 * and a `foot` pinned at its bottom for what is TRIGGERED (a `DeliverBar`).
 *
 * The host is a `@container` that puts the stage and this block side by
 * side from 860 px: there the block scrolls its own body; under it the PAGE
 * scrolls, the head sticks to the page's top and the bands just under it
 * (the head's height is measured, `--bands-top`), the foot to its bottom.
 *
 * `footRef` hands the foot's element to a host that portals into it (a
 * panel kept mounted so its run stays in the foot on every tab); an empty
 * foot takes no room.
 */
export default function InspectorBlock({
  label,
  head,
  children,
  foot,
  footRef,
  bodyClassName = 'gap-1',
}: {
  /** Names the block for assistive tech — «Recap settings». */
  label: string;
  head?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  footRef?: Ref<HTMLDivElement>;
  /** The body's own stacking — its gap. */
  bodyClassName?: string;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const [headH, setHeadH] = useState(0);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeadH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <aside
      className="flex-none min-w-0 flex flex-col border border-line rounded-paper bg-surface [--bands-top:var(--head-h,0px)] @min-[860px]:min-h-0 @min-[860px]:[--bands-top:0px]"
      style={{ '--head-h': `${head ? headH : 0}px` } as CSSProperties}
      aria-label={label}
    >
      {head && (
        <div ref={headRef} className="flex-none sticky top-0 z-[3] rounded-t-paper bg-surface px-3 pt-3 pb-2 @min-[860px]:static">
          {head}
        </div>
      )}
      <div
        className={`flex flex-col px-3 pb-4 overflow-x-clip @min-[860px]:overflow-x-hidden @min-[860px]:flex-1 @min-[860px]:min-h-0 @min-[860px]:overflow-y-auto @min-[860px]:overscroll-contain ${head ? '' : 'pt-2'} ${bodyClassName} ${STICKY_BANDS}`}
      >
        {children}
      </div>
      {/* The foot: what the instrument TRIGGERS, pinned at the block's bottom. */}
      <div ref={footRef} className="flex-none sticky bottom-0 z-[3] px-3 pb-3 empty:hidden @min-[860px]:static">
        {foot}
      </div>
    </aside>
  );
}

/** The tabs of a block's head: ONE row, each as wide as its word, sideways scroll only where a screen is narrower. */
export const BLOCK_TABS = 'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:flex-auto [&>button]:min-w-max [&>button]:px-1.5';
