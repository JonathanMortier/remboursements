// Notifications push : chargé par le service worker généré (workbox importScripts).

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Remboursements', {
      body: data.body || '',
      tag: data.tag,
      icon: 'pwa-192x192.png',
      badge: 'badge-96x96.png',
      lang: 'fr',
      data: { url: data.url || '' },
    }),
  );
});

// Appui sur la notification : ramène l'appli au premier plan sur le bon mois.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((c) => c.url.startsWith(self.registration.scope));
      if (client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
