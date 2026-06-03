import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'esnext' },
  test: { environment: 'node' },
});
