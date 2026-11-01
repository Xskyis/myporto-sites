/**
 * Single source of truth for the production origin.
 *
 * Consumed by astro.config.mjs (canonical URLs + sitemap, overridable via the SITE_URL env
 * var in CI) and by BaseLayout.astro as the defensive fallback when Astro.site is unset.
 * Keep this file dependency-free: the Astro config imports it at build time.
 */
export const SITE_URL = 'https://nabilfgrza.is-a.dev';
