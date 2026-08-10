/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Build stamps injected by vite.config.ts `define`.
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string
declare const __COMMIT_SHA__: string
