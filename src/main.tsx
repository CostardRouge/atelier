import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { AssetLibraryProvider } from './shared/library/AssetLibraryContext';
import { MediaScopeProvider } from './shared/sources/media-scope';
import { SectionBarProvider } from './shared/ui/section-rail';
import { LayoutModeProvider } from './shared/ui/use-layout-mode';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LayoutModeProvider>
      <AssetLibraryProvider>
        <MediaScopeProvider>
          <SectionBarProvider>
            <App />
          </SectionBarProvider>
        </MediaScopeProvider>
      </AssetLibraryProvider>
    </LayoutModeProvider>
  </StrictMode>,
);
