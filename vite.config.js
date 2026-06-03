import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// "Last updated" = the most recent commit touching public/data (falls back to the
// build time if git history isn't available). Injected as __LAST_UPDATED__ at build
// time, so it refreshes automatically whenever the data changes and is redeployed.
// (CI must check out full history — see fetch-depth in the deploy workflow.)
function dataLastUpdated() {
  try {
    const iso = execSync('git log -1 --format=%cI -- public/data', { encoding: 'utf8' }).trim();
    if (iso) return iso;
  } catch { /* no git / no history → fall through */ }
  return new Date().toISOString();
}

// Served from a project subpath on GitHub Pages (…/DRC-Ebola-genomic-epi/), but
// from root in local dev. `base` feeds import.meta.env.BASE_URL, which prefixes
// the runtime data fetches and the peartree bundle so they resolve under the subpath.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/DRC-Ebola-genomic-epi/' : '/',
  define: { __LAST_UPDATED__: JSON.stringify(dataLastUpdated()) },
  build: { target: 'esnext' },
  test: { environment: 'node' },
}));
