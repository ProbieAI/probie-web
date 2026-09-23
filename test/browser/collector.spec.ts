import { expect, test, type Page } from "@playwright/test";

type CapturedEvent = {
  type: string;
  url: string;
  user_id: string | null;
  session_id: string;
  payload: Record<string, unknown>;
};

async function capture(page: Page) {
  const events: CapturedEvent[] = [];
  await page.route("**/api/widget/events", async (route) => {
    events.push(...route.request().postDataJSON().events);
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  return events;
}

async function flush(page: Page) {
  await page.evaluate(async () => {
    const sdk = await import("/dist/index.js");
    sdk.flush();
  });
}

test("captures a page view and strips sensitive query parameters", async ({ page }) => {
  const events = await capture(page);
  await page.goto("/examples/browser/?secret=do-not-send&utm_source=demo#private");
  await flush(page);
  await expect.poll(() => events.filter((event) => event.type === "pageview").length).toBe(1);
  const url = new URL(events[0].url);
  expect(url.search).toBe("?utm_source=demo");
  expect(url.hash).toBe("");
});

test("captures uncaught errors and failed fetch requests", async ({ page }) => {
  const events = await capture(page);
  await page.goto("/examples/browser/");
  await page.getByRole("button", { name: "Trigger JS error" }).click();
  const response = page.waitForResponse("**/demo/failure");
  await page.getByRole("button", { name: "Fail a request" }).click();
  await response;
  await flush(page);
  await expect.poll(() => events.some((event) => event.type === "js_error")).toBe(true);
  await expect.poll(() => events.some((event) => event.type === "fetch_error" && event.payload.status === 503)).toBe(true);
});

test("initialization is idempotent and keeps the first client", async ({ page }) => {
  const events = await capture(page);
  await page.goto("/examples/browser/");
  const sameClient = await page.evaluate(async () => {
    const sdk = await import("/dist/index.js");
    return sdk.init({ token: "ignored", apiBase: "https://example.invalid" }) === sdk.getClient();
  });
  expect(sameClient).toBe(true);
  await flush(page);
  await expect.poll(() => events.filter((event) => event.type === "pageview").length).toBe(1);
});

test("identity applies to future events and reset rotates the session", async ({ page }) => {
  const events = await capture(page);
  await page.goto("/examples/browser/");
  await page.evaluate(async () => {
    const sdk = await import("/dist/index.js");
    sdk.identify("test_user");
    sdk.track("js_error", { message: "before reset" });
    sdk.reset();
    sdk.track("js_error", { message: "after reset" });
    sdk.flush();
  });
  await expect.poll(() => events.filter((event) => event.type === "js_error").length).toBe(2);
  const [before, after] = events.filter((event) => event.type === "js_error");
  expect(before.user_id).toBe("test_user");
  expect(after.user_id).toBeNull();
  expect(before.session_id).not.toBe(after.session_id);
});

test("captures pathname changes without duplicating query-only navigation", async ({ page }) => {
  const events = await capture(page);
  await page.goto("/examples/browser/");
  await page.evaluate(() => {
    history.pushState({}, "", "/next");
    history.pushState({}, "", "/next?view=details");
  });
  await flush(page);
  await expect.poll(() => events.filter((event) => event.type === "pageview").length).toBe(2);
});

test("importing the SDK does not start collection", async ({ page }) => {
  const events = await capture(page);
  await page.route("**/blank", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Import test</title>" }));
  await page.goto("/blank");
  const result = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    const sdk = await import("/dist/index.js");
    sdk.flush();
    return { client: sdk.getClient(), untouched: originalFetch === window.fetch, storage: sessionStorage.length };
  });
  expect(result).toEqual({ client: null, untouched: true, storage: 0 });
  expect(events).toHaveLength(0);
});
