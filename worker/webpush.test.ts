import { createECDH, randomBytes } from 'node:crypto';
// @ts-expect-error : pas de types pour http_ece (bibliothèque de référence utilisée par web-push)
import ece from 'http_ece';
import { describe, expect, it, vi } from 'vitest';
import worker from './src/index.js';
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from './src/webpush.js';

describe('Web Push', () => {
  it('chiffre un message que la bibliothèque de référence sait déchiffrer', async () => {
    const receiver = createECDH('prime256v1');
    receiver.generateKeys();
    const auth = randomBytes(16);
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: b64urlEncode(receiver.getPublicKey()), auth: b64urlEncode(auth) },
    };
    const message = JSON.stringify({ title: 'Marie a ajouté 18,90 €', body: 'Pharma · Pharmacie du Centre' });
    const body = await encryptPayload(sub, message);
    const clear = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: receiver, authSecret: auth });
    expect(clear.toString('utf8')).toBe(message);
  });

  it('signe un jeton VAPID valide pour l’origine du service push', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = b64urlEncode(await crypto.subtle.exportKey('raw', pair.publicKey));
    const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const header = await vapidAuthorization('https://web.push.apple.com/abc', {
      publicKey,
      privateKey: d!,
      subject: 'mailto:test@example.com',
    });
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(publicKey);
    const [h, c, s] = jwt.split('.');
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
    expect(claims.aud).toBe('https://web.push.apple.com');
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });
});

describe('Worker /send', () => {
  it('refuse un appel sans le bon mot de passe', async () => {
    const res = await worker.fetch(new Request('https://w/send', { method: 'POST', body: '{}' }), { PUSH_SECRET: 's3cret' });
    expect(res.status).toBe(401);
  });

  it('envoie le message chiffré à chaque abonnement et renvoie les statuts', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const env = {
      PUSH_SECRET: 's3cret',
      VAPID_PUBLIC_KEY: b64urlEncode(await crypto.subtle.exportKey('raw', pair.publicKey)),
      VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d,
      VAPID_SUBJECT: 'mailto:test@example.com',
    };
    const receiver = createECDH('prime256v1');
    receiver.generateKeys();
    const auth = randomBytes(16);
    const keys = { p256dh: b64urlEncode(receiver.getPublicKey()), auth: b64urlEncode(auth) };
    const subscriptions = [
      { endpoint: 'https://push.example/ok', keys },
      { endpoint: 'https://push.example/gone', keys },
    ];
    const received: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const clear = ece.decrypt(Buffer.from(init!.body as Uint8Array), {
        version: 'aes128gcm',
        privateKey: receiver,
        authSecret: auth,
      });
      received.push(clear.toString('utf8'));
      expect(new Headers(init!.headers).get('Authorization')).toMatch(/^vapid t=/);
      return new Response(null, { status: String(url).endsWith('gone') ? 410 : 201 });
    });
    const res = await worker.fetch(
      new Request('https://w/send', {
        method: 'POST',
        headers: { Authorization: 'Bearer s3cret' },
        body: JSON.stringify({ subscriptions, payload: { title: 'Test' } }),
      }),
      env,
    );
    fetchMock.mockRestore();
    const data = await res.json();
    expect(data.results.map((r: { status: number }) => r.status)).toEqual([201, 410]);
    expect(received).toEqual([JSON.stringify({ title: 'Test' }), JSON.stringify({ title: 'Test' })]);
  });
});
