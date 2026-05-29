// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: true, port: 4321 },
  // Astro blocks some same-site fetch POSTs (403) when Origin is missing/mismatched.
  security: { checkOrigin: false },
  vite: {
    ssr: {
      external: ['pg', 'qrcode'],
    },
  },
});
