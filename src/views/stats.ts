import type { Expense } from '../api';
import { formatEuro, h } from '../dom';

/** Répartition par catégorie (barres). Avec `onSelect`, chaque ligne devient un bouton de filtre. */
export function categoryBars(
  rows: Pick<Expense, 'category' | 'amount'>[],
  opts: { active?: string | null; onSelect?: (category: string) => void } = {},
): HTMLElement | null {
  const byCat = new Map<string, number>();
  for (const x of rows) byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.amount);
  if (!byCat.size) return null;
  const total = rows.reduce((s, x) => s + x.amount, 0) || 1;
  const { active = null, onSelect } = opts;

  return h(
    'section',
    { class: 'card cats' + (active ? ' filtering' : '') },
    [...byCat]
      .sort((a, b) => b[1] - a[1])
      .map(([c, v]) => {
        const content = [
          h('span', null, c),
          h('strong', null, formatEuro(v)),
          h('span', { class: 'bar', style: `--w:${Math.max(2, Math.round((v / total) * 100))}%` }),
        ];
        return onSelect
          ? h(
              'button',
              {
                type: 'button',
                class: 'cat' + (c === active ? ' active' : ''),
                'aria-pressed': String(c === active),
                'aria-label': `${c} : ${formatEuro(v)}. ${c === active ? 'Retirer le filtre' : 'Filtrer la liste'}`,
                onclick: () => onSelect(c),
              },
              content,
            )
          : h('div', { class: 'cat' }, content);
      }),
  );
}
