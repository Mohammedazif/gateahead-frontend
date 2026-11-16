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

Run the local checks with `npm test`.

Install the pinned test tools with `npm ci` and Chromium with `npx playwright install chromium`. With the development server running, `npm run test:browser` runs 93 controlled Chromium scenarios: five crossing workflows, 40 desktop/phone user journeys, and 48 paired data/network/clock cases. These cover GPS permissions and delayed replies, city search, saved gates, sharing, reporting, keyboard navigation, commute checks, opposing trains, stale reports, partial discovery, offline fallback, reduced motion, clock differences, and browsers without map graphics. Requests are intercepted; test reports and train-provider requests never reach live servers.

`BROWSER_BASE_URL` defaults to `http://127.0.0.1:5173`; `BROWSER_ARTIFACTS` selects a screenshot/report directory. Each script also runs separately. `PLAYWRIGHT_MODULE` can point to another installed Playwright package. The scripts fail on unexpected JavaScript/console errors and save JSON results and failure screenshots.

`node scripts/browser-journeys-check.mjs` exercises 20 user journeys in desktop and phone/touch profiles (40 cases), including first visit, GPS allowed/denied and delayed callbacks, city-search keyboard races, map confirmation and keyboard focus, saved gate rename/removal/races, clipboard sharing and shared-link reloads, report replacement/expiry, and automatic checks inside/outside commute hours. Incoming-link tests compare waiting normally, selecting another cached gate, and navigating away while a fresh crossing lookup is pending. It uses controlled API replies and isolated browser storage; no observations reach a live report server. It accepts the same Playwright/base URL/artifact variables; its artifact default is `/tmp/gateahead-browser-journeys`. Set `BROWSER_SCENARIO` to a name substring to rerun one journey. Phone profiles emulate touch and layout in Chromium; they do not replace native-device testing.

After `npm run build`, start `npm run preview` and run `npm run test:offline` for five production checks: page rendering, service-worker installation, offline reload/navigation, cached JavaScript/CSS, and returning online. Its default `BROWSER_BASE_URL` is `http://127.0.0.1:4173`; it accepts the same Playwright and artifact environment variables. The shell cache handles hosting `Vary: Origin` headers while leaving API responses outside the service-worker cache.

## Navigation

Search and location controls sit above the map. **Nearby**, **Trains**, and **Saved** each have their own view. Selecting a crossing opens its details; **Back to crossings** returns to the nearby list. Theme, automatic checks, and commute hours are in **Settings**. Reporting opens a separate dialog, and secondary route details stay collapsed until requested.

The map automatically animates fresh, moving trains using the selected gate's ETA, travel direction, and the configured estimated speed. A train reaches the gate at its ETA in real time; opening a gate does not start a demo or restart travel. Scene timestamps anchor cached views. Movement continues through the arrival estimate while the report remains less than eight minutes old. For a closed gate, the map includes the approaching train during the barrier lead time. Distant estimates remain outside the local track. Stopped trains retain their reported position; uncertain timings do not produce precise animated crossings.

All eligible trains at the selected crossing can appear and move simultaneously. Each retains its train number, snapshot time, direction, validity, and optional estimated track geometry. Number labels stay distinguishable when positions overlap. The **Trains on map** controls and **Show on map** actions locate a train without hiding the others or fetching more reports. The estimated barrier remains down while any fresh train requires closure; one report expiring does not suppress another fresh train. Individual reported positions and inferred track assignments are estimates.

Nearby and the Trains list use exact `gate_predictions`, preserve each gate's name, and exclude passed gates. Older grouped responses indicate affected gates without assigning the first gate's ETA to all members. A newer crossing check updates its Nearby result when returning to the list. Area estimates count down for two minutes between checks; a moving crossing scene follows its server-supplied validity window. Offline and older views retain their original timing and are labeled as saved. Train arrival time is shown separately from estimated barrier closure. A newer train check invalidates older cached scene details.

## Saved gates and limited-data features

Select a crossing to save it under a name, share its link, or submit an unverified community report. Saved gates can be renamed or removed in the sheet and are stored only in this browser. A link such as `/?lat=12.1&lon=75.2&gate=osm%3A1` selects the location and opens the crossing when it is found.

Automatic checks are optional and run every two minutes while the page is visible and online. Commute controls use the device's local time, support overnight windows, and can restrict checks to weekdays. Train checks have a 90-second cooldown; a server `Retry-After` pauses prediction and scene requests. Repeated scene opens reuse a result for 90 seconds.

The browser retains up to 24 successful API results. Saved predictions keep their original check time and are labeled as historical; stale train markers are suppressed. Production builds include an offline application shell after a successful online visit. Crossing lists remain readable offline, but map tiles and fresh train reports need a connection.

Community reports expire after ten minutes, are explicitly unverified, and never replace train predictions. The backend must include the new `GET /reports` and `POST /reports` endpoints. No notification-service credentials are required for these features; phone push delivery is not included.

`dist/` is the static site. The Vite proxy exists only for `npm run dev`.

Vercel forwards `/api` to `https://gateahead-api.onrender.com` and strips that prefix. The browser still calls `/api` on the site.

The Crossing Pin logo masters are in `public/branding/`, with light and dark versions for the header. `public/favicon.ico` and `public/apple-touch-icon.png` provide browser and home-screen icons. The selected design reference is in `branding/crossing-pin-concept.png`.

The reusable [logo kit](branding/gateahead-logo-kit/README.md) includes six variants, SVG/PDF/EPS originals and print files, PNG/WebP/JPG exports from 16 to 4096px, TIFF, and platform icon sets. Open [the preview](branding/gateahead-logo-kit/preview.html), or save [the complete ZIP](branding/gateahead-logo-kit-v1.zip). Export scripts and a checksum manifest are included for future use; these backup files live outside `public/` and are not bundled into the website.

Development startup retires the GateAhead production worker and its offline shell cache on localhost. The dev server serves a retiring `/sw.js`, uses `Cache-Control: no-store`, and requires port 5173 to be free. Production pages reload once when an updated worker takes control. If an earlier UI remains open, restart the server from this checkout and reload the page.
