import { useEffect, useRef, useState } from 'react';
import { Icons } from '../shared/ui/icons';
import { HOME_PATH, TOOLS, type Tool } from './tools';

/**
 * The active tool's name in the masthead, and the way to every other one.
 *
 * It is a MENU and not a row of segments, on purpose: the maintainer keeps
 * adding tools (one is being prepared as this is written), segments do not
 * hold past four, and a phone would need a dropdown anyway. What the audit
 * changed is its findability — the trigger used to be plain text with a 9px
 * chevron, the most frequent gesture in the suite drawn as the least
 * visible. It is a real target now (a bordered pill on hover and while
 * open), and the entries are filed in two groups: the editors the suite is
 * converging on, then the instruments kept until the Studio absorbs them.
 */
export default function ToolSwitcher({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — a lightweight popover, no library.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const editors = TOOLS.filter((t) => t.group === 'editor');
  const instruments = TOOLS.filter((t) => t.group === 'instrument');
  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 h-[2.125rem] -my-1 px-2.5 -ml-1 rounded-control border not-italic font-normal text-ink-soft cursor-pointer transition-colors ${
          open
            ? 'border-line-strong bg-surface text-ink'
            : 'border-transparent bg-transparent hover:border-line-strong hover:bg-surface hover:text-ink'
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch tool"
      >
        {tool.label}
        <span
          className={`inline-flex text-sm text-muted transition-transform duration-200 ease-paper ${
            open ? 'rotate-180' : ''
          }`}
        >
          {Icons.down}
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] p-1.5 rounded-paper border border-line bg-surface shadow-paper z-50 font-sans not-italic tracking-normal"
          role="menu"
          aria-label="Tools"
        >
          <p className="m-0 px-3 pt-2 pb-1 font-mono text-2xs tracking-[0.14em] uppercase text-muted">
            Editors
          </p>
          {editors.map((t) => (
            <ToolRow key={t.id} tool={t} active={t.id === tool.id} onPick={close} />
          ))}

          <span className="block h-px bg-line mx-2 my-1.5" />
          <p className="m-0 px-3 pt-1 pb-1 font-mono text-2xs tracking-[0.14em] uppercase text-muted">
            Instruments
          </p>
          <div className="grid grid-cols-2 gap-x-1">
            {instruments.map((t) => {
              const active = t.id === tool.id;
              return (
                <a
                  key={t.id}
                  href={`#${t.path}`}
                  role="menuitem"
                  aria-current={active ? 'page' : undefined}
                  onClick={close}
                  className={`flex items-center gap-2 px-3 py-2 rounded-[8px] no-underline text-sm text-ink transition-colors ${
                    active ? 'bg-paper-2 font-semibold' : 'hover:bg-paper-2/60'
                  }`}
                >
                  {t.label}
                </a>
              );
            })}
          </div>

          <span className="block h-px bg-line mx-2 my-1.5" />
          <div className="flex items-center justify-between px-1">
            <a
              href={`#${HOME_PATH}`}
              role="menuitem"
              onClick={close}
              className="px-2 py-1.5 rounded-[8px] no-underline text-xs text-ink-soft hover:bg-paper-2/60 hover:text-ink"
            >
              Home
            </a>
            <a
              href="#/sources"
              role="menuitem"
              onClick={close}
              className="px-2 py-1.5 rounded-[8px] no-underline text-xs text-ink-soft hover:bg-paper-2/60 hover:text-ink"
            >
              Sources
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/** An editor's row: the name, and one line of what it is for. */
function ToolRow({ tool, active, onPick }: { tool: Tool; active: boolean; onPick: () => void }) {
  return (
    <a
      href={`#${tool.path}`}
      role="menuitem"
      aria-current={active ? 'page' : undefined}
      onClick={onPick}
      className={`flex items-center gap-3 px-3 py-2 rounded-[10px] no-underline transition-colors ${
        active ? 'bg-accent-wash' : 'hover:bg-paper-2/60'
      }`}
    >
      <span className="min-w-0 flex flex-col gap-0.5">
        <span className={`text-sm font-semibold leading-tight ${active ? 'text-accent-ink' : 'text-ink'}`}>
          {tool.label}
        </span>
        {tool.blurb && (
          <span className="text-xs text-muted leading-tight truncate">{firstClause(tool.blurb)}</span>
        )}
      </span>
      {active && <span className="ml-auto inline-flex text-accent-ink">{Icons.check}</span>}
    </a>
  );
}

/** The blurb's first clause — the menu has one line, the home card the whole pitch. */
function firstClause(blurb: string): string {
  const cut = blurb.search(/[:—]/);
  return (cut > 12 ? blurb.slice(0, cut) : blurb).trim();
}
