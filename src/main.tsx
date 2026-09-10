import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { AssetLibraryProvider } from './shared/library/AssetLibraryContext';
import { MediaScopeProvider } from './shared/sources/media-scope';
import { LayoutModeProvider } from './shared/ui/use-layout-mode';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LayoutModeProvider>
      <AssetLibraryProvider>
        <MediaScopeProvider>
          <App />
        </MediaScopeProvider>
      </AssetLibraryProvider>
    </LayoutModeProvider>
  </StrictMode>,
);
