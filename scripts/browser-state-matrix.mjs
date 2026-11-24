import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
const artifacts = resolve(process.env.BROWSER_ARTIFACTS || "/tmp/gateahead-browser-state-matrix");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const gate = { id: "osm:9004", name: "School Road", lat: 12, lon: 75, km: 0.4, source: "osm" };
const train = (at, changes = {}) => ({ number: "16603", name: "Maveli Express", current: "On the line", movement: "moving",
  eta_min: 6, closes_in_min: 1, status: "closing_soon", age_min: 0, along_km: 5,
  position_on_segment: true, snapshot_at: at / 1000, motion: { direction: 1, speed_kmh: 60, valid_for_sec: 480 }, ...changes });
const scene = (at, rows = [train(at)]) => ({ available: true, crossing: gate, rail: [[11.92, 75], [12.08, 75]],
  trains: rows, passed: [], awaiting_update: [] });
const predict = (at, rows = [train(at)]) => ({ generated_at: new Date(at).toISOString(), crossings: 1, checked: rows.length,
  running: rows.length, stations: [], sightings: [], passed: [], awaiting_update: [],
  gate_predictions: rows.map((row) => ({ id: gate.id, train: row.number, name: row.name, eta: row.eta_min,
    closes_in: row.closes_in_min, status: row.status, age_min: row.age_min, at_station: row.movement === "stopped" })),
  approaching: rows.map((row) => ({ train: row.number, name: row.name, current: row.current, cluster: gate.name, count: 1,
    ids: [gate.id], eta: row.eta_min, closes_in: row.closes_in_min, status: row.status, age_min: row.age_min,
    at_station: row.movement === "stopped", from_you_km: gate.km, lat: gate.lat, lon: gate.lon })) });
