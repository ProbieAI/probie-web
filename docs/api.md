# API reference

```ts
import { init, getClient, identify, reset, track, flush } from "@probie-dev/web";
import type { ProbieClient, ProbieConfig, EventType } from "@probie-dev/web";
```

## `init(config): ProbieClient`

Starts automatic collection and returns the active client. The first successful
call wins. Later calls return the same client and ignore their configuration.
Call it in the browser after any consent decision your app requires.

```ts
const client = init({
  token: "YOUR_WIDGET_TOKEN",
  sampleRate: 0.25,
  captureQuery: false,
});
```

| Option | Default | Behavior |
| --- | --- | --- |
| `token: string` | Required | Public widget token that routes events to your Probie project |
| `apiBase?: string` | `https://probie.dev` | Receiver origin; any path on this URL is discarded |
| `sampleRate?: number` | `1` | Fraction of sessions to capture, clamped to 0 through 1 |
| `captureQuery?: boolean` | `false` | Retain all URL query parameters when true; otherwise retain only supported UTM parameters |

`init` throws outside a browser, for an empty token, or for an invalid `apiBase`
URL. Validate configuration at setup time. An import alone is safe in an SSR build.

Sampling is decided at initialization. For rates below 1, the decision is stored
in `sessionStorage` and reused on reloads. Rate 1 always enables capture. A stored
sampling decision can therefore outlive a configuration change. Sampling is not
an opt-out API and does not remove installed listeners.

## `getClient(): ProbieClient | null`

Returns the active client, or `null` before initialization. The client exposes
`identify`, `reset`, `track`, and `flush` with the same signatures as the module
functions below. Module helpers do nothing before initialization.

## `identify(userId: string | null): void`

Associates future events with an application user ID. Use an opaque identifier,
not an email address. Identity is held in memory and must be set again after a
full reload. `identify(null)` clears identity without rotating the session.
Queued events retain the identity they had when captured.

## `reset(): void`

Clears user identity and creates a new session ID. Call on logout or an account
switch. It does not clear queued events, change the sampling decision, stop
collection, or remove instrumentation.

## `track(type, payload?, element?): void`

Manually emits a supported event. Payloads must be JSON-serializable. The SDK does
not redact arbitrary payload fields. If supplied, `element` contributes structural
metadata and a hashed label.

```ts
track("js_error", { message: "Preview could not be rendered" });
```

`EventType` is the following closed set:

```ts
type EventType =
  | "pageview" | "page_leave"
  | "click" | "rage_click" | "dead_click"
  | "form_submit" | "form_abandon" | "form_retry"
  | "fetch_error" | "js_error"
  | "stuck_overlay" | "stuck_loading" | "scroll_lock";
```

Automatic capture already emits these events. Emit manually only when you need to
supply a signal the automatic collector cannot observe. Arbitrary custom event
names are not part of this API.

## `flush(): void`

Requests delivery of buffered events. It returns immediately, not a promise or a
delivery receipt. Calls during an active request do not start another concurrent
fetch. Normal batches flush every 12 seconds or when the queue reaches 50 events.

Each request contains at most 100 events. The buffer holds at most 200 events and
keeps the oldest pending events when full. Network failures, HTTP 429, and HTTP
5xx responses receive up to four immediate retries with backoff; later flushes can
retry retained events. Other unsuccessful responses block delivery until reload.

Background and page-exit flushes can use `sendBeacon`. A successful beacon enqueue
is not a server acknowledgement, so the queue is retained for later delivery.
Event IDs remain stable across retries. Delivery is best effort, not guaranteed.
