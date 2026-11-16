import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? findTests(join(directory, entry.name))
    : entry.name.endsWith(".test.ts") ? [join(directory, entry.name)] : []));
  return nested.flat();
}

const output = await mkdtemp(join(tmpdir(), "gateahead-tests-"));
try {
  const files = await findTests("src");
  await build({ entryPoints: files, outbase: "src", outdir: output, outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", format: "esm", logLevel: "warning",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  for (const file of files) {
    const compiled = join(output, relative("src", file).replace(/\.ts$/, ".mjs"));
    const result = spawnSync(process.execPath, [compiled], { stdio: "inherit" });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
} finally {
  await rm(output, { recursive: true, force: true });
}
