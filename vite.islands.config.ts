// Builds the React islands (src/web/client) into one ES module, static/islands.js, served like
// app.js from /assets (src/web/assets.ts). `npm run islands`; commit the result, as with tw.css.

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'src/web/static',
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: 'src/web/client/islands.tsx',
      output: { format: 'es', entryFileNames: 'islands.js', codeSplitting: false },
    },
  },
});
