import { expect, test } from '@playwright/test';
import { configure, euro, listMonth, pickCategory, reset, seed } from './helpers';

test.beforeEach(async ({ page, request }) => {
  await reset(request);
  await configure(page);
});

test('ajout manuel d’une dépense, visible dans le mois', async ({ page, request }) => {
  await page.goto('/#/add');
  await page.fill('#amount', '23,40');
  await page.fill('#date', '2026-11-05');
  await pickCategory(page, 'Courses');
  await page.fill('#store', 'Carrefour');
  await page.getByRole('button', { name: 'Enregistrer la dépense' }).click();
  await expect(page.locator('#toast')).toContainText('enregistrés');

  const saved = await listMonth(request, '2026-11');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ amount: 23.4, category: 'Courses', store: 'Carrefour', by: 'Marie' });

  await page.goto('/#/month/2026-11');
  await expect(page.locator('.summary .amount')).toHaveText(euro('23,40'));
  await expect(page.locator('.list .item')).toHaveCount(1);
  await expect(page.locator('.list .item')).toContainText('Carrefour');
});

test('photo d’un ticket : total, date et magasin détectés', async ({ page }) => {
  test.slow(); // téléchargement du moteur OCR au premier passage
  await page.goto('/#/add');
  await page.locator('input[type=file]:not([capture])').setInputFiles('e2e/fixtures/ticket.png');
  await expect(page.locator('.ocr-status')).toContainText('Détecté', { timeout: 90_000 });
  await expect(page.locator('#amount')).toHaveValue('8,96');
  await expect(page.locator('#date')).toHaveValue('2026-11-07');
  await expect(page.locator('#store')).toHaveValue(/super u/i);
  await expect(page.locator('img.preview')).toBeVisible();
});

test('catégorie proposée d’après le magasin', async ({ page, request }) => {
  await seed(request, [{ id: 's1', date: '2026-11-02', amount: 40, category: 'Courses', store: 'Super U' }]);
  await page.goto('/#/month/2026-11'); // la liste du mois alimente la mémoire magasin → catégorie
  await expect(page.locator('.list .item')).toHaveCount(1);

  await page.goto('/#/add');
  await page.fill('#store', 'SUPER-U');
  await page.locator('#store').blur();
  await expect(page.getByRole('radio', { name: 'Courses' })).toBeChecked();
  await expect(page.locator('.hint.guess')).toBeVisible();

  // Un choix manuel n'est jamais écrasé.
  await pickCategory(page, 'Divers');
  await page.locator('#store').focus();
  await page.locator('#store').blur();
  await expect(page.getByRole('radio', { name: 'Divers' })).toBeChecked();
  await expect(page.locator('.hint.guess')).toBeHidden();
});

test('modifier (Annuler puis Enregistrer) et supprimer', async ({ page, request }) => {
  await seed(request, [{ id: 'e1', date: '2026-11-03', amount: 18.9, category: 'Pharma', store: 'Pharmacie' }]);
  page.on('dialog', (d) => d.accept());
  await page.goto('/#/month/2026-11');

  await page.locator('.list .item', { hasText: 'Pharmacie' }).click();
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page.fill('#amount', '99,00');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.summary .amount')).toHaveText(euro('18,90'));

  await page.locator('.list .item', { hasText: 'Pharmacie' }).click();
  await page.getByRole('button', { name: 'Modifier' }).click();
  await page.fill('#amount', '25,90');
  await pickCategory(page, 'Soins');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page.locator('.summary .amount')).toHaveText(euro('25,90'));
  expect((await listMonth(request, '2026-11'))[0]).toMatchObject({ amount: 25.9, category: 'Soins' });

  await page.locator('.list .item', { hasText: 'Pharmacie' }).click();
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.locator('.empty')).toContainText('Aucune dépense');
  expect(await listMonth(request, '2026-11')).toHaveLength(0);
});

test('filtre par catégorie dans la vue Mois', async ({ page, request }) => {
  await seed(request, [
    { id: 'f1', date: '2026-11-02', amount: 10, category: 'Courses', store: 'Lidl' },
    { id: 'f2', date: '2026-11-04', amount: 20, category: 'Courses', store: 'Super U' },
    { id: 'f3', date: '2026-11-06', amount: 5, category: 'Pharma', store: 'Pharmacie' },
  ]);
  await page.goto('/#/month/2026-11');
  await expect(page.locator('.list .item')).toHaveCount(3);

  await page.locator('button.cat', { hasText: 'Courses' }).click();
  await expect(page.locator('.list .item')).toHaveCount(2);
  await expect(page.locator('.filter-chip')).toContainText('Courses · 2 dépenses');
  await expect(page.locator('.summary .amount')).toHaveText(euro('35,00')); // le total reste celui du mois

  await page.locator('.filter-chip').click();
  await expect(page.locator('.list .item')).toHaveCount(3);
});

test('marquer le mois remboursé puis annuler', async ({ page, request }) => {
  await seed(request, [{ id: 'p1', date: '2026-11-02', amount: 12.5, category: 'Divers' }]);
  page.on('dialog', (d) => d.accept());
  await page.goto('/#/month/2026-11');

  await page.getByRole('button', { name: 'Marquer comme remboursé' }).click();
  await expect(page.locator('.summary .label')).toHaveText('Remboursé');
  await expect(page.locator('.list .badge.ok')).toHaveText('remboursé');

  await page.getByRole('button', { name: 'Annuler le remboursement' }).click();
  await expect(page.locator('.summary .label')).toHaveText('À rembourser');
});

test('hors ligne : la dépense attend puis part au retour du réseau', async ({ page, context, request }) => {
  await page.goto('/#/add');
  await expect(page.locator('.chips .chip')).toHaveCount(6);
  await context.setOffline(true);

  await page.fill('#amount', '7,20');
  await page.fill('#date', '2026-11-08');
  await pickCategory(page, 'Transports');
  await page.getByRole('button', { name: 'Enregistrer la dépense' }).click();
  await expect(page.locator('#toast')).toContainText('hors ligne');
  await expect(page.locator('.tabs .dot')).toHaveText('1');
  expect(await listMonth(request, '2026-11')).toHaveLength(0);

  await context.setOffline(false);
  await expect(page.locator('.tabs .dot')).toBeHidden({ timeout: 15_000 });
  expect(await listMonth(request, '2026-11')).toHaveLength(1);
});

test('vue année : totaux et accès à un mois', async ({ page, request }) => {
  await seed(request, [
    { id: 'y1', date: '2026-10-03', amount: 60, category: 'Soins', secu: true },
    { id: 'y2', date: '2026-11-02', amount: 40, category: 'Courses' },
  ]);
  await page.goto('/#/month/2026-11');
  await page.locator('.title-link').click();
  await expect(page).toHaveURL(/#\/year\/2026$/);
  await expect(page.locator('h1')).toHaveText('Année 2026');
  await expect(page.locator('.summary .amount')).toHaveText(euro('100,00'));
  await expect(page.locator('.summary .sub')).toContainText('dont attendu');
  await expect(page.locator('.chart .col:not(.nodata)')).toHaveCount(2);

  await page.locator('.list .item', { hasText: 'Octobre 2026' }).click();
  await expect(page).toHaveURL(/#\/month\/2026-10$/);
  await expect(page.locator('.summary .amount')).toHaveText(euro('60,00'));
});

test('thème sombre choisi dans les Réglages', async ({ page }) => {
  await page.goto('/#/settings');
  await page.locator('.segmented label', { hasText: 'Sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
