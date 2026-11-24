import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Uses an existing development server. Every API response is controlled here;
// no train providers or community-report servers receive these requests.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
const artifacts = resolve(process.env.BROWSER_ARTIFACTS || "/tmp/gateahead-browser-check");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const results = [];
const gate = { id: "osm:node:9004", name: "School Road", lat: 12, lon: 75, km: 0.4, source: "osm" };
const otherGate = { ...gate, id: "osm:node:9005", name: "Canal Road", lat: 12.002, km: 0.7 };
const rail = [[11.93, 75], [12.07, 75]];
const stoppedTrain = (at) => ({ number: "16650", name: "Parasuram Express", movement: "stopped", current: "Pazhayangadi",
  eta_min: 6, closes_in_min: 1, status: "closing_soon", age_min: 7, along_km: 5, position_on_segment: true, snapshot_at: at / 1000 });
const movingTrain = (at) => ({ number: "16603", name: "Maveli Express", movement: "moving", current: "On the line",
  eta_min: 6, closes_in_min: 1, status: "closing_soon", age_min: 0, along_km: 0, snapshot_at: at / 1000,
  motion: { direction: 1, speed_kmh: 60, valid_for_sec: 420 } });
const scene = (at, trains = [stoppedTrain(at), movingTrain(at)], crossing = gate) => ({ available: true, crossing, rail, trains, passed: [], awaiting_update: [] });
const prediction = (at, trains = [stoppedTrain(at), movingTrain(at)]) => ({ generated_at: new Date(at).toISOString(), crossings: 2,
  checked: trains.length, running: trains.length, stations: [], sightings: [], passed: [], awaiting_update: [],
  gate_predictions: trains.map((train) => ({ id: gate.id, train: train.number, name: train.name, eta: train.eta_min,
    closes_in: train.closes_in_min, status: train.status, age_min: train.age_min, at_station: train.movement === "stopped" })),
  approaching: trains.map((train) => ({ train: train.number, name: train.name, current: train.current, cluster: gate.name,
    count: 1, ids: [gate.id], eta: train.eta_min, closes_in: train.closes_in_min, status: train.status, age_min: train.age_min,
    at_station: train.movement === "stopped", from_you_km: gate.km, lat: gate.lat, lon: gate.lon })) });

async function visible(locator) { await locator.first().waitFor({ state: "visible", timeout: 15000 }); }
async function text(page) { return page.locator("body").innerText(); }
async function advance(page, ms) { await page.clock.fastForward(ms); await page.clock.runFor(150); }
async function nearby(page) { await page.getByRole("tab", { name: "Nearby", exact: true }).click(); }
async function trains(page) { await page.getByRole("tab", { name: "Trains", exact: true }).click(); }
async function openGate(page, name = gate.name) { await nearby(page); await page.getByRole("button", { name: new RegExp(name) }).click(); await visible(page.getByLabel("Crossing details")); }
async function settleScene(page) { await page.getByText("Checking this crossing…", { exact: true }).waitFor({ state: "hidden", timeout: 15000 }); }
async function check(page) { await page.getByRole("button", { name: "Check trains", exact: true }).click(); }