const results = [];
const profiles = [
  { name: "desktop", viewport: { width: 1366, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const visible = (locator) => locator.first().waitFor({ state: "visible", timeout: 12000 });
const advance = async (page, milliseconds) => { await page.clock.fastForward(milliseconds); await page.clock.runFor(100); };
async function check(page) { await page.getByRole("tab", { name: "Trains", exact: true }).click(); await page.getByRole("button", { name: "Check trains", exact: true }).click(); }
async function open(page) {
  await page.getByRole("tab", { name: "Nearby", exact: true }).click();
  await page.getByRole("button", { name: /School Road/ }).click();
  await page.getByText("Checking this crossing…", { exact: true }).waitFor({ state: "hidden", timeout: 12000 });
}
async function run(profile, name, exercise, options = {}) {
  const context = await browser.newContext({ ...profile, serviceWorkers: "block", reducedMotion: options.reducedMotion ? "reduce" : "no-preference" });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [], consoleErrors = [];
  const state = { mode: "ok", calls: {}, rows: null, coverage: undefined, reportMalformed: false, sourceOffset: 0 };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.clock.install({ time: new Date("2026-11-16T08:00:00Z") });
  if (options.noGraphics) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return /webgl/i.test(kind) ? null : original.call(this, kind, ...args); };
  });
  await context.route("https://tiles.openfreemap.org/**", (route) => route.fulfill({ json: {
    version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#282d2c" } }],
  } }));
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    state.calls[path] = (state.calls[path] || 0) + 1;
    const at = await page.evaluate(() => Date.now());
    if (path === "/gates") return route.fulfill({ json: { gates: [gate] } });
    if (path === "/crossing-details") return route.fulfill({ json: { error: "access_unavailable" } });
    if (path === "/place") return route.fulfill({ json: { name: "Test area" } });
    if (path === "/reports") return route.fulfill({ json: state.reportMalformed ? {} : { verified: false, reports: [] } });
    if (path === "/scene") {
      const body = scene(at, state.rows || [train(at)]);
      if (state.mode === "bad-scene") body.trains[0].track = { rail: "unavailable" };
      return route.fulfill({ json: body });
    }
    if (path === "/predict") {
      if (state.mode === "503") return route.fulfill({ status: 503, json: { detail: "Temporarily unavailable" } });
      if (state.mode === "offline") return route.abort("internetdisconnected");
      const body = { ...predict(at, state.rows || [train(at)]), coverage: state.coverage,
        generated_at: new Date(at + state.sourceOffset).toISOString() };
      if (state.mode === "bad-ids") body.approaching[0].ids = {};
      if (state.mode === "bad-name") body.approaching[0].name = { unavailable: true };
      if (state.mode === "bad-source-time") body.generated_at = "not-a-date";
      return route.fulfill({ json: body });
    }
    throw new Error(`Unexpected request ${path}`);
  });
  const id = `${profile.name}-${name}`;
  try {
    await page.goto(`${base}/?lat=12&lon=75&name=Test%20area`, { waitUntil: "domcontentloaded" });
    await visible(page.getByRole("button", { name: /School Road/ }));
    await exercise(page, state);
    assert.deepEqual(errors, [], "no uncaught browser errors");
    const unexpected = consoleErrors.filter((message) => !/Failed to load resource/.test(message) &&
      !(options.noGraphics && /WebGL|webgl|context/i.test(message)));
    assert.deepEqual(unexpected, [], "no unexpected console errors");
    results.push({ id, passed: true, calls: state.calls, errors, consoleErrors });
    console.log(`PASS ${id}`);
  } catch (error) {
    await page.screenshot({ path: resolve(artifacts, `${id}-failure.png`), fullPage: true }).catch(() => {});
    results.push({ id, passed: false, error: error.stack || String(error), calls: state.calls, errors, consoleErrors });
    console.error(`FAIL ${id}: ${error.message}`);
  } finally { await context.close(); }
}
try {
  for (const profile of profiles) {
    await run(profile, "moving-clock", async (page, state) => {
      await open(page); await page.waitForFunction(() => window.__gateRun?.trains?.length === 1);
      const before = await page.evaluate(() => window.__gateRun.trains[0].lat);
      await advance(page, 45000);
      assert.ok((await page.evaluate(() => window.__gateRun.trains[0].lat)) > before);
      assert.equal((await page.evaluate(() => window.__gateRun)).lowered, 0);
    });
    await run(profile, "stopped-clock-held", async (page, state) => {
      const at = await page.evaluate(() => Date.now());
      state.rows = [train(at, { movement: "stopped", motion: undefined, age_min: 1, eta_min: 6 })];
      await open(page); await page.waitForFunction(() => window.__gateRun?.trains?.length === 1);
      const before = await page.evaluate(() => window.__gateRun.trains[0].lat);
      await advance(page, 90000);
      assert.equal(await page.evaluate(() => window.__gateRun.trains[0].lat), before);
      assert.equal((await page.evaluate(() => window.__gateRun)).lowered, 0);
      assert.match(await page.getByLabel("Crossing details").innerText(), /Estimated train arrival in 6 min/);
    });
    await run(profile, "expired-train-does-not-hide-fresh-train", async (page, state) => {
      const at = await page.evaluate(() => Date.now());
      state.rows = [train(at, { number: "16650", age_min: 7.5, motion: { direction: -1, speed_kmh: 60, valid_for_sec: 30 } }), train(at)];
      await open(page); await page.waitForFunction(() => window.__gateRun?.trains?.length === 2);
      await advance(page, 75000);
      assert.deepEqual(await page.evaluate(() => window.__gateRun.trains.map((row) => row.number)), ["16603"]);
      assert.equal(await page.evaluate(() => window.__gateRun.lowered), 1);
    });
    await run(profile, "opposing-directions", async (page, state) => {
      const at = await page.evaluate(() => Date.now());
      state.rows = [train(at), train(at, { number: "16650", motion: { direction: -1, speed_kmh: 60, valid_for_sec: 480 } })];
      await open(page); await page.waitForFunction(() => window.__gateRun?.trains?.length === 2);
      const before = await page.evaluate(() => window.__gateRun.trains);
      await advance(page, 30000);
      const after = await page.evaluate(() => window.__gateRun.trains);
      assert.ok(after.find((row) => row.number === "16603").lat > before.find((row) => row.number === "16603").lat);
      assert.ok(after.find((row) => row.number === "16650").lat < before.find((row) => row.number === "16650").lat);
    });
    await run(profile, "uncertain-near-train-keeps-barrier-unknown", async (page, state) => {
      const at = await page.evaluate(() => Date.now());
      state.rows = [train(at, { eta_min: 2.3, closes_in_min: -2.7, status: "approaching", basis: "timetable", motion: undefined })];
      await open(page); await page.waitForFunction(() => window.__gateRun?.trains?.length === 1);
      assert.doesNotMatch(await page.getByLabel("Crossing details").innerText(), /closed · train/);
      assert.equal(await page.evaluate(() => window.__gateRun.lowered), 0);
      const before = await page.evaluate(() => window.__gateRun.trains[0].lat);
      await advance(page, 45000);
      assert.equal(await page.evaluate(() => window.__gateRun.trains[0].lat), before);
    });
    for (const offset of [-3600000, 3600000]) {
      await run(profile, `source-clock-${offset < 0 ? "behind" : "ahead"}`, async (page, state) => {
        const at = await page.evaluate(() => Date.now());
        state.sourceOffset = offset;
        state.rows = [train(at + offset, { number: "16650", name: "Parasuram Express", current: "Pazhayangadi",
          age_min: 7, movement: "stopped", motion: undefined })];
        await check(page); await visible(page.getByText("16650 Parasuram Express", { exact: true }));
        await open(page); await page.waitForFunction(() => window.__gateRun?.trains?.length === 1);
        assert.equal(await page.getByRole("heading", { name: "Position update needed", exact: true }).count(), 0);
        await advance(page, 75000);
        await visible(page.getByRole("heading", { name: "Position update needed", exact: true }));
        assert.equal(await page.evaluate(() => window.__gateRun.trains.length), 0);
        await page.getByRole("tab", { name: "Trains", exact: true }).click();
        await visible(page.getByRole("heading", { name: "Position update needed", exact: true }));
        assert.doesNotMatch(await page.locator("body").innerText(), /Recently passed/);
      });
    }
    for (const mode of ["503", "offline", "bad-ids", "bad-name", "bad-source-time"]) {
      await run(profile, `saved-result-survives-${mode}`, async (page, state) => {
        await check(page); await visible(page.getByText("16603 Maveli Express", { exact: true }));
        const cached = await page.evaluate(() => JSON.parse(localStorage.getItem("gateahead:responses"))["/api/predict?lat=12&lon=75"].at);
        state.mode = mode;
        await advance(page, 91000); await check(page);
        await visible(page.getByText(/Saved check/));
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("gateahead:responses"))["/api/predict?lat=12&lon=75"].at), cached);
      });
    }
    for (const partial of [false, true]) {
      await run(profile, `${partial ? "partial" : "complete"}-coverage`, async (page, state) => {
        state.coverage = { live_candidates: partial ? 3 : 1, live_checked: 1, pending_live: partial ? 2 : 0, missing_or_stale_routes: 0 };
        await check(page); await visible(page.getByText("16603 Maveli Express", { exact: true }));
        assert.equal(await page.getByText(/still pending; refresh to continue/).count(), partial ? 1 : 0);
      });
    }
    for (const knownTrain of [false, true]) {
      await run(profile, `discovery-down-${knownTrain ? "known-service" : "no-estimates"}`, async (page, state) => {
        state.rows = knownTrain ? null : [];
        state.coverage = { live_candidates: knownTrain ? 1 : 0, live_checked: knownTrain ? 1 : 0,
          pending_live: 0, missing_or_stale_routes: 0, unavailable_discovery: 3 };
        await check(page);
        await visible(page.getByText(/Some train searches did not complete/));
        assert.equal(await page.getByText("16603 Maveli Express", { exact: true }).count(), knownTrain ? 1 : 0);
      });
    }
    for (const condition of [
      { name: "visible-online", enabled: true, visible: true, online: true, expected: 2 },
      { name: "hidden-online", enabled: true, visible: false, online: true, expected: 1 },
      { name: "visible-offline", enabled: true, visible: true, online: false, expected: 1 },
      { name: "disabled", enabled: false, visible: true, online: true, expected: 1 },
    ]) {
      await run(profile, `automatic-${condition.name}`, async (page, state) => {
        await check(page); await visible(page.getByText("16603 Maveli Express", { exact: true }));
        if (condition.enabled) {
          await page.getByRole("button", { name: "Open settings" }).click();
          await page.getByLabel("Check every 2 minutes while visible").check();
          await page.keyboard.press("Escape");
        }
        await page.evaluate(({ visible, online }) => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible ? "visible" : "hidden" });
          Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
        }, condition);
        await advance(page, 135000);
        if (condition.expected === 2) await page.waitForFunction(() => !document.querySelector("button.solid.compact:disabled"));
        assert.equal(state.calls["/predict"], condition.expected);
      });
    }
    await run(profile, "reduced-motion-keeps-wall-clock-position", async (page, state) => {
      await open(page); await page.waitForFunction(() => window.__gateRun?.trains?.length === 1);
      const before = await page.evaluate(() => window.__gateRun.trains[0].lat);
      await advance(page, 45000);
      assert.ok((await page.evaluate(() => window.__gateRun.trains[0].lat)) > before);
      assert.equal((await page.evaluate(() => window.__gateRun)).lowered, 0);
    }, { reducedMotion: true });
    await run(profile, "malformed-scene-keeps-navigation", async (page, state) => {
      state.mode = "bad-scene"; await open(page);
      await visible(page.getByText(/unreadable response/));
      await page.getByRole("button", { name: "Back to crossings" }).click();
      await visible(page.getByRole("button", { name: /School Road/ }));
    });
    await run(profile, "malformed-report-keeps-dialog-and-retry", async (page, state) => {
      await open(page); state.reportMalformed = true;
      await page.getByRole("button", { name: "Report", exact: true }).click();
      await page.getByRole("button", { name: "The gate is closed", exact: true }).click();
      await visible(page.getByRole("dialog", { name: "Report this crossing" }));
      await visible(page.getByRole("status").filter({ hasText: /unreadable|Could not/ }));
      assert.doesNotMatch(await page.locator("body").innerText(), /Report saved for 10 minutes/);
    });
    await run(profile, "no-map-graphics-retains-crossing-list", async (page, state) => {
      await visible(page.getByText(/Map unavailable/));
      await check(page); await visible(page.getByText("16603 Maveli Express", { exact: true }));
      await open(page); await visible(page.getByRole("button", { name: "Back to crossings" }));
    }, { noGraphics: true });
  }
} finally {
  await browser.close();
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify({ base, results }, null, 2));
}
console.log(`${results.filter((result) => result.passed).length}/${results.length} paired state scenarios passed`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
