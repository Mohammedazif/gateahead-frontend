import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const project = dirname(scripts);
const artifacts = resolve(process.env.BROWSER_ARTIFACTS || "/tmp/gateahead-browser-audit");
await mkdir(artifacts, { recursive: true });
const children = new Set();
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = true;
  for (const child of children) child.kill(signal);
});

const suites = [
  ["crossings", "browser-check.mjs"],
  ["journeys", "browser-journeys-check.mjs"],
  ["conditions", "browser-state-matrix.mjs"],
  ["gate-groups", "browser-gate-groups-check.mjs"],
];
const results = await Promise.all(suites.map(([name, script]) => new Promise((done) => {
  const folder = resolve(artifacts, name);
  const child = spawn(process.execPath, [resolve(scripts, script)], {
    cwd: project, stdio: "inherit", env: { ...process.env, BROWSER_ARTIFACTS: folder },
  });
  children.add(child);
  child.once("error", (error) => {
    children.delete(child);
    done({ name, passed: false, error: error.message, artifacts: folder });
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    done({ name, passed: code === 0 && !signal, code, signal, artifacts: folder });
  });
})));
await writeFile(resolve(artifacts, "results.json"), JSON.stringify({ results, interrupted }, null, 2));
console.log(`${results.filter((result) => result.passed).length}/${suites.length} browser suites passed; artifacts: ${artifacts}`);
if (interrupted || results.some((result) => !result.passed)) process.exitCode = 1;
