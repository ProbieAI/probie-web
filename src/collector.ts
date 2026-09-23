import {
  dismissGestureCarriesEvidence,
  isExplicitDismissControl,
  persistentOverlayKind,
  type PersistentOverlayKind,
} from "./overlay-evidence.js";

// Probie passive behavioral collector. See docs/data-collection.md for captured fields.
//
// Loaded by probie-widget.js, standalone with data-token, or initialized from
// @probie-dev/web. Auto-captures a
// general interaction stream (pageviews, clicks, forms, network errors, JS
// errors) and batches it to POST /api/widget/events. It never reads input
// values or typed text — only structure. The token travels in the JSON body so
// the sendBeacon path (which can't set headers) works.

export type EventType =
  | "pageview"
  | "click"
  | "rage_click"
  | "dead_click"
  | "form_submit"
  | "form_abandon"
  | "form_retry"
  | "fetch_error"
  | "js_error"
  | "page_leave"
  | "stuck_overlay"
  | "stuck_loading"
  | "scroll_lock";

export interface ProbieConfig {
  /** Public project token from the Probie integration page. */
  token: string;
  /** Probie origin, for example https://probie.dev. */
  apiBase?: string;
  /** 0..1. The decision is made once per browser session. Default 1. */
  sampleRate?: number;
  /** Include all query parameters. Default false retains only supported UTM parameters. */
  captureQuery?: boolean;
}

export interface ProbieClient {
  identify(userId: string | null): void;
  reset(): void;
  track(type: EventType, payload?: Record<string, unknown>, element?: Element | null): void;
  flush(): void;
}

let singleton: ProbieClient | null = null;

/**
 * Starts Probie's browser collector. Idempotent: the first configuration wins,
 * which makes framework double-mounts and repeated imports harmless.
 */
export function init(config: ProbieConfig): ProbieClient {
  if (singleton) return singleton;
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("probie: init() must run in a browser");
  }
  if (!config || typeof config.token !== "string" || config.token.length === 0) {
    throw new Error("probie: config.token is required");
  }

  singleton = start(config);
  return singleton;
}

/** The active browser client, or null before init(). */
export function getClient(): ProbieClient | null {
  return singleton;
}

