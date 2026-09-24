# Publishing a release

Releases are published from `ProbieAI/probie-web` to `@probie-dev/web` on npm.
Use the Probie Engineering GitHub identity for public commits and releases.

## Ship a version

1. Update from `main`, then run `npm version patch --no-git-tag-version`
   (or choose `minor` or an explicit prerelease version).
2. Add a dated `## X.Y.Z - YYYY-MM-DD` entry to `CHANGELOG.md`.
3. Commit the version, lockfile, changelog, and SDK changes. Push to `main`
   after review and wait for CI to pass.
4. Create a GitHub release with tag `vX.Y.Z` targeting that commit and publish it.
   Mark versions with a prerelease suffix as prereleases.

The Release workflow validates the version and changelog, tests the package and
Chromium/Firefox/WebKit behavior, and publishes the tested tarball through npm
trusted publishing. Stable versions use `latest`; prereleases use `next`.
It verifies the registry checksum and attaches the tarball and manifest to the
GitHub release. No npm token is stored in GitHub.

For a preview, run **Actions → Release → Run workflow** with a commit or tag.
Download the `npm-package` artifact to inspect or install the tarball. Manual
workflow runs never publish. Pushing a commit or tag alone also does not publish.

If a workflow fails because of configuration, fix the configuration and rerun it.
An already-published version with the identical checksum is safe to retry. If
contents differ, prepare a new version; never move a published release tag.

Hosted scripts on `probie.dev` are deployed separately from npm releases.
