import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { AssetLibraryProvider } from './shared/library/AssetLibraryContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AssetLibraryProvider>
      <App />
    </AssetLibraryProvider>
  </StrictMode>,
);