function start(config: ProbieConfig): ProbieClient {
  'use strict';

  interface ElementInfo {
    path: string;
    role: string | null;
    name: string | null;
    type: string | null;
    testid: string | null;
    text_hash: string | null;
  }

  interface ProbieEvent {
    event_id: string;
    type: string;
    ts: number;
    session_id: string;
    user_id: string | null;
    url: string;
    route: string;
    referrer: string;
    element: ElementInfo | null;
    payload: Record<string, unknown>;
  }

  const token = config.token;
  const apiBase = new URL(config.apiBase || "https://probie.dev").origin;
  const endpoint = apiBase + "/api/widget/events";
  const captureQuery = config.captureQuery === true;
  const sampleRate = (function () {
    const n = config.sampleRate == null ? 1 : config.sampleRate;
    return isNaN(n) ? 1 : Math.min(1, Math.max(0, n));
  })();

  // Sampling is per session: the first page load rolls the dice and the
  // decision persists in sessionStorage alongside probie_sid, so a sampled
  // session is captured whole (a funnel with missing steps is worse than no
  // funnel). rate >= 1 short-circuits so the default config never pins a
  // stale "0" from an earlier lower rate.
  const sampled = (function () {
    if (sampleRate >= 1) return true;
    try {
      const stored = sessionStorage.getItem("probie_sampled");
      if (stored === "1" || stored === "0") return stored === "1";
      const roll = Math.random() < sampleRate;
      sessionStorage.setItem("probie_sampled", roll ? "1" : "0");
      return roll;
    } catch (_e) {
      return Math.random() < sampleRate;
    }
  })();

  // --- identity ---------------------------------------------------------------

  function genId(): string {
    try {
      const c = crypto as any;
      if (c && typeof c.randomUUID === "function") return c.randomUUID();
    } catch (_e) {
      /* fall through */
    }
    return "pb-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function resolveSessionId(): string {
    try {
      let s = sessionStorage.getItem("probie_sid");
      if (!s) {
        s = genId();
        sessionStorage.setItem("probie_sid", s);
      }
      return s;
    } catch (_e) {
      return genId();
    }
  }

  let sid = resolveSessionId();
  let userId: string | null = null;

  // window.probie stub + queue draining (probie('identify', userId)).
  function handleCommand(command: string, args: any[]): void {
    if (command === "identify" && args.length > 0 && args[0] != null) {
      userId = String(args[0]);
    } else if (command === "reset") {
      reset();
    } else if (command === "track" && typeof args[0] === "string") {
      track(args[0] as EventType, args[1], args[2]);
    } else if (command === "flush") {
      flush(false);
    }
  }
  const w = window as any;
  const queued: any[] = w.probie && w.probie.q ? w.probie.q.slice() : [];
  w.probie = function (command: string) {
    const rest = Array.prototype.slice.call(arguments, 1);
    handleCommand(command, rest);
  };
  for (let i = 0; i < queued.length; i++) {
    try {
      const callArgs = queued[i];
      handleCommand(callArgs[0], Array.prototype.slice.call(callArgs, 1));
    } catch (_e) {
      /* ignore malformed queued call */
    }
  }

  // --- URL + element helpers --------------------------------------

  // Keep a bounded set of campaign parameters for attribution. Applications
  // must avoid putting personal data in these values or URL paths.
  const KEEP_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"];
  const MAX_PARAM_LEN = 128;

  function sanitizeUrl(raw: string): string {
    if (!raw) return "";
    try {
      const u = new URL(raw, location.href);
      u.hash = "";
      if (!captureQuery) {
        // Normalize campaign parameter names; preserve their values and case.
        const found: Record<string, string> = {};
        u.searchParams.forEach(function (value, name) {
          const key = name.toLowerCase();
          if (value && !(key in found) && KEEP_PARAMS.indexOf(key) !== -1) {
            found[key] = value.slice(0, MAX_PARAM_LEN);
          }
        });
        // Rebuilt in whitelist order, not source order, so two landings on the
        // same campaign with the params typed in a different order aggregate
        // as one URL.
        const kept = new URLSearchParams();
        for (let i = 0; i < KEEP_PARAMS.length; i++) {
          if (KEEP_PARAMS[i] in found) kept.set(KEEP_PARAMS[i], found[KEEP_PARAMS[i]]);
        }
        u.search = kept.toString();
      }
      return u.toString();
    } catch (_e) {
      return raw.split("#")[0].split("?")[0];
    }
  }

  function currentRoute(): string {
    try {
      return new URL(location.href).pathname;
    } catch (_e) {
      return "";
    }
  }

  function hashString(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function describeNode(el: Element): string {
    const tag = el.tagName ? el.tagName.toLowerCase() : "?";
    const id = el.id ? "#" + el.id : "";
    const className = (el as HTMLElement).className;
    const cls =
      typeof className === "string" && className.trim()
        ? "." + className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
    return tag + id + cls;
  }

  function elementInfo(el: Element | null): ElementInfo | null {
    if (!el || !el.tagName) return null;
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && depth < 4) {
      parts.unshift(describeNode(node));
      node = node.parentElement;
      depth++;
    }
    // Send a label hash instead of raw label text. This is not anonymization.
    const label = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || "")
      .trim()
      .slice(0, 80);
    return {
      path: parts.join(">"),
      role: el.getAttribute("role"),
      name: el.getAttribute("name"),
      type: el.getAttribute("type"),
      testid: el.getAttribute("data-testid"),
      text_hash: label ? hashString(label) : null,
    };
  }

  // --- buffer + flush ---------------------------------------------------------

  const MAX_BUFFER = 50;
  const HARD_CAP = 200;
  const MAX_DELIVERY_BATCH = 100;
  const FLUSH_MS = 12000;
  const MAX_RETRIES = 4;
  const RETRY_BASE_MS = 250;
  const RETRY_MAX_MS = 4000;
  const STORAGE_KEY = "probie_events_v1_" + hashString(token);

  interface DeliveryBatch {
    events: ProbieEvent[];
    body: string;
    attempt: number;
  }

  function restoreBuffer(): ProbieEvent[] {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      const restored: ProbieEvent[] = [];
      for (let i = Math.max(0, parsed.length - HARD_CAP); i < parsed.length; i++) {
        const event = parsed[i] as Partial<ProbieEvent> | null;
        if (!event || typeof event !== "object") continue;
        if (typeof event.type !== "string" || typeof event.ts !== "number" || typeof event.session_id !== "string") continue;
        if (typeof event.event_id !== "string" || !event.event_id) event.event_id = genId();
        restored.push(event as ProbieEvent);
      }
      return restored;
    } catch (_e) {
      return [];
    }
  }

  const buffer: ProbieEvent[] = restoreBuffer();
  let activeBatch: DeliveryBatch | null = null;
  let deliveryBlocked = false;

  function persistBuffer(): void {
    try {
      if (buffer.length === 0) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
    } catch (_e) {
      /* in-memory delivery still works when storage is unavailable */
    }
  }

  // `at` pins url/route to the page being left (a page_leave is emitted after
  // the SPA route has already changed under it).
  function emit(
    type: string,
    payload: Record<string, unknown>,
    el?: Element | null,
    at?: { url: string; route: string }
  ): void {
    if (!sampled) return;
    buffer.push({
      event_id: genId(),
      type: type,
      ts: Date.now(),
      session_id: sid,
      user_id: userId,
      url: at ? at.url : sanitizeUrl(location.href),
      route: at ? at.route : currentRoute(),
      referrer: sanitizeUrl(document.referrer || ""),
      element: el === undefined ? null : elementInfo(el),
      payload: payload || {},
    });
    // Preserve the oldest unacknowledged work. Under a prolonged outage the
    // hard cap sheds newly captured events instead of deleting the batch that
    // is already being retried.
    if (buffer.length > HARD_CAP) buffer.length = HARD_CAP;
    persistBuffer();
    if (buffer.length >= MAX_BUFFER) flush(false);
  }

  function acknowledge(batch: DeliveryBatch): void {
    if (activeBatch !== batch) return;
    // Only the protected head batch can be active. Check ids defensively so a
    // future queue change cannot acknowledge unrelated events.
    for (let i = 0; i < batch.events.length; i++) {
      if (!buffer[i] || buffer[i].event_id !== batch.events[i].event_id) {
        activeBatch = null;
        return;
      }
    }
    buffer.splice(0, batch.events.length);
    activeBatch = null;
    deliveryBlocked = false;
    persistBuffer();
    if (buffer.length >= MAX_BUFFER) flush(false);
  }

  function finishAttempt(batch: DeliveryBatch): void {
    if (activeBatch === batch) activeBatch = null;
  }

  function transientStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  function retryDelay(attempt: number): number {
    const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, attempt));
    return Math.round(base * (0.75 + Math.random() * 0.5));
  }

  function scheduleRetry(batch: DeliveryBatch): void {
    if (activeBatch !== batch) return;
    if (batch.attempt >= MAX_RETRIES) {
      finishAttempt(batch);
      return;
    }
    const delay = retryDelay(batch.attempt);
    batch.attempt++;
    window.setTimeout(function () {
      if (activeBatch === batch) postFetch(batch);
    }, delay);
  }

  function postFetch(batch: DeliveryBatch): void {
    try {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: batch.body,
        keepalive: true,
        credentials: "omit",
      }).then(
        function (res) {
          if (res && res.status >= 200 && res.status < 300) {
            acknowledge(batch);
          } else if (res && transientStatus(res.status)) {
            scheduleRetry(batch);
          } else {
            // Keep the batch, but do not hammer a permanent 4xx. A reload can
            // try the session-backed queue again after configuration changes.
            deliveryBlocked = true;
            finishAttempt(batch);
          }
        },
        function () {
          scheduleRetry(batch);
        }
      );
    } catch (_e) {
      scheduleRetry(batch);
    }
  }

  function sendBeaconBatch(batch: DeliveryBatch): boolean {
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([batch.body], { type: "application/json" });
        return navigator.sendBeacon(endpoint, blob);
      }
    } catch (_e) {
      /* fall through to fetch */
    }
    return false;
  }

  function flush(useBeacon: boolean): void {
    if (buffer.length === 0 || deliveryBlocked) return;
    if (activeBatch) {
      // pagehide/hidden can race an in-flight fetch and newer capture. Beacon
      // the current queue head so events added after the fetch began are not
      // stranded; overlapping stable ids make either request order safe.
      if (useBeacon) {
        const events = buffer.slice(0, MAX_DELIVERY_BATCH);
        sendBeaconBatch({ events: events, body: JSON.stringify({ token: token, events: events }), attempt: 0 });
      }
      return;
    }
    const events = buffer.slice(0, MAX_DELIVERY_BATCH);
    const batch: DeliveryBatch = {
      events: events,
      body: JSON.stringify({ token: token, events: events }),
      attempt: 0,
    };
    activeBatch = batch;
    if (useBeacon && sendBeaconBatch(batch)) {
      // sendBeacon has no response channel, so it is never an acknowledgement.
      // Keep the persisted events for the next page/interval to confirm via a
      // 2xx fetch; stable ids make that replay harmless.
      activeBatch = null;
      return;
    }
    postFetch(batch);
  }

  function isOwnEndpoint(u: string): boolean {
    try {
      const abs = new URL(u, location.href);
      return abs.origin === apiBase && abs.pathname.indexOf("/api/widget") === 0;
    } catch (_e) {
      return false;
    }
  }

  // --- collectors -------------------------------------------------------------

  // JS errors
  window.addEventListener("error", function (e: ErrorEvent) {
    emit("js_error", {
      message: e.message ? String(e.message).slice(0, 500) : "",
      filename: e.filename ? sanitizeUrl(e.filename) : "",
      lineno: e.lineno || 0,
      colno: e.colno || 0,
      stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : "",
    });
  });
  window.addEventListener("unhandledrejection", function (e: PromiseRejectionEvent) {
    const reason: any = e.reason;
    emit("js_error", {
      message: reason && reason.message ? String(reason.message).slice(0, 500) : String(reason).slice(0, 500),
      stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : "",
    });
  });

  // Click-family payload: page coordinates + viewport, so hotspots can be
  // rendered later without changing the wire format again.
  function clickPayload(e: MouseEvent): Record<string, unknown> {
    return {
      x: Math.round(e.pageX),
      y: Math.round(e.pageY),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  }

  // --- dead clicks ------------------------------------------------------------
  //
  // An interactive-looking element is clicked and nothing observable happens
  // within DEAD_CLICK_MS: no DOM mutation, no route change, no outbound
  // request, no browser-handled navigation. The classic dead button. Any page
  // effect bumps effectTick; a watcher that fires with the tick unchanged
  // emits dead_click. Biased toward false negatives (a busy page's unrelated
  // mutations mask real dead clicks) — never toward false positives.
  const DEAD_CLICK_MS = 1000;
  const DEAD_CLICK_PAGE_CAP = 10;
  let deadClickCount = 0;
  let deadPending = false;
  let effectTick = 0;

  function bumpEffect(): void {
    effectTick++;
  }

  if (typeof MutationObserver === "function") {
    try {
      // One observer serves both consumers: the dead-click effect tick and
      // the stuck-overlay appearance scan (defined below; hoisted).
      new MutationObserver(function (muts) {
        bumpEffect();
        scanForOverlays(muts);
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } catch (_e) {
      /* no mutation signal; navigation + network still cancel */
    }
  }
  window.addEventListener("hashchange", bumpEffect);

  // Native controls (and media) respond without touching the DOM — a select
  // opening its dropdown mutates nothing — so they can't be judged dead.
  function isNativeControl(el: Element): boolean {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    return ["input", "select", "textarea", "option", "label", "video", "audio"].indexOf(tag) !== -1;
  }

  function interactiveCandidate(el: Element): Element | null {
    if (isNativeControl(el)) return null;
    let hit: Element | null = null;
    try {
      hit = el.closest ? el.closest("a,button,summary,[role=button],[role=link],[role=tab],[role=menuitem],[onclick]") : null;
    } catch (_e) {
      /* ignore */
    }
    if (!hit) {
      // catch-all for div-buttons: styled clickable, no semantics
      try {
        if (getComputedStyle(el as HTMLElement).cursor === "pointer") hit = el;
      } catch (_e) {
        /* ignore */
      }
    }
    return hit && !isNativeControl(hit) ? hit : null;
  }

  // The browser itself will act on an unprevented real link (navigate, new
  // tab, download) — that effect is invisible to us, so don't judge it.
  function browserHandlesClick(el: Element, ev: MouseEvent): boolean {
    if (ev.defaultPrevented) return false;
    let a: Element | null = null;
    try {
      a = el.closest ? el.closest("a") : null;
    } catch (_e) {
      return false;
    }
    if (!a) return false;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return true;
    const href = a.getAttribute("href");
    return !!href && href !== "#";
  }

  function maybeWatchDeadClick(el: Element, ev: MouseEvent): void {
    if (!sampled || deadPending || deadClickCount >= DEAD_CLICK_PAGE_CAP) return;
    const candidate = interactiveCandidate(el);
    if (!candidate) return;
    deadPending = true;
    const payload = clickPayload(ev);
    // The tick is captured NOW, in the capture phase, before page handlers
    // run: a synchronous handler's DOM mutation is delivered as a microtask
    // (after this task, before any timer), so a deferred capture would read
    // the already-bumped tick and miss the effect entirely.
    const tickAtClick = effectTick;
    // Defer past the bubble phase so defaultPrevented is observable.
    window.setTimeout(function () {
      if (browserHandlesClick(candidate, ev)) {
        deadPending = false;
        return;
      }
      window.setTimeout(function () {
        deadPending = false;
        if (effectTick === tickAtClick) {
          deadClickCount++;
          emit("dead_click", payload, candidate);
        }
      }, DEAD_CLICK_MS);
    }, 0);
  }

  // --- stuck UI ---------------------------------------------------------------
  //
  // Detectors for "wrong effect" bugs that throw no error and mutate no DOM in
  // the moment the user expects a change:
  //   stuck_overlay — a floating surface appeared after an interaction and
  //     ignored dismissal gestures it actually promises. Transient menus use
  //     outside-click / Escape; persistent UI requires its own close control.
  //   stuck_loading — a control the user clicked went busy (disabled /
  //     aria-busy), the network went quiet, and the control never recovered.
  //   scroll_lock — the page cannot scroll (body overflow:hidden) with no
  //     modal on screen: a closed dialog leaked its scroll lock.
  // The event names and payloads are platform-neutral so native SDKs can emit
  // equivalent signals using the same event contract. Payload `message` is a
  // concise human-readable summary. Same bias as dead clicks: false negatives
  // over false positives, always.

  const OVERLAY_CAP = 4;
  const OVERLAY_APPEAR_WINDOW_MS = 1500;
  const OVERLAY_DISMISS_CHECK_MS = 600;
  const OVERLAY_JUDGE_WINDOW_MS = 20000;
  const OVERLAY_STRIKES = 2;
  const STUCK_OVERLAY_PAGE_CAP = 3;

  interface TrackedOverlay {
    el: Element;
    trigger: Element | null;
    appearedAt: number;
    persistentKind: PersistentOverlayKind | null;
    strikes: number;
    // A strike is "strong" when the gesture can only mean dismissal: an
    // explicit close control, Escape, or a click on empty space. Persistent
    // surfaces only accept explicit close/consent controls as evidence.
    strongStrike: boolean;
    pending: boolean;
    emitted: boolean;
  }

  const overlays: TrackedOverlay[] = [];
  let stuckOverlayCount = 0;
  let lastInteractionAt = 0;
  let lastInteractionTarget: Element | null = null;

  function isShown(el: Element): boolean {
    if (!el.isConnected) return false;
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(el as HTMLElement);
    } catch (_e) {
      return false;
    }
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8;
  }

  // Popup-like: floats over the page and looks elevated. The trait test (not
  // ARIA alone) matters — the buggy dropdowns worth catching are exactly the
  // ones with no popup semantics.
  function isPopupLike(el: Element): boolean {
    if (el.nodeType !== 1 || !el.getBoundingClientRect) return false;
    if ((el.id || "").indexOf("probie") === 0) return false; // never judge our own UI
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(el as HTMLElement);
    } catch (_e) {
      return false;
    }
    if (cs.position !== "absolute" && cs.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 32 || r.height < 32) return false;
    const z = parseInt(cs.zIndex, 10);
    const role = (el.getAttribute("role") || "").toLowerCase();
    const popupRole = ["menu", "listbox", "dialog", "tooltip"].indexOf(role) !== -1;
    return (isFinite(z) && z >= 1) || popupRole || el.hasAttribute("popover") || cs.boxShadow !== "none";
  }

  // Modals legitimately ignore outside clicks (backdrops, confirm dialogs);
  // only Escape strikes count against them.
  function isModalLike(el: Element): boolean {
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "dialog" || role === "alertdialog") return true;
    if (el.getAttribute("aria-modal") === "true") return true;
    if (el.tagName && el.tagName.toLowerCase() === "dialog") return true;
    const r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.85;
  }

  function trackOverlay(el: Element): void {
    for (let i = 0; i < overlays.length; i++) if (overlays[i].el === el) return;
    overlays.push({
      el: el,
      trigger: lastInteractionTarget,
      appearedAt: Date.now(),
      persistentKind: persistentOverlayKind(el),
      strikes: 0,
      strongStrike: false,
      pending: false,
      emitted: false,
    });
    if (overlays.length > OVERLAY_CAP) overlays.shift();
  }

  // Scan mutations for a popup appearing right after an interaction. Depth-2
  // walk under a node budget: portals add a wrapper whose child is the popup.
  function scanForOverlays(muts: MutationRecord[]): void {
    if (!sampled || stuckOverlayCount >= STUCK_OVERLAY_PAGE_CAP) return;
    if (Date.now() - lastInteractionAt > OVERLAY_APPEAR_WINDOW_MS) return;
    let budget = 24;
    function consider(el: Element): void {
      if (budget-- <= 0) return;
      if (isShown(el) && isPopupLike(el)) trackOverlay(el);
    }
    for (let i = 0; i < muts.length && budget > 0; i++) {
      const m = muts[i];
      if (m.type === "attributes" && m.target && m.target.nodeType === 1) {
        consider(m.target as Element);
      } else if (m.type === "childList") {
        for (let j = 0; j < m.addedNodes.length && budget > 0; j++) {
          const n = m.addedNodes[j];
          if (n.nodeType !== 1) continue;
          consider(n as Element);
          const kids = (n as Element).children;
          for (let k = 0; kids && k < kids.length && budget > 0; k++) consider(kids[k]);
        }
      }
    }
  }

  function emitStuckOverlay(o: TrackedOverlay, via: string): void {
    o.emitted = true;
    stuckOverlayCount++;
    const triggerInfo = o.trigger ? elementInfo(o.trigger) : null;
    const triggerPath = triggerInfo ? triggerInfo.path : null;
    emit(
      "stuck_overlay",
      {
        via: via,
        evidence: via === "close_control" ? "failed_close_control" : "repeated_dismiss_gestures",
        surface_kind: o.persistentKind || "transient",
        strikes: o.strikes,
        trigger: triggerPath,
        message:
          "overlay " +
          describeNode(o.el) +
          " stayed open after " +
          o.strikes +
          " dismiss attempts (last: " +
          via +
          ")" +
          (triggerPath ? "; opened via " + triggerPath : ""),
      },
      o.el
    );
  }

  // A dismiss gesture happened: for each live overlay it should have closed,
  // look again shortly after (past close animations). Still on screen on the
  // same route = a strike.
  function judgeOverlayDismiss(via: string, target: Element | null, x: number | null, y: number | null): void {
    if (!sampled || stuckOverlayCount >= STUCK_OVERLAY_PAGE_CAP) return;
    for (let i = overlays.length - 1; i >= 0; i--) {
      const o = overlays[i];
      if (!o.el.isConnected || !isShown(o.el)) {
        overlays.splice(i, 1); // it closed; re-tracked if it ever reopens
        continue;
      }
      if (o.emitted || o.pending) continue;
      if (Date.now() - o.appearedAt > OVERLAY_JUDGE_WINDOW_MS) continue;
      if (!dismissGestureCarriesEvidence(o.persistentKind, via)) continue;
      let strong = false;
      if (via === "close_control") {
        if (!target || !o.el.contains(target) || !isExplicitDismissControl(target, o.el)) continue;
        strong = true;
      } else if (via === "escape") {
        strong = true;
      } else {
        if (isModalLike(o.el)) continue;
        if (target && (o.el.contains(target) || (o.trigger && o.trigger.contains(target)))) continue;
        // Clicking into a form control is not a dismiss gesture: comboboxes
        // and date pickers legitimately keep their popup open across it.
        if (target && isNativeControl(target)) continue;
        const r = o.el.getBoundingClientRect();
        if (x != null && y != null && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) continue;
        strong = !target || !interactiveCandidate(target);
      }
      o.pending = true;
      const routeAtGesture = currentRoute();
      window.setTimeout(function () {
        o.pending = false;
        if (currentRoute() !== routeAtGesture) return;
        if (!o.el.isConnected || !isShown(o.el)) return;
        o.strikes++;
        if (strong) o.strongStrike = true;
        if (o.strikes >= OVERLAY_STRIKES && o.strongStrike && !o.emitted && stuckOverlayCount < STUCK_OVERLAY_PAGE_CAP) {
          emitStuckOverlay(o, via);
        }
      }, OVERLAY_DISMISS_CHECK_MS);
    }
  }

  document.addEventListener(
    "pointerdown",
    function (e: PointerEvent) {
      const t = e.target && (e.target as Node).nodeType === 1 ? (e.target as Element) : null;
      // Judge BEFORE recording: this gesture runs against overlays opened by
      // the previous interaction, not the one it may itself open.
      let closeAttempt = false;
      if (t) {
        for (let i = 0; i < overlays.length; i++) {
          if (overlays[i].el.contains(t) && isExplicitDismissControl(t, overlays[i].el)) {
            closeAttempt = true;
            break;
          }
        }
      }
      judgeOverlayDismiss(closeAttempt ? "close_control" : "outside_click", t, e.clientX, e.clientY);
      lastInteractionAt = Date.now();
      lastInteractionTarget = t ? interactiveCandidate(t) : null;
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Escape inside a text control usually means "clear/cancel input".
        const a = document.activeElement;
        const tag = a && a.tagName ? a.tagName.toLowerCase() : "";
        const editing =
          tag === "input" || tag === "textarea" || tag === "select" || (a && (a as HTMLElement).isContentEditable);
        if (!editing) judgeOverlayDismiss("escape", null, null, null);
      }
      lastInteractionAt = Date.now();
      const a = document.activeElement;
      lastInteractionTarget = a && a.nodeType === 1 ? interactiveCandidate(a) : null;
    },
    true
  );

  // --- stuck loading ---
  //
  // A click sends a control busy (disabled / aria-busy) and a request out; the
  // network settles and goes quiet, but the control never comes back. The
  // classic forgotten re-enable on the fetch error path. Requiring network
  // activity after the click keeps "button disabled because the form is now
  // invalid" from ever firing.
  const LOADING_BUSY_CONFIRM_MS = 800;
  const LOADING_POLL_MS = 3000;
  const LOADING_MAX_POLLS = 15;
  const LOADING_MIN_STUCK_MS = 10000;
  const LOADING_NET_QUIET_MS = 8000;
  const STUCK_LOADING_PAGE_CAP = 2;

  let netInFlight = 0;
  let netStarted = 0;
  let lastNetSettleAt = 0;
  let loadingPending = false;
  let stuckLoadingCount = 0;

  function noteNetStart(): void {
    netInFlight++;
    netStarted++;
  }

  function noteNetSettle(): void {
    if (netInFlight > 0) netInFlight--;
    lastNetSettleAt = Date.now();
  }

  function isBusyControl(el: Element): boolean {
    return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-busy") === "true";
  }

  function maybeWatchLoading(target: Element): void {
    if (!sampled || loadingPending || stuckLoadingCount >= STUCK_LOADING_PAGE_CAP) return;
    let ctl: Element | null = null;
    try {
      ctl = target.closest ? target.closest("button,input[type=submit],[role=button]") : null;
    } catch (_e) {
      return;
    }
    if (!ctl || isBusyControl(ctl)) return;
    const control = ctl;
    const clickAt = Date.now();
    const startedBefore = netStarted;
    const routeAtClick = currentRoute();
    loadingPending = true;
    let polls = 0;

    function stop(): void {
      loadingPending = false;
    }

    function poll(): void {
      if (currentRoute() !== routeAtClick || !control.isConnected || !isShown(control)) return stop();
      if (!isBusyControl(control)) return stop(); // recovered
      const now = Date.now();
      if (
        netStarted > startedBefore &&
        netInFlight === 0 &&
        lastNetSettleAt >= clickAt &&
        now - lastNetSettleAt >= LOADING_NET_QUIET_MS &&
        now - clickAt >= LOADING_MIN_STUCK_MS
      ) {
        stuckLoadingCount++;
        emit(
          "stuck_loading",
          {
            waited_ms: now - clickAt,
            message:
              "control " +
              describeNode(control) +
              " still disabled/loading " +
              Math.round((now - clickAt) / 1000) +
              "s after click with the network idle",
          },
          control
        );
        return stop();
      }
      if (++polls >= LOADING_MAX_POLLS) return stop();
      window.setTimeout(poll, LOADING_POLL_MS);
    }

    window.setTimeout(function () {
      if (!control.isConnected || !isBusyControl(control)) return stop(); // never went busy
      poll();
    }, LOADING_BUSY_CONFIRM_MS);
  }

  // --- scroll lock ---
  //
  // Body overflow:hidden with overflowing content and no modal on screen: a
  // dismissed dialog leaked its scroll lock. Three wheel gestures that move
  // nothing confirm it. App shells (body pinned, inner panes scroll) are
  // excluded twice over: the wheel target sits inside a scrollable container,
  // and a pinned body has no overflowing scrollHeight.
  const SCROLL_LOCK_PROBE_MS = 250;
  const SCROLL_LOCK_STRIKES = 3;
  let scrollLockEmitted = false;
  let scrollLockStrikes = 0;
  let scrollProbePending = false;

  function insideScrollableContainer(el: Element | null): boolean {
    let n = el;
    let depth = 0;
    while (n && depth < 6 && n !== document.body && n !== document.documentElement) {
      if (n.scrollHeight > n.clientHeight + 10) {
        try {
          const ov = getComputedStyle(n as HTMLElement).overflowY;
          if (ov === "auto" || ov === "scroll") return true;
        } catch (_e) {
          /* ignore */
        }
      }
      n = n.parentElement;
      depth++;
    }
    return false;
  }

  function modalCoversViewport(): boolean {
    for (let i = 0; i < overlays.length; i++) {
      if (overlays[i].el.isConnected && isShown(overlays[i].el)) return true;
    }
    try {
      let n = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2));
      let depth = 0;
      while (n && depth < 12) {
        const cs = getComputedStyle(n as HTMLElement);
        if (cs.position === "fixed" || cs.position === "absolute") {
          const r = n.getBoundingClientRect();
          if (r.width * r.height >= window.innerWidth * window.innerHeight * 0.25) return true;
        }
        n = n.parentElement;
        depth++;
      }
    } catch (_e) {
      /* ignore */
    }
    return false;
  }

  window.addEventListener(
    "wheel",
    function (e: WheelEvent) {
      if (!sampled || scrollLockEmitted || scrollProbePending || !e.deltaY) return;
      const doc = document.documentElement;
      if (!doc || doc.scrollHeight <= window.innerHeight + 100) return;
      let bodyLocked = false;
      try {
        bodyLocked =
          getComputedStyle(document.body).overflowY === "hidden" || getComputedStyle(doc).overflowY === "hidden";
      } catch (_e) {
        return;
      }
      if (!bodyLocked) {
        scrollLockStrikes = 0;
        return;
      }
      const t = e.target && (e.target as Node).nodeType === 1 ? (e.target as Element) : null;
      if (insideScrollableContainer(t)) return;
      if (modalCoversViewport()) {
        scrollLockStrikes = 0;
        return;
      }
      const y0 = window.pageYOffset;
      scrollProbePending = true;
      window.setTimeout(function () {
        scrollProbePending = false;
        if (window.pageYOffset !== y0) {
          scrollLockStrikes = 0;
          return;
        }
        if (++scrollLockStrikes >= SCROLL_LOCK_STRIKES) {
          scrollLockEmitted = true;
          emit("scroll_lock", {
            message: "page scroll is locked (body overflow hidden) with no modal on screen",
          });
        }
      }, SCROLL_LOCK_PROBE_MS);
    },
    { passive: true, capture: true }
  );

  // Clicks + rage clicks (>=3 on the same element within ~1s)
  let lastClickEl: Element | null = null;
  let clickCount = 0;
  let clickTimer: number | undefined;
  document.addEventListener(
    "click",
    function (e: MouseEvent) {
      const el = e.target as Element | null;
      emit("click", clickPayload(e), el);
      if (el) maybeWatchDeadClick(el, e);
      if (el) maybeWatchLoading(el);
      if (el && el === lastClickEl) {
        clickCount++;
      } else {
        lastClickEl = el;
        clickCount = 1;
      }
      if (clickTimer) clearTimeout(clickTimer);
      if (clickCount >= 3) {
        emit("rage_click", { count: clickCount, ...clickPayload(e) }, el);
        clickCount = 0;
        lastClickEl = null;
      }
      clickTimer = window.setTimeout(function () {
        clickCount = 0;
        lastClickEl = null;
      }, 1000);
    },
    true
  );

  // Forms: submit, retry (>=2 submits of the same form within 10s), abandon
  const formSubmits: Record<string, number[]> = {};
  const touchedForms: HTMLFormElement[] = [];
  const submittedForms: HTMLFormElement[] = [];

  function formKey(form: HTMLFormElement): string {
    const info = elementInfo(form);
    return info ? info.path : "form";
  }

  document.addEventListener(
    "focusin",
    function (e: Event) {
      const t = e.target as HTMLElement | null;
      const form = t && t.closest ? (t.closest("form") as HTMLFormElement | null) : null;
      if (form && touchedForms.indexOf(form) === -1) touchedForms.push(form);
    },
    true
  );

  document.addEventListener(
    "submit",
    function (e: Event) {
      const form = e.target as HTMLFormElement | null;
      if (!form) return;
      if (submittedForms.indexOf(form) === -1) submittedForms.push(form);
      emit("form_submit", {}, form);
      const key = formKey(form);
      const now = Date.now();
      const recent = (formSubmits[key] || []).filter(function (t) {
        return now - t < 10000;
      });
      recent.push(now);
      formSubmits[key] = recent;
      if (recent.length >= 2) emit("form_retry", { count: recent.length }, form);
    },
    true
  );

  function emitAbandons(): void {
    for (let i = 0; i < touchedForms.length; i++) {
      if (submittedForms.indexOf(touchedForms[i]) === -1) emit("form_abandon", {}, touchedForms[i]);
    }
    touchedForms.length = 0;
  }

  // Network: fetch + XHR, emit on genuine network/HTTP failures. Application
  // code commonly aborts stale requests during component cleanup; an abort is
  // an expected lifecycle outcome, not evidence that the request failed.
  function safeErrorName(err: any): string {
    const name = err && typeof err.name === "string" ? err.name : "";
    return ["TypeError", "NetworkError", "TimeoutError", "Error"].indexOf(name) !== -1 ? name : "Error";
  }

  function isOffline(): boolean {
    try {
      return typeof navigator.onLine === "boolean" && !navigator.onLine;
    } catch (_e) {
      return false;
    }
  }

  function fetchWasCancelled(input: any, init: any, err: any): boolean {
    const errorName = err && typeof err.name === "string" ? err.name : "";
    if (errorName === "TimeoutError") return false;
    if (errorName === "AbortError") return true;
    try {
      const signal = (init && init.signal) || (input && input.signal);
      if (!signal || !signal.aborted) return false;
      const reasonName = signal.reason && typeof signal.reason.name === "string" ? signal.reason.name : "";
      return reasonName !== "TimeoutError";
    } catch (_e) {
      return false;
    }
  }

  function networkFailureKind(err: any): string {
    if (err && err.name === "TimeoutError") return "timeout";
    return isOffline() ? "offline" : "network_error";
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (this: any): Promise<Response> {
      const args: any[] = Array.prototype.slice.call(arguments);
      const input = args[0];
      const init = args[1];
      const start = Date.now();
      const urlStr =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : (input && input.url) || "";
      const method = (init && init.method) || (input && input.method) || "GET";
      const p = origFetch.apply(this, args as any) as Promise<Response>;
      if (isOwnEndpoint(urlStr)) return p;
      bumpEffect();
      noteNetStart();
      return p.then(
        function (res) {
          noteNetSettle();
          if (res && res.status >= 400) {
            emit("fetch_error", {
              method: String(method).toUpperCase(),
              url: sanitizeUrl(urlStr),
              status: res.status,
              duration_ms: Date.now() - start,
            });
          }
          return res;
        },
        function (err) {
          noteNetSettle();
          if (!fetchWasCancelled(input, init, err)) {
            emit("fetch_error", {
              method: String(method).toUpperCase(),
              url: sanitizeUrl(urlStr),
              status: 0,
              duration_ms: Date.now() - start,
              failure_kind: networkFailureKind(err),
              error_name: safeErrorName(err),
            });
          }
          throw err;
        }
      );
    } as typeof fetch;
  }

  const xhrProto = XMLHttpRequest.prototype as any;
  const origOpen = xhrProto.open;
  const origSend = xhrProto.send;
  xhrProto.open = function (this: any, method: string, url: string) {
    this.__pb = { method: method, url: url, start: 0 };
    return origOpen.apply(this, Array.prototype.slice.call(arguments));
  };
  xhrProto.send = function (this: any) {
    const meta = this.__pb;
    if (meta && !isOwnEndpoint(meta.url)) {
      bumpEffect();
      noteNetStart();
      meta.start = Date.now();
      const xhr = this;
      let cancelled = false;
      let failureKind = "";
      this.addEventListener(
        "abort",
        function () {
          cancelled = true;
        },
        { once: true }
      );
      this.addEventListener(
        "timeout",
        function () {
          failureKind = "timeout";
        },
        { once: true }
      );
      this.addEventListener(
        "error",
        function () {
          failureKind = isOffline() ? "offline" : "network_error";
        },
        { once: true }
      );
      this.addEventListener("loadend", function () {
        noteNetSettle();
        const status = xhr.status;
        if (!cancelled && (status === 0 || status >= 400)) {
          const statusZero = status === 0;
          const kind = failureKind || (isOffline() ? "offline" : "network_error");
          emit("fetch_error", {
            method: String(meta.method).toUpperCase(),
            url: sanitizeUrl(meta.url),
            status: status,
            duration_ms: Date.now() - meta.start,
            ...(statusZero ? { failure_kind: kind, error_name: kind === "timeout" ? "TimeoutError" : "NetworkError" } : {}),
          });
        }
      }, { once: true });
    }
    return origSend.apply(this, Array.prototype.slice.call(arguments));
  };

  // Dwell (visible time on a route) + max scroll depth per route view.
  //
  // page_leave carries duration_ms (visible ms since the last page_leave for
  // this route view) and scroll_depth (max % of the page seen). It fires on
  // SPA route change, on the tab going hidden, and at pagehide. A route view
  // can therefore emit several incremental page_leave events (hide, return,
  // hide again); consumers SUM duration_ms and MAX scroll_depth per
  // (session, route), so incremental emission adds up to total visible time.
  // Hidden time is never counted.
  //
  // scroll_depth is only ever measured while the DOM still belongs to the
  // view being reported: scroll events raise it live, and emitPageLeave takes
  // a final measurement at emit time (at a route-change emit the new page has
  // not rendered yet, so the DOM is still the departing page's). The baseline
  // is NOT measured eagerly at view start — at that moment the DOM is the
  // previous page's, and a short page scrolled to bottom would stamp a bogus
  // ~100% floor onto the new view.
  let viewAt = { url: sanitizeUrl(location.href), route: currentRoute() };
  let viewSegmentStart = Date.now();
  let viewRunning = document.visibilityState !== "hidden";
  let viewAccumMs = 0;
  let viewMaxScroll = 0;

  function currentScrollDepth(): number {
    try {
      const doc = document.documentElement;
      const total = Math.max(
        doc ? doc.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0
      );
      if (total <= 0) return 0;
      const seen =
        (window.pageYOffset || (doc && doc.scrollTop) || 0) +
        (window.innerHeight || (doc && doc.clientHeight) || 0);
      return Math.max(0, Math.min(100, Math.round((seen / total) * 100)));
    } catch (_e) {
      return 0;
    }
  }

  function pauseDwell(): void {
    if (viewRunning) {
      viewAccumMs += Date.now() - viewSegmentStart;
      viewRunning = false;
    }
  }

  function resumeDwell(): void {
    if (!viewRunning) {
      viewSegmentStart = Date.now();
      viewRunning = true;
    }
  }

  // Emit accumulated visible time for the current route view (skipped when
  // nothing accrued, e.g. pagehide right after a hidden-tab emit).
  function emitPageLeave(): void {
    if (viewRunning) {
      viewAccumMs += Date.now() - viewSegmentStart;
      viewSegmentStart = Date.now();
    }
    if (viewAccumMs <= 0) return;
    // Final depth measurement, taken while the DOM is still this view's:
    // covers views the user saw but never scrolled (viewport-only depth).
    const d = currentScrollDepth();
    if (d > viewMaxScroll) viewMaxScroll = d;
    emit(
      "page_leave",
      { duration_ms: Math.round(viewAccumMs), scroll_depth: viewMaxScroll },
      undefined,
      viewAt
    );
    viewAccumMs = 0;
  }

  function resetView(): void {
    viewAt = { url: sanitizeUrl(location.href), route: currentRoute() };
    viewSegmentStart = Date.now();
    viewAccumMs = 0;
    // Start at zero: the new page has not rendered yet, so measuring now
    // would read the OLD page's DOM (see the section comment above). Scroll
    // events and the emit-time measurement fill it in once the DOM is real.
    viewMaxScroll = 0;
  }

  window.addEventListener(
    "scroll",
    function () {
      const d = currentScrollDepth();
      if (d > viewMaxScroll) viewMaxScroll = d;
    },
    { passive: true }
  );

  // Pageviews + SPA route changes
  let lastPath = currentRoute();
  function onRouteChange(): void {
    bumpEffect();
    const p = currentRoute();
    if (p !== lastPath) {
      lastPath = p;
      emitPageLeave();
      resetView();
      emit("pageview", {});
    }
  }
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (this: any) {
    const r = origPush.apply(this, Array.prototype.slice.call(arguments) as any);
    onRouteChange();
    return r;
  };
  history.replaceState = function (this: any) {
    const r = origReplace.apply(this, Array.prototype.slice.call(arguments) as any);
    onRouteChange();
    return r;
  };
  window.addEventListener("popstate", onRouteChange);

  // --- lifecycle --------------------------------------------------------------

  function teardown(): void {
    emitPageLeave();
    emitAbandons();
    flush(true);
  }
  setInterval(function () {
    flush(false);
  }, FLUSH_MS);
  // Hidden often just means a tab switch / backgrounded app the user returns
  // from, so it flushes (beacon, in case the page never comes back) and emits
  // the dwell accrued so far — on mobile, hidden is often the last signal we
  // ever get. form_abandon is decided at pagehide, when the page is actually
  // going away.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      emitPageLeave();
      pauseDwell();
      flush(true);
    } else {
      resumeDwell();
    }
  });
  window.addEventListener("pagehide", teardown);

  emit("pageview", {});

  function identify(nextUserId: string | null): void {
    try {
      userId = nextUserId == null ? null : String(nextUserId);
    } catch (_e) {
      /* telemetry must never throw into the host app */
    }
  }

  function reset(): void {
    userId = null;
    try {
      sessionStorage.removeItem("probie_sid");
    } catch (_e) {
      /* rotate in memory when storage is unavailable */
    }
    sid = resolveSessionId();
  }

  function track(type: EventType, payload?: Record<string, unknown>, element?: Element | null): void {
    try {
      emit(type, payload || {}, element);
    } catch (_e) {
      /* telemetry must never throw into the host app */
    }
  }

  return {
    identify,
    reset,
    track,
    flush: function () {
      flush(false);
    },
  };
}
