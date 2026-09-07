import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { AssetLibraryProvider } from './shared/library/AssetLibraryContext';
import { MediaScopeProvider } from './shared/sources/media-scope';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AssetLibraryProvider>
      <MediaScopeProvider>
        <App />
      </MediaScopeProvider>
    </AssetLibraryProvider>
  </StrictMode>,
);
