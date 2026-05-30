import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Project page on GitHub Pages is served under
// https://<user>.github.io/dji-flight-data/, so `base` must match the repo
// name (slashes included) or the built assets will 404.
export default defineConfig({
  plugins: [react()],
  base: '/dji-flight-data/',
});
