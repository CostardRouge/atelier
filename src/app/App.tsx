import { useEffect, useState } from 'react';
import AssetSidebar from './AssetSidebar';
import ErrorBoundary from './ErrorBoundary';
import Home from './Home';
import { REPO_URL } from './site';
import { HOME_PATH, toolForPath } from './tools';
import ToolSwitcher from './ToolSwitcher';
import { useHashRoute } from './use-hash-route';

const COLLAPSE_KEY = 'atelier.library.collapsed';

/**
 * App shell for the Atelier suite: a masthead whose nav + active tool both
 * derive from the {@link TOOLS} registry, the active tool (or the home page)
 * rendered in `<main>`, and a shared footer. Adding a tool never touches this
 * file — it's all driven by the registry and the hash route.
 */
export default function App() {
  const path = useHashRoute();
  // No matching tool → the home page. The wordmark always links back here, so
  // an empty or unknown hash lands on home with nothing to redirect.
  const tool = toolForPath(path);
  const Active = tool?.Component ?? Home;

  // The active view, guarded so a single tool's crash shows a recoverable
  // panel instead of blanking the suite. Keyed by route, so navigating to
  // another tool clears a prior error and mounts the next one fresh.
  const activeContent = (
    <ErrorBoundary resetKey={path}>
      <Active />
    </ErrorBoundary>
  );

  // Every tool reads its assets from the shared library, shown as a left
  // sidebar. It collapses to a thin rail (the choice is remembered); it
  // starts expanded so the library is discoverable.
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Every tool runs in a fixed-height, FULL-WIDTH frame — editing wants every
  // pixel (a landscape clip beside two panels eats width fast), so tools run
  // edge-to-edge with only a thin breathing margin. Only the Home landing
  // keeps a readable column and the natural page scroll + footer.
  //
  // Under 820px the frame gives up its fixed height so the page scrolls
  // normally — but only VERTICALLY. Sideways it clips: a control row that
  // outgrows the screen should wrap (they are built to), and the one that
  // someday doesn't must not hand the whole document a horizontal scrollbar
  // and let the interface drift into the margin. `clip` rather than `hidden`
  // because it creates no scroll container, so the y axis stays plainly
  // visible and sticky positioning keeps working; anything legitimately wider
  // than the screen scrolls inside its own container, untouched by this.
  return (
    <div
      className={
        tool
          ? 'h-dvh flex flex-col min-h-0 overflow-hidden w-full px-4 pt-3 pb-3 max-[820px]:h-auto max-[820px]:min-h-dvh max-[820px]:overflow-x-clip max-[820px]:overflow-y-visible'
          : 'max-w-[1080px] mx-auto px-[clamp(1.25rem,5vw,3.5rem)] pt-[clamp(1.25rem,4vw,3rem)] pb-20'
      }
    >
      <header
        className={`flex items-baseline justify-between gap-4 border-b border-line ${
          tool ? 'pb-2.5' : 'pb-4'
        }`}
      >
        <span className="inline-flex items-baseline gap-[0.4rem] font-serif text-2xl tracking-[-0.01em] italic">
          <a
            href={`#${HOME_PATH}`}
            className="text-ink no-underline transition-colors duration-200 ease-paper hover:text-accent"
          >
            Atelier
          </a>
          {tool && (
            <>
              <span className="text-faint not-italic" aria-hidden="true">
                /
              </span>
              <ToolSwitcher tool={tool} />
            </>
          )}
        </span>
        <div className="flex items-center gap-[0.9rem]">
          {tool?.subtitle && (
            <span className="font-mono text-[0.7rem] tracking-[0.18em] uppercase text-muted max-[480px]:hidden">
              {tool.subtitle}
            </span>
          )}
          <a
            className="inline-flex items-center text-muted transition-[color,transform] duration-200 ease-paper hover:text-accent hover:-translate-y-px"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="View source on GitHub"
            title="View source on GitHub"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
          </a>
        </div>
      </header>

      <main
        className={
          tool
            ? 'flex-1 min-h-0 flex mt-3 flex-row gap-4 max-[820px]:flex-col'
            : undefined
        }
      >
        {tool ? (
          <>
            <AssetSidebar
              tool={tool}
              collapsed={collapsed}
              onToggle={() => setCollapsed((c) => !c)}
            />
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {activeContent}
            </div>
          </>
        ) : (
          activeContent
        )}
      </main>

      {/* Tools run in a fixed-height frame, so the global footer would push it
          past the viewport — show it only on the Home landing. */}
      {!tool && (
        <footer className="mt-14 pt-5 border-t border-line text-[0.8rem] text-muted flex flex-wrap items-center gap-[0.5rem_0.7rem]">
          <span className="w-[5px] h-[5px] rounded-full bg-accent inline-block" />
          Runs entirely in your browser — files are never uploaded.
          <span className="w-[5px] h-[5px] rounded-full bg-accent inline-block" />
          Everything stays on your machine — no account, no server.
          <span className="w-[5px] h-[5px] rounded-full bg-accent inline-block" />
          <a
            className="text-accent-ink underline underline-offset-[3px] font-semibold hover:text-accent"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
        </footer>
      )}
    </div>
  );
}
