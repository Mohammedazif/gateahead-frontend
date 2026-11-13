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

The Crossing Pin logo masters are in `public/branding/`, with light and dark versions for the header. `public/favicon.ico` and `public/apple-touch-icon.png` provide browser and home-screen icons. The selected design reference is in `branding/crossing-pin-concept.png`.

The reusable [logo kit](branding/gateahead-logo-kit/README.md) includes six variants, SVG/PDF/EPS originals and print files, PNG/WebP/JPG exports from 16 to 4096px, TIFF, and platform icon sets. Open [the preview](branding/gateahead-logo-kit/preview.html), or save [the complete ZIP](branding/gateahead-logo-kit-v1.zip). Export scripts and a checksum manifest are included for future use; these backup files live outside `public/` and are not bundled into the website.
