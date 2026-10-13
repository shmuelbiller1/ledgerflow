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
    dedupe: ["react", "react-dom"] 
  },
  plugins: [react(), tailwindcss(), VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["robots.txt", "apple-touch-icon.png", "**/*.svg"],
      manifest: {
        id: "com.ledgerflow.app",
        start_url: "/#dashboard",
        scope: "/",
        name: "LedgerFlow",
        short_name: "LedgerFlow",
        description: "Professional cloud financial management and smart double-entry auditing.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait-primary",
        categories: ["finance", "business", "productivity"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ],
        shortcuts: [
          {
            name: "New Journal Entry",
            short_name: "New Entry",
            description: "Create a new journal entry",
            url: "/?action=new-journal",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Dashboard",
            short_name: "Dashboard",
            description: "View financial dashboard",
            url: "/",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }]
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
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
    }), ],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  esbuild: {
    target: 'esnext'
  },
  optimizeDeps: {
    include: ['recharts', 'd3'],
    esbuildOptions: {
      target: 'esnext'
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-utils': ['date-fns', 'zustand', 'clsx', 'tailwind-merge'],
          'vendor-ui': ['lucide-react', 'motion/react', 'sonner'],
          'vendor-viz': ['recharts', 'd3'],
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
