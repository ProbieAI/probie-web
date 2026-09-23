import assert from "node:assert/strict";
import test from "node:test";
import { releaseInfo, registryDecision } from "../scripts/release.mjs";

function fixture(version = "0.1.0") {
  return {
    manifest: {
      name: "@probie-dev/web", version,
      repository: { url: "git+https://github.com/ProbieAI/probie-web.git" },
      publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
    },
    lock: { name: "@probie-dev/web", version, packages: { "": { version } } },
    changelog: `# Changelog\n\n## ${version} - 2026-09-23\n\nFirst release.\n`,
    tag: `v${version}`,
  };
}

test("stable releases use latest and prereleases use next", () => {
  assert.equal(releaseInfo(fixture()).dist_tag, "latest");
  assert.equal(releaseInfo({ ...fixture("0.2.0-beta.1"), prerelease: true }).dist_tag, "next");
});

test("release rejects a tag mismatch, stale lockfile, or missing release notes", () => {
  assert.throws(() => releaseInfo({ ...fixture(), tag: "v0.2.0" }), /tag must match/);
  const stale = fixture();
  stale.lock.packages[""].version = "0.0.1";
  assert.throws(() => releaseInfo(stale), /root version mismatch/);
  assert.throws(() => releaseInfo({ ...fixture(), changelog: "## Unreleased" }), /dated changelog/);
});

test("prerelease status must agree with the version", () => {
  assert.throws(() => releaseInfo(fixture("0.2.0-beta.1")), /prerelease setting/);
  assert.throws(() => releaseInfo({ ...fixture(), prerelease: true }), /prerelease setting/);
});

test("preview accepts unreleased notes but still checks package identity", () => {
  assert.equal(releaseInfo({ ...fixture(), preview: true, tag: undefined, changelog: "## Unreleased" }).version, "0.1.0");
  const wrong = fixture();
  wrong.manifest.repository.url = "git+https://github.com/other/project.git";
  assert.throws(() => releaseInfo({ ...wrong, preview: true }), /Repository must match/);
});

test("published versions are skipped only when their integrity matches", () => {
  assert.equal(registryDecision({ status: 0, stdout: '"sha512-same"' }, "sha512-same"), true);
  assert.throws(() => registryDecision({ status: 0, stdout: '"sha512-other"' }, "sha512-same"), /different contents/);
});

test("only a registry 404 means the version is available", () => {
  assert.equal(registryDecision({ status: 1, stdout: '{"error":{"code":"E404"}}' }, "sha512-same"), false);
  assert.throws(() => registryDecision({ status: 1, stdout: '{"error":{"code":"E401"}}' }, "sha512-same"), /lookup failed/);
  assert.throws(() => registryDecision({ status: 1, stdout: 'network error' }, "sha512-same"), /registry response/);
});
