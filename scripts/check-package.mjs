import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicFiles = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).files;
const scratch = mkdtempSync(join(tmpdir(), "probie-web-package-"));
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const [pack] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch]));
  const files = pack.files.map(({ path }) => path);
  // Keep publication opt-in per file: a new doc, fixture, or generated asset
  // must not enter the package merely because it shares a directory.
  for (const file of publicFiles) {
    assert.ok(!/[?*\[\]{}!]/.test(file), `Package entries must be exact file paths: ${file}`);
    assert.ok(!file.startsWith("/") && !file.split("/").includes(".."), `Invalid package path: ${file}`);
  }
  assert.deepEqual([...files].sort(), [...publicFiles, "package.json"].sort(), "Tarball differs from the explicit public file list");
  for (const required of ["dist/index.js", "dist/index.cjs", "dist/index.d.ts", "src/collector.ts", "src/overlay-evidence.ts", "LICENSE", "README.md"]) {
    assert.ok(files.includes(required), `Missing from tarball: ${required}`);
  }
  for (const file of files) {
    assert.match(file, /^(dist\/|src\/|docs\/|examples\/|README\.md$|CHANGELOG\.md$|CONTRIBUTING\.md$|SECURITY\.md$|LICENSE$|package\.json$)/, `Unexpected package file: ${file}`);
    assert.ok(!/(^|\/)(\.env|node_modules|\.git)(\/|$|\.)/.test(file), `Private file in tarball: ${file}`);
  }
  const consumer = join(scratch, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(scratch, pack.filename)], consumer);
  const assertion = `if (sdk.getClient() !== null || typeof sdk.init !== 'function') throw new Error('Invalid SDK exports'); sdk.flush(); sdk.reset(); sdk.identify('test');`;
  run(process.execPath, ["--input-type=module", "-e", `import * as sdk from '@probie-dev/web'; ${assertion}`], consumer);
  run(process.execPath, ["-e", `const sdk = require('@probie-dev/web'); ${assertion}`], consumer);
  for (const ext of ["mts", "cts"]) {
    writeFileSync(join(consumer, `consumer.${ext}`), `import { init, type ProbieConfig, type EventType } from '@probie-dev/web';
const config: ProbieConfig = { token: 'test' };
const event: EventType = 'js_error';
init(config).track(event, { message: 'test' });
`);
  }
  run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2020", "consumer.mts", "consumer.cts"], consumer);
  const manifest = JSON.parse(readFileSync(join(consumer, "node_modules/@probie-dev/web/package.json"), "utf8"));
  assert.equal(Object.keys(manifest.dependencies || {}).length, 0);
  console.log(`Package verified: ${files.length} files, ESM + CommonJS + TypeScript consumers, zero runtime dependencies.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