async function run(name, test) {
  const errors = [];
  const consoleErrors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const state = { calls: {}, reports: [], offline: false, rate: false, malformed: false, scene: null, predict: null, delayGate: null, release: null };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.clock.install({ time: new Date("2026-11-16T10:00:00Z") });
  await context.route("https://tiles.openfreemap.org/**", (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#282d2c" } }] } }));
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    state.calls[path] = (state.calls[path] || 0) + 1;
    if (state.offline) { await route.abort("internetdisconnected"); return; }
    if (path === "/predict" && state.rate) { await route.fulfill({ status: 429, headers: { "Retry-After": "45" }, json: {} }); return; }
    if (path === "/predict" && state.malformed) { await route.fulfill({ json: { approaching: "unavailable", sightings: [] } }); return; }
    const now = await page.evaluate(() => Date.now());
    if (path === "/place") { await route.fulfill({ json: { name: "Kannur test area" } }); return; }
    if (path === "/gates") { await route.fulfill({ json: { gates: [gate, otherGate] } }); return; }
    if (path === "/crossing-details") { await route.fulfill({ json: { error: "access_unavailable" } }); return; }
    if (path === "/cities") { await route.fulfill({ json: { cities: [{ name: "Kannur", state: "Kerala", lat: 12, lon: 75 }] } }); return; }
    if (path === "/predict") { await route.fulfill({ json: state.predict || prediction(now) }); return; }
    if (path === "/scene") {
      const id = url.searchParams.get("crossing_id");
      if (state.delayGate === id) await new Promise((resolve) => { state.release = resolve; });
      await route.fulfill({ json: state.scene || scene(now, [stoppedTrain(now), movingTrain(now)], id === otherGate.id ? otherGate : gate) }); return;
    }
    if (path === "/reports") {
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        assert.equal(body.crossing_id, gate.id);
        assert.equal(body.lat, gate.lat);
        assert.equal(body.lon, gate.lon);
        assert.match(body.installation_id, /^[0-9a-f-]{36}$/i);
        state.reports = [{ state: body.state, at: now / 1000, expires_at: now / 1000 + 600 }];
      }
      await route.fulfill({ json: { verified: false, reports: state.reports } }); return;
    }
    throw new Error(`Unexpected fixture request: ${request.method()} ${url.pathname}`);
  });
  try {
    await page.goto(`${base}/?lat=12&lon=75`, { waitUntil: "domcontentloaded" });
    await visible(page.getByRole("button", { name: new RegExp(gate.name) }));
    assert.equal(await page.locator("canvas.maplibregl-canvas").evaluate((canvas) => Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))), true, "WebGL must be active");
    await test(page, state);
    assert.deepEqual(errors, [], "uncaught browser errors");
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/^Failed to load resource: (net::ERR_INTERNET_DISCONNECTED|the server responded with a status of 429)/.test(message));
    assert.deepEqual(unexpectedConsoleErrors, [], "unexpected browser console errors");
    await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true });
    results.push({ name, passed: true, calls: state.calls, browserErrors: errors, consoleErrors });
    console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: resolve(artifacts, `${name}-failure.png`), fullPage: true }).catch(() => {});
    results.push({ name, passed: false, error: error.stack || String(error), calls: state.calls, browserErrors: errors, consoleErrors });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    state.release?.();
    await context.close();
  }
}

