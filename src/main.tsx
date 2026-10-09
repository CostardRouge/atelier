import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import ErrorBoundary from './app/ErrorBoundary';
import { AssetLibraryProvider } from './shared/library/AssetLibraryContext';
import { MediaScopeProvider } from './shared/sources/media-scope';
import { SectionBarProvider } from './shared/ui/section-rail';
import { LayoutModeProvider } from './shared/ui/use-layout-mode';
import { installPressFeedback } from './shared/ui/press-dom';
import { installCommandConsole } from './shared/commands/console';
import { resumeBridge } from './shared/commands/bridge-client';
// The four faces, served from our OWN origin (2026-09-24, his call): they
// used to come from Google Fonts on every page load, a request to a third
// party the README's network callout never named. Exactly the weights the
// old link asked for; each file names its unicode range, so a browser fetches
// only the subsets a page draws.
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/vt323/400.css';
import './index.css';

// Every tool is a chunk fetched on first use (`app/tools.tsx`), and the site
// is redeployed on every push to `main` with hashed file names. A tab left
// open across a deploy then asks for a chunk that no longer exists the first
// time it opens another tool. Vite reports that as `vite:preloadError`; the
// documented cure is a reload, which picks up the new `index.html` and its
// chunk names. At most once every thirty seconds, so a genuinely unreachable
// file shows the tool's error panel instead of reloading in a loop — while a
// tab that lives through several deploys recovers from each of them.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'atelier.preload-reloaded';
  const RETRY_AFTER_MS = 30_000;
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < RETRY_AFTER_MS) return;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Storage refused (private mode): fall through to the error panel.
    return;
  }
  event.preventDefault();
  location.reload();
});

// A control goes down under a finger and stays down a beat after the lift
// (`shared/ui/press.ts`): one listener for the whole suite, styled by the
// recipes.
installPressFeedback();

// The command registry from the console and any browser automation:
// `await atelier.run('app.status')` (`shared/commands/`).
installCommandConsole();
// A tab connected to the agent bridge before a reload reconnects; nothing
// else ever connects by itself (`bridge-client.ts`).
resumeBridge();

// A boundary around EVERYTHING, and not only around the tool and the
// library inside `App`: the masthead, the bottom bar, the providers and the
// shell's own hooks all render outside those two, and a throw in any of them
// was a blank page. This one offers the same panel — try again, reload.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary resetKey="root">
      <LayoutModeProvider>
        <AssetLibraryProvider>
          <MediaScopeProvider>
            <SectionBarProvider>
              <App />
            </SectionBarProvider>
          </MediaScopeProvider>
        </AssetLibraryProvider>
      </LayoutModeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
