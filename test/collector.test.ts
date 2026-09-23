import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const WIDGET_SRC = readFileSync(new URL('../dist/index.cjs', import.meta.url), 'utf8');

interface CapturedEvent {
  event_id: string;
  type: string;
  url: string;
  route: string;
  referrer: string;
  session_id: string;
  payload: {
    duration_ms?: number;
    scroll_depth?: number;
    status?: number;
    failure_kind?: string;
    error_name?: string;
  };
}

type Listener = (ev?: unknown) => void;

interface Harness {
  fireDoc: (type: string) => void;
  fireWin: (type: string) => void;
  setVisibility: (v: string) => void;
  setScrollY: (y: number) => void;
  setScrollHeight: (h: number) => void;
  pushState: (path: string) => void;
  request: (input: string, init?: RequestInit) => Promise<unknown>;
  createXhr: () => XMLHttpRequest & { fail: (kind: 'error' | 'timeout') => void };
  events: () => Promise<CapturedEvent[]>;
  deliveries: () => Promise<CapturedEvent[][]>;
}

function boot(
  opts: {
    visibility?: string;
    href?: string;
    referrer?: string;
    fetchPlan?: Array<number | 'reject'>;
    storage?: Map<string, string>;
    appFetch?: (input: unknown, init?: RequestInit) => Promise<unknown>;
    online?: boolean;
  } = {},
): Harness {
  const state = {
    visibility: opts.visibility ?? 'visible',
    href: opts.href ?? 'http://app.test/',
    scrollY: 0,
    scrollHeight: 4000,
  };
  const docListeners = new Map<string, Listener[]>();
  const winListeners = new Map<string, Listener[]>();
  const bodies: Array<string | Blob> = [];

  const on = (map: Map<string, Listener[]>) => (type: string, fn: Listener) => {
    map.set(type, [...(map.get(type) ?? []), fn]);
  };
  const fire = (map: Map<string, Listener[]>) => (type: string) => {
    for (const fn of map.get(type) ?? []) fn({});
  };

  const documentStub = {
    currentScript: {
      src: 'http://app.test/assets/probie-widget-events.js',
      getAttribute: (name: string) => (name === 'data-token' ? 'pb_test_token' : null),
    },
    addEventListener: on(docListeners),
    get visibilityState() {
      return state.visibility;
    },
    referrer: opts.referrer ?? '',
    documentElement: {
      get scrollHeight() {
        return state.scrollHeight;
      },
      get scrollTop() {
        return state.scrollY;
      },
      clientHeight: 800,
    },
    body: {
      get scrollHeight() {
        return state.scrollHeight;
      },
    },
  };

  const windowStub = {
    addEventListener: on(winListeners),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    get innerHeight() {
      return 800;
    },
    get pageYOffset() {
      return state.scrollY;
    },
    fetch: opts.appFetch ?? (() => Promise.resolve({ status: 200 })),
  };

  const historyStub: {
    pushState: (s: unknown, t: string, url: string) => void;
    replaceState: (s: unknown, t: string, url: string) => void;
  } = {
    pushState: (_s, _t, url) => {
      state.href = new URL(url, state.href).toString();
    },
    replaceState: (_s, _t, url) => {
      state.href = new URL(url, state.href).toString();
    },
  };

  const storage = opts.storage ?? new Map<string, string>();
  const fetchPlan = (opts.fetchPlan ?? []).slice();

  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('location', {
    get href() {
      return state.href;
    },
  });
  vi.stubGlobal('history', historyStub);
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal('navigator', {
    onLine: opts.online ?? true,
    sendBeacon: (_url: string, blob: Blob) => {
      bodies.push(blob);
      return true;
    },
  });
  vi.stubGlobal(
    'fetch',
    (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      const result = fetchPlan.shift() ?? 200;
      return result === 'reject' ? Promise.reject(new Error('network unavailable')) : Promise.resolve({ status: result });
    },
  );
  class XhrStub {
    status = 0;
    private listeners = new Map<string, Array<{ fn: Listener; once: boolean }>>();

    open() {}
    send() {}

    addEventListener(type: string, fn: Listener, options?: { once?: boolean }) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn, once: options?.once === true }]);
    }

    private fire(type: string) {
      const listeners = this.listeners.get(type) ?? [];
      for (const { fn } of listeners) fn({});
      this.listeners.set(
        type,
        listeners.filter(({ once }) => !once),
      );
    }

    abort() {
      this.fire('abort');
      this.fire('loadend');
    }

    fail(kind: 'error' | 'timeout') {
      this.fire(kind);
      this.fire('loadend');
    }
  }
  vi.stubGlobal('XMLHttpRequest', XhrStub);

  const module = { exports: {} as { init?: (config: Record<string, unknown>) => unknown } };
  runInNewContext(WIDGET_SRC, {
    module, exports: module.exports, window, document, location, history,
    sessionStorage, navigator, fetch, XMLHttpRequest, URL, URLSearchParams,
    Blob, crypto, Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  module.exports.init!({ token: 'pb_test_token', apiBase: 'http://app.test' });

  return {
    fireDoc: fire(docListeners),
    fireWin: fire(winListeners),
    setVisibility: (v: string) => {
      state.visibility = v;
    },
    setScrollY: (y: number) => {
      state.scrollY = y;
    },
    setScrollHeight: (h: number) => {
      state.scrollHeight = h;
    },
    pushState: (path: string) => historyStub.pushState({}, '', path),
    request: (input: string, init?: RequestInit) => windowStub.fetch(input, init),
    createXhr: () => new XhrStub() as XMLHttpRequest & { fail: (kind: 'error' | 'timeout') => void },
    events: async () => {
      const out: CapturedEvent[] = [];
      const seen = new Set<string>();
      for (const b of bodies) {
        const text = typeof b === 'string' ? b : await b.text();
        for (const event of (JSON.parse(text) as { events: CapturedEvent[] }).events) {
          if (seen.has(event.event_id)) continue;
          seen.add(event.event_id);
          out.push(event);
        }
      }
      return out;
    },
    deliveries: async () => {
      const out: CapturedEvent[][] = [];
      for (const b of bodies) {
        const text = typeof b === 'string' ? b : await b.text();
        out.push((JSON.parse(text) as { events: CapturedEvent[] }).events);
      }
      return out;
    },
  };
}

const leaves = (events: CapturedEvent[]) => events.filter((e) => e.type === 'page_leave');

describe('widget dwell / page_leave (built bundle)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function bootWithTimers(opts: { visibility?: string } = {}): Harness {
    vi.useFakeTimers();
    return boot(opts);
  }

  it('emits page_leave with visible dwell and max scroll depth on SPA route change', async () => {
    const h = bootWithTimers();
    vi.advanceTimersByTime(5000);
    h.setScrollY(1200); // (1200 + 800) / 4000 = 50%
    h.fireWin('scroll');
    vi.advanceTimersByTime(2000);
    h.pushState('/second');
    h.fireWin('pagehide'); // beacon-flush the buffer

    const events = await h.events();
    expect(events.map((e) => e.type)).toEqual(['pageview', 'page_leave', 'pageview']);
    const [leave] = leaves(events);
    expect(leave.payload.duration_ms).toBe(7000);
    expect(leave.payload.scroll_depth).toBe(50);
    // pinned to the page being LEFT, not the new location
    expect(leave.route).toBe('/');
    expect(leave.url).toBe('http://app.test/');
  });

  it('does not inherit the old page depth after an SPA route change', async () => {
    const h = bootWithTimers();
    // Short first page, scrolled to the bottom: (200 + 800) / 1000 = 100%.
    h.setScrollHeight(1000);
    vi.advanceTimersByTime(3000);
    h.setScrollY(200);
    h.fireWin('scroll');
    // Route change fires BEFORE the new page renders — the DOM under the
    // collector is still the old short page here.
    h.pushState('/second');
    // Now the SPA renders the new, tall page and scrolls back to top.
    h.setScrollHeight(4000);
    h.setScrollY(0);
    vi.advanceTimersByTime(5000);
    h.fireWin('pagehide');

    const l = leaves(await h.events());
    expect(l.map((e) => e.route)).toEqual(['/', '/second']);
    expect(l[0].payload.scroll_depth).toBe(100);
    // The new view's depth is its own viewport fraction, (0 + 800) / 4000,
    // not the 100% the old page's DOM would have measured at reset time.
    expect(l[1].payload.scroll_depth).toBe(20);
  });

  it('reports viewport depth for a view the user saw but never scrolled', async () => {
    const h = bootWithTimers();
    vi.advanceTimersByTime(4000);
    h.fireWin('pagehide');

    const l = leaves(await h.events());
    expect(l).toHaveLength(1);
    // Measured at emit time against this view's DOM: (0 + 800) / 4000.
    expect(l[0].payload.scroll_depth).toBe(20);
  });

  it('sums incrementally across hidden/visible flips and never counts hidden time', async () => {
    const h = bootWithTimers();
    vi.advanceTimersByTime(3000);
    h.setVisibility('hidden');
    h.fireDoc('visibilitychange'); // emits 3000ms and pauses the clock
    vi.advanceTimersByTime(60_000); // backgrounded: must not count
    h.setVisibility('visible');
    h.fireDoc('visibilitychange');
    vi.advanceTimersByTime(4000);
    h.fireWin('pagehide'); // emits the remaining 4000ms

    const l = leaves(await h.events());
    expect(l.map((e) => e.payload.duration_ms)).toEqual([3000, 4000]);
    expect(l.every((e) => e.route === '/')).toBe(true);
  });

  it('hidden-at-init tab accrues nothing until it becomes visible', async () => {
    const h = bootWithTimers({ visibility: 'hidden' });
    vi.advanceTimersByTime(8000); // background prefetch/preview time
    h.pushState('/second'); // no page_leave: nothing visible happened on /
    h.setVisibility('visible');
    h.fireDoc('visibilitychange');
    vi.advanceTimersByTime(6000);
    h.fireWin('pagehide');

    const l = leaves(await h.events());
    expect(l).toHaveLength(1);
    expect(l[0].route).toBe('/second');
    expect(l[0].payload.duration_ms).toBe(6000);
  });

  it('skips the page_leave entirely when no time accrued', async () => {
    const h = bootWithTimers();
    h.fireWin('pagehide');
    const events = await h.events();
    expect(events.map((e) => e.type)).toEqual(['pageview']);
  });
});

