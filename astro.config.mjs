// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// SITE_URL is set in Vercel project settings once the domain is chosen (brief §0).
// The placeholder check (scripts/check-placeholders.mjs) fails a production
// build while it is unset.
const site = process.env.SITE_URL ?? 'https://placeholder.invalid';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  integrations: [react(), mdx(), sitemap()],
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  vite: {
    plugins: [tailwindcss()],
    build: { chunkSizeWarningLimit: 900 },
  },
});
