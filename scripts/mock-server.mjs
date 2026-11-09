// Faux backend local qui imite le script Google (pour tester sans Google).
// Usage : node scripts/mock-server.mjs   → URL http://localhost:8787 , code secret : test
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const SECRET = 'test';
const categories = ['Courses', 'Pharma', 'Psy', 'Magasins', 'Divers', 'Transports'];
const expenses = [];
const photos = new Map();

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.end(JSON.stringify({ ok: true, data: 'mock OK' }));
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
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
          return send(x);
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
        case 'photo':
          return send({ mime: 'image/jpeg', base64: photos.get(r.photoId) });
        default:
          return send(null, 'Action inconnue');
      }
    } catch (e) {
      send(null, String(e));
    }
  });
}).listen(8787, () => console.log('Mock backend sur http://localhost:8787 (secret : test)'));
