import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Run against a production build served with `npm run preview`.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:4173";
const artifacts = resolve(process.env.BROWSER_ARTIFACTS || "/tmp/gateahead-browser-offline");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
await context.route("https://tiles.openfreemap.org/**", (route) => route.fulfill({
  json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#282d2c" } }] },
}));
await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
const errors = [];
const consoleErrors = [];
const responses = [];
const checks = [];
let phase = "online";
let failure;
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ phase, text: message.text() }); });
page.on("response", (response) => {
  if (new URL(response.url()).origin === new URL(base).origin)
    responses.push({ phase, path: new URL(response.url()).pathname, status: response.status(), fromWorker: response.fromServiceWorker() });
});
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "GateAhead", exact: true }).waitFor();
  pass("production application renders");
  await page.waitForFunction(() => navigator.serviceWorker.controller != null);
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("gateahead-shell-"));
    return Promise.all(names.map(async (name) => ({ name, files: (await (await caches.open(name)).keys()).map((request) => request.url) })));
  });
  assert.ok(cached.some((cache) => cache.files.some((file) => file.endsWith(".js")) && cache.files.some((file) => file.endsWith(".css"))));
  assert.ok(cached.some((cache) => cache.files.some((file) => /\/maplibre-gl-worker-.*\.mjs$/.test(file))), "the local map worker is precached");
  pass("service worker controls page and caches JavaScript and CSS");
  phase = "offline";
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "GateAhead", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await page.getByRole("heading", { name: "Your regular crossings, together" }).waitFor();
  pass("offline reload renders application and navigation");
  const offlineAssets = responses.filter((response) => response.phase === "offline" && /\.(js|css)$/.test(response.path));
  assert.ok(offlineAssets.some((response) => response.path.endsWith(".js")));
  assert.ok(offlineAssets.some((response) => response.path.endsWith(".css")));
  assert.ok(offlineAssets.every((response) => response.fromWorker && response.status === 200));
  pass("offline JavaScript and CSS come from the application cache");
  await page.screenshot({ path: resolve(artifacts, "offline-phone.png"), fullPage: true });
  phase = "online-again";
  await context.setOffline(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "GateAhead", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  pass("return online renders without uncaught browser errors");
} catch (error) {
  failure = error.stack || String(error);
  console.error(failure);
  await page.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(resolve(artifacts, "results.json"), JSON.stringify({ base, checks, failure, errors, consoleErrors, responses }, null, 2));
  await browser.close();
}
