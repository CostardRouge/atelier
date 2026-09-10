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
import SectionRail from '../shared/ui/SectionRail';
import { useSectionBar } from '../shared/ui/section-rail';
import { useLayoutMode } from '../shared/ui/use-layout-mode';

/**
 * Whether the library column is collapsed to its rail, remembered PER SIZE.
 *
 * Two keys rather than one, because they are two different preferences: what
 * you want beside a 1440px editor and what you want beside a 900px one are not
 * the same answer, and a single flag made changing one silently change the
 * other. The desktop key keeps its original name so an existing choice
 * survives; the tablet one is new and defaults to collapsed — see the note on
 * `railByDefault` below.
 */
const COLLAPSE_KEY = 'atelier.library.collapsed';
const COLLAPSE_KEY_MEDIUM = 'atelier.library.collapsed.medium';

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

  // How much room the shell has, decided once and published by the provider
  // (`shared/ui/layout-mode.ts`). On a phone the library is not a column at
  // all: it rises as a sheet over the stage, summoned from the app bar.
  // Everywhere else it stays where it has always been — docked at the left.
  const mode = useLayoutMode();
  const compact = mode === 'compact';
  const libraryDocked = !compact;

  // Every tool reads its assets from the shared library, shown as a left
  // sidebar that collapses to a thin rail. The choice is remembered per size.
  //
  // **Below 1180px the rail is the DEFAULT**, and that is arithmetic rather
  // than taste: the full column is 288px while a tool's own layout splits
  // side-by-side at an 800px CONTAINER, so a full library leaves a 900px
  // tablet only 564px for the Studio and its editor stacks the inspector
  // beneath a 240px stage. The 48px rail leaves 804px, which is over the line
  // — measured at 820, 900, 1024, 1100, 1180, 1280 and 1440. So the sidebar is
  // visible at the left at every one of those widths, just narrow where the
  // full panel would cost the editor its shape; widening it there is one
  // click, and stacking the editor is then a choice made in the moment.
  const railByDefault = mode === 'medium';
  const [collapsedWide, setCollapsedWide] = useState<boolean>(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  const [collapsedMedium, setCollapsedMedium] = useState<boolean>(
    // Absent means collapsed here, unlike the desktop key: the default IS the
    // rail, so only an explicit '0' opens it.
    () => localStorage.getItem(COLLAPSE_KEY_MEDIUM) !== '0',
  );
  const collapsed = railByDefault ? collapsedMedium : collapsedWide;
  const toggleLibrary = () => {
    if (railByDefault) setCollapsedMedium((c) => !c);
    else setCollapsedWide((c) => !c);
  };
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsedWide ? '1' : '0');
  }, [collapsedWide]);
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY_MEDIUM, collapsedMedium ? '1' : '0');
  }, [collapsedMedium]);

  const [libraryOpen, setLibraryOpen] = useState(false);
  // A sheet belongs to the screen it was opened on: switching tool or growing
  // the window past a phone both make it stale, so it closes.
  useEffect(() => setLibraryOpen(false), [path, mode]);
  // What the active tool put in the thumb zone, if anything. A tool with no
  // sections of its own (the reading tools) publishes none and gets no bar.
  const sectionBar = useSectionBar();
  const rail = compact && tool ? sectionBar : null;
  // A bar of STARTING POINTS carries the library itself; a bar of sections
  // does not, and leaves it in the app bar. Either way it is offered once.
  const railOpensLibrary = rail?.role === 'actions';

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
          {/* A phone has no column for the library, so this is the way to it —
              unless the bar below is a set of starting points, which the
              library belongs among; then it lives there instead. */}
          {tool && !libraryDocked && !railOpensLibrary && (
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
                <AssetSidebar tool={tool} collapsed={collapsed} onToggle={toggleLibrary} />
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

      {/* The tool's own cells, in the thumb zone. */}
      {rail && (
        <SectionRail
          bar={rail}
          onLibrary={railOpensLibrary ? () => setLibraryOpen(true) : undefined}
        />
      )}

      {/* The same panel, risen from the bottom instead of docked at the side —
          a phone is the one width with no room for a column at all. It scrolls
          its own list, so the sheet's body must not scroll as well. */}
      {tool && compact && (
        <ErrorBoundary resetKey={`library:${tool.id}`}>
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
