import { describe, expect, it } from 'vitest';
import { findAmounts, parseDate, parseReceipt, parseStore, parseTotal } from './parse';

const TODAY = new Date(2026, 10, 9);

describe('findAmounts', () => {
  it('lit les formats français', () => {
    expect(findAmounts('LAIT 1,25 €')).toEqual([1.25]);
    expect(findAmounts('TOTAL 1 234,56')).toEqual([1234.56]);
    expect(findAmounts('TOTAL 12. 50')).toEqual([12.5]);
    expect(findAmounts('2 x 3,10 6,20')).toEqual([3.1, 6.2]);
  });
});

describe('parseTotal', () => {
  it('supermarché avec sous-total, TVA et paiement CB', () => {
    const text = `CARREFOUR MARKET
LAIT DEMI ECREME     1,15
PAIN DE MIE          2,39
SOUS-TOTAL           3,54
REMISE FIDELITE     -0,50
TOTAL A PAYER        3,04
CB                   3,04
TVA 5,5%  HT 2,88  TVA 0,16
NB ARTICLES 2`;
    expect(parseTotal(text)).toBe(3.04);
  });

  it('erreurs OCR sur le mot TOTAL', () => {
    expect(parseTotal('PRODUIT 4,20\nT0TAL TTC 18,75\nTVA 20% 3,13')).toBe(18.75);
  });

  it('montant sur la ligne suivante', () => {
    expect(parseTotal('PHARMACIE\nNET À PAYER\n27,90 EUR\nMERCI')).toBe(27.9);
  });

  it('ignore espèces et rendu', () => {
    const text = `BOULANGERIE
BAGUETTE 1,20
TOTAL 5,60
ESPECES 10,00
RENDU 4,40`;
    expect(parseTotal(text)).toBe(5.6);
  });

  it('total HT ne prime pas sur TTC', () => {
    expect(parseTotal('TOTAL HT 50,00\nTOTAL TVA 10,00\nTOTAL TTC 60,00')).toBe(60);
  });

  it('repli sur le montant répété', () => {
    expect(parseTotal('ARTICLE 3,00\nARTICLE 9,50\n12,50\nVISA 12,50')).toBe(12.5);
  });

  it('rien trouvé', () => {
    expect(parseTotal('MERCI DE VOTRE VISITE')).toBeNull();
  });
});

describe('parseDate', () => {
  it('formats courants', () => {
    expect(parseDate('LE 05/11/2026 A 18:32', TODAY)).toBe('2026-11-05');
    expect(parseDate('05.11.26 18:32', TODAY)).toBe('2026-11-05');
    expect(parseDate('Date: 5-11-2026', TODAY)).toBe('2026-11-05');
  });
  it('rejette les dates impossibles ou futures', () => {
    expect(parseDate('31/02/2026', TODAY)).toBeNull();
    expect(parseDate('01/01/2030', TODAY)).toBeNull();
  });
});

describe('parseStore', () => {
  it('prend la première ligne de lettres', () => {
    expect(parseStore('*** E.LECLERC ***\n12 rue de Paris')).toBe('E Leclerc');
    expect(parseStore('BIENVENUE\nPHARMACIE DU CENTRE')).toBe('Pharmacie Du Centre');
  });
});

describe('parseReceipt', () => {
  it('combine tout', () => {
    expect(parseReceipt('LIDL\n08/11/2026\nTOTAL 42,17\nCB 42,17', TODAY)).toEqual({
      total: 42.17,
      date: '2026-11-08',
      store: 'Lidl',
    });
  });
});
