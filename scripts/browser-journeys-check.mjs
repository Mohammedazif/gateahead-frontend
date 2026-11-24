import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Human workflows run against React/MapLibre, with isolated browser storage
// and controlled service replies. Nothing is posted to live train/report APIs.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
const artifacts = resolve(process.env.BROWSER_ARTIFACTS || "/tmp/gateahead-browser-journeys");
const filter = process.env.BROWSER_SCENARIO;
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const results = [];
const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 1000 } },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
];
const cities = [{ name: "Kannur", state: "Kerala", lat: 12, lon: 75 }, { name: "Kozhikode", state: "Kerala", lat: 13, lon: 76 }];
const gateA = { id: "osm:node:9004", name: "School Road", lat: 12, lon: 75, km: 0.4, source: "osm" };
const gateB = { id: "osm:node:9104", name: "Station Road", lat: 13, lon: 76, km: 0.3, source: "osm" };
const gateC = { ...gateA, id: "osm:node:9005", name: "Canal Road", lat: 12.002, km: 0.7 };
const gateD = { ...gateC, id: "osm:node:9006", name: "Park Road", lat: 12.003 };
const trainCheckId = "fixture-train-check-id01";
const verifiedOn = new Date().toISOString().slice(0, 10);
const visible = (locator) => locator.first().waitFor({ state: "visible", timeout: 10000 });
const body = (page) => page.locator("body").innerText();
const settle = async (page) => { await page.getByText("Checking this crossing…", { exact: true }).waitFor({ state: "hidden" }); };
async function pickCity(page, name) {
  await page.locator(".location-open").click();
  await page.getByRole("combobox").fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}
