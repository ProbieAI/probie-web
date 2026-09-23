# Compatibility and limitations

## Package formats

The package provides ESM and CommonJS entry points, TypeScript declarations, source
maps, and the original TypeScript source. It has no runtime npm dependencies.
Importing either entry point in Node is supported for SSR builds, but `init` must
run in a browser. Use Node 22 or 24 for SDK development.

## Browser requirements

The JavaScript bundle targets ES2018. Collection needs standard browser APIs,
including `URL`, `URLSearchParams`, promises, `fetch`, History, and
`XMLHttpRequest`. Storage has an in-memory fallback. `sendBeacon` is optional;
fetch is the fallback transport. No polyfills are included.

Automated browser smoke tests run against Chromium, Firefox, and WebKit in CI.
These tests are not a guarantee for every browser version, embedded webview, or
third-party instrumentation combination. Internet Explorer is not a target.

## Current boundaries

- Collection covers browser events. There is no server-side SDK in this package.
- Stuck-interface and click-friction detection are heuristics, not proof of a bug.
- Automatic page views follow pathname changes. Hash or query-only navigation is
  not counted as a new view.
- One module instance has one active collector. Multiple bundled copies can
  install duplicate instrumentation; deduplicate the package and avoid loading
  both the hosted collector and the npm SDK.
- There is no teardown, runtime opt-out, redaction hook, or per-collector toggle.
- `track` accepts the documented event names, not arbitrary custom event names.
- This package does not include session replay, screenshots, source-map upload,
  source-map symbolication, or a source-code fix engine.
- Event delivery is best effort. Queue limits, browser shutdown, network failure,
  CSP, blockers, and storage restrictions can cause missing events.

## Version policy

This is a 0.x SDK. Patch releases preserve compatibility; minor versions may
include breaking changes with migration notes. Review the changelog before
upgrading. Bug fixes are developed against the latest release. No long-term
support window is promised for earlier 0.x versions. See the
[versioning policy](versioning.md) for pinned installs and hosted script updates.
