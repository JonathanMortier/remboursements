/** Extraction du total, de la date et du magasin depuis le texte OCR d'un ticket de caisse. */

export interface ReceiptInfo {
  total: number | null;
  date: string | null; // AAAA-MM-JJ
  store: string | null;
}

// Montant : 12,50 / 12.50 / 1 234,56 / 12, 50 (espace parasite de l'OCR)
const AMOUNT_RE = /(?<![\d,.])(\d{1,3}(?:[ .]\d{3})+|\d{1,5})\s?[,.]\s?(\d{2})(?!\d)/g;

// Lignes du total, par priorité décroissante.
const KEYWORDS: { re: RegExp; score: number }[] = [
  { re: /NET\s*A\s*PAYER|TOTAL\s*A\s*PAYER|MONTANT\s*A\s*PAYER|TOTAL\s*TTC|MONTANT\s*TTC/, score: 3 },
  { re: /\bA\s*PAYER\b|\bTOTAL\b|\bTOTAL\s*EUR|\bTOTAL\s*€/, score: 2 },
  { re: /\bMONTANT\b|\bCARTE\b|\bCB\b|\bC\.B\b|PAIEMENT|DEBIT|SANS\s*CONTACT/, score: 1 },
];

// Lignes « TOTAL » qui ne sont pas le total payé.
const EXCLUDE_RE =
  /SOUS[\s-]*TOTAL|S\/TOTAL|TOTAL\s*H\.?T|TOTAL\s*TVA|\bTVA\b|REMISE|ECONOMI|AVANTAGE|FIDELITE|CAGNOTTE|POINTS|NB\.?\s*ART|ARTICLES?|RENDU|MONNAIE|ESPECES|TICKET\s*RESTO|\bHT\b/;

function normalizeLine(line: string): string {
  return line
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Version « lettres » d'une ligne pour détecter les mots-clés malgré les erreurs OCR (T0TAL, T0TA1…). */
function lettersOnly(line: string): string {
  return line.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/\|/g, 'I');
}

export function findAmounts(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const value = Number(m[1].replace(/[ .]/g, '') + '.' + m[2]);
    if (value > 0 && value < 100000) out.push(value);
  }
  return out;
}

export function parseTotal(text: string): number | null {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const candidates: { value: number; score: number }[] = [];

  lines.forEach((line, i) => {
    const keyLine = lettersOnly(line);
    if (EXCLUDE_RE.test(keyLine)) return;
    const kw = KEYWORDS.find((k) => k.re.test(keyLine));
    if (!kw) return;
    let amounts = findAmounts(line);
    // Montant parfois sur la ligne suivante (mise en page sur deux lignes).
    if (amounts.length === 0 && i + 1 < lines.length && !EXCLUDE_RE.test(lettersOnly(lines[i + 1]))) {
      amounts = findAmounts(lines[i + 1]);
    }
    if (amounts.length) candidates.push({ value: amounts[amounts.length - 1], score: kw.score });
  });

  if (candidates.length) {
    const best = Math.max(...candidates.map((c) => c.score));
    return Math.max(...candidates.filter((c) => c.score === best).map((c) => c.value));
  }

  // Repli : montant qui apparaît le plus souvent (total répété), sinon le plus grand.
  const all: number[] = [];
  for (const line of lines) {
    if (/RENDU|MONNAIE|ESPECES/.test(lettersOnly(line))) continue;
    all.push(...findAmounts(line));
  }
  if (!all.length) return null;
  const counts = new Map<number, number>();
  for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1);
  const repeated = [...counts].filter(([, n]) => n >= 2).map(([v]) => v);
  return Math.max(...(repeated.length ? repeated : all));
}

export function parseDate(text: string, today = new Date()): string | null {
  const re = /(?<!\d)(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{4}|\d{2})(?!\d)/g;
  const maxTime = today.getTime() + 2 * 86400000;
  const minTime = today.getTime() - 3 * 365 * 86400000;
  for (const m of text.matchAll(re)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    const date = new Date(y, mo - 1, d);
    if (date.getMonth() !== mo - 1) continue; // 31/02 etc.
    if (date.getTime() > maxTime || date.getTime() < minTime) continue;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

export function parseStore(text: string): string | null {
  for (const raw of text.split(/\r?\n/).slice(0, 6)) {
    const line = raw.replace(/[^\p{L}\p{N}' &\-]/gu, ' ').replace(/\s+/g, ' ').trim();
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (letters >= 3 && letters / line.length > 0.6 && !/BIENVENUE|TICKET|FACTURE/i.test(line)) {
      return line
        .toLowerCase()
        .replace(/(^|[\s\-'])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
        .slice(0, 40);
    }
  }
  return null;
}

export function parseReceipt(text: string, today = new Date()): ReceiptInfo {
  return { total: parseTotal(text), date: parseDate(text, today), store: parseStore(text) };
}
