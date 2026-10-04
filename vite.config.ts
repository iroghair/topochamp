import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Relative paths so the build works from any folder, e.g. a GitHub Pages project site.
  base: './',
  plugins: [svelte()],
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
});
