import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import icon from 'astro-icon';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/site';

// https://astro.build/config
export default defineConfig({
  // The SITE_URL env var lets a deploy pipeline build with its own origin; src/site.ts is
  // the default and the same value BaseLayout.astro falls back to.
  site: process.env.SITE_URL || SITE_URL,
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    icon({
      include: {
        lucide: ['*'],
        'simple-icons': ['*'],
      },
    }),
    sitemap(),
  ],
});
