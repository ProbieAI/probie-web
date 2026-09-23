# Versions and updates

## npm releases

Each npm release has a unique version. Published versions are never replaced.

During 0.x, patch releases preserve compatibility and minor releases may include
breaking changes. Check the [changelog](../CHANGELOG.md) for changes and migration
notes before upgrading. From 1.0 onward, breaking changes require a major version.

Stable releases use the `latest` channel. Prereleases use `next` and are intended
for testing. Bug fixes target the latest release; older 0.x releases do not have
a long-term support commitment.

## Pin your installed version

Once the npm package is available, install an exact version with:

```sh
npm install --save-exact @probie-dev/web
```

Commit `package.json` and your lockfile, and use `npm ci` for reproducible builds.
Your application keeps using the locked version until you update it.

Before deploying an upgrade, test initialization, event delivery, and any identity
or manual event calls your app uses. To roll back, restore the previous package
version and lockfile and redeploy your application.

## Hosted scripts

The hosted script URLs receive updates automatically:

- `https://probie.dev/assets/probie-widget-events.js`
- `https://probie.dev/assets/probie-widget.js`

Existing script installations continue to work without migrating to npm. These
URLs are not pinned to an npm version, and adding a version query parameter does
not pin the code. Use the npm package when you need control over upgrade timing.

See the [hosted script guide](hosted-script.md) for installation and configuration.
