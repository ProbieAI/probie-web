import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@probie-dev/web";
const REPOSITORY = "git+https://github.com/ProbieAI/probie-web.git";
const REGISTRY = "https://registry.npmjs.org/";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*))?$/;

export function releaseInfo({ manifest, lock, changelog, tag, preview = false, prerelease = false }) {
  assert.equal(manifest.name, PACKAGE, "Unexpected npm package name");
  assert.match(manifest.version, VERSION, "Expected a release version without build metadata");
  assert.equal(lock.name, PACKAGE, "Lockfile package name mismatch");
  assert.equal(lock.version, manifest.version, "Lockfile version mismatch");
  assert.equal(lock.packages?.[""]?.version, manifest.version, "Lockfile root version mismatch");
  assert.equal(manifest.repository?.url, REPOSITORY, "Repository must match the npm trusted publisher");
  assert.equal(manifest.publishConfig?.access, "public", "Expected a public npm package");
  assert.equal(manifest.publishConfig?.registry, REGISTRY, "Unexpected publish registry");
  const isPrerelease = manifest.version.includes("-");
  if (!preview) {
    assert.equal(tag, `v${manifest.version}`, "Release tag must match package.json");
    assert.equal(prerelease, isPrerelease, "GitHub prerelease setting must match the version suffix");
    const heading = new RegExp(`^## ${manifest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} - \\d{4}-\\d{2}-\\d{2}\\r?$`, "m");
    assert.match(changelog, heading, "Add a dated changelog entry for this version before release");
  }
  return {
    version: manifest.version,
    dist_tag: isPrerelease ? "next" : "latest",
    tarball: `probie-dev-web-${manifest.version}.tgz`,
  };
}

export function registryDecision({ status, stdout }, expectedIntegrity) {
  let response;
  try { response = JSON.parse(stdout); } catch { throw new Error("Could not read the npm registry response"); }
  if (status === 0) {
    assert.equal(response, expectedIntegrity, "This npm version exists with different contents. Bump the version; never overwrite a release.");
    return true;
  }
  assert.equal(response?.error?.code, "E404", `Registry lookup failed: ${response?.error?.code || "unknown error"}`);
  return false;
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

function main() {
  if (process.argv[2] === "registry") {
    const [pack] = JSON.parse(readFileSync("release/manifest.json", "utf8"));
    assert.equal(pack.name, PACKAGE);
    assert.match(pack.version, VERSION);
    assert.equal(pack.filename, `probie-dev-web-${pack.version}.tgz`);
    const bytes = readFileSync(`release/${pack.filename}`);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    assert.equal(integrity, pack.integrity, "Release artifact checksum mismatch");
    const result = spawnSync("npm", ["view", `${PACKAGE}@${pack.version}`, "dist.integrity", "--json", `--registry=${REGISTRY}`], { encoding: "utf8" });
    if (result.error) throw result.error;
    const exists = registryDecision(result, integrity);
    if (process.argv.includes("--require-published")) assert.ok(exists, "Published version is not visible in npm yet");
    output({ already_published: exists });
    return;
  }
  output(releaseInfo({
    manifest: JSON.parse(readFileSync("package.json", "utf8")),
    lock: JSON.parse(readFileSync("package-lock.json", "utf8")),
    changelog: readFileSync("CHANGELOG.md", "utf8"),
    preview: process.argv.includes("--preview"),
    tag: process.env.RELEASE_TAG,
    prerelease: process.env.RELEASE_PRERELEASE === "true",
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
