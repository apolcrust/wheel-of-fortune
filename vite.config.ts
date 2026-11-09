import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";

function offlineCachePlugin(): Plugin {
  let base = "/";
  return {
    name: "offline-cache",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle)
        .filter((entry) => entry.type === "chunk" || entry.type === "asset")
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
      const assets = entries.map((entry) => `${base}${entry.fileName}`);
      const version = createHash("sha256")
        .update(entries.map((entry) => entry.fileName).join("|"))
        .digest("hex")
        .slice(0, 12);
      const source = `
const CACHE = "fortune-wheel-${version}";
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
    if (request.mode === "navigate") {
      try {
        const response = await fetch(request);
        if (response.ok) {
          await (await caches.open(CACHE)).put(BASE + "index.html", response.clone());
        }
        return response;
      } catch (error) {
        const fallback = await caches.match(BASE + "index.html");
        if (fallback) return fallback;
        throw error;
      }
    }
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