describe('widget event delivery (built bundle)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries transient failures with the exact same stable event ids until a 2xx acknowledgement', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const h = boot({ fetchPlan: [429, 500, 'reject', 200] });

    await vi.advanceTimersByTimeAsync(12_000);
    expect(await h.deliveries()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(await h.deliveries()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(await h.deliveries()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1000);

    const deliveries = await h.deliveries();
    expect(deliveries).toHaveLength(4);
    expect(deliveries[0]).toEqual(deliveries[1]);
    expect(deliveries[1]).toEqual(deliveries[2]);
    expect(deliveries[2]).toEqual(deliveries[3]);
    expect(deliveries[0][0].event_id).toMatch(/^(pb-|[0-9a-f-]{36})/);

    // The acknowledged event was removed, so the next interval has nothing
    // to resend.
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await h.deliveries()).toHaveLength(4);
  });

  it('retains a permanent-4xx batch without repeatedly hammering the endpoint', async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    const h = boot({ fetchPlan: [400, 200], storage });

    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(24_000);

    expect(await h.deliveries()).toHaveLength(1);
    const persisted = [...storage.entries()].find(([key]) => key.startsWith('probie_events_v1_'))?.[1];
    expect(persisted).toBeDefined();
    expect((JSON.parse(persisted!) as CapturedEvent[])[0].event_id).toBe((await h.deliveries())[0][0].event_id);
  });

  it('bounds each transient retry cycle', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const h = boot({ fetchPlan: [500, 500, 500, 500, 500, 200] });

    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(250 + 500 + 1000 + 2000);
    expect(await h.deliveries()).toHaveLength(5); // initial attempt + four retries

    // Stay short of the next periodic flush; no sixth exponential retry may
    // be scheduled by this cycle.
    await vi.advanceTimersByTimeAsync(4000);
    expect(await h.deliveries()).toHaveLength(5);
  });

  it('restores a beaconed unload batch on the next page because sendBeacon cannot acknowledge it', async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    const firstPage = boot({ storage });

    vi.advanceTimersByTime(1000);
    firstPage.fireWin('pagehide');

    const [beaconed] = await firstPage.deliveries();
    const beaconedIds = beaconed.map((event) => event.event_id);
    vi.clearAllTimers();
    vi.unstubAllGlobals();

    const nextPage = boot({ storage });
    await vi.advanceTimersByTimeAsync(12_000);
    const [replayed] = await nextPage.deliveries();
    expect(replayed.slice(0, beaconedIds.length).map((event) => event.event_id)).toEqual(beaconedIds);
    expect([...storage.keys()].some((key) => key.startsWith('probie_events_v1_'))).toBe(false);
  });
});

