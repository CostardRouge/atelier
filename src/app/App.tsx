import { useEffect, useState } from 'react';
import AssetSidebar from './AssetSidebar';
import SourcesScreen from './SourcesScreen';
import ErrorBoundary from './ErrorBoundary';
import Home from './Home';
import { REPO_URL } from './site';
import { HOME_PATH, toolForPath } from './tools';
import ToolSwitcher from './ToolSwitcher';
import { useHashRoute } from './use-hash-route';
import BottomSheet from '../shared/ui/BottomSheet';
import SideDrawer from '../shared/ui/SideDrawer';
import SectionRail from '../shared/ui/SectionRail';
import { useSectionBar } from '../shared/ui/section-rail';
import { useLayoutMode } from '../shared/ui/use-layout-mode';

const COLLAPSE_KEY = 'atelier.library.collapsed';

/**
 * App shell for the Atelier suite: a masthead whose nav + active tool both
 * derive from the {@link TOOLS} registry, the active tool (or the home page)
 * rendered in `<main>`, and a shared footer. Adding a tool never touches this
 * file — it's all driven by the registry and the hash route.
 */
export default function App() {
  const path = useHashRoute();
  // `#/sources` — and `#/connect?instance=…`, the older name an instance's
  // own app rail links to — is not a tool: it is the one screen that lets a
  // remote source into the app, lists what is connected and takes one out
  // again. It belongs to the shell so no tool has to know about sources. The
  // query rides in the hash, after the path.
  const sourcesPath = ['/sources', '/connect'].find(
    (base) => path === base || path.startsWith(`${base}?`),
  );
  // No matching tool → the home page. The wordmark always links back here, so
  // an empty or unknown hash lands on home with nothing to redirect.
  const tool = sourcesPath ? undefined : toolForPath(path);
  const Active = tool?.Component ?? Home;

  // The active view, guarded so a single tool's crash shows a recoverable
  // panel instead of blanking the suite. Keyed by route, so navigating to
  // another tool clears a prior error and mounts the next one fresh.
  const activeContent = (
    <ErrorBoundary resetKey={path}>
      {sourcesPath ? (
        <SourcesScreen query={path.slice(sourcesPath.length + 1)} />
      ) : (
        <Active />
      )}
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

  // How much room the shell has, decided once and published by the provider
  // (`shared/ui/layout-mode.ts`). On a phone the library is not a column at
  // all: it rises as a sheet over the stage, summoned from the app bar.
  const mode = useLayoutMode();
  const compact = mode === 'compact';
  // Where the library goes, and it is arithmetic rather than taste. The column
  // is 288px and a tool's own layout splits side-by-side at an 800px
  // CONTAINER, so a docked library leaves a 900px tablet only 570px for the
  // Studio — under its threshold, so the editor stacks its inspector beneath a
  // 240px stage. Taking it out of the flow gives the tool the whole width.
  // `expanded` starts at 1180 because that is the first width where both fit.
  const libraryDocked = mode === 'expanded';
  const [libraryOpen, setLibraryOpen] = useState(false);
  // A sheet belongs to the screen it was opened on: switching tool or growing
  // the window past a phone both make it stale, so it closes.
  useEffect(() => setLibraryOpen(false), [path, mode]);
  // What the active tool put in the thumb zone, if anything. A tool with no
  // sections of its own (the reading tools) publishes none and gets no bar.
  const sectionBar = useSectionBar();
  const rail = compact && tool ? sectionBar : null;

  // Every tool runs in a fixed-height, FULL-WIDTH frame — editing wants every
  // pixel (a landscape clip beside two panels eats width fast), so tools run
  // edge-to-edge with only a thin breathing margin. Only the Home landing
  // keeps a readable column and the natural page scroll + footer.
  //
  // **The frame keeps its height at every width**, phones included. It used to
  // give it up under 820px (`h-auto min-h-dvh`) so the page could scroll, and
  // that is what turned the suite into a stack: the library card first, the
  // editor third, the stage 240px of an 844px screen. It also made every
  // height above a stage indefinite, which is what let one pinch collapse the
  // Studio canvas to 1×1 — a whole bug class that a definite height retires
  // rather than patches. On a phone the library is a sheet instead of a
  // column, so nothing needs the page to grow.
  //
  // Sideways it clips at every width, as before: a control row that outgrows
  // the screen should wrap (they are built to), and the one that someday
  // doesn't must not hand the whole document a horizontal scrollbar and let
  // the interface drift into the margin. Anything legitimately wider than the
  // screen scrolls inside its own container, untouched by this.
  const toolShell = compact
    ? 'h-dvh flex flex-col min-h-0 overflow-hidden w-full pt-[env(safe-area-inset-top)]'
    : 'h-dvh flex flex-col min-h-0 overflow-hidden w-full px-4 pt-3 pb-3';

  return (
    <div className={tool ? toolShell : 'max-w-[1080px] mx-auto px-[clamp(1.25rem,5vw,3.5rem)] pt-[clamp(1.25rem,4vw,3rem)] pb-20'}>
      <header
        className={`flex items-baseline justify-between gap-4 border-b border-line ${
          tool ? (compact ? 'flex-none h-12 px-3 items-center' : 'pb-2.5') : 'pb-4'
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
        <div className={`flex items-center ${compact && tool ? 'gap-1.5' : 'gap-[0.9rem]'}`}>
          {tool?.subtitle && !compact && (
            <span className="font-mono text-[0.7rem] tracking-[0.18em] uppercase text-muted max-[480px]:hidden">
              {tool.subtitle}
            </span>
          )}
          {/* Wherever the library is not a column, this is the way to it. It
              stays in the app bar rather than joining the section bar: that
              bar is the tool's, and the library is the shell's. */}
          {tool && !libraryDocked && (
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              aria-label="Open the asset library"
              aria-expanded={libraryOpen}
              className="w-9 h-9 grid place-items-center rounded-lg border border-line bg-surface text-ink-soft hover:text-accent hover:border-line-strong transition-colors"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  d="M2.5 4h11M2.5 8h11M2.5 12h11"
                />
              </svg>
            </button>
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
            ? compact
              ? // The bar below pays the safe area when there is one, so the
                // page must not pay it twice.
                `flex-1 min-h-0 flex flex-col px-2 pt-2 ${
                  rail ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]'
                }`
              : 'flex-1 min-h-0 flex mt-3 flex-row gap-4'
            : undefined
        }
      >
        {tool ? (
          <>
            {/* The library is guarded too, and separately: it is not part of
                the tool, and a crash in it (or in a source's browser, which it
                renders) used to blank the whole suite because only the tool
                sat inside a boundary. Keyed by tool so switching clears it.
                Below `expanded` it is not here at all — it is in the drawer
                or the sheet below. */}
            {libraryDocked && (
              <ErrorBoundary resetKey={`library:${tool.id}`}>
                <AssetSidebar
                  tool={tool}
                  collapsed={collapsed}
                  onToggle={() => setCollapsed((c) => !c)}
                />
              </ErrorBoundary>
            )}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {activeContent}
            </div>
          </>
        ) : (
          activeContent
        )}
      </main>

      {/* The tool's own sections, in the thumb zone. The library is not one of
          them — it is the shell's, and it stays in the app bar. */}
      {rail && <SectionRail bar={rail} />}

      {/* The same panel, out of the flow. Risen from the bottom on a phone,
          slid in from the left on anything between — and it scrolls its own
          list, so the sheet's body must not scroll as well. */}
      {tool && !libraryDocked && (
        <ErrorBoundary resetKey={`library:${tool.id}`}>
          {compact ? (
            <BottomSheet
              open={libraryOpen}
              onClose={() => setLibraryOpen(false)}
              title="Library"
              bodyScrolls={false}
            >
              <AssetSidebar
                tool={tool}
                collapsed={false}
                onToggle={() => setLibraryOpen(false)}
                variant="sheet"
              />
            </BottomSheet>
          ) : (
            <SideDrawer
              open={libraryOpen}
              onClose={() => setLibraryOpen(false)}
              label="Asset library"
            >
              {/* Docked markup, so the drawer shows the panel with its own
                  frame — it is a card lifted off the page here, not a sheet
                  that draws one for it. Its collapse control closes it, which
                  is what collapsing means when it is not in the flow. */}
              <AssetSidebar
                tool={tool}
                collapsed={false}
                onToggle={() => setLibraryOpen(false)}
                variant="drawer"
              />
            </SideDrawer>
          )}
        </ErrorBoundary>
      )}

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
