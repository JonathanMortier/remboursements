import { api, type Expense } from '../api';
import { formatEuro, h, monthLabel } from '../dom';
import { icon } from '../icons';
import { pending } from '../queue';
import { categoryBars } from './stats';

const shortMonth = (m: number) =>
  new Date(2000, m, 1).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');

/** Vue année : total, histogramme des 12 mois, détail par mois et par catégorie. */
export async function renderYear(root: HTMLElement, year: number): Promise<void> {
  const body = h('div', { class: 'year-body' });
  const banner = h('p', { class: 'banner', hidden: true });
  const key = String(year);

  root.replaceChildren(
    h(
      'div',
      { class: 'month-nav' },
      h('a', { class: 'icon', href: `#/year/${year - 1}`, 'aria-label': 'Année précédente' }, icon('prev', 26)),
      h('h1', null, `Année ${year}`),
      h('a', { class: 'icon', href: `#/year/${year + 1}`, 'aria-label': 'Année suivante' }, icon('next', 26)),
    ),
    banner,
    body,
  );

  async function draw(list: Expense[]) {
    const queued = (await pending()).filter((x) => x.date.startsWith(key));
    const rows: Expense[] = [...queued.map(({ photo: _p, ...x }) => x), ...list.filter((x) => !queued.some((q) => q.id === x.id))];
    const sum = (l: Expense[]) => l.reduce((s, x) => s + x.amount, 0);

    const total = sum(rows);
    const unpaidRows = rows.filter((x) => !x.paidAt);
    const unpaid = sum(unpaidRows);
    const expected = sum(unpaidRows.filter((x) => x.secu));

    const months = Array.from({ length: 12 }, (_, i) => {
      const id = `${year}-${String(i + 1).padStart(2, '0')}`;
      const mRows = rows.filter((x) => x.date.startsWith(id));
      return { i, id, total: sum(mRows), unpaid: sum(mRows.filter((x) => !x.paidAt)), count: mRows.length };
    });
    const max = Math.max(...months.map((m) => m.total), 1);

    const summary = h(
      'section',
      { class: 'card summary' },
      h('p', { class: 'label' }, `Dépenses ${year}`),
      h('p', { class: 'amount' }, formatEuro(total)),
      h(
        'p',
        { class: 'sub' },
        rows.length === 0
          ? 'Aucune dépense cette année.'
          : unpaid > 0
            ? `Reste à rembourser : ${formatEuro(unpaid)}` + (expected > 0 ? ` · dont attendu ${formatEuro(expected)}` : '')
            : 'Tout est remboursé ✓',
      ),
    );

    const chart = h(
      'section',
      { class: 'card chart', 'aria-label': 'Dépenses par mois' },
      months.map((m) =>
        h(
          'a',
          {
            class: 'col' + (m.count ? '' : ' nodata'),
            href: `#/month/${m.id}`,
            'aria-label': `${monthLabel(m.id)} : ${formatEuro(m.total)}`,
          },
          h('span', { class: 'val' }, m.total ? String(Math.round(m.total)) : ''),
          h(
            'span',
            { class: 'track' },
            h('span', {
              class: 'fill' + (m.count && m.unpaid === 0 ? ' paid' : ''),
              style: `--h:${m.total ? Math.max(4, Math.round((m.total / max) * 100)) : 0}%`,
            }),
          ),
          h('span', { class: 'lbl' }, shortMonth(m.i)),
        ),
      ),
    );

    chart.append(
      h(
        'p',
        { class: 'legend' },
        h('span', null, h('i', { class: 'sw' }), 'à rembourser'),
        h('span', null, h('i', { class: 'sw paid' }), 'remboursé'),
      ),
    );

    const monthList = h(
      'ul',
      { class: 'list' },
      months
        .filter((m) => m.count)
        .reverse()
        .map((m) =>
          h(
            'li',
            null,
            h(
              'a',
              { class: 'item', href: `#/month/${m.id}` },
              h('div', null, h('strong', null, monthLabel(m.id)), h('small', null, `${m.count} dépense${m.count > 1 ? 's' : ''}`)),
              h(
                'div',
                { class: 'right' },
                h('strong', null, formatEuro(m.total)),
                m.unpaid === 0
                  ? h('span', { class: 'badge ok' }, 'remboursé')
                  : h('span', { class: 'badge warn' }, `${formatEuro(m.unpaid)} à rembourser`),
              ),
            ),
          ),
        ),
    );

    body.replaceChildren(summary, rows.length ? chart : '', categoryBars(rows) ?? '', rows.length ? monthList : '');
  }

  const cached = api.cachedList(key);
  if (cached) await draw(cached);
  else body.replaceChildren(h('p', { class: 'empty' }, 'Chargement…'));
  try {
    await draw(await api.list(key));
    banner.hidden = true;
  } catch (err) {
    banner.hidden = false;
    banner.textContent = (cached ? 'Données hors ligne. ' : '') + (err as Error).message;
    if (!cached) await draw([]);
  }
}
