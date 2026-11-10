import { api, type Expense } from '../api';
import { icon } from '../icons';
import { dateLabel, formatEuro, h, monthLabel, shiftMonth, toast } from '../dom';
import { flush, pending, removePending } from '../queue';
import { renderForm } from './form';

type Row = Expense & { pending?: boolean };

export async function renderMonth(root: HTMLElement, month: string): Promise<void> {
  const body = h('div', { class: 'month-body' });
  const banner = h('p', { class: 'banner', hidden: true });
  // Bouton Actualiser dans la carte du total, loin des flèches de navigation.
  const refresh = h(
    'button',
    { class: 'icon small refresh', title: 'Actualiser', 'aria-label': 'Actualiser', onclick: () => load(true) },
    icon('refresh', 18),
  );

  root.replaceChildren(
    h(
      'div',
      { class: 'month-nav' },
      h('a', { class: 'icon', href: '#/month/' + shiftMonth(month, -1), 'aria-label': 'Mois précédent' }, icon('prev', 26)),
      h('h1', null, monthLabel(month)),
      h('a', { class: 'icon', href: '#/month/' + shiftMonth(month, 1), 'aria-label': 'Mois suivant' }, icon('next', 26)),
    ),
    banner,
    body,
  );

  async function draw(list: Expense[]) {
    const queued: Row[] = (await pending())
      .filter((x) => x.date.startsWith(month))
      .map(({ photo: _p, ...x }) => ({ ...x, pending: true }));
    const rows: Row[] = [...queued, ...list.filter((x) => !queued.some((q) => q.id === x.id))].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    );

    const total = rows.reduce((s, x) => s + x.amount, 0);
    const unpaid = rows.filter((x) => !x.paidAt).reduce((s, x) => s + x.amount, 0);
    const allPaid = rows.length > 0 && rows.every((x) => x.paidAt);
    const paidDate = allPaid ? rows.map((x) => x.paidAt!).sort().pop()!.slice(0, 10) : '';
    // Part du montant affiché pour laquelle un remboursement est attendu (Sécu, mutuelle…).
    const expected = rows.filter((x) => x.secu && (allPaid || !x.paidAt)).reduce((s, x) => s + x.amount, 0);

    const byCat = new Map<string, number>();
    for (const x of rows) byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.amount);

    const summary = h(
      'section',
      { class: 'card summary' + (allPaid ? ' paid' : '') },
      refresh,
      h('p', { class: 'label' }, allPaid ? 'Remboursé' : 'À rembourser'),
      h(
        'div',
        { class: 'amount-row' },
        h('p', { class: 'amount' }, formatEuro(allPaid ? total : unpaid)),
        expected > 0
          ? h(
              'span',
              { class: 'expected', title: 'Remboursement attendu sur ce montant' },
              h('small', null, 'dont attendu'),
              formatEuro(expected),
            )
          : null,
      ),
      allPaid
        ? h('p', { class: 'sub' }, `le ${dateLabel(paidDate)}`)
        : unpaid !== total
          ? h('p', { class: 'sub' }, `sur ${formatEuro(total)} (une partie déjà remboursée)`)
          : h('p', { class: 'sub' }, `${rows.length} dépense${rows.length > 1 ? 's' : ''}`),
      rows.length
        ? h(
            'button',
            {
              // Action de fin de mois : visible mais secondaire, le total reste le point focal.
              class: 'outline',
              onclick: async (e: Event) => {
                const paid = !allPaid;
                const msg = paid
                  ? `Confirmer le remboursement de ${formatEuro(unpaid)} pour ${monthLabel(month)} ?`
                  : 'Annuler le remboursement de ce mois ?';
                if (!confirm(msg)) return;
                (e.target as HTMLButtonElement).disabled = true;
                try {
                  await api.markPaid(month, paid);
                  toast(paid ? 'Mois marqué comme remboursé' : 'Remboursement annulé');
                } catch (err) {
                  toast((err as Error).message, 'error');
                }
                load(true);
              },
            },
            allPaid ? [icon('x', 18), 'Annuler le remboursement'] : [icon('check', 18), 'Marquer comme remboursé'],
          )
        : null,
    );

    const cats = byCat.size
      ? h(
          'section',
          { class: 'card cats' },
          [...byCat]
            .sort((a, b) => b[1] - a[1])
            .map(([c, v]) =>
              h(
                'div',
                { class: 'cat' },
                h('span', null, c),
                h('strong', null, formatEuro(v)),
                h('span', { class: 'bar', style: `--w:${Math.max(2, Math.round((v / total) * 100))}%` }),
              ),
            ),
        )
      : null;

    const items = rows.length
      ? h(
          'ul',
          { class: 'list' },
          rows.map((x) =>
            h(
              'li',
              null,
              h(
                'button',
                { class: 'item', onclick: () => openDetail(x) },
                h(
                  'div',
                  null,
                  h('strong', null, x.store || x.category),
                  h(
                    'small',
                    null,
                    [dateLabel(x.date), x.store ? x.category : '', x.by].filter(Boolean).join(' · '),
                  ),
                ),
                h(
                  'div',
                  { class: 'right' },
                  h('strong', null, formatEuro(x.amount)),
                  x.secu ? h('span', { class: 'badge secu' }, 'Remb. attendu') : null,
                  x.pending
                    ? h('span', { class: 'badge warn' }, 'en attente')
                    : x.paidAt
                      ? h('span', { class: 'badge ok' }, 'remboursé')
                      : null,
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'empty' }, 'Aucune dépense ce mois-ci.', h('br'), h('a', { href: '#/add' }, 'Ajouter une dépense'));

    body.replaceChildren(summary, cats ?? '', items);
  }

  function openDetail(x: Row) {
    const img = h('img', { class: 'preview', alt: 'Ticket', hidden: true });
    const dialog: HTMLDialogElement = h(
      'dialog',
      { class: 'detail', onclose: () => dialog.remove() },
      h(
        'header',
        { class: 'detail-head' },
        h('p', { class: 'amount' }, formatEuro(x.amount)),
        h('p', { class: 'sub' }, x.store || x.category),
      ),
      h(
        'dl',
        null,
        h('dt', null, 'Date'),
        h('dd', null, dateLabel(x.date)),
        h('dt', null, 'Catégorie'),
        h('dd', null, x.category),
        h('dt', null, 'Remb. attendu'),
        h('dd', null, x.secu ? 'Oui' : 'Non'),
        x.note ? [h('dt', null, 'Note'), h('dd', null, x.note)] : null,
        x.by ? [h('dt', null, 'Saisi par'), h('dd', null, x.by)] : null,
        x.paidAt ? [h('dt', null, 'Remboursé'), h('dd', null, dateLabel(x.paidAt.slice(0, 10)))] : null,
      ),
      x.pending ? h('p', { class: 'hint' }, "Pas encore envoyée (en attente de réseau).") : null,
      img,
      h(
        'div',
        { class: 'actions' },
        x.photoId
          ? h(
              'button',
              {
                onclick: async (e: Event) => {
                  const btn = e.target as HTMLButtonElement;
                  btn.disabled = true;
                  btn.textContent = 'Chargement…';
                  try {
                    const p = await api.photo(x.photoId!);
                    img.src = `data:${p.mime};base64,${p.base64}`;
                    img.hidden = false;
                    btn.remove();
                  } catch (err) {
                    toast((err as Error).message, 'error');
                    btn.disabled = false;
                    btn.textContent = 'Voir le ticket';
                  }
                },
              },
              'Voir le ticket',
            )
          : null,
        !x.pending
          ? h(
              'button',
              {
                onclick: () => {
                  dialog.close();
                  openEdit(x);
                },
              },
              'Modifier',
            )
          : null,
        h(
          'button',
          {
            class: 'danger',
            onclick: async () => {
              if (!confirm('Supprimer cette dépense' + (x.photoId ? ' et sa photo' : '') + ' ?')) return;
              try {
                if (x.pending) await removePending(x.id);
                else await api.remove(x.id);
                toast('Supprimée');
                dialog.close();
                load(true);
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            },
          },
          'Supprimer',
        ),
        h('button', { onclick: () => dialog.close() }, 'Fermer'),
      ),
    );
    document.body.append(dialog);
    dialog.showModal();
  }

  /** Formulaire de modification dans une popin, avec bouton Annuler. */
  function openEdit(x: Expense) {
    const content = h('div');
    const dialog: HTMLDialogElement = h('dialog', { class: 'detail edit', onclose: () => dialog.remove() }, content);
    renderForm(
      content,
      x,
      () => {
        dialog.close();
        load(true);
      },
      () => dialog.close(),
    );
    document.body.append(dialog);
    dialog.showModal();
  }

  async function load(force = false) {
    const cached = api.cachedList(month);
    if (cached && !force) await draw(cached);
    else if (!cached) body.replaceChildren(h('p', { class: 'empty' }, 'Chargement…'));
    refresh.classList.add('spin');
    try {
      await flush();
      await draw(await api.list(month));
      banner.hidden = true;
    } catch (err) {
      banner.hidden = false;
      banner.textContent = (cached ? 'Données hors ligne. ' : '') + (err as Error).message;
      if (!cached) await draw([]);
    } finally {
      refresh.classList.remove('spin');
    }
  }

  await load();
}
