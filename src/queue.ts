/** File d'attente hors ligne : les dépenses sont d'abord stockées dans IndexedDB puis envoyées. */
import { get, set } from 'idb-keyval';
import { api, NetworkError, type ExpenseInput } from './api';

const KEY = 'pending-expenses';
let flushing: Promise<FlushResult> | null = null;
const listeners = new Set<() => void>();

export interface FlushResult {
  sent: number;
  remaining: number;
  error?: string;
}

export async function pending(): Promise<ExpenseInput[]> {
  try {
    return (await get<ExpenseInput[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

async function save(list: ExpenseInput[]): Promise<void> {
  await set(KEY, list);
  listeners.forEach((fn) => fn());
}

export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function enqueue(expense: ExpenseInput): Promise<void> {
  const list = await pending();
  await save([...list.filter((x) => x.id !== expense.id), expense]);
}

export async function removePending(id: string): Promise<void> {
  await save((await pending()).filter((x) => x.id !== id));
}

export function flush(): Promise<FlushResult> {
  if (!flushing) {
    flushing = (async () => {
      let sent = 0;
      let error: string | undefined;
      for (const item of await pending()) {
        try {
          await api.add(item); // idempotent côté serveur (même id ignoré)
          await removePending(item.id);
          sent++;
        } catch (err) {
          error = err instanceof NetworkError ? undefined : (err as Error).message;
          break;
        }
      }
      return { sent, remaining: (await pending()).length, error };
    })().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}
