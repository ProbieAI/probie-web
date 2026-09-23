# Framework setup

Install `@probie-dev/web` and get a public widget token from your Probie project.
The token is intended for browser code. Never substitute a server credential.

All examples initialize one collector per loaded module instance. Use one copy of
the package and one initialization path. See [data collection](data-collection.md)
for consent and lifecycle limitations.

## JavaScript and Vite

In your browser entry point:

```ts
import { init } from "@probie-dev/web";

const token = import.meta.env.VITE_PROBIE_TOKEN;
if (token) init({ token });
```

Set `VITE_PROBIE_TOKEN` in your client environment and restart your dev server.
For plain JavaScript, pass the public token directly instead of `import.meta.env`.

## React

Render a component once near your application root:

```tsx
import { useEffect } from "react";
import { init } from "@probie-dev/web";

export function Probie({ token }: { token: string }) {
  useEffect(() => {
    if (token) init({ token });
  }, [token]);
  return null;
}
```

Render `<Probie token="YOUR_WIDGET_TOKEN" />` when collection is permitted. React
Strict Mode's repeated effects return the same collector from this module.
Changing the token after initialization does not reconfigure it. Unmounting the
component does not stop capture.

## Next.js App Router

Create a client component, for example `app/probie.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { init } from "@probie-dev/web";

export function Probie() {
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PROBIE_TOKEN;
    if (token) init({ token });
  }, []);
  return null;
}
```

Render `<Probie />` inside the body of your root layout. Set
`NEXT_PUBLIC_PROBIE_TOKEN` in your build environment. Next.js exposes variables
with this prefix to browser code. If consent is required, render the component
only after permission to collect has been established.

The SDK captures the browser portion of your app. It does not instrument server
components, route handlers, or server actions.

## Identity

After login, call `identify(String(user.id))` with an opaque application ID. After
logout, call `reset()`. Repeat identification after full document reloads.

Path changes through `pushState`, `replaceState`, and `popstate` are captured
automatically. Query-only and hash-only changes do not generate a new page view.
