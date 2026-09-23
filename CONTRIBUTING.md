# Contribute to Probie for JavaScript

Bug reports, documentation improvements, and focused fixes are welcome. For a new
API or a change to automatic collection, open an issue first so maintainers can
discuss its behavior and data implications.

## Local setup

Use Node 22 or 24 and npm. This repository builds independently; no Probie backend,
database, or account is needed for tests.

```sh
npm ci
npm run check
```

For real-browser tests:

```sh
npx playwright install chromium firefox webkit
npm run test:browser
```

For an interactive example:

```sh
npm run demo
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Public SDK functions and types |
| `src/collector.ts` | Browser instrumentation, queue, identity, and transport |
| `src/overlay-evidence.ts` | Structural signals for overlay detection |
| `test/` | Package contracts and behavioral regression tests |
| `test/browser/` | Real-browser collection and initialization checks |
| `examples/browser/` | Local application with an event inspector |
| `docs/` | API, integration, and data collection documentation |
| `scripts/` | Local demo server and package validation |

## Before a pull request

Describe the concrete bug or behavior change. Include a small reproduction and a
regression test when behavior changes. Keep unrelated formatting out of the diff.
Run `npm run check`; run browser tests for browser instrumentation changes.

Update the relevant docs and the Unreleased changelog for public API or collection
changes. Avoid real project tokens, customer data, or production endpoints in
fixtures. Tests use a local receiver and fake identifiers.

The package check installs the actual npm tarball into an isolated temporary
consumer, checks both module formats and TypeScript imports, and verifies the
package contents. This catches files that are available in a checkout but absent
from a published package.

## Review and conduct

Keep discussions respectful and focused on the code. Explain tradeoffs and provide
reproductions where possible. Maintainers review contributions before merging.
Contributions to this SDK are made under its [MIT license](LICENSE).

Report security issues privately using [SECURITY.md](SECURITY.md).
