# Local browser example

This example uses the built SDK with a local HTTP receiver. It does not need a
Probie account or send events to the hosted service.

From the repository root:

```sh
npm ci
npm run demo
```

Open `http://127.0.0.1:4173/examples/browser/`. Trigger an error, a failed request,
or a route change, then press **Flush events**. The inspector shows the actual
JSON received from the collector. Identity and reset controls demonstrate how
future events change after login and logout.

The receiver deduplicates by event ID and keeps up to 200 events in memory.
Stopping the server clears its memory. Browser session storage may retain pending
events. Use a fresh tab for a clean session.

The server binds to loopback and is a development example, not a production ingest
service. Set `PORT` if port 4173 is already in use.

For production setup, use the [framework guides](../docs/frameworks.md) and your
project's public token with the default Probie receiver.
