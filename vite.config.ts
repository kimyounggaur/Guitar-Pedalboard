import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Guitar-Pedalboard/',
  plugins: [react()],
  build: {
    emptyOutDir: false,
    minify: false,
  },
});
