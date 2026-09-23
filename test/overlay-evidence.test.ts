import { describe, expect, it } from 'vitest';
import {
  dismissGestureCarriesEvidence,
  isExplicitDismissControl,
  persistentOverlayKind,
} from '../src/overlay-evidence.js';

interface FakeElementInit {
  tag?: string;
  attrs?: Record<string, string>;
  parent?: Element | null;
}

function element({ tag = 'div', attrs = {}, parent = null }: FakeElementInit = {}): Element {
  const el = {
    tagName: tag.toUpperCase(),
    parentElement: parent,
    getAttribute(name: string) {
      if (name === 'id') return attrs.id ?? '';
      if (name === 'class') return attrs.class ?? '';
      return attrs[name] ?? null;
    },
  };
  return el as unknown as Element;
}

describe('widget overlay evidence', () => {
  it('recognizes consent UI as intentionally persistent', () => {
    const shell = element({ attrs: { id: 'cookie-consent-banner', class: 'onetrust-cmp-shell' } });
    const dialog = element({ attrs: { role: 'dialog' }, parent: shell });

    expect(persistentOverlayKind(dialog)).toBe('consent');
  });

  it('recognizes chat/support and live-region surfaces as intentionally persistent', () => {
    expect(persistentOverlayKind(element({ attrs: { class: 'intercom-messenger-frame' } }))).toBe('support');
    expect(persistentOverlayKind(element({ attrs: { role: 'status', 'aria-live': 'polite' } }))).toBe('persistent');
  });

  it('keeps ordinary menus and product dialogs eligible for stuck detection', () => {
    expect(persistentOverlayKind(element({ attrs: { id: 'project-menu', role: 'menu' } }))).toBeNull();
    expect(persistentOverlayKind(element({ attrs: { id: 'delete-project', role: 'dialog' } }))).toBeNull();
  });

  it('requires explicit close evidence for intentionally persistent surfaces', () => {
    expect(dismissGestureCarriesEvidence('consent', 'outside_click')).toBe(false);
    expect(dismissGestureCarriesEvidence('support', 'escape')).toBe(false);
    expect(dismissGestureCarriesEvidence('persistent', 'close_control')).toBe(true);
    expect(dismissGestureCarriesEvidence(null, 'outside_click')).toBe(true);
    expect(dismissGestureCarriesEvidence(null, 'escape')).toBe(true);
  });

  it('treats an explicitly-labelled nested close button as direct evidence', () => {
    const overlay = element({ attrs: { class: 'intercom-messenger-frame' } });
    const button = element({ tag: 'button', attrs: { 'aria-label': 'Close support chat' }, parent: overlay });
    const icon = element({ tag: 'svg', parent: button });

    expect(isExplicitDismissControl(icon, overlay)).toBe(true);
  });

  it('treats a failed consent choice as direct friction, not mere visibility', () => {
    const overlay = element({ attrs: { id: 'privacy-consent-dialog' } });
    const accept = element({ tag: 'button', attrs: { 'data-action': 'accept-all' }, parent: overlay });

    expect(isExplicitDismissControl(accept, overlay)).toBe(true);
  });

  it('does not mistake an ordinary support action for dismissal', () => {
    const overlay = element({ attrs: { id: 'support-chat-dialog' } });
    const send = element({ tag: 'button', attrs: { 'data-action': 'send-message' }, parent: overlay });

    expect(isExplicitDismissControl(send, overlay)).toBe(false);
  });
});