try {
  await run("stopped-report-timeline", async (page, state) => {
    await check(page);
    await visible(page.getByText("16650 Parasuram Express", { exact: true }));
    await openGate(page);
    await settleScene(page);
    await page.waitForFunction(() => window.__gateRun?.trains?.length === 2);
    const before = await page.evaluate(() => window.__gateRun);
    assert.equal(before.lowered, 0);
    const firstMoving = before.trains.find((train) => train.number === "16603");
    await advance(page, 45000);
    assert.equal(await page.getByRole("heading", { name: "Position update needed", exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => window.__gateRun)).lowered, 0);
    await advance(page, 30000);
    await visible(page.getByRole("heading", { name: "Position update needed", exact: true }));
    assert.match(await text(page), /Last reported stopped at Pazhayangadi/);
    assert.match(await text(page), /Other reported train/i);
    const after = await page.evaluate(() => window.__gateRun);
    assert.deepEqual(after.trains.map((train) => train.number), ["16603"]);
    assert.ok(after.trains[0].lat > firstMoving.lat);
    assert.equal(after.lowered, 1);
    const calls = state.calls["/scene"];
    await page.getByRole("button", { name: "Back to crossings", exact: true }).click();
    assert.match(await text(page), /School Road[\s\S]*Position update needed/);
    await openGate(page);
    await settleScene(page);
    assert.equal(state.calls["/scene"], calls, "scene should reuse its original snapshot within90seconds");
    await trains(page);
    await visible(page.getByRole("heading", { name: "Position update needed", exact: true }));
    const body = await text(page);
    assert.ok(body.indexOf("16650") < body.indexOf("16603"));
    assert.doesNotMatch(body, /Recently passed/);
  });

  await run("newer-scene-reconciles-nearby", async (page, state) => {
    const now = await page.evaluate(() => Date.now());
    const old = { ...movingTrain(now), eta_min: 0, closes_in_min: -5, status: "closed" };
    state.predict = prediction(now, [old]);
    await check(page);
    await visible(page.getByText("16603 Maveli Express", { exact: true }));
    state.scene = { ...scene(now, []), coverage: { status: "complete" } };
    await openGate(page);
    await settleScene(page);
    await visible(page.getByRole("heading", { name: "No approaching train in the latest check", exact: true }));
    await page.getByRole("button", { name: "Back to crossings", exact: true }).click();
    const row = await page.getByRole("button", { name: new RegExp(gate.name) }).innerText();
    assert.doesNotMatch(row, /closed|passing/i);
    await trains(page);
    assert.doesNotMatch(await text(page), /16603 Maveli Express/);
  });

  await run("partial-empty-scene-keeps-the-prior-crossing-estimate", async (page, state) => {
    const now = await page.evaluate(() => Date.now());
    state.predict = prediction(now, [{ ...movingTrain(now), eta_min: 2, closes_in_min: -3, status: "closed" }]);
    await check(page);
    await visible(page.getByText("16603 Maveli Express", { exact: true }));
    state.scene = { ...scene(now, []), coverage: { status: "partial", live_checked: 0, live_candidates: 0,
      pending_live: 0, missing_or_stale_routes: 0 } };
    await openGate(page);
    await settleScene(page);
    await visible(page.getByRole("heading", { name: "The latest check did not establish train timing" }));
    await page.getByRole("button", { name: "Back to crossings", exact: true }).click();
    assert.match(await page.getByRole("button", { name: new RegExp(gate.name) }).innerText(), /Est\. closed/);
  });

  await run("saved-report-settings-dialogs", async (page, state) => {
    await openGate(page);
    await settleScene(page);
    await page.getByRole("button", { name: "Save gate", exact: true }).click();
    const saveDialog = page.getByRole("dialog", { name: "Save gate" });
    await saveDialog.getByRole("textbox", { name: "Gate name" }).fill("Home gate");
    await saveDialog.getByRole("button", { name: "Save gate", exact: true }).click();
    await visible(page.getByRole("button", { name: "Saved · remove", exact: true }));
    await page.getByRole("button", { name: "Report", exact: true }).click();
    await visible(page.getByRole("dialog", { name: "Report this crossing", exact: true }));
    await page.getByRole("button", { name: "The gate is closed", exact: true }).click();
    await visible(page.getByText("Report saved for 10 minutes.", { exact: true }));
    assert.equal(state.reports[0].state, "closed");
    await page.getByRole("button", { name: "Open settings", exact: true }).click();
    await visible(page.getByRole("dialog", { name: "Settings", exact: true }));
    await page.getByRole("button", { name: "Light", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" });
    await visible(page.getByLabel("Crossing details"));
    await page.getByRole("button", { name: "Report", exact: true }).click();
    await page.keyboard.press("Escape");
    await visible(page.getByLabel("Crossing details"));
    await page.keyboard.press("Escape");
    await page.getByLabel("Crossing details").waitFor({ state: "hidden" });
    await page.getByRole("tab", { name: /Saved/, exact: false }).click();
    await visible(page.getByRole("button", { name: /Home gate/ }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Saved/, exact: false }).click();
    await visible(page.getByRole("button", { name: /Home gate/ }));
    await page.getByRole("button", { name: /Home gate/ }).click();
    await settleScene(page);
    await visible(page.getByLabel("Crossing details"));
  });

  await run("rate-limit-cache-offline", async (page, state) => {
    state.rate = true;
    await check(page);
    await visible(page.getByText(/Too many checks/));
    assert.equal(state.calls["/predict"], 1);
    await check(page);
    await visible(page.getByText(/Checks are paused until/));
    assert.equal(state.calls["/predict"], 1);
    state.rate = false;
    await advance(page, 91000);
    await check(page);
    await visible(page.getByText("16603 Maveli Express", { exact: true }));
    await openGate(page);
    await settleScene(page);
    const at = await page.evaluate(() => JSON.parse(localStorage.getItem("gateahead:responses"))["/api/predict?lat=12&lon=75"].at);
    await trains(page);
    state.malformed = true;
    await advance(page, 91000);
    await check(page);
    await visible(page.getByText(/Saved check/));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("gateahead:responses"))["/api/predict?lat=12&lon=75"].at), at);
    state.malformed = false;
    state.offline = true;
    await advance(page, 91000);
    await check(page);
    await visible(page.getByText(/Saved check/));
    await openGate(page);
    await settleScene(page);
    await visible(page.getByText(/Saved view/));
    await page.waitForFunction(() => window.__gateRun?.trains?.length === 0);
  });

  await run("late-scene-cannot-reopen-other-gate", async (page, state) => {
    state.delayGate = gate.id;
    await openGate(page);
    await visible(page.getByText("Checking this crossing…", { exact: true }));
    await page.getByRole("button", { name: "Back to crossings", exact: true }).click();
    await openGate(page, otherGate.name);
    await settleScene(page);
    await visible(page.getByRole("heading", { name: otherGate.name, exact: true }));
    assert.ok(state.release, "first gate request must have started");
    state.release();
    state.release = null;
    await page.waitForTimeout(200);
    await visible(page.getByRole("heading", { name: otherGate.name, exact: true }));
    assert.equal(await page.getByRole("heading", { name: gate.name, exact: true }).count(), 0);
  });
} finally {
  await browser.close();
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify({ base, viewport: "1440x1000", results }, null, 2));
}
console.log(`${results.filter((result) => result.passed).length}/${results.length} desktop browser scenarios passed; artifacts: ${artifacts}`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
