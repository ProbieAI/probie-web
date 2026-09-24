# Changelog

## 0.1.1 - 2026-09-24

### Fixed

- Release automation now skips the npm dry run when an identical version is
  already published and waits for registry propagation after publication.
- Published through GitHub Actions with npm provenance. Browser runtime behavior
  is unchanged from 0.1.0.

## 0.1.0 - 2026-09-24

### Added

- Standalone source distribution for `@probie-dev/web`.
- Automatic JavaScript error, failed-request, navigation, click, form-friction,
  and stuck-interface capture.
- Explicit initialization, session identity, manual events, and flush helpers.
- Session-scoped buffering, transient delivery retries, and stable event IDs.
- ESM and CommonJS builds, TypeScript declarations, and source maps.
- Framework guides, collection reference, local event inspector, and package checks.
