import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

test("ESM entry imports without a browser global", async () => {
  const sdk = await import("../dist/index.js");
  assert.deepEqual(
    Object.keys(sdk).sort(),
    ["flush", "getClient", "identify", "init", "reset", "track"],
  );
  assert.equal(sdk.getClient(), null);
  assert.throws(() => sdk.init({ token: "test" }), /must run in a browser/);
});

test("CommonJS entry exposes the same API", () => {
  const require = createRequire(import.meta.url);
  const sdk = require("../dist/index.cjs");
  assert.deepEqual(
    Object.keys(sdk).sort(),
    ["flush", "getClient", "identify", "init", "reset", "track"],
  );
});

test("published declarations expose config and client types", async () => {
  const declarations = await readFile(new URL("../dist/index.d.ts", import.meta.url), "utf8");
  for (const marker of ["interface ProbieConfig", "interface ProbieClient", "type EventType", "function init"]) {
    assert.match(declarations, new RegExp(marker));
  }
});

test("source maps include the collector source for auditability", async () => {
  const map = JSON.parse(await readFile(new URL("../dist/index.js.map", import.meta.url), "utf8"));
  assert.ok(map.sources.some((source) => source.endsWith("src/collector.ts")));
  assert.ok(map.sourcesContent.some((source) => source.includes("Probie passive behavioral collector")));
});
