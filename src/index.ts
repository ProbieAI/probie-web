import {
  getClient as getCollectorClient,
  init as initCollector,
  type EventType as CollectorEventType,
  type ProbieConfig as CollectorConfig,
} from "./collector.js";

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
  /** Probie origin. Defaults to https://probie.dev. */
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

/** Initialize the browser collector. Idempotent; the first configuration wins. */
export function init(config: ProbieConfig): ProbieClient {
  return initCollector(config as CollectorConfig) as ProbieClient;
}

/** Return the initialized client, or null before init(). */
export function getClient(): ProbieClient | null {
  return getCollectorClient() as ProbieClient | null;
}

export function identify(userId: string | null): void {
  getCollectorClient()?.identify(userId);
}

export function reset(): void {
  getCollectorClient()?.reset();
}

export function track(type: EventType, payload?: Record<string, unknown>, element?: Element | null): void {
  getCollectorClient()?.track(type as CollectorEventType, payload, element);
}

export function flush(): void {
  getCollectorClient()?.flush();
}
