import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at /admin on the same domain as the apps, so the API is just /v1.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { port: 5174, proxy: { '/v1': 'http://localhost:4000', '/uploads': 'http://localhost:4000' } },
});
