import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const MOCK = 'http://localhost:8790';
export const euro = (s: string) => new RegExp(s.replace(',', ',') + '\\s€');

export interface Seed {
  id: string;
  date: string;
  amount: number;
  category: string;
  store?: string;
  by?: string;
  secu?: boolean;
}

async function call(request: APIRequestContext, body: Record<string, unknown>) {
  const res = await request.post(MOCK, { data: JSON.stringify({ secret: 'test', ...body }) });
  const json = await res.json();
  expect(json.ok, json.error).toBe(true);
  return json.data;
}

export const reset = (request: APIRequestContext) => call(request, { action: 'reset' });

export const seed = (request: APIRequestContext, list: Seed[]) =>
  Promise.all(
    list.map((x) => call(request, { action: 'add', expense: { store: '', note: '', by: 'Marie', ...x } })),
  );

export const listMonth = (request: APIRequestContext, month: string) => call(request, { action: 'list', month });

/** Appli configurée sur le faux backend, au nom de `name`. */
export async function configure(page: Page, name = 'Marie') {
  await page.addInitScript(
    ([url, name]) => {
      localStorage.setItem('remb.settings', JSON.stringify({ url, secret: 'test', name }));
    },
    [MOCK, name] as const,
  );
}

export async function pickCategory(page: Page, name: string) {
  await page.locator('.chips .chip', { hasText: new RegExp(`^${name}$`) }).click();
}
