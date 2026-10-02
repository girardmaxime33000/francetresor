import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// SITE_URL : adresse publique (plan de site XML, adresses canoniques).
// BASE_PATH : sous-chemin de publication, par exemple /francetresor pour GitHub Pages.
const site = process.env.SITE_URL || 'http://localhost:4321';
const base = (process.env.BASE_PATH || '/').replace(/\/+$/, '') || '/';

/**
 * Préfixe les adresses relatives à la racine (href="/...", src="/...", url(/...))
 * par le sous-chemin de publication. Les adresses déjà préfixées et celles des
 * jeux de données chargés par les scripts (data-src, préfixées côté client) sont laissées.
 */
function prefixRootPaths() {
  return {
    name: 'prefix-root-paths',
    hooks: {
      'astro:build:done': ({ dir }) => {
        if (base === '/') return;
        const root = fileURLToPath(dir);
        const prefix = (p) => (p.startsWith('//') || p === base || p.startsWith(`${base}/`) ? p : base + p);
        const walk = (d) => {
          for (const name of readdirSync(d)) {
            const p = join(d, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith('.html') || p.endsWith('.css')) {
              const src = readFileSync(p, 'utf-8');
              const out = src
                .replace(/(?<![-\w])(href|src|action)="(\/[^"]*)"/g, (_, a, v) => `${a}="${prefix(v)}"`)
                .replace(/url\((['"]?)(\/[^)'"]*)\1\)/g, (_, q, v) => `url(${q}${prefix(v)}${q})`);
              if (out !== src) writeFileSync(p, out);
            }
          }
        };
        walk(root);
      },
    },
  };
}

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  integrations: [sitemap(), prefixRootPaths()],
  devToolbar: { enabled: false },
});
