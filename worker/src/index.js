// Worker Cloudflare « remboursements-push » : relais d'envoi des notifications.
// Il ne stocke rien : le script Google lui transmet les abonnements et le message à chaque envoi.
//
// Secrets (npx wrangler secret put …) :
//   PUSH_SECRET        mot de passe partagé avec le script Google (propriété PUSH_SECRET)
//   VAPID_PUBLIC_KEY   clé publique VAPID (aussi dans le script Google)
//   VAPID_PRIVATE_KEY  clé privée VAPID (ne quitte jamais Cloudflare)
//   VAPID_SUBJECT      contact, ex. mailto:toi@example.com

import { sendPush } from './webpush.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Comparaison en temps constant du mot de passe. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !b) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'remboursements-push' });
    if (request.method !== 'POST' || url.pathname !== '/send') return json({ ok: false, error: 'Introuvable' }, 404);

    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!sameSecret(token, env.PUSH_SECRET)) return json({ ok: false, error: 'Non autorisé' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'JSON invalide' }, 400);
    }
    const subs = Array.isArray(body.subscriptions) ? body.subscriptions.slice(0, 20) : [];
    const payload = JSON.stringify(body.payload ?? {});
    const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };

    const results = await Promise.all(
      subs.map(async (s) => {
        try {
          return { endpoint: s.endpoint, status: await sendPush(s, payload, vapid) };
        } catch (err) {
          return { endpoint: s.endpoint, status: 0, error: String(err?.message ?? err) };
        }
      }),
    );
    return json({ ok: true, results });
  },
};
