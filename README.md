# GateAhead web

Map, train sheet, and 3D gate view for GateAhead. This site only draws what the Python API returns.

In development, Vite proxies `/api` to `http://127.0.0.1:8000` and strips the `/api` prefix. Start the API before the site.

```bash
npm ci
npm run dev
```

The site is at http://localhost:5173.

```bash
npm run build
```

`dist/` is the static site. The Vite proxy exists only for `npm run dev`.

Vercel forwards `/api` to `https://gateahead-api.onrender.com` and strips that prefix. The browser still calls `/api` on the site.
