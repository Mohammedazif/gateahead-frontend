import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
const artifacts = resolve(process.env.BROWSER_ARTIFACTS || "/tmp/gateahead-browser-gate-groups");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const malicious = 'Near Trikaripur <img src=x onerror="window.__injected=true">';
const a = { id: "100", name: malicious, lat: 12.004, lon: 75.0005, km: .4, source: "osm",
  group_id: "road-7:100", group_name: "Market Road", group_size: 2, road: "Market Road" };
const b = { ...a, id: "101", name: "Near Trikaripur", lon: 75.0011, km: .45 };
const c = { ...a, id: "102", name: "Near Trikaripur", lat: 12.0005, lon: 75.0023, group_id: "", group_name: "", group_size: 1, road: "Canal Road" };
const gates = [a, b, c];
const freight = { id: "osm:node:4518094360", name: "FCI Godown crossing",
  lat: 12.002, lon: 75.0018, km: .6, source: "osm", restricted_freight: true };
const dates = ["2026-11-15", "2026-11-16"];
const run = (date) => ({ train: "16512", name: "Daily Express", run_id: `16512:${date}`, start_date: date });
const prediction = (at, uncertain = false) => ({ generated_at: new Date(at).toISOString(), crossings: 3,
  checked: 2, running: 2, stations: [], sightings: [], passed: [],
  approaching: dates.map((date, i) => ({ ...run(date), cluster: "Near Trikaripur", count: 3,
    ids: gates.map((gate) => gate.id).filter((id) => !(uncertain && i === 0 && id === b.id)),
    eta: i ? 20 : 1, closes_in: i ? 15 : -4, status: i ? "approaching" : "closed", age_min: 0,
    at_station: false, current: "On the line", from_you_km: .4, lat: a.lat, lon: a.lon })),
  gate_predictions: dates.flatMap((date, i) => gates.filter((gate) => !(uncertain && i === 0 && gate.id === b.id)).map((gate) => {
    const track = gates.indexOf(gate);
    return { ...run(date), id: gate.id, eta: (i ? 20 : 1) + track * 12,
      closes_in: (i ? 15 : -4) + track * 12, status: i || track ? "approaching" : "closed", age_min: 0 };
  })),
  awaiting_update: uncertain ? [{ number: "16512", name: "Daily Express", run_id: "16512:2026-11-15", start_date: dates[0],
    current: "Trikaripur", age_min: 12, reason: "stopped_report", ids: [b.id] }] : [],
});
const visible = (locator) => locator.first().waitFor({ state: "visible", timeout: 15000 });
const results = [];
const profiles = [{ name: "desktop", viewport: { width: 1440, height: 1000 } },
  { name: "desktop-api-first", viewport: { width: 1440, height: 1000 }, holdStyle: true },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }];

// Project the fixture coordinate using the app's documented fitBounds padding/maxZoom.
// The pointer then reaches the actual WebGL circle and exercises its delegated handler.
async function hoverGate(page, gate) {
  const canvas = await page.locator("canvas.maplibregl-canvas").boundingBox();
  assert.ok(canvas);
  const world = ({ lat, lon }) => ({ x: (lon + 180) / 360 * 512,
    y: (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 512 });
  const bounds = [...gates, { lat: 12, lon: 75 }].map(world);
  const minX = Math.min(...bounds.map((p) => p.x)), maxX = Math.max(...bounds.map((p) => p.x));
  const minY = Math.min(...bounds.map((p) => p.y)), maxY = Math.max(...bounds.map((p) => p.y));
  const zoom = Math.min(14.6, Math.log2((canvas.width - 112) / (maxX - minX)), Math.log2((canvas.height - 112) / (maxY - minY)));
  const point = world(gate);
  const x = canvas.x + canvas.width / 2 + (point.x - (minX + maxX) / 2) * 2 ** zoom;
  const y = canvas.y + canvas.height / 2 + (point.y - (minY + maxY) / 2) * 2 ** zoom;
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.mouse.move(x + attempt % 2, y);
    if (await page.getByRole("tooltip").isVisible()) break;
    await page.waitForTimeout(150);
  }
  await visible(page.getByRole("tooltip"));
  return { x, y };
}

