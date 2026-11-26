import { CLIPBOARD_FORMAT, type MapClipboardPayload } from '../../../../shared/map';

const CLIPBOARD_STORAGE_KEY = 'agent_party_map_clipboard_v2';

export interface CopyResult {
  copied: boolean;
  method: 'clipboard' | 'execCommand' | 'manual';
}

/**
 * Copy text safely across HTTPS and plain HTTP LAN origins (`http://192.168.x.x`),
 * falling back to `document.execCommand('copy')` and focusing/selecting the visible
 * manual textarea if the browser blocks programmatic clipboard access.
 */
export async function copyTextSafe(
  text: string,
  manualTextarea?: HTMLTextAreaElement | null,
): Promise<CopyResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { copied: true, method: 'clipboard' };
    } catch {
      // fall through to execCommand
    }
  }

  try {
    const target = manualTextarea ?? document.createElement('textarea');
    const ephemeral = !manualTextarea;
    if (ephemeral) {
      target.value = text;
      target.setAttribute('readonly', '');
      target.style.position = 'fixed';
      target.style.top = '-9999px';
      target.style.left = '-9999px';
      target.style.opacity = '0';
      document.body.append(target);
    } else {
      target.value = text;
    }
    const prevFocus = document.activeElement as HTMLElement | null;
    target.focus();
    target.select();
    target.setSelectionRange(0, target.value.length);
    const ok = document.execCommand('copy');
    if (ephemeral) {
      target.remove();
      prevFocus?.focus?.();
    }
    if (ok) return { copied: true, method: 'execCommand' };
  } catch {
    // fall through to manual prompt
  }

  if (manualTextarea) {
    try {
      manualTextarea.value = text;
      manualTextarea.focus();
      manualTextarea.select();
      manualTextarea.setSelectionRange(0, manualTextarea.value.length);
    } catch {
      // ignore selection error
    }
  }
  return { copied: false, method: 'manual' };
}

export function saveMapClipboard(payload: MapClipboardPayload | null): void {
  try {
    if (!payload) {
      localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

export function loadMapClipboard(): MapClipboardPayload | null {
  try {
    const raw = localStorage.getItem(CLIPBOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MapClipboardPayload>;
    if (parsed?.format !== CLIPBOARD_FORMAT) return null;
    return parsed as MapClipboardPayload;
  } catch {
    return null;
  }
}

export function onMapClipboardChange(cb: (payload: MapClipboardPayload | null) => void): () => void {
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === CLIPBOARD_STORAGE_KEY) {
      cb(loadMapClipboard());
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
