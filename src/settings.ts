export interface Settings {
  url: string;
  secret: string;
  name: string;
}

const KEY = 'remb.settings';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

export function getSettings(): Settings {
  try {
    return { url: '', secret: '', name: '', ...JSON.parse(safeGet(KEY) ?? '{}') };
  } catch {
    return { url: '', secret: '', name: '' };
  }
}

export function saveSettings(s: Settings): void {
  safeSet(KEY, JSON.stringify(s));
}

export function isConfigured(): boolean {
  const s = getSettings();
  return Boolean(s.url && s.secret);
}

/** Petit cache JSON (dernière liste du mois, catégories) pour l'affichage hors ligne. */
export function cacheGet<T>(key: string): T | null {
  try {
    const v = safeGet('remb.cache.' + key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown): void {
  safeSet('remb.cache.' + key, JSON.stringify(value));
}

/** Code de configuration à partager avec l'autre téléphone (URL + secret). */
export function exportConfigCode(): string {
  const { url, secret } = getSettings();
  return btoa(unescape(encodeURIComponent(JSON.stringify({ url, secret }))));
}

export function importConfigCode(code: string): { url: string; secret: string } {
  const parsed = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  if (!parsed.url || !parsed.secret) throw new Error('Code invalide');
  return { url: parsed.url, secret: parsed.secret };
}
