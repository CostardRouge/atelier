/**
 * The suite's icons: one grid (24), one stroke (1.7), `currentColor`.
 *
 * Before this the interface drew its icons as Unicode glyphs — about 140 of
 * them, `×` and `✕` both meaning close, `❚❚`/`▶` copied into seven players —
 * and a glyph is drawn by whichever font the platform substitutes, so the same
 * "close" was a different shape on every machine. These are the same SVGs
 * Winnow draws (the maintainer wants the two apps to look alike), kept in the
 * repo rather than pulled from an icon package: no dependency, no request, and
 * a set small enough to read in one screen.
 *
 * Each icon is an element, not a component, so it can be passed straight to a
 * `Button`'s `icon`; size follows the parent's font through `1em`, and a
 * caller that needs it larger sets the font size or an explicit class.
 * Glyphs that MEAN something in the content — a `→` between two places, a
 * `◆` place marker on a canvas — stay text; this is for controls.
 */

import type { ReactNode, SVGProps } from 'react';

function icon(paths: ReactNode, extra?: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...extra}
    >
      {paths}
    </svg>
  );
}

export const Icons = {
  back: icon(<path d="M15 6l-6 6 6 6" />),
  forward: icon(<path d="M9 6l6 6-6 6" />),
  up: icon(<path d="M6 15l6-6 6 6" />),
  down: icon(<path d="M6 9l6 6 6-6" />),
  chevronRight: icon(<path d="M9 6l6 6-6 6" />),
  arrowUp: icon(<path d="M12 19V5M5 12l7-7 7 7" />),
  arrowDown: icon(<path d="M12 5v14M5 12l7 7 7-7" />),
  close: icon(<path d="M6 6l12 12M18 6 6 18" />),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  minus: icon(<path d="M5 12h14" />),
  check: icon(<path d="M5 12l5 5 9-10" />),
  more: icon(
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </>,
  ),
  /** The dotted wait — an export in flight, a fetch not yet answered. */
  ellipsis: icon(
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>,
  ),
  settings: icon(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>,
  ),
  info: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>,
  ),
  warning: icon(<path d="M12 4l9 16H3zM12 10v4M12 17v.01" />),
  play: icon(<path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />),
  pause: icon(
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>,
  ),
  download: icon(<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />),
  upload: icon(<path d="M12 15V4m0 0L8 8m4-4 4 4M5 20h14" />),
  export: icon(<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />),
  import: icon(<path d="M12 15V4m0 0L8 8m4-4 4 4M5 20h14" />),
  trash: icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />),
  reset: icon(<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5" />),
  search: icon(
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>,
  ),
  image: icon(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.2" fill="currentColor" stroke="none" />
    </>,
  ),
  video: icon(
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </>,
  ),
  calendar: icon(
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>,
  ),
  grid: icon(
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>,
  ),
  rows: icon(<path d="M4 7h16M4 12h16M4 17h16" />),
  library: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>,
  ),
  folder: icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  link: icon(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />),
  external: icon(<path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5" />),
  clock: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  scissors: icon(
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8 7.5 20 18M8 16.5 20 6" />
    </>,
  ),
  sun: icon(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  ),
  moon: icon(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />),
} as const;

export type IconName = keyof typeof Icons;
