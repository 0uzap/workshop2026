import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// En développement, Vite relaie les appels API comme le fait nginx en production
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/auth': 'http://localhost:3001',
      '/api/payments': 'http://localhost:3000'
    }
  }
});
