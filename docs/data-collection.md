# Data collection

The SDK captures browser events and sends them to your configured Probie receiver.
Importing it does not start collection. Calling `init` installs listeners and
instruments `fetch`, `XMLHttpRequest`, and the History API.

## Captured fields

| Data | Fields or behavior |
| --- | --- |
| Event context | Event ID, event type, timestamp, session ID, optional user ID |
| Navigation | Page URL, path, referrer, visible duration, and maximum scroll depth |
| Elements | Structural path containing tags, IDs, and up to three classes per node; role, name, type, test ID, and label hash |
| Interactions | Click coordinates and viewport dimensions; form and stuck-interface evidence |
| Errors | Error message, available stack trace, script filename, line, and column |
| Failed requests | URL, method, status, duration, and failure classification |
| Manual events | The payload supplied by your application |

The collector does not capture input values, keystroke contents, request or
response bodies, screenshots, or a DOM session recording. It reads element labels
to calculate a short hash and reads attributes to classify controls. That hash is
not a security boundary or an anonymization guarantee.

Error messages are truncated to 500 characters and stacks to 2,000 characters.
They are not otherwise redacted. URL paths and DOM attributes are also not
redacted. Keep personal data and credentials out of those fields and manual
payloads. The receiver also sees ordinary HTTP connection metadata.

## URLs

URL fragments are removed. With the default `captureQuery: false`, only these
query parameters are retained, with each value limited to 128 characters:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_term`
- `utm_content`
- `utm_id`

Parameter names are normalized to lowercase. Keep personal data out of campaign
values. With `captureQuery: true`, all query parameters are retained. This setting
does not redact URL paths or URL-like text embedded in an error message or stack.

## Browser storage

The SDK uses `sessionStorage`, with an in-memory fallback when storage is
unavailable. It does not create cookies or use `localStorage`.

| Key | Contents |
| --- | --- |
| `probie_sid` | Current session ID |
| `probie_sampled` | Sampling decision for rates below 1 |
| `probie_events_v1_<token hash>` | Pending event queue for the project token |

`reset()` clears identity and rotates the session ID. It does not delete pending
events or reset sampling. The browser's session-storage lifecycle determines how
long a persisted session and its pending events survive.

## Transport

Events are batched as JSON to `POST <apiBase>/api/widget/events`. The public widget
token is included in the body. Normal delivery uses `fetch` with
`credentials: "omit"`. Background and exit delivery can use `sendBeacon`, whose
credential behavior is controlled by the browser; it has no credentials option.

Allow your receiver origin in your Content Security Policy's `connect-src`.
For the default receiver this is `https://probie.dev`. A custom receiver must
handle CORS and the JSON preflight from your application's origin.

## Consent and collection controls

Your application controls whether and when to call `init`. Connect this to your
consent flow where applicable and describe collection in your privacy notice.

Version 0.1 has no runtime opt-out, teardown, per-event filter, or redaction hook.
Calling `reset`, setting a later `sampleRate: 0`, or unmounting a React component
does not stop an initialized collector. If the user withdraws consent, persist
their choice, reload the document, and skip `init` on the next load. Already queued
or in-flight events are not recalled. Applications that require immediate runtime
revocation should wait for a supported stop API before adopting this version.

The source in [collector.ts](../src/collector.ts) defines client-side collection.
This document does not describe server-side retention or deletion policies.
