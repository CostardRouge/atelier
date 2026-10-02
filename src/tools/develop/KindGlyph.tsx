import { useId } from 'react';
import type { PaletteKind } from './kind-palette';

/**
 * A mask kind drawn as what it covers, in a 34 × 24 frame — a gradient for a
 * linear mask, an ellipse for a radial, a figure and a pointer for a subject.
 * The palette's tiles and the kind chip both wear it, so the same picture
 * means the same kind wherever it is met. Ink is `currentColor`.
 */
export default function KindGlyph({ kind, className = 'w-[34px] h-6' }: { kind: PaletteKind; className?: string }) {
  // A gradient needs a document-unique id; React's has colons, which a
  // `url(#…)` reference does not want.
  const id = `kg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const frame = <rect x="1" y="1" width="32" height="22" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.35" />;
  let body;
  switch (kind) {
    case 'whole':
      body = <rect x="1" y="1" width="32" height="22" rx="4" fill="currentColor" fillOpacity="0.85" />;
      break;
    case 'linear':
      body = (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.15" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="0.7" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="32" height="22" rx="4" fill={`url(#${id})`} />
          {frame}
        </>
      );
      break;
    case 'radial':
      body = (
        <>
          <defs>
            <radialGradient id={id}>
              <stop offset="0.45" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="17" cy="12" rx="12" ry="9" fill={`url(#${id})`} />
          {frame}
        </>
      );
      break;
    case 'shade':
      body = (
        <>
          <defs>
            <radialGradient id={id} cx="0" cy="1" r="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="0.8" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="1" y="1" width="32" height="22" rx="4" fill={`url(#${id})`} />
          {frame}
        </>
      );
      break;
    case 'luma':
      body = (
        <>
          {frame}
          <rect x="5" y="15" width="5" height="5" fill="currentColor" fillOpacity="0.25" />
          <rect x="12" y="10" width="5" height="10" fill="currentColor" fillOpacity="0.9" />
          <rect x="19" y="7" width="5" height="13" fill="currentColor" fillOpacity="0.9" />
          <rect x="26" y="12" width="4" height="8" fill="currentColor" fillOpacity="0.25" />
        </>
      );
      break;
    case 'colour':
      body = (
        <>
          {frame}
          <circle cx="11" cy="12" r="4.5" fill="currentColor" fillOpacity="0.9" />
          <circle cx="21" cy="9" r="3" fill="currentColor" fillOpacity="0.55" />
          <circle cx="23" cy="16" r="3.5" fill="currentColor" fillOpacity="0.75" />
        </>
      );
      break;
    case 'brush':
      body = (
        <>
          {frame}
          <path d="M5 17c4-8 7 2 11-5s7-2 12-6" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        </>
      );
      break;
    case 'subject':
      body = (
        <>
          {frame}
          <circle cx="16" cy="8" r="3.4" fill="currentColor" />
          <path d="M10 21c0-5 3-8.5 6-8.5s6 3.5 6 8.5z" fill="currentColor" />
          <path
            d="M25 13l2.5 7 1-3 3-1z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 34 24" aria-hidden="true" className={className}>
      {body}
    </svg>
  );
}
