import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL || 'https://nabilfgrza.is-a.dev',
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
  ],
  vite: {
    build: {
      chunkSizeWarningLimit: 5000,
    },
  },
});
