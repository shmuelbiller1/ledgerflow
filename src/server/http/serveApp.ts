import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { startStandaloneScheduler } from "../jobs/standaloneScheduler";

declare const __PRODUCTION_BUNDLE__: boolean | undefined;

/**
 * Mounts static assets from `distPath`, returns 404 for missing `/assets/*` bundles so
 * removed lazy chunks never serve SPA `index.html`, and falls back to rate-limited `index.html` for SPA routes.
 */
export function mountSpaStaticRoutes(app: express.Express, distPath: string): void {
  const spaFallbackLimiter = rateLimit({
    windowMs: 60_000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(express.static(distPath));
  app.use('/assets', (_req, res) => {
    res.status(404).type('text/plain').send('Not Found');
  });
  app.get('/{*splat}', spaFallbackLimiter, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

/**
 * Long-running server (npm run dev / npm start), F-01 moved from server.ts: the API app plus the
 * web pages (Vite in development, dist/ in production), the background jobs' timer and a graceful
 * shutdown. On Vercel none of this runs: api/index.mjs serves createApp() and vercel.json's cron calls
 * /api/cron/*. Both run the one list in jobs/jobRegistry.ts (AUD-05).
 */
export async function serveApp(app: express.Express, PORT: number): Promise<void> {
  const http = await import('http');
  const httpServer = http.createServer(app);

  // Vite middleware is strictly for unbundled local development (`npm run dev` -> `tsx server.ts`).
  // Production bundles (`__PRODUCTION_BUNDLE__ === true`) dead-code-eliminate this branch so `vite`,
  // `rollup`, `jiti`, and `@esbuild/*` are never bundled or traced into deployed server artifacts.
  if (typeof __PRODUCTION_BUNDLE__ === "undefined" && process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: { server: httpServer }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Robust dist path resolution for standalone and container deployments
    const candidatePaths = [
      path.join(process.cwd(), 'dist'),
      path.join(__dirname, 'dist'),
      path.join(__dirname, '../dist'),
      process.cwd()
    ];
    const distPath = candidatePaths.find(p => fs.existsSync(path.join(p, 'index.html'))) || path.join(process.cwd(), 'dist');
    mountSpaStaticRoutes(app, distPath);
  }

  httpServer.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.debug(`💥 Port ${PORT} is in use, retrying...`);
      setTimeout(() => {
        httpServer.close();
        httpServer.listen(PORT, "0.0.0.0");
      }, 1000);
    }
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.debug(`🚀 [Server] Production Ready: http://localhost:${PORT}`);
    console.debug(`📂 [Server] Serving static assets from: ${process.env.NODE_ENV === "production" ? "dist" : "Vite Dev Server"}`);

    // Every background job, at the times vercel.json gives Vercel Cron (jobs/jobRegistry.ts), plus the
    // start-up pass the registry asks for. Admins can still run some by hand (/api/v1/system/...).
    for (const cron of startStandaloneScheduler()) {
      console.debug(`⏰ [Jobs] ${cron.id} (${cron.schedule} UTC) next runs at ${cron.nextRunAt}`);
    }
  });

  const gracefulShutdown = (signal: string) => {
    console.debug(`🛑 [Server] Received ${signal}. Shutting down gracefully...`);
    httpServer.close(() => {
      console.debug('👋 [Server] Closed remaining connections. Exiting process.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('💥 [Server] Forced shutdown due to timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