try {
  for (const profile of profiles) {
    const context = await browser.newContext({ ...profile, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], consoleErrors = [];
    const state = { offline: false, uncertain: false, scenes: [] };
    let releaseStyle;
    const styleReady = new Promise((resolveStyle) => { releaseStyle = resolveStyle; });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await context.route("https://tiles.openfreemap.org/**", async (route) => {
      if (profile.holdStyle) await styleReady;
      return route.fulfill({ json: { version: 8, sources: {
        attribution: { type: "geojson", data: { type: "FeatureCollection", features: [] },
          attribution: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap test attribution</a>' },
      }, layers: [
        { id: "background", type: "background", paint: { "background-color": "#e8ece8" } },
        { id: "test-attribution", type: "line", source: "attribution" },
      ] } }).catch(() => {});
    });
    await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
    await context.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, "");
      if (state.offline) return route.abort("internetdisconnected");
      if (path === "/gates") return route.fulfill({ json: { gates: [...gates, freight] } });
      if (path === "/crossing-details") return route.fulfill({ json: { error: "access_unavailable" } });
      if (path === "/predict") return route.fulfill({ json: prediction(await page.evaluate(() => Date.now()), state.uncertain) });
      if (path === "/place") return route.fulfill({ json: { name: "Trikaripur" } });
      if (path === "/cities") return route.fulfill({ json: { cities: [{ name: "Kannur", state: "Kerala", lat: 13, lon: 75 }] } });
      if (path === "/reports") return route.fulfill({ json: { verified: false, reports: [] } });
      if (path === "/scene") {
        const selected = gates.find((gate) => gate.id === url.searchParams.get("crossing_id"));
        assert.ok(selected);
        state.scenes.push(selected.id);
        return route.fulfill({ json: { available: true, crossing: selected,
          rail: [[selected.lat - .002, selected.lon], [selected.lat + .002, selected.lon]], trains: [], awaiting_update: [] } });
      }
      throw new Error(`Unexpected fixture ${path}`);
    });
    try {
      await page.goto(`${base}/?lat=12&lon=75&name=Trikaripur`, { waitUntil: "domcontentloaded" });
      await visible(page.locator(".crossing-row").first());
      assert.equal(await page.locator(".gates > ul > li").count(), 2, "the legacy freight crossing stays hidden");
      assert.equal(await page.getByText(freight.name, { exact: true }).count(), 0);
      releaseStyle();
      await page.waitForTimeout(1200);
      const attribution = page.locator(".maplibregl-ctrl-attrib-inner").getByText("OpenStreetMap test attribution", { exact: true });
      await attribution.waitFor({ state: "attached" });
      assert.equal(await attribution.getAttribute("href"), "https://www.openstreetmap.org/copyright");
      if (!profile.isMobile) {
        const tooltip = page.getByRole("tooltip");
        const point = await hoverGate(page, a);
        assert.match(await tooltip.innerText(), /Market Road/);
        assert.match(await tooltip.innerText(), /0.4 km away/);
        assert.match(await tooltip.innerText(), /Track crossing 1 of 2/);
        assert.ok((await tooltip.innerText()).includes(malicious));
        assert.equal(await tooltip.locator("img").count(), 0, "untrusted label is text, never an HTML element");
        assert.equal(await page.evaluate(() => window.__injected), undefined);
        assert.equal(await page.locator("canvas.maplibregl-canvas").getAttribute("aria-describedby"), await tooltip.getAttribute("id"));
        await page.screenshot({ path: resolve(artifacts, `${profile.name}-hover-point-100.png`), fullPage: true });
        await page.mouse.move(point.x + 65, point.y + 65);
        await tooltip.waitFor({ state: "hidden" });
        await hoverGate(page, a);
        await page.getByRole("tab", { name: "Nearby", exact: true }).focus();
        await page.keyboard.press("Escape");
        await tooltip.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "Open settings" }).click();
        await page.getByRole("button", { name: "Light", exact: true }).click();
        await page.getByRole("button", { name: "Close Settings" }).click();
        await hoverGate(page, b);
        assert.match(await tooltip.innerText(), /0.5 km away\nTrack crossing 2 of 2/);
        assert.equal(await page.locator(".gate-hover-popup").count(), 1, "style reload does not duplicate hover handlers/popups");
        await page.mouse.click((await hoverGate(page, b)).x, (await hoverGate(page, b)).y);
        await visible(page.getByLabel("Crossing details"));
        assert.equal(state.scenes.at(-1), b.id, "hover and click retain exact member ID");
        await tooltip.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "Back to crossings" }).click();
      }
      const members = page.locator(".crossing-members");
      await members.locator("summary").click();
      assert.equal(await members.getByRole("button").count(), 2);
      assert.deepEqual(await members.getByRole("button").first().evaluate((button) => ({
        display: getComputedStyle(button).display, wrapping: getComputedStyle(button.querySelector("span")).whiteSpace,
      })), { display: "block", wrapping: "normal" }, "track identity stays visible on narrow screens");
      await members.getByRole("button", { name: /Track crossing 2 of 2/ }).click();
      await visible(page.getByLabel("Crossing details"));
      assert.equal(state.scenes.at(-1), b.id);
      assert.match(await page.locator(".detail-heading").innerText(), /Track crossing 2 of 2/);
      await page.getByRole("button", { name: "Save gate", exact: true }).click();
      const saveDialog = page.getByRole("dialog", { name: "Save gate" });
      await saveDialog.getByRole("textbox", { name: "Gate name" }).fill("Track gate 101");
      await saveDialog.getByRole("button", { name: "Save gate", exact: true }).click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("gateahead:favorites") || "[]").length > 0);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("gateahead:favorites")));
      assert.equal(saved[0].gate.id, b.id, "saved shortcut retains the member, not group or primary ID");
      await page.getByRole("button", { name: "Back to crossings" }).click();
      await page.getByRole("tab", { name: "Trains", exact: true }).click();
      await page.getByRole("button", { name: "Check trains", exact: true }).click();
      await visible(page.locator(".train").first());
      assert.equal(await page.locator(".train").count(), 2, "daily journeys remain separate cards");
      for (const [i, card] of (await page.locator(".train").all()).entries()) {
        assert.match(await card.locator("header").innerText(), new RegExp(dates[i]));
        assert.equal(await card.locator(":scope > ul > .timing-group").count(), 2);
        await card.locator(".track-checks summary").click();
        assert.equal(await card.locator(".track-checks li").count(), 2);
        assert.match(await card.locator(".track-checks").innerText(), /Track crossing 1 of 2/);
        assert.match(await card.locator(".track-checks").innerText(), /Track crossing 2 of 2/);
      }
      const firstCard = page.locator(".train").first();
      assert.equal(await firstCard.locator(".timing-summary > span:last-child").first().evaluate((element) => getComputedStyle(element).flexShrink), "1", "long member timing can wrap within the card");
      assert.match(await firstCard.locator(".track-checks").innerText(), /closed.*train (in 1 min|due within 1 min)/);
      assert.match(await firstCard.locator(".track-checks").innerText(), /closes in 8 min/);
      await page.screenshot({ path: resolve(artifacts, `${profile.name}-grouped-journeys.png`), fullPage: true });
      const storedCheck = await page.evaluate(() => JSON.parse(localStorage.getItem("gateahead:responses"))["/api/predict?lat=12&lon=75"]);
      await page.evaluate((legacyGate) => {
        const cache = JSON.parse(localStorage.getItem("gateahead:responses"));
        cache["/api/gates?lat=12&lon=75"].data.gates.push(legacyGate);
        localStorage.setItem("gateahead:responses", JSON.stringify(cache));
        const favorites = JSON.parse(localStorage.getItem("gateahead:favorites"));
        favorites.push({ label: legacyGate.name, gate: legacyGate, place: { lat: 12, lon: 75 } });
        localStorage.setItem("gateahead:favorites", JSON.stringify(favorites));
      }, freight);
      state.offline = true;
      await page.reload({ waitUntil: "domcontentloaded" });
      await visible(page.locator(".crossing-row").first());
      assert.equal(await page.locator(".gates > ul > li").count(), 2, "older cached freight crossings stay hidden");
      await page.getByRole("tab", { name: /Saved/ }).click();
      assert.equal(await page.getByText(freight.name, { exact: true }).count(), 0);
      await page.getByRole("tab", { name: "Trains", exact: true }).click();
      await visible(page.getByText(/Saved check/));
      for (const summary of await page.locator(".track-checks summary").all()) await summary.click();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("gateahead:responses"))["/api/predict?lat=12&lon=75"]), storedCheck, "offline restore preserves the original checks and timestamp");
      assert.equal(await page.locator(".train").count(), 2);
      assert.match(await page.locator(".train").first().locator(".track-checks").innerText(), /Track crossing 1 of 2.*\nclosed.*train in 1 min/);
      assert.match(await page.locator(".train").first().locator(".track-checks").innerText(), /Track crossing 2 of 2.*\ncloses in 8 min/);
      await page.screenshot({ path: resolve(artifacts, `${profile.name}-cached-grouped-journeys.png`), fullPage: true });
      state.offline = false;
      state.uncertain = true;
      await page.getByRole("button", { name: "Check trains", exact: true }).click();
      await visible(page.getByText("Last reported stopped at Trikaripur", { exact: false }));
      assert.match(await page.locator(".train").first().locator(".timing-summary").first().innerText(), /Position update needed/);
      assert.doesNotMatch(await page.locator(".train").nth(1).locator(".timing-summary").first().innerText(), /Position update needed/);
      await page.getByRole("tab", { name: "Nearby", exact: true }).click();
      assert.match(await page.locator(".crossing-row").first().innerText(), /Position update needed/);
      await page.locator(".crossing-members summary").click();
      assert.match(await page.locator(".crossing-members").innerText(), /Position update needed/);
      assert.match(await page.locator(".crossing-members").innerText(), /Est.*closed/);
      await page.screenshot({ path: resolve(artifacts, `${profile.name}-mixed-uncertainty.png`), fullPage: true });
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(layout.scroll <= layout.width + 1, `no horizontal overflow ${JSON.stringify(layout)}`);
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors.filter((message) => !/Failed to load resource.*(?:ERR_INTERNET_DISCONNECTED|ERR_FAILED)/i.test(message)), [], "no unexpected map or browser errors");
      results.push({ profile: profile.name, passed: true, checks: [...(profile.isMobile ? [] : ["safe pointer hover", "Escape and theme reset"]), "physical grouping", "exact member selection/save", "separate daily journeys", "offline checks", "mixed uncertainty"] });
      console.log(`PASS ${profile.name}/gate-groups`);
    } catch (error) {
      await page.screenshot({ path: resolve(artifacts, `${profile.name}-failure.png`), fullPage: true });
      results.push({ profile: profile.name, passed: false, error: error.stack || String(error), errors, consoleErrors });
      console.error(`FAIL ${profile.name}/gate-groups: ${error.message}`);
    } finally { releaseStyle(); await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(resolve(artifacts, "results.json"), JSON.stringify({ results }, null, 2));
console.log(`Artifacts: ${artifacts}`);
if (results.some((row) => !row.passed)) process.exitCode = 1;
