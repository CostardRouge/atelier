import { useEffect, useRef, useState } from 'react';
import { TOOLS, type Tool } from './tools';

/**
 * The active tool name in the masthead, doubling as a tool switcher. It reads
 * as plain text — no border, no chrome — and only a small chevron hints that
 * it's clickable; the dropdown chrome (border, shadow, rounded panel) appears
 * on open. This replaces the old segmented nav pill, reclaiming a slice of
 * header space while keeping every tool one click away.
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

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        className="inline-flex items-center gap-[0.3rem] not-italic font-normal text-ink-soft cursor-pointer transition-colors hover:text-ink aria-expanded:text-ink"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch tool"
      >
        {tool.label}
        <svg
          className={`w-[0.6em] h-[0.6em] text-faint transition-transform duration-200 ease-paper ${
            open ? 'rotate-180 text-muted' : ''
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-3 min-w-[15rem] p-1.5 rounded-paper border border-line bg-surface shadow-paper z-50 font-sans not-italic tracking-normal"
          role="menu"
          aria-label="Tools"
        >
          {TOOLS.map((t) => {
            const active = t.id === tool.id;
            return (
              <a
                key={t.id}
                href={`#${t.path}`}
                role="menuitem"
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`flex flex-col gap-[0.15rem] px-3 py-[0.55rem] rounded-[10px] no-underline transition-colors ${
                  active ? 'bg-paper-2' : 'hover:bg-paper-2/60'
                }`}
              >
                <span className="flex items-center gap-2 text-[0.95rem] font-semibold text-ink leading-none">
                  {t.label}
                  {active && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-accent"
                      aria-hidden="true"
                    />
                  )}
                </span>
                {t.subtitle && (
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">
                    {t.subtitle}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
