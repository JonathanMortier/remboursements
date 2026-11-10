// Faux backend local qui imite le script Google (pour tester sans Google).
// Usage : node scripts/mock-server.mjs   → URL http://localhost:8787 , code secret : test
// (autre port : PORT=8788 node scripts/mock-server.mjs)
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { b64urlEncode, sendPush } from '../worker/src/webpush.js';

const SECRET = 'test';
const PORT = Number(process.env.PORT) || 8787;
const categories = ['Courses', 'Pharma', 'Soins', 'Magasins', 'Divers', 'Transports'];
const expenses = [];
const photos = new Map();

// Notifications : clés VAPID générées au démarrage, envoi direct (comme le Worker Cloudflare).
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapid = {
  publicKey: b64urlEncode(await crypto.subtle.exportKey('raw', pair.publicKey)),
  privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d,
  subject: 'mailto:test@example.com',
};
const subs = new Map(); // endpoint → { name, subscription }
async function notify(targets, payload) {
  let sent = 0;
  for (const [endpoint, s] of targets) {
    const status = await sendPush(s.subscription, JSON.stringify(payload), vapid).catch((e) => (console.error(e), 0));
    console.log('push', status, endpoint.slice(0, 60));
    if (status === 404 || status === 410) subs.delete(endpoint);
    if (status >= 200 && status < 300) sent++;
  }
  return sent;
}

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.end(JSON.stringify({ ok: true, data: 'mock OK' }));
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const send = (data, error) => res.end(JSON.stringify(error ? { ok: false, error } : { ok: true, data }));
    try {
      const r = JSON.parse(body);
      if (r.secret !== SECRET) return send(null, 'Code secret invalide');
      const find = (id) => expenses.findIndex((x) => x.id === id);
      switch (r.action) {
        case 'categories':
          return send(categories);
        case 'list':
          return send(expenses.filter((x) => x.date.startsWith(r.month)).sort((a, b) => b.date.localeCompare(a.date)));
        case 'add': {
          const { photo, ...x } = r.expense;
          if (find(x.id) >= 0) return send(expenses[find(x.id)]);
          if (photo) photos.set((x.photoId = randomUUID()), photo);
          expenses.push({ ...x, createdAt: new Date().toISOString(), paidAt: '' });
          send(x);
          const others = [...subs].filter(([, s]) => s.name !== x.by);
          const details = [x.category, x.store, x.date.split('-').reverse().slice(0, 2).join('/')].filter(Boolean);
          const amount = x.amount.toFixed(2).replace('.', ',') + ' €';
          const body = [details.join(' · '), x.secu ? 'Remboursement attendu' : '', x.note].filter(Boolean).join('\n');
          await notify(others, { title: `${x.by} a ajouté ${amount}`, body, tag: 'expense-' + x.id, url: '#/month/' + x.date.slice(0, 7) });
          return;
        }
        case 'update': {
          const i = find(r.expense.id);
          if (i < 0) return send(null, 'Dépense introuvable');
          const { photo, ...x } = r.expense;
          if (photo) photos.set((x.photoId = randomUUID()), photo);
          expenses[i] = { ...expenses[i], ...x };
          return send(expenses[i]);
        }
        case 'delete': {
          const i = find(r.id);
          if (i >= 0) expenses.splice(i, 1);
          return send(true);
        }
        case 'markPaid': {
          let n = 0;
          for (const x of expenses) if (x.date.startsWith(r.month)) (x.paidAt = r.paid === false ? '' : new Date().toISOString()), n++;
          return send(n);
        }
        case 'pushConfig':
          return send({ publicKey: vapid.publicKey });
        case 'subscribe':
          subs.set(r.subscription.endpoint, { name: r.name, subscription: r.subscription });
          return send(true);
        case 'unsubscribe':
          subs.delete(r.endpoint);
          return send(true);
        case 'pushTest': {
          const s = subs.get(r.endpoint);
          if (!s) return send(null, 'Cet appareil n’est pas abonné');
          const sent = await notify([[r.endpoint, s]], { title: 'Notifications activées ✓', body: 'Test depuis le faux backend.', tag: 'test', url: '#/month' });
          return sent ? send({ sent }) : send(null, 'Envoi refusé par le service de notifications');
        }
        case 'recapTest': {
          // Récap du mois demandé (ou du mois précédent), comme recapMensuel() du script Google.
          const d = new Date();
          const month = r.month ?? new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 7);
          const rows = expenses.filter((x) => x.date.startsWith(month));
          if (!rows.length) return send({ sent: 0 });
          const eur = (n) => n.toFixed(2).replace('.', ',') + ' €';
          const sum = (l) => l.reduce((t, x) => t + x.amount, 0);
          const unpaid = rows.filter((x) => !x.paidAt);
          const expected = sum(unpaid.filter((x) => x.secu));
          const nom = new Date(month + '-01').toLocaleDateString('fr-FR', { month: 'long' });
          const title = unpaid.length ? `Récap ${/^[aeiou]/.test(nom) ? 'd’' : 'de '}${nom}` : `${nom} est entièrement remboursé ✓`;
          const body = `${eur(sum(unpaid.length ? unpaid : rows))}${unpaid.length ? ' à rembourser' : ''} · ${rows.length} dépense(s)` +
            (expected ? `\ndont ${eur(expected)} de remboursement attendu` : '');
          return send({ sent: await notify([...subs], { title, body, tag: 'recap-' + month, url: '#/month/' + month }) });
        }
        case 'reset':
          // Tests E2E : repart d'un faux backend vide.
          expenses.length = 0;
          photos.clear();
          subs.clear();
          return send(true);
        case 'photo':
          return send({ mime: 'image/jpeg', base64: photos.get(r.photoId) });
        default:
          return send(null, 'Action inconnue');
      }
    } catch (e) {
      send(null, String(e));
    }
  });
}).listen(PORT, () => console.log(`Mock backend sur http://localhost:${PORT} (secret : test)`));