async function openGate(page, name = "School Road") {
  await page.getByRole("tab", { name: "Nearby", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await visible(page.getByLabel("Crossing details"));
  await settle(page);
}
async function mapTap(page) {
  const canvas = page.locator("canvas.maplibregl-canvas");
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await canvas.tap({ position: { x: 55, y: 140 } });
  else await canvas.click({ position: { x: 55, y: 140 } });
  await visible(page.getByRole("dialog", { name: /Finding this place|Test map point|°/ }));
}
async function saveGate(page, name = "Home gate") {
  page.once("dialog", (dialog) => dialog.accept(name));
  await page.getByRole("button", { name: "Save gate", exact: true }).click();
  await visible(page.getByRole("button", { name: "Saved · remove", exact: true }));
}
async function useLightTheme(page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Light", exact: true }).click();
  await settings.getByRole("button", { name: "Close Settings" }).click();
}

async function run(profile, name, test, options = {}) {
  if (filter && !`${profile.name}/${name}`.includes(filter)) return;
  const errors = [], consoleErrors = [];
  const context = await browser.newContext({ ...profile, timezoneId: "Asia/Kolkata", serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const state = { calls: [], releases: [], heldGates: options.heldGates === true, reports: [], reportDevice: null,
    delayedCities: false, delayReport: options.delayReport, gatesUnavailable: options.gatesUnavailable,
    heldScenes: options.heldScenes, rateGate: options.rateGate, detailFlags: [], holdTrainCheck: options.progressivePredict === true };
  if (options.clock) await page.clock.install({ time: new Date("2026-11-16T08:30:00+05:30") });
  if (options.gpsDelayed) await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success, error) => { window.__gpsSuccess = success; window.__gpsError = error; };
  });
  if (options.storage) await page.addInitScript((storage) => {
    if (!sessionStorage.getItem("journey-seeded")) {
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem("journey-seeded", "yes");
    }
  }, options.storage);
  await context.route("https://tiles.openfreemap.org/**", (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#282d2c" } }] } }));
  // Font-provider latency is outside these controlled interaction workflows.
  await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    state.calls.push({ path, query: Object.fromEntries(url.searchParams), method: route.request().method() });
    const reply = (json) => route.fulfill({ json }).catch(() => {});
    const lat = Number(url.searchParams.get("lat"));
    const gate = lat >= 12.5 ? gateB : gateA;
    if (path === "/gates") {
      if (state.heldGates && lat < 12.5) await new Promise((release) => state.releases.push(release));
      if (state.gatesUnavailable) return reply({ gates: [], error: "map_busy" });
      return reply({ gates: options.twoGates && lat < 12.5 ? [gateA, gateC] : [gate] });
    }
    if (path === "/cities") {
      const q = url.searchParams.get("q").toLowerCase();
      if (state.delayedCities) await new Promise((release) => state.releases.push(release));
      return reply({ cities: cities.filter((city) => city.name.toLowerCase().includes(q)) });
    }
    if (path === "/place") return reply({ name: "Test map point" });
    if (path === "/predict") {
      if (options.progressivePredict && url.searchParams.get("progressive") === "true") {
        return reply({ check_id: trainCheckId, revision: 0, done: false });
      }
      return reply({ generated_at: new Date().toISOString(), crossings: 1, checked: 0,
        running: 0, stations: [], approaching: [], gate_predictions: [], passed: [], sightings: [], awaiting_update: [] });
    }
    if (options.progressivePredict && path === `/predict/checks/${trainCheckId}`) {
      const done = url.searchParams.get("after") === "1";
      if (done && state.holdTrainCheck) await new Promise((release) => state.releases.push(release));
      const trains = [{ train: "16512", name: "Regional Express" }, ...(done ? [{ train: "16513", name: "Coastal Express" }] : [])];
      const approaching = done ? trains.map((train) => ({ ...train, eta: 4, status: "approaching", closes_in: 2,
        cluster: gateA.name, lat: gateA.lat, lon: gateA.lon, ids: [gateA.id] })) : [];
      const sightings = done ? [] : [{ number: trains[0].train, name: trains[0].name, delay: 0, age: 1,
        current: "Kannur", passed_local: false, observed: true }];
      return reply({ check_id: trainCheckId, revision: done ? 2 : 1, done, result: {
        generated_at: new Date().toISOString(), crossings: 1, checked: trains.length, running: trains.length,
        approaching, sightings, coverage: { status: done ? "complete" : "partial", checking: !done,
          live_checked: trains.length, live_candidates: 2, pending_live: done ? 0 : 1, missing_or_stale_routes: 0 },
      } });
    }
    if (path === "/scene") {
      const id = url.searchParams.get("crossing_id");
      const chosen = [gateA, gateB, gateC, gateD].find((item) => item.id === id) || gateA;
      if (state.heldScenes) await new Promise((release) => state.releases.push(release));
      if (state.rateGate === id) return route.fulfill({ status: 429, headers: { "Retry-After": "60" }, json: {} });
      return reply({ available: true, crossing: chosen, rail: [[chosen.lat - .03, chosen.lon], [chosen.lat + .03, chosen.lon]], trains: [], passed: [], awaiting_update: [], ...options.sceneFields?.[id] });
    }
    if (path === "/crossing-details") {
      return reply(options.accessDetails?.[url.searchParams.get("crossing_id")] ?? { error: "access_unavailable" });
    }
    if (path === "/crossing-details/flags") {
      assert.equal(route.request().method(), "POST");
      state.detailFlags.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: { accepted: true } });
    }
    if (path === "/reports") {
      if (route.request().method() === "POST") {
        const report = route.request().postDataJSON();
        assert.equal(report.crossing_id, gateA.id);
        assert.match(report.installation_id, /^[0-9a-f-]{36}$/i);
        if (state.reportDevice) assert.equal(report.installation_id, state.reportDevice);
        state.reportDevice = report.installation_id;
        const now = await page.evaluate(() => Date.now() / 1000);
        state.reports = [{ state: report.state, at: now, expires_at: now + 600 }];
      }
      const reports = state.reports;
      if (state.delayReport && route.request().method() === "GET") await new Promise((release) => state.releases.push(release));
      return reply({ verified: false, reports });
    }
    throw new Error(`Unhandled fixture ${path}`);
  });
  try {
    await page.goto(`${base}/${options.initial || ""}`, { waitUntil: "domcontentloaded" });
    await visible(page.getByRole("heading", { name: "GateAhead", exact: true }));
    await page.waitForFunction(() => Boolean(document.querySelector("canvas.maplibregl-canvas")));
    await test(page, context, state);
    assert.deepEqual(errors, [], "no uncaught browser errors");
    const unexpectedConsole = options.rateLimitExpected
      ? consoleErrors.filter((message) => !/^Failed to load resource:.*\b429\b/.test(message)) : consoleErrors;
    assert.deepEqual(unexpectedConsole, [], "no unexpected console errors");
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, `horizontal overflow ${JSON.stringify(layout)}`);
    await page.screenshot({ path: resolve(artifacts, `${profile.name}-${name}.png`), fullPage: true });
    results.push({ profile: profile.name, name, passed: true, calls: state.calls.length, errors });
    console.log(`PASS ${profile.name}/${name}`);
  } catch (error) {
    await page.screenshot({ path: resolve(artifacts, `${profile.name}-${name}-failure.png`), fullPage: true }).catch(() => {});
    results.push({ profile: profile.name, name, passed: false, error: error.stack || String(error), errors, consoleErrors, calls: state.calls });
    console.error(`FAIL ${profile.name}/${name}: ${error.message}`);
  } finally {
    state.releases.forEach((release) => release());
    await context.close();
  }
}

