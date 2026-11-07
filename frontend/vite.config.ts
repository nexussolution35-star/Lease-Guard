/// <reference types="vitest/config" />
import { defineConfig, defaultClientConditions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import path from 'node:path'

// Workspace packages publish TypeScript source under this export condition,
// so the frontend compiles them directly without a separate build step.
const WORKSPACE_SOURCE_CONDITION = '@leaseguard/source'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Route generation options live in tsr.config.json, shared with the `tsr` CLI.
    tanstackRouter(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
    conditions: [WORKSPACE_SOURCE_CONDITION, ...defaultClientConditions],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
