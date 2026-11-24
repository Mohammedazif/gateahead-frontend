import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "geojson",
      transform(code, id) {
        if (!id.split("?")[0].endsWith(".geojson")) return;
        return { code: `export default ${code}`, map: null };
      },
    },
    {
      name: "offline-shell",
      configureServer(server) {
        // A production worker may still control localhost after `vite preview`.
        // Give its update check a worker that releases the development origin.
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== "/sw.js") return next();
          response.setHeader("Content-Type", "application/javascript");
          response.setHeader("Cache-Control", "no-store");
          response.end(`
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('gateahead-shell-')).map(key => caches.delete(key)));
  await self.registration.unregister();
  const clients = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
  await Promise.all(clients.map(client => client.navigate(client.url)));
})()));
`);
        });
      },
      generateBundle: {
        order: "post",
        handler(_options, bundle) {
          const assets = Object.keys(bundle).filter((name) => /\.(m?js|css)$/.test(name));
          const version = assets.find((name) => name.endsWith(".js")) || "v1";
          const files = ["/", ...assets.map((name) => `/${name}`), "/branding/gateahead-mark-dark.svg", "/branding/gateahead-mark-light.svg", "/favicon.ico"];
          this.emitFile({ type: "asset", fileName: "sw.js", source: `
const CACHE = ${JSON.stringify(`gateahead-shell-${version}`)};
const FILES = ${JSON.stringify(files)};
// Precached files are the same public shell for every same-origin request.
// Module/style requests can carry Origin while cache.addAll does not; a
// hosting Vary: Origin header must not make those cached files disappear.
const fromShell = request => caches.open(CACHE).then(cache => cache.match(request, {ignoreVary: true}));
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('gateahead-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, {cache: 'no-store'}).catch(() => fromShell('/')));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(fromShell(event.request).then(hit => hit || fetch(event.request)));
  }
});
` });
        },
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    headers: { "Cache-Control": "no-store" },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
