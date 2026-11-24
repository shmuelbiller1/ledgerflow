/// <reference types="vite/client" />

/** The package version, substituted by vite `define` at build time (vite.config.ts).
 *  `typeof` guards keep non-vite runtimes (node tests) from throwing. */
declare const __APP_VERSION__: string;

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedReload?: () => void;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
