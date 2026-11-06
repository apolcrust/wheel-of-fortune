import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

function offlineCachePlugin(): Plugin {
  let base = "/";
  return {
    name: "offline-cache",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .filter((entry) => entry.type === "chunk" || entry.type === "asset")
        .map((entry) => `${base}${entry.fileName}`);
      const source = `
const CACHE = "fortune-wheel-v1";
const BASE = ${JSON.stringify(base)};
const ASSETS = ${JSON.stringify([base, `${base}index.html`, ...assets])};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("fortune-wheel-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const path = new URL(request.url).pathname;
    const cached = await caches.match(request, { ignoreSearch: true }) || await caches.match(path);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    } catch (error) {
      const fallback = request.mode === "navigate" ? await caches.match(BASE + "index.html") : undefined;
      if (fallback) return fallback;
      throw error;
    }
  })());
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineCachePlugin()],
  build: {
    chunkSizeWarningLimit: 550,
  },
  test: {
    environment: "node",
  },
});
