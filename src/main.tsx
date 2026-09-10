import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { AssetLibraryProvider } from './shared/library/AssetLibraryContext';
import { MediaScopeProvider } from './shared/sources/media-scope';
import { SectionBarProvider } from './shared/ui/section-rail';
import { LayoutModeProvider } from './shared/ui/use-layout-mode';
import './index.css';

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
