import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  // Dev-only: allow the sandbox live-preview host (Vite rejects unknown Host headers).
  server: {
    allowedHosts: ['.e2b.app'],
  },
  resolve: {
    alias: {
      react: path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom')
    },
    dedupe: ['react', 'react-dom']
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Safe deferred updates: never force-reload active tabs with unsaved financial work.
      registerType: 'prompt',
      includeAssets: ['robots.txt', 'apple-touch-icon.png', '**/*.svg'],
      manifest: {
        id: 'com.ledgerflow.app',
        start_url: '/#dashboard',
        scope: '/',
        name: 'LedgerFlow',
        short_name: 'LedgerFlow',
        description: 'Professional cloud financial management and smart double-entry auditing.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        categories: ['finance', 'business', 'productivity'],
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        shortcuts: [
          {
            name: 'New Journal Entry',
            short_name: 'New Entry',
            description: 'Create a new journal entry',
            url: '/?action=new-journal',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }]
          },
          {
            name: 'Dashboard',
            short_name: 'Dashboard',
            description: 'View financial dashboard',
            url: '/',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }]
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // Never intercept backend API downloads, exports, webhooks, or auth endpoints with SPA HTML.
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        // Precache only the core app shell + shared vendor/layout chunks; lazy screens cache on demand.
        globPatterns: [
          'index.html',
          'assets/app-*.js',
          'assets/index-*.css',
          'assets/vendor-react-*.js',
          'assets/vendor-ui-*.js',
          'assets/vendor-supabase-*.js',
          'assets/vendor-utils-*.js',
          'assets/RootLayout-*.js'
        ],
        runtimeCaching: [
          {
            // Never cache authenticated or workspace-scoped backend financial API responses.
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin && (url.pathname === '/api' || url.pathname.startsWith('/api/')),
            handler: 'NetworkOnly'
          },
          {
            // Never cache Supabase Auth, PostgREST, Realtime, Storage, or Edge Function responses.
            urlPattern: ({ url }) =>
              /\.supabase\.(?:co|in)$/i.test(url.hostname) ||
              /^\/(?:auth|rest|realtime|storage|functions)\/v1(?:\/|$)/.test(url.pathname),
            handler: 'NetworkOnly'
          },
          {
            // Cache visited content-hashed lazy screen chunks and static media on demand.
            urlPattern: ({ sameOrigin, request, url }) =>
              sameOrigin &&
              url.pathname.startsWith('/assets/') &&
              ['script', 'style', 'font', 'image', 'worker'].includes(request.destination),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ledgerflow-hashed-assets',
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: {
                statuses: [200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  esbuild: {
    target: 'esnext'
  },
  optimizeDeps: {
    // F-49: scan every screen up front. Lazily loaded screens otherwise reveal new dependencies mid-session,
    // and the dev server reloads the page under a running browser test ("Failed to find script").
    entries: ['index.html', 'src/**/*.tsx'],
    include: ['recharts', 'd3'],
    esbuildOptions: {
      target: 'esnext'
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app-[hash].js',
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[/\\]node_modules[/\\](?:react|react-dom|scheduler)[/\\]/.test(id)) {
            return 'vendor-react';
          }
          if (/[/\\]node_modules[/\\]@supabase[/\\]/.test(id)) {
            return 'vendor-supabase';
          }
          if (/[/\\]node_modules[/\\](?:date-fns|zustand|clsx|tailwind-merge)[/\\]/.test(id)) {
            return 'vendor-utils';
          }
          if (/[/\\]node_modules[/\\](?:motion|framer-motion|motion-dom|motion-utils|sonner)[/\\]/.test(id)) {
            return 'vendor-ui';
          }
          if (/[/\\]node_modules[/\\](?:recharts|d3|d3-[^/\\]+|victory-vendor)[/\\]/.test(id)) {
            return 'vendor-viz';
          }
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
