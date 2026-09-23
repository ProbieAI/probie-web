# Probie with Open SaaS

Add the browser collector to the React application in your Open SaaS project.
The collector runs in the browser and captures errors and interaction signals.
For installation help, visit [probie.dev/install](https://probie.dev/install).

## Install

From the Open SaaS `app` directory:

```sh
npm install @probie-dev/web
```

## Add a browser component

Create `src/client/Probie.tsx`:

```tsx
import { useEffect } from "react";
import { init } from "@probie-dev/web";

export function Probie() {
  useEffect(() => {
    init({ token: "YOUR_WIDGET_TOKEN" });
  }, []);
  return null;
}
```

Copy the public widget token from your Probie project. Render `<Probie />` once in
your existing root component, typically `src/client/App.tsx`, alongside its
existing children. Keep your routing and providers in place.

If your application uses consent, initialize only after the consent choice allows
collection. See [collection controls](data-collection.md#consent-and-collection-controls).
For application-specific setup, consult the
[Open SaaS documentation](https://docs.opensaas.sh/).

## Verify collection

1. Open the app in a browser and navigate between two routes.
2. In developer tools, filter Network requests for `/api/widget/events`.
3. Wait for a periodic flush or call the SDK's `flush()` helper.
4. Confirm a successful response and check the project in Probie for new events.

Allow `https://probie.dev` in CSP `connect-src` if your app restricts network
connections. [Troubleshooting](troubleshooting.md) covers missing events.

## Connect the repository

Connect the application's repository through Probie to use the fix workflow.
Browser collection alone does not authorize repository access or open pull
requests. Validate the complete workflow on a test project before enabling it
for your team.