describe('widget network failures (built bundle)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const networkEvents = (events: CapturedEvent[]) => events.filter((e) => e.type === 'fetch_error');

  it('ignores an AbortController cancellation during component cleanup', async () => {
    const h = boot({
      appFetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
    });
    const controller = new AbortController();
    const request = h.request('http://api.test/reddit-posts', { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    h.fireWin('pagehide');

    expect(networkEvents(await h.events())).toEqual([]);
  });

  it('records a genuine fetch rejection with a safe failure kind and error name', async () => {
    const h = boot({ appFetch: () => Promise.reject(new TypeError('Failed to fetch secret details')) });
    await expect(h.request('http://api.test/search')).rejects.toThrow('Failed to fetch');
    h.fireWin('pagehide');

    expect(networkEvents(await h.events())).toMatchObject([
      { payload: { status: 0, failure_kind: 'network_error', error_name: 'TypeError' } },
    ]);
  });

  it('continues to record confirmed HTTP 429 and 500 responses', async () => {
    const h = boot({ appFetch: (input) => Promise.resolve({ status: String(input).includes('rate') ? 429 : 500 }) });
    await h.request('http://api.test/rate-limited');
    await h.request('http://api.test/broken');
    h.fireWin('pagehide');

    expect(networkEvents(await h.events()).map((e) => e.payload.status)).toEqual([429, 500]);
  });

  it('ignores XHR aborts but classifies genuine XHR network failures', async () => {
    const h = boot();
    const cancelled = h.createXhr();
    cancelled.open('GET', 'http://api.test/stale');
    cancelled.send();
    cancelled.abort();

    const failed = h.createXhr();
    failed.open('GET', 'http://api.test/search');
    failed.send();
    failed.fail('error');
    h.fireWin('pagehide');

    expect(networkEvents(await h.events())).toMatchObject([
      { payload: { status: 0, failure_kind: 'network_error', error_name: 'NetworkError' } },
    ]);
  });
});

// Query capture is off here (no data-capture-query attribute), which is the
// default every customer runs.
describe('widget URL capture (built bundle)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function firstPageview(opts: { href?: string; referrer?: string }): Promise<CapturedEvent> {
    const h = boot(opts);
    h.fireWin('pagehide');
    return (await h.events())[0];
  }

  it('keeps utm params and drops everything else in the query', async () => {
    const pv = await firstPageview({
      href: 'http://app.test/landing?sessionToken=s3cr3t&utm_source=Newsletter&email=a@b.com&utm_campaign=spring+sale#hero',
    });
    // utm_* survives so the session has an origin; the session token, the
    // address, and the fragment do not.
    expect(pv.url).toBe('http://app.test/landing?utm_source=Newsletter&utm_campaign=spring+sale');
    expect(pv.route).toBe('/landing');
  });

  it('canonicalises param order so one campaign is one URL', async () => {
    const pv = await firstPageview({ href: 'http://app.test/landing?utm_campaign=spring+sale&utm_source=Newsletter' });
    expect(pv.url).toBe('http://app.test/landing?utm_source=Newsletter&utm_campaign=spring+sale');
  });

  // Ad platforms and link builders hand out mixed-case param names. The React
  // Native collector already matched case-insensitively, so before this the
  // same link reported a campaign on mobile and Direct on web.
  it('matches param names case-insensitively and lowercases them', async () => {
    const pv = await firstPageview({ href: 'http://app.test/landing?UTM_Source=Newsletter&Utm_Campaign=Spring' });
    expect(pv.url).toBe('http://app.test/landing?utm_source=Newsletter&utm_campaign=Spring');
  });

  it('keeps the referring page but not its query', async () => {
    const pv = await firstPageview({ href: 'http://app.test/', referrer: 'https://news.ycombinator.com/item?id=42&user=alice' });
    expect(pv.referrer).toBe('https://news.ycombinator.com/item');
  });

  it('reports no query at all when the landing URL carries no campaign', async () => {
    const pv = await firstPageview({ href: 'http://app.test/landing?q=shoes&page=2' });
    expect(pv.url).toBe('http://app.test/landing');
  });
});
