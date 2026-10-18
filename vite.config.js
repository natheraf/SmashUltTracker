import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/share': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // The server reads env at import time in some tests; give them the test env.
    env: {
      NODE_ENV: 'test',
      IP_HASH_SALT: 'test-salt-0123456789',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'testadminpass1',
    },
  },
});
