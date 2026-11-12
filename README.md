# SmartRail web

Map, train sheet, and 3D gate view for SmartRail. This site only draws what the Python API returns.

In development, Vite proxies `/api` to `http://127.0.0.1:8000` and strips the `/api` prefix. Start the API before the site.

```bash
npm ci
npm run dev
```

The site is at http://localhost:5173.

```bash
npm run build
```

`dist/` is the static site. A host has to forward `/api` to the API and strip that prefix. The Vite proxy exists only for `npm run dev`.
