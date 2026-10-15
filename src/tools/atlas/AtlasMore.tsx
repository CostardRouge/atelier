import { Children, useState, type ReactNode } from 'react';

const MORE_KEY = 'atelier.atlas.more.';

function readOpen(id: string): boolean {
  try {
    return localStorage.getItem(MORE_KEY + id) === '1';
  } catch {
    return false;
  }
}

/**
 * The rows of a section past its essentials, folded behind «N more» — the
 * count is of the rows it holds right now, so a mode that adds one says so.
 * Each child is ONE row: a fragment would count as one. Remembered per
 * section on this browser.
 */
export default function AtlasMore({ id, children }: { id: string; children: ReactNode }) {
  const rows = Children.toArray(children);
  const [open, setOpen] = useState(() => readOpen(id));
  if (rows.length === 0) return null;
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(MORE_KEY + id, o ? '0' : '1');
      } catch {
        /* the fold holds for the session */
      }
      return !o;
    });
  };
  return (
    <>
      {open && rows}
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="touch-row self-start inline-flex items-center gap-1 h-6 p-0 border-0 bg-transparent text-xs font-medium text-accent-ink cursor-pointer hover:underline focus-visible:underline focus:outline-none"
      >
        {open ? 'Fewer' : `${rows.length} more`}
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
    </>
  );
}
