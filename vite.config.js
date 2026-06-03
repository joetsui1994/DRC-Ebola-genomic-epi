import { defineConfig } from 'vite';

// Served from a project subpath on GitHub Pages (…/DRC-Ebola-genomic-epi/), but
// from root in local dev. `base` feeds import.meta.env.BASE_URL, which prefixes
// the runtime data fetches and the peartree bundle so they resolve under the subpath.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/DRC-Ebola-genomic-epi/' : '/',
  build: { target: 'esnext' },
  test: { environment: 'node' },
}));
