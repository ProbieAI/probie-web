// Structural overlay signals shared by the browser collector and unit tests.
// These checks deliberately use attributes rather than page copy: they are
// only deciding whether a surface has an intentionally persistent contract,
// and only the resulting surface category is added to a stuck event.

export type PersistentOverlayKind = "consent" | "support" | "persistent";

const CONSENT_TOKENS = [
  "cmp",
  "consent",
  "cookie",
  "cookiebot",
  "didomi",
  "gdpr",
  "iubenda",
  "onetrust",
  "optanon",
  "osano",
  "privacy",
  "termly",
  "trustarc",
];

const SUPPORT_TOKENS = [
  "beacon",
  "chat",
  "crisp",
  "drift",
  "helpscout",
  "hubspot",
  "intercom",
  "livechat",
  "messenger",
  "support",
  "tawk",
  "zendesk",
];

const PERSISTENT_TOKENS = ["announcement", "banner", "feedback", "notification", "persistent", "snackbar", "toast"];
const DISMISS_TOKENS = ["cancel", "close", "collapse", "dismiss", "hide", "minimize"];
const CONSENT_ACTION_TOKENS = ["accept", "agree", "allow", "decline", "reject"];

function attr(el: Element, name: string): string {
  try {
    return el.getAttribute(name) || "";
  } catch (_e) {
    return "";
  }
}

function structuralText(el: Element): string {
  return [
    attr(el, "id"),
    attr(el, "class"),
    attr(el, "role"),
    attr(el, "aria-label"),
    attr(el, "title"),
    attr(el, "name"),
    attr(el, "data-testid"),
    attr(el, "data-action"),
    attr(el, "data-dismiss"),
    attr(el, "data-bs-dismiss"),
    attr(el, "data-cookieconsent"),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsToken(text: string, tokens: string[]): boolean {
  if (!text) return false;
  const padded = " " + text + " ";
  for (let i = 0; i < tokens.length; i++) {
    if (padded.indexOf(" " + tokens[i] + " ") !== -1) return true;
  }
  return false;
}

/**
 * Cookie/consent surfaces, support widgets, and live-region notifications are
 * expected to remain visible while the user continues working. Their mere
 * persistence is therefore not evidence that dismissal is broken.
 */
export function persistentOverlayKind(el: Element): PersistentOverlayKind | null {
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 4) {
    const text = structuralText(node);
    if (containsToken(text, CONSENT_TOKENS)) return "consent";
    if (containsToken(text, SUPPORT_TOKENS)) return "support";
    if (containsToken(text, PERSISTENT_TOKENS)) return "persistent";
    const role = attr(node, "role").toLowerCase();
    const live = attr(node, "aria-live").toLowerCase();
    if (role === "status" || role === "log" || role === "banner" || (live && live !== "off")) {
      return "persistent";
    }
    node = node.parentElement;
    depth++;
  }
  return null;
}

/**
 * Outside-click and Escape only carry a dismissal contract for transient UI.
 * A labelled close/consent action is direct evidence for every surface kind.
 */
export function dismissGestureCarriesEvidence(kind: PersistentOverlayKind | null, via: string): boolean {
  return via === "close_control" || kind === null;
}

/** A click on an explicitly-labelled close control is direct friction proof. */
export function isExplicitDismissControl(target: Element, overlay: Element): boolean {
  const kind = persistentOverlayKind(overlay);
  let node: Element | null = target;
  let depth = 0;
  while (node && depth < 5) {
    const text = structuralText(node);
    if (
      containsToken(text, DISMISS_TOKENS) ||
      (kind === "consent" && containsToken(text, CONSENT_ACTION_TOKENS)) ||
      attr(node, "data-dismiss").length > 0 ||
      attr(node, "data-bs-dismiss").length > 0
    ) {
      return true;
    }
    if (node === overlay) break;
    node = node.parentElement;
    depth++;
  }
  return false;
}
