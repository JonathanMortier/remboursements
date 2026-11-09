import { cacheGet, cacheSet, getSettings } from './settings';

export interface Expense {
  id: string;
  date: string; // AAAA-MM-JJ
  amount: number;
  category: string;
  store: string;
  note: string;
  photoId?: string;
  by: string;
  createdAt?: string;
  paidAt?: string;
  /** Dépense de soin : remboursée (true) ou non (false) par la Sécu. Absent hors soins. */
  secu?: boolean;
}

/** Dépense à envoyer : peut contenir la photo en base64. */
export interface ExpenseInput extends Expense {
  photo?: string;
}

export const DEFAULT_CATEGORIES = ['Courses', 'Pharma', 'Psy', 'Magasins', 'Divers', 'Transports'];

/** Catégories de soins, pour lesquelles on indique le remboursement Sécu. */
export const isCare = (category: string) =>
  /pharma|psy|sant[ée]|soin|m[ée]dec|docteur|dentist|kin[ée]|ortho|optic|lunett|h[ôo]pital|labo/i.test(category);

export class NetworkError extends Error {}
export class ServerError extends Error {}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { url, secret } = getSettings();
  if (!url || !secret) throw new ServerError('Appli non configurée (voir Réglages)');
  let res: Response;
  try {
    // text/plain = requête « simple » : pas de pré-vol CORS, qu'Apps Script ne sait pas gérer.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, action, ...payload }),
      redirect: 'follow',
    });
  } catch {
    throw new NetworkError('Pas de connexion');
  }
  let json: { ok: boolean; data?: T; error?: string };
  try {
    json = await res.json();
  } catch {
    throw new ServerError(`Réponse inattendue du serveur (${res.status}). Vérifie l'URL du script.`);
  }
  if (!json.ok) throw new ServerError(json.error ?? 'Erreur serveur');
  return json.data as T;
}

export const api = {
  async categories(): Promise<string[]> {
    try {
      const cats = await call<string[]>('categories');
      cacheSet('categories', cats);
      return cats;
    } catch {
      return cacheGet<string[]>('categories') ?? DEFAULT_CATEGORIES;
    }
  },
  cachedCategories(): string[] {
    return cacheGet<string[]>('categories') ?? DEFAULT_CATEGORIES;
  },
  async list(month: string): Promise<Expense[]> {
    const list = await call<Expense[]>('list', { month });
    cacheSet('month.' + month, list);
    return list;
  },
  cachedList(month: string): Expense[] | null {
    return cacheGet<Expense[]>('month.' + month);
  },
  add: (expense: ExpenseInput) => call<Expense>('add', { expense }),
  update: (expense: ExpenseInput) => call<Expense>('update', { expense }),
  remove: (id: string) => call<boolean>('delete', { id }),
  markPaid: (month: string, paid: boolean) => call<number>('markPaid', { month, paid }),
  photo: (photoId: string) => call<{ mime: string; base64: string }>('photo', { photoId }),
  ping: () => call<string[]>('categories'),
};
