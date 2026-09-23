# Install with a hosted script

**We can install Probie for you.** Get started at
[probie.dev/install](https://probie.dev/install), or follow the manual setup below.

You can use Probie on a website without npm or a JavaScript build step. Create a
project in [Probie](https://probie.dev), copy its public widget token from the
integration page, and choose one snippet below. Replace `YOUR_WIDGET_TOKEN` with
that token and place the snippet before the closing `</body>` tag.

## Automatic capture without visible UI

```html
<script
  src="https://probie.dev/assets/probie-widget-events.js"
  data-token="YOUR_WIDGET_TOKEN"
></script>
```

The script starts the browser collector automatically. It captures errors, failed
requests, and interaction signals without adding a button or dialog. You do not
need to call `init`.

## Automatic capture with a feedback button

```html
<script
  src="https://probie.dev/assets/probie-widget.js"
  data-token="YOUR_WIDGET_TOKEN"
></script>
```

This adds the feedback widget and automatically loads the collector. Do not also
include the standalone collector snippet. The integration page in Probie has
appearance controls for the feedback widget.

## Configuration

Both scripts accept these HTML attributes:

| Attribute | Default | Purpose |
| --- | --- | --- |
| `data-token` | Required | Your project's public widget token |
| `data-sample` | `1` | Fraction of sessions to capture, from `0` to `1` |
| `data-capture-query` | `0` | Set to `1` to retain all URL query parameters; otherwise only supported UTM parameters are retained |

For example, to capture 25% of sessions:

```html
<script
  src="https://probie.dev/assets/probie-widget-events.js"
  data-token="YOUR_WIDGET_TOKEN"
  data-sample="0.25"
></script>
```

The feedback widget also accepts `data-events="0"` to disable its automatic
collector loading while keeping the feedback button. This attribute applies to
`probie-widget.js`, not the standalone collector. It does not stop a collector
that has already loaded.

## Hosted script or npm?

| Hosted script | npm package |
| --- | --- |
| Paste a script into your HTML or site builder | Import the SDK into your application |
| Starts automatically when loaded | Starts when you call `init` |
| Served and updated by Probie at the hosted URL | Version controlled through your package manager and lockfile |
| Optional feedback widget | Collector only |

These are alternative installation methods for the browser collector. Existing
script installations do not need to migrate when the npm package is published.
The hosted scripts and npm releases can update on different schedules.
Hosted URLs are not version-pinned. See the [versioning policy](versioning.md)
when choosing how to manage upgrades.

Use only one collector per page. Loading the hosted collector alongside an
initialized npm SDK can duplicate instrumentation and events. To use the feedback
button with the npm collector, set `data-events="0"` on the feedback widget and
initialize the npm SDK once.

## Consent and delivery

If your app uses a consent choice, insert the script only after that choice
permits collection. The script starts collection as soon as it loads; there is
no runtime stop API. See [data collection](data-collection.md).

If your site uses a Content Security Policy, allow `https://probie.dev` in the
applicable `script-src` (or `script-src-elem`) and `connect-src` directives. Keep
your existing policy and add the required origin.

To check delivery, inspect requests to `/api/widget/events` in browser developer
tools. Normal event batches flush within about 12 seconds. See
[troubleshooting](troubleshooting.md) if events do not arrive.
