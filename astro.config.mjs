import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/site';

// https://astro.build/config
export default defineConfig({
  // The SITE_URL env var lets a deploy pipeline build with its own origin; src/site.ts is
  // the default and the same value BaseLayout.astro falls back to.
  site: process.env.SITE_URL || SITE_URL,
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    icon({
      include: {
        // Explicit allowlist of every icon actually rendered (see `npm run test`
        // → tests/unit/icon-allowlist.test.ts). Adding a new <Icon name="…"> requires
        // adding it here; a wildcard re-inlines the full collections into the build.
        lucide: [
          'arrow-down',
          'arrow-down-right',
          'arrow-left',
          'arrow-right',
          'arrow-up',
          'arrow-up-right',
          'award',
          'check',
          'coffee',
          'copy',
          'download',
          'external-link',
          'file-text',
          'mail',
          'map-pin',
          'menu',
          'moon',
          'sparkles',
          'sun',
          'trophy',
          'x',
        ],
        'simple-icons': [
          'astro',
          'flutter',
          'github',
          'googlecloud',
          'html5',
          'javascript',
          'laravel',
          'linkedin',
          'mysql',
          'nextdotjs',
          'nodedotjs',
          'postgresql',
          'python',
          'react',
          'tailwindcss',
          'typescript',
        ],
      },
    }),
    sitemap(),
  ],
});
