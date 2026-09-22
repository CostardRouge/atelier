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
// chunk names. Once per session only, so a genuinely unreachable file shows
// the tool's error panel instead of reloading in a loop.
window.addEventListener('vite:preloadError', (event) => {
  const RELOADED = 'atelier.preload-reloaded';
  let already = false;
  try {
    already = sessionStorage.getItem(RELOADED) === '1';
    if (!already) sessionStorage.setItem(RELOADED, '1');
  } catch {
    // Storage refused (private mode): fall through to the error panel.
    already = true;
  }
  if (already) return;
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
