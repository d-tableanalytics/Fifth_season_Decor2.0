import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Override with API_PROXY_TARGET=http://localhost:5050 if port 5000 is taken
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:5000',
    },
  },
});
