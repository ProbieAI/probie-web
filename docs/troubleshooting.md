# Troubleshooting

## No events arrive

Check that `init` executes in the browser with your project's public widget token.
For a [hosted script](hosted-script.md), check that the script loads successfully
with the correct `data-token`; it initializes automatically without an `init` call.
The SDK emits an initial page view and normally flushes within 12 seconds.
`flush()` requests an earlier delivery but does not wait for its completion.

Inspect `/api/widget/events` in browser developer tools:

| Observation | Check |
| --- | --- |
| No request | Initialization, sampling, consent choice, and script blockers |
| CSP error | Add the receiver origin to your existing `connect-src` directive |
| CORS error | Receiver origin and JSON preflight support |
| 4xx other than 429 | Token and request configuration; reload after correcting them |
| 429 or 5xx | Receiver availability and rate limits; the SDK retries transient failures |
| 2xx | Correct Probie project and service-side processing |

## An initialization change has no effect

The first successful `init` call wins. Later calls do not replace the token,
receiver, sampling rate, or query settings. Reload the document after changing
configuration. Sampling decisions below 1 can persist in session storage across
reloads. Use a fresh browser session when testing a new sampling configuration.

## Duplicate events

Check for multiple bundled copies of the SDK or simultaneous installation of the
hosted collector and npm package. Within a single module instance, repeated
initialization is idempotent. Retries can deliver the same event ID more than once;
a custom receiver must deduplicate by event ID.

## The import works on the server but initialization fails

Importing is SSR-safe. Run `init` in a browser entry point or React effect, not
inside a server component or during server rendering.

## Logout did not stop collection

`reset` removes identity and rotates the session. It does not disable telemetry.
See [consent and collection controls](data-collection.md#consent-and-collection-controls).

## Report a problem

Include the SDK version, browser, framework, expected behavior, and a minimal
reproduction. Remove user data, tokens, and sensitive request bodies from logs and
screenshots. Report vulnerabilities through [SECURITY.md](../SECURITY.md).
