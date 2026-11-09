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

/** Thème d'affichage : suivre le téléphone, ou forcer clair / sombre. */
export type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'remb.theme';

export function getTheme(): Theme {
  const t = safeGet(THEME_KEY);
  return t === 'light' || t === 'dark' ? t : 'auto';
}

export function setTheme(t: Theme): void {
  safeSet(THEME_KEY, t);
  applyTheme();
}

export function applyTheme(): void {
  const t = getTheme();
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
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

/** Seules les URL Apps Script sont acceptées : un lien piégé ne peut pas détourner le code secret. */
export function isValidScriptUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'script.google.com' && u.pathname.startsWith('/macros/');
  } catch {
    return false;
  }
}

/** Lien d'installation avec l'URL du script en paramètre (pour le QR code). */
export function installLink(): string {
  const link = new URL(import.meta.env.BASE_URL, location.origin);
  link.searchParams.set('script', getSettings().url);
  return link.toString();
}

/** Au démarrage : pré-remplit l'URL du script depuis ?script=… si elle n'est pas encore configurée. */
export function applyScriptParam(): void {
  const param = new URLSearchParams(location.search).get('script');
  if (!param || !isValidScriptUrl(param)) return;
  const s = getSettings();
  if (!s.url) saveSettings({ ...s, url: param });
}

/** Code de configuration à partager avec l'autre téléphone (URL + secret). */
export function exportConfigCode(): string {
  const { url, secret } = getSettings();
  return btoa(unescape(encodeURIComponent(JSON.stringify({ url, secret }))));
}

export function importConfigCode(code: string): { url: string; secret: string } {
  const parsed = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  if (!parsed.url || !parsed.secret || !isValidScriptUrl(parsed.url)) throw new Error('Code invalide');
  return { url: parsed.url, secret: parsed.secret };
}
