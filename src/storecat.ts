import type { Expense } from './api';
import { safeGet, safeSet } from './settings';

/** Mémoire locale « magasin → catégorie » pour proposer la catégorie d'une nouvelle dépense. */
const KEY = 'remb.storecat';
type Counts = Record<string, Record<string, number>>; // magasin normalisé → { catégorie: nb }

export function normalize(store: string): string {
  return store
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function load(): Counts {
  try {
    return JSON.parse(safeGet(KEY) ?? '{}') as Counts;
  } catch {
    return {};
  }
}

/** Mémorise les dépenses vues (liste du mois ou dépense enregistrée). Idempotent par id. */
export function learn(expenses: Pick<Expense, 'id' | 'store' | 'category'>[]): void {
  const counts = load();
  let seen: Set<string>;
  try {
    seen = new Set<string>(JSON.parse(safeGet(KEY + '.ids') ?? '[]'));
  } catch {
    seen = new Set();
  }
  let changed = false;
  for (const x of expenses) {
    const store = normalize(x.store ?? '');
    if (!store || !x.category || seen.has(x.id)) continue;
    seen.add(x.id);
    counts[store] ??= {};
    counts[store][x.category] = (counts[store][x.category] ?? 0) + 1;
    changed = true;
  }
  if (!changed) return;
  safeSet(KEY, JSON.stringify(counts));
  safeSet(KEY + '.ids', JSON.stringify([...seen].slice(-2000)));
}

/** Catégorie la plus utilisée pour ce magasin, parmi celles proposées. */
export function guess(store: string, categories: string[]): string | null {
  const byCat = load()[normalize(store)];
  if (!byCat) return null;
  const best = Object.entries(byCat)
    .filter(([c]) => categories.includes(c))
    .sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}
