import { api } from './api';
import { getSettings } from './settings';

export type PushState =
  | 'unsupported' // navigateur sans Web Push
  | 'install' // iPhone : il faut d'abord installer l'appli sur l'écran d'accueil
  | 'denied' // refusé dans les réglages du téléphone
  | 'off'
  | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // En développement il n'y a pas de service worker : on n'attend pas indéfiniment.
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  if (!('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'install' : 'unsupported';
  }
  if (!(await registration())) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSubscription()) ? 'on' : 'off';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** À appeler depuis un appui sur un bouton (exigé par iOS pour la demande d'autorisation). */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Autorisation refusée');
  const { publicKey } = await api.pushConfig();
  if (!publicKey) throw new Error("Les notifications ne sont pas encore configurées dans le script Google (voir README)");
  const reg = await registration();
  if (!reg) throw new Error('Service worker indisponible');
  let sub = await reg.pushManager.getSubscription();
  // Clé VAPID changée côté serveur : on repart d'un abonnement neuf.
  const current = sub?.options.applicationServerKey;
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))) !== btoa(String.fromCharCode(...keyBytes(publicKey)))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api.subscribe(sub.toJSON(), getSettings().name);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.unsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

export async function testPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Notifications désactivées sur cet appareil');
  await api.pushTest(sub.endpoint);
}

/** Après un changement de prénom : met à jour l'abonnement côté script. */
export async function refreshSubscription(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await api.subscribe(sub.toJSON(), getSettings().name);
}
