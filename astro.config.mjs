import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// L'adresse publique est lue dans SITE_URL au moment du build. Sans valeur,
// aucune adresse canonique n'est émise et le plan de site XML reste relatif à localhost.
const site = process.env.SITE_URL || 'http://localhost:4321';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  integrations: [sitemap()],
  devToolbar: { enabled: false },
});