try {
  for (const profile of profiles) {
    await run(profile, "first-visit-search-keyboard", async (page, _context, state) => {
      await visible(page.getByRole("heading", { name: "Start with a place" }));
      await page.getByRole("tab", { name: "Trains", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Check trains", exact: true }).isDisabled(), true);
      await page.locator(".location-open").click();
      const input = page.getByRole("combobox");
      await input.fill("zzzz");
      await visible(page.getByText("No Indian city matches that."));
      await input.fill("Kannur");
      await page.getByRole("option").first().waitFor();
      await input.press("ArrowDown");
      assert.equal(await input.getAttribute("aria-activedescendant"), await page.getByRole("option").first().getAttribute("id"));
      await input.press("Enter");
      await visible(page.getByRole("button", { name: /School Road/ }));
      assert.match(await page.locator(".location-open").innerText(), /Kannur/);
      assert.equal(state.calls.filter((call) => call.path === "/predict").length, 0);
    });

    await run(profile, "gps-permission-granted", async (page, context) => {
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ latitude: 12.001234, longitude: 75.007654 });
      await page.getByRole("button", { name: "Use my location", exact: true }).click();
      await visible(page.getByRole("button", { name: /School Road/ }));
      await visible(page.getByRole("button", { name: "Use my location", exact: true }));
      assert.match(await page.locator(".location-open").innerText(), /Test map point/);
      assert.equal(await page.evaluate(() => location.search), "");
      assert.equal(await page.evaluate(() => localStorage.getItem("gateahead:last-place")), "null");
      assert.doesNotMatch(await page.evaluate(() => localStorage.getItem("gateahead:responses") || ""), /12\.001234|75\.007654/);
    });

    await run(profile, "gps-denied-recovers-with-search", async (page) => {
      await page.getByRole("button", { name: "Use my location", exact: true }).click();
      await visible(page.getByText("Location was blocked. Tap the map to drop a pin."));
      await pickCity(page, "Kannur");
      await visible(page.getByRole("button", { name: /School Road/ }));
      assert.doesNotMatch(await body(page), /Location was blocked/);
    });

    for (const outcome of ["success", "error"]) await run(profile, `old-gps-${outcome}-cannot-replace-city`, async (page) => {
      await page.getByRole("button", { name: "Use my location", exact: true }).click();
      await pickCity(page, "Kozhikode");
      await visible(page.getByRole("button", { name: /Station Road/ }));
      await page.evaluate((outcome) => outcome === "success"
        ? window.__gpsSuccess({ coords: { latitude: 12, longitude: 75 } })
        : window.__gpsError({ code: 1, message: "late denied GPS" }), outcome);
      await page.waitForTimeout(150);
      assert.match(await page.locator(".location-open").innerText(), /Kozhikode/);
      assert.doesNotMatch(await body(page), /Location was blocked/);
      await visible(page.getByRole("button", { name: "Use my location", exact: true }));
    }, { gpsDelayed: true });

    await run(profile, "typing-new-city-does-not-select-old-result", async (page, _context, state) => {
      await page.locator(".location-open").click();
      const input = page.getByRole("combobox");
      await input.fill("Kannur");
      await visible(page.getByRole("option", { name: /Kannur/ }));
      state.delayedCities = true;
      await input.fill("Kozhikode");
      await input.press("Enter");
      assert.equal(await page.getByRole("dialog", { name: "Find a crossing", exact: true }).count(), 1);
      assert.equal(state.calls.filter((call) => call.path === "/gates").length, 0);
      state.delayedCities = false;
      state.releases.forEach((release) => release());
      await visible(page.getByRole("option", { name: /Kozhikode/ }));
      await input.press("Enter");
      await visible(page.getByRole("button", { name: /Station Road/ }));
    });

    await run(profile, "map-pick-cancel-confirm-double-tap", async (page, _context, state) => {
      await page.waitForTimeout(350);
      await mapTap(page);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(state.calls.filter((call) => call.path === "/gates").length, 0);
      // End the previous touch gesture before a deliberate new map selection.
      // MapLibre's tap recognizer keeps its gesture window for500ms.
      await page.waitForTimeout(650);
      await mapTap(page);
      await page.getByRole("button", { name: "Look up", exact: true }).evaluate((button) => { button.click(); button.click(); });
      await visible(page.locator(".crossing-row"));
      assert.equal(state.calls.filter((call) => call.path === "/gates").length, 1);
    });

    await run(profile, "map-pick-escape-keeps-selected-crossing", async (page) => {
      await openGate(page);
      await mapTap(page);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
      await visible(page.getByLabel("Crossing details"));
      await page.keyboard.press("Escape");
      await visible(page.getByRole("heading", { name: "Nearby crossings", exact: true }));
    }, { initial: "?lat=12&lon=75" });

    await run(profile, "map-pick-traps-keyboard-in-confirmation", async (page) => {
      await page.waitForTimeout(350);
      await mapTap(page);
      const lookUp = page.getByRole("button", { name: "Look up", exact: true });
      await lookUp.focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).evaluate((button) => button === document.activeElement), true);
      await page.keyboard.press("Shift+Tab");
      assert.equal(await lookUp.evaluate((button) => button === document.activeElement), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
    });

    await run(profile, "saved-rename-reload-open-remove", async (page) => {
      await openGate(page);
      await saveGate(page);
      await page.getByRole("tab", { name: /Saved/ }).click();
      await page.getByLabel("Manage Home gate").click();
      page.once("dialog", (dialog) => dialog.accept("Office gate"));
      await page.getByRole("button", { name: "Rename", exact: true }).click();
      await visible(page.getByRole("button", { name: /Office gate/ }));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: /Saved/ }).click();
      await page.getByRole("button", { name: /Office gate/ }).click();
      await visible(page.getByLabel("Crossing details"));
      await settle(page);
      await page.getByRole("tab", { name: /Saved/ }).click();
      await page.getByLabel("Manage Office gate").click();
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await visible(page.getByRole("heading", { name: "Your regular crossings, together" }));
    }, { initial: "?lat=12&lon=75" });

    await run(profile, "saved-load-cannot-override-new-city", async (page, _context, state) => {
      await openGate(page);
      await saveGate(page);
      await page.getByRole("tab", { name: /Saved/ }).click();
      state.heldGates = true;
      await page.getByRole("button", { name: /Home gate/ }).click();
      await page.waitForTimeout(80);
      await pickCity(page, "Kozhikode");
      await visible(page.getByRole("button", { name: /Station Road/ }));
      state.releases.forEach((release) => release());
      await page.waitForTimeout(150);
      assert.equal(await page.getByLabel("Crossing details").count(), 0);
      assert.match(await page.locator(".location-open").innerText(), /Kozhikode/);
    }, { initial: "?lat=12&lon=75" });

    await run(profile, "new-features-commute-saved-order-check-and-reload", async (page, _context, state) => {
      if (profile.name === "phone") await useLightTheme(page);
      await page.getByRole("tab", { name: /Saved/ }).click();
      await page.getByRole("button", { name: "New commute", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "New commute" });
      await editor.getByLabel("Commute name").fill("Home to work");
      await editor.getByLabel("Home gate").check();
      await editor.getByLabel("Canal gate").check();
      await editor.getByRole("button", { name: "Move Canal gate earlier" }).press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Move Canal gate later");
      await editor.getByRole("button", { name: "Save commute" }).click();
      const commute = page.getByRole("region", { name: "Home to work" });
      assert.deepEqual(await commute.locator("li button").allTextContents(), ["Canal gate", "Home gate"]);
      await commute.getByRole("button", { name: "Check commute" }).press("Enter");
      await visible(commute.getByText(/16603 Maveli Express/));
      await visible(commute.getByText("Train timing unavailable"));
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Check commute");
      if (profile.name === "phone") await page.getByRole("button", { name: "Expand crossings and trains" }).click();
      await page.screenshot({ path: resolve(artifacts, `${profile.name}-commute-check-result.png`) });
      assert.equal(await page.getByRole("tab", { name: /Saved/ }).getAttribute("aria-selected"), "true");
      assert.equal(await commute.getByRole("button", { name: "Check commute" }).isDisabled(), true);
      assert.deepEqual(state.calls.filter((call) => call.path === "/scene").map((call) => call.query.crossing_id).sort(), [gateA.id, gateC.id]);
      await page.evaluate((id) => {
        const key = "gateahead:responses";
        const cache = JSON.parse(localStorage.getItem(key));
        for (const [path, hit] of Object.entries(cache)) {
          if (path.includes(encodeURIComponent(id))) hit.at -= 60 * 60 * 1000;
        }
        localStorage.setItem(key, JSON.stringify(cache));
      }, gateA.id);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: /Saved/ }).click();
      assert.deepEqual(await commute.locator("li button").allTextContents(), ["Canal gate", "Home gate"]);
      await visible(commute.getByText(/Saved check/));
      await visible(commute.getByText(/At saved check, the barrier was estimated to close/));
      state.rateGate = gateA.id;
      await commute.getByRole("button", { name: "Check commute" }).click();
      await visible(commute.getByText(/Too many checks/));
      await visible(commute.getByText(/At saved check, the barrier was estimated to close/));
      await commute.getByLabel("Manage Home to work").click();
      await commute.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("dialog", { name: "Edit commute" }).getByLabel("Commute name").fill("Evening trip");
      await page.getByRole("button", { name: "Save commute" }).click();
      await visible(page.getByRole("region", { name: "Evening trip" }));
    }, { storage: { "gateahead:favorites": [
      { gate: gateA, label: "Home gate", place: { lat: 12, lon: 75 } },
      { gate: gateC, label: "Canal gate", place: { lat: 12, lon: 75 } },
    ] }, rateLimitExpected: true, sceneFields: {
      [gateA.id]: { trains: [{ number: "16603", name: "Maveli Express", eta_min: 6, closes_in_min: 2, status: "closing_soon", along_km: 2, age_min: 1 }] },
      [gateC.id]: { coverage: { status: "partial" } },
    } });

    await run(profile, "new-features-crossing-access-verified-bypass-and-flag", async (page, _context, state) => {
      if (profile.name === "phone") await useLightTheme(page);
      await page.getByRole("button", { name: /School Road/ }).click();
      await visible(page.getByText("Checking this crossing…"));
      const bypass = page.getByRole("link", { name: /Open underpass pin in Maps/ });
      await visible(bypass);
      const url = new URL(await bypass.getAttribute("href"));
      assert.equal(url.origin, "https://www.google.com");
      assert.equal(url.searchParams.get("query"), "12.001,75.001");
      await page.getByText("Crossing access", { exact: true }).click();
      const access = page.getByRole("region", { name: "Crossing access and bypasses" });
      await visible(access.getByText("Restricted", { exact: true }));
      await visible(access.getByText("Unknown", { exact: true }));
      await access.getByRole("button", { name: "Flag outdated details" }).press("Enter");
      await visible(access.getByText("Flag sent for review."));
      assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Flag outdated details");
      state.heldScenes = false;
      state.releases.forEach((release) => release());
      await settle(page);
      if (profile.name === "phone") await page.getByRole("button", { name: "Expand crossings and trains" }).click();
      await page.screenshot({ path: resolve(artifacts, `${profile.name}-access-and-bypass-result.png`) });
      assert.equal(state.detailFlags.length, 1);
      assert.equal(state.detailFlags[0].crossing_id, gateA.id);
      assert.match(state.detailFlags[0].installation_id, /^[0-9a-f-]{36}$/i);
    }, { initial: "?lat=12&lon=75", heldScenes: true, sceneFields: { [gateA.id]: { available: false, rail: [] } },
      accessDetails: { [gateA.id]: { crossing: gateA, crossing_access: {
        cars: "restricted", two_wheelers: "allowed", pedestrians: "unknown", source: "verified", verified_on: verifiedOn,
        bypasses: [{ kind: "underpass", name: "Canal Road underpass", lat: 12.001, lon: 75.001, verified_on: verifiedOn, replacement: true }],
      },
    } } });

    await run(profile, "new-features-commute-storage-failure-and-cancellation", async (page, _context, state) => {
      await page.getByRole("tab", { name: /Saved/ }).click();
      await page.evaluate(() => {
        const write = Storage.prototype.setItem;
        const guarded = function (key, value) {
          if (key === "gateahead:commutes") throw new DOMException("Storage quota", "QuotaExceededError");
          return write.call(this, key, value);
        };
        Storage.prototype.setItem = guarded;
        window.restoreCommuteStorage = () => { Storage.prototype.setItem = write; };
      });
      await page.getByRole("button", { name: "New commute" }).click();
      const editor = page.getByRole("dialog", { name: "New commute" });
      await editor.getByLabel("Commute name").fill("New route");
      await editor.getByLabel("School Road", { exact: true }).check();
      await editor.getByRole("button", { name: "Save commute" }).click();
      await visible(editor.getByText("Could not save this commute on this device. Try again."));
      await editor.getByRole("button", { name: "Cancel" }).click();
      await page.evaluate(() => window.restoreCommuteStorage());

      const commute = page.getByRole("region", { name: "Morning route" });
      await Promise.all([
        page.waitForRequest((request) => request.url().includes(encodeURIComponent(gateA.id))),
        page.waitForRequest((request) => request.url().includes(encodeURIComponent(gateC.id))),
        commute.getByRole("button", { name: "Check commute" }).click(),
      ]);
      await commute.getByLabel("Manage Morning route").click();
      await commute.getByRole("button", { name: "Remove", exact: true }).press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "New commute");
      state.heldScenes = false;
      state.releases.forEach((release) => release());
      await visible(page.getByText("Commute removed.", { exact: true }));
      await page.waitForTimeout(150);
      assert.equal(state.calls.filter((call) => call.path === "/scene").length, 2);
    }, { heldScenes: true, storage: {
      "gateahead:favorites": [gateA, gateC, gateD].map((gate) => ({ gate, label: gate.name, place: { lat: 12, lon: 75 } })),
      "gateahead:commutes": [{ id: "morning", label: "Morning route", gateIds: [gateA.id, gateC.id, gateD.id] }],
    } });

    const legacy = { ...gateA, id: "user:12:45" };
    const canonical = { ...gateA, id: "pin:aabbccddeeff4a12a123334455667788", group_id: "road-1", group_size: 2 };
    await run(profile, "new-features-commute-legacy-migrates-and-discloses-track-scope", async (page) => {
      await page.getByRole("tab", { name: /Saved/ }).click();
      const commute = page.getByRole("region", { name: "Morning route" });
      await commute.getByRole("button", { name: "Check commute" }).click();
      await visible(commute.getByText("Estimated passing window", { exact: false }));
      const stored = await page.evaluate(() => ({
        gates: JSON.parse(localStorage.getItem("gateahead:favorites")),
        trips: JSON.parse(localStorage.getItem("gateahead:commutes")),
      }));
      assert.equal(stored.gates[0].gate.id, canonical.id);
      assert.deepEqual(stored.trips[0].gateIds, [canonical.id]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: /Saved/ }).click();
      await visible(commute.getByText(/At saved check, the train was estimated to be in the passing window/));
      await visible(commute.getByText(/Part of 2 track crossings · this check covers one track/));
    }, { storage: {
      "gateahead:favorites": [{ gate: legacy, label: legacy.name, place: { lat: 12, lon: 75 } }],
      "gateahead:commutes": [{ id: "morning", label: "Morning route", gateIds: [legacy.id] }],
    }, sceneFields: { [legacy.id]: { crossing: canonical, legacy_alias_resolved: true, trains: [{
      number: "16603", name: "Maveli Express", eta_min: -.2, closes_in_min: -5.2,
      status: "closed", along_km: 2, age_min: 1, position_on_segment: false, movement: "moving", observed: true,
    }] } } });

    await run(profile, "share-link-round-trip", async (page, context) => {
      await page.addInitScript(() => { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); });
      await page.evaluate(() => { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); });
      await openGate(page);
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await visible(page.getByText("Crossing link copied.", { exact: true }));
      const link = await page.evaluate(() => navigator.clipboard.readText());
      const url = new URL(link);
      assert.equal(url.searchParams.get("gate"), gateA.id);
      await page.goto(link, { waitUntil: "domcontentloaded" });
      await visible(page.getByLabel("Crossing details"));
      await settle(page);
      await visible(page.getByRole("heading", { name: gateA.name, exact: true }));
    }, { initial: "?lat=12&lon=75" });

    await run(profile, "new-city-after-shared-link-survives-reload", async (page) => {
      await visible(page.getByLabel("Crossing details"));
      await pickCity(page, "Kozhikode");
      await visible(page.getByRole("button", { name: /Station Road/ }));
      await page.reload({ waitUntil: "domcontentloaded" });
      await visible(page.getByRole("button", { name: /Station Road/ }));
      assert.match(await page.locator(".location-open").innerText(), /Kozhikode/);
      assert.equal(await page.getByLabel("Crossing details").count(), 0);
    }, { initial: "?lat=12&lon=75&gate=osm%3Anode%3A9004&name=Shared%20gate" });

    for (const action of ["untouched", "manual-gate", "navigate-away"]) await run(profile, `incoming-link-${action}-while-gates-load`, async (page, _context, state) => {
      await visible(page.getByRole("button", { name: /Canal Road/ }));
      if (action === "manual-gate") {
        await page.getByRole("button", { name: /Canal Road/ }).click();
        await settle(page);
        await visible(page.getByRole("heading", { name: "Canal Road", exact: true }));
      } else if (action === "navigate-away") await page.getByRole("tab", { name: "Trains", exact: true }).click();
      const fresh = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/gates");
      state.heldGates = false;
      state.releases.forEach((release) => release());
      await fresh;
      await page.waitForTimeout(250);
      if (action === "untouched") await visible(page.getByRole("heading", { name: "School Road", exact: true }));
      else if (action === "manual-gate") await visible(page.getByRole("heading", { name: "Canal Road", exact: true }));
      else {
        assert.equal(await page.getByLabel("Crossing details").count(), 0);
        await visible(page.getByRole("heading", { name: "Trains on this stretch", exact: true }));
      }
    }, { initial: "?lat=12&lon=75&gate=osm%3Anode%3A9004", heldGates: true, twoGates: true,
      storage: { "gateahead:responses": { "/api/gates?lat=12&lon=75": { at: Date.now(), data: { gates: [gateA, gateC] } } } } });

    await run(profile, "report-replace-expire-and-keyboard-tabs", async (page, _context, state) => {
      await openGate(page);
      for (const [choice, label] of [["The gate is open", "Gate open"], ["The gate is closed", "Gate closed"], ["The location is incorrect", "Location reported incorrect"]]) {
        await page.getByRole("button", { name: "Report", exact: true }).click();
        await page.getByRole("button", { name: choice, exact: true }).click();
        await visible(page.getByText("Report saved for 10 minutes.", { exact: true }));
        const disclosure = page.locator(".community-reports");
        if (!await disclosure.evaluate((element) => element.open)) await disclosure.locator("summary").click();
        await visible(disclosure.getByText(new RegExp(label)));
        assert.equal(state.reports.length, 1);
      }
      await page.clock.fastForward(601000);
      await page.clock.runFor(100);
      await visible(page.getByText("No recent reports for this crossing."));
      const nearby = page.getByRole("tab", { name: "Nearby", exact: true });
      await nearby.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", { name: "Trains", exact: true }).getAttribute("aria-selected"), "true");
      await page.keyboard.press("End");
      assert.equal(await page.getByRole("tab", { name: /Saved/ }).getAttribute("aria-selected"), "true");
    }, { initial: "?lat=12&lon=75", clock: true });

    for (const allowed of [false, true]) await run(profile, `commute-automatic-checks-${allowed ? "inside" : "outside"}`, async (page, _context, state) => {
      await visible(page.getByRole("button", { name: /School Road/ }));
      await page.getByRole("button", { name: "Check trains", exact: true }).click();
      await page.getByRole("button", { name: "Checking…", exact: true }).waitFor({ state: "hidden" });
      assert.equal(state.calls.filter((call) => call.path === "/predict").length, 1);
      await page.getByRole("button", { name: "Open settings" }).click();
      await page.getByLabel("Check every 2 minutes while visible").check();
      await page.getByLabel("Only during my commute").check();
      await page.getByLabel("From", { exact: true }).fill(allowed ? "08:00" : "00:00");
      await page.getByLabel("Until", { exact: true }).fill(allowed ? "10:00" : "01:00");
      await page.getByRole("button", { name: "Close Settings", exact: true }).click();
      await page.clock.fastForward(135000); await page.clock.runFor(250);
      assert.equal(state.calls.filter((call) => call.path === "/predict").length, allowed ? 2 : 1);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Open settings" }).click();
      assert.equal(await page.getByLabel("Check every 2 minutes while visible").isChecked(), true);
      assert.equal(await page.getByLabel("Only during my commute").isChecked(), true);
    }, { initial: "?lat=12&lon=75", clock: true });

    await run(profile, "legacy-saved-record-does-not-crash", async (page) => {
      await page.getByRole("tab", { name: /Saved/ }).click();
      await visible(page.getByRole("heading", { name: "Your regular crossings, together" }));
      await pickCity(page, "Kannur");
      await visible(page.getByRole("button", { name: /School Road/ }));
    }, { storage: { "gateahead:favorites": [{ label: "Broken old gate", place: { lat: 12, lon: 75 },
      gate: { id: "missing-on-map", lat: 12, lon: 75, name: { old: "gate" } } }] } });

    await run(profile, "invalid-last-place-does-not-crash", async (page) => {
      await visible(page.getByRole("heading", { name: "Start with a place" }));
      await pickCity(page, "Kannur");
      await visible(page.getByRole("button", { name: /School Road/ }));
    }, { storage: { "gateahead:last-place": true } });

    await run(profile, "older-report-request-cannot-overwrite-a-submission", async (page, _context, state) => {
      const firstPoll = page.waitForRequest((request) => request.method() === "GET" && new URL(request.url()).pathname === "/api/reports");
      await openGate(page);
      await firstPoll;
      await page.getByRole("button", { name: "Report", exact: true }).click();
      await page.getByRole("button", { name: "The gate is closed", exact: true }).click();
      await visible(page.getByText("Report saved for 10 minutes.", { exact: true }));
      state.delayReport = false;
      state.releases.forEach((release) => release());
      const reports = page.locator(".community-reports");
      await reports.locator("summary").click();
      await visible(reports.getByText(/Gate closed/));
    }, { initial: "?lat=12&lon=75", delayReport: true });

    await run(profile, "train-results-appear-before-the-check-finishes", async (page, _context, state) => {
      await page.getByRole("button", { name: "Check trains", exact: true }).click();
      await visible(page.getByText("Checking station boards and live reports…"));
      await visible(page.locator("article.train").getByText(/Regional Express/));
      await visible(page.getByText("1 of 2 train checks completed. More results are loading."));
      assert.equal(await page.locator("article.train").count(), 1);
      assert.equal(await page.getByRole("button", { name: "Checking…", exact: true }).isDisabled(), true);
      state.holdTrainCheck = false;
      state.releases.forEach((release) => release());
      await visible(page.locator("article.train").getByText(/Coastal Express/));
      assert.equal(await page.locator("article.train").count(), 2);
      assert.equal(await page.getByText(/More results are loading/).count(), 0);
    }, { initial: "?lat=12&lon=75", progressivePredict: true });

    await run(profile, "crossing-list-can-retry-in-place", async (page, _context, state) => {
      const retry = page.getByRole("button", { name: "Retry crossing lookup" });
      await visible(retry);
      const warning = page.getByText(/The crossing list is busy/);
      await visible(warning);
      // The development mount can expose a cancelled StrictMode request to Playwright.
      const requestsBeforeRetry = state.calls.filter((call) => call.path === "/gates").length;
      assert.ok(requestsBeforeRetry > 0);
      state.gatesUnavailable = false;
      state.heldGates = true;
      try {
        await retry.click();
        await visible(page.getByText(/Looking up crossings/));
        await warning.waitFor({ state: "hidden" });
      } finally {
        state.heldGates = false;
        state.releases.forEach((release) => release());
      }
      await visible(page.getByRole("button", { name: /School Road/ }));
      assert.equal(state.calls.filter((call) => call.path === "/gates").length, requestsBeforeRetry + 1);
    }, { initial: "?lat=12&lon=75", gatesUnavailable: true });

    await run(profile, "removed-pre-upgrade-favorite-cannot-open", async (page) => {
      await page.getByRole("tab", { name: /Saved/ }).click();
      await page.getByRole("button", { name: /Retired gate/ }).click();
      await visible(page.getByText("That crossing is no longer on the map."));
      assert.equal(await page.getByLabel("Crossing details").count(), 0);
    }, { storage: { "gateahead:favorites": [{ label: "Retired gate", place: { lat: 12, lon: 75 },
      gate: { ...gateA, id: "removed-gate", name: "Retired Road" } }] } });
  }
} finally {
  await browser.close();
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify({ base, results }, null, 2));
}
console.log(`${results.filter((result) => result.passed).length}/${results.length} user journeys passed; artifacts: ${artifacts}`);
if (!results.length) { console.error(`No user journey matched ${JSON.stringify(filter)}.`); process.exitCode = 2; }
if (results.some((result) => !result.passed)) process.exitCode = 1;
