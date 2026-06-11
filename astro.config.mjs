import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://deeppearlai.com',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});
