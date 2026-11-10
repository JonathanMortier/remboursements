import { beforeEach, describe, expect, it } from 'vitest';
import { guess, learn, normalize } from './storecat';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage;
});
const cats = ['Courses', 'Pharma', 'Soins', 'Magasins', 'Divers', 'Transports'];

describe('catégorie devinée', () => {
  it('normalise les noms de magasin', () => {
    expect(normalize('  Super-U  Évry ')).toBe('super u evry');
  });

  it('propose la catégorie la plus fréquente pour un magasin', () => {
    learn([
      { id: '1', store: 'Super U', category: 'Courses' },
      { id: '2', store: 'SUPER U', category: 'Courses' },
      { id: '3', store: 'super-u', category: 'Divers' },
    ]);
    expect(guess('Super U', cats)).toBe('Courses');
    expect(guess('Carrefour', cats)).toBeNull();
  });

  it('ne compte pas deux fois la même dépense', () => {
    learn([{ id: '1', store: 'SNCF', category: 'Divers' }]);
    learn([{ id: '1', store: 'SNCF', category: 'Divers' }]);
    learn([{ id: '2', store: 'SNCF', category: 'Transports' }, { id: '3', store: 'SNCF', category: 'Transports' }]);
    expect(guess('sncf', cats)).toBe('Transports');
  });

  it('ignore une catégorie qui n’existe plus', () => {
    learn([{ id: '1', store: 'Cabinet', category: 'Psy' }]);
    expect(guess('Cabinet', cats)).toBeNull();
  });
});
