import { api, NetworkError, type Expense, type ExpenseInput } from '../api';
import { formatEuro, h, parseAmount, toast, todayIso, uuid } from '../dom';
import { compressForUpload, loadImage } from '../image';
import { readReceipt, warmUpOcr } from '../ocr';
import { enqueue, flush } from '../queue';
import { getSettings } from '../settings';

/** Formulaire d'ajout (initial absent) ou de modification d'une dépense. */
export function renderForm(root: HTMLElement, initial?: Expense, onSaved?: (e: Expense) => void): void {
  const editing = Boolean(initial);
  let photo: string | undefined; // base64 de la photo compressée
  const touched = new Set<string>();

  const amount = h('input', {
    id: 'amount',
    type: 'text',
    inputMode: 'decimal',
    placeholder: '0,00',
    autocomplete: 'off',
    required: true,
    value: initial ? String(initial.amount).replace('.', ',') : '',
    oninput: () => touched.add('amount'),
  });
  const date = h('input', {
    id: 'date',
    type: 'date',
    required: true,
    value: initial?.date ?? todayIso(),
    max: todayIso(),
    oninput: () => touched.add('date'),
  });
  const cats = api.cachedCategories();
  const category = h(
    'select',
    { id: 'category', required: true },
    h('option', { value: '' }, 'Choisir…'),
    cats.map((c) => h('option', { value: c, selected: initial?.category === c }, c)),
  );
  if (initial && !cats.includes(initial.category)) {
    category.append(h('option', { value: initial.category, selected: true }, initial.category));
  }
  const store = h('input', {
    id: 'store',
    type: 'text',
    placeholder: 'Ex. Carrefour',
    value: initial?.store ?? '',
    oninput: () => touched.add('store'),
  });
  const note = h('input', { id: 'note', type: 'text', placeholder: 'Optionnel', value: initial?.note ?? '' });

  // Mise à jour des catégories depuis le Sheet (sans écraser la sélection).
  api.categories().then((fresh) => {
    const selected = category.value;
    category.replaceChildren(
      h('option', { value: '' }, 'Choisir…'),
      ...[...new Set([...fresh, ...(selected && !fresh.includes(selected) ? [selected] : [])])].map((c) =>
        h('option', { value: c, selected: c === selected }, c),
      ),
    );
  });

  const preview = h('img', { class: 'preview', alt: 'Ticket', hidden: true });
  const status = h('p', { class: 'ocr-status', hidden: true });
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const rawText = h('pre', { class: 'raw' });
  const rawBox = h('details', { class: 'raw-box', hidden: true }, h('summary', null, 'Texte lu sur le ticket'), rawText);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    status.hidden = false;
    status.textContent = 'Chargement de la photo…';
    try {
      const img = await loadImage(file);
      photo = compressForUpload(img);
      preview.src = 'data:image/jpeg;base64,' + photo;
      preview.hidden = false;

      progress.hidden = false;
      progress.value = 0;
      status.textContent = 'Lecture du ticket…';
      const res = await readReceipt(img, (p, s) => {
        if (s.startsWith('recognizing')) {
          progress.value = p;
          status.textContent = `Lecture du ticket… ${Math.round(p * 100)} %`;
        } else if (s.includes('load')) {
          status.textContent = 'Préparation de la lecture (1re fois : quelques secondes)…';
        }
      });
      progress.hidden = true;
      rawText.textContent = res.text;
      rawBox.hidden = false;

      const found: string[] = [];
      if (res.total && !touched.has('amount')) {
        amount.value = res.total.toFixed(2).replace('.', ',');
        found.push('total ' + formatEuro(res.total));
      }
      if (res.date && !touched.has('date')) {
        date.value = res.date;
        found.push('date');
      }
      if (res.store && !touched.has('store') && !store.value) {
        store.value = res.store;
        found.push('magasin');
      }
      status.textContent = found.length
        ? `Détecté : ${found.join(', ')}. Vérifie avant d'enregistrer.`
        : 'Total non détecté, saisis-le à la main.';
      status.className = 'ocr-status ' + (res.total ? 'ok' : 'warn');
      if (!res.total) amount.focus();
    } catch (err) {
      progress.hidden = true;
      status.className = 'ocr-status warn';
      status.textContent = navigator.onLine
        ? 'Lecture impossible : ' + (err as Error).message
        : 'Lecture indisponible hors ligne la 1re fois. Saisis le montant à la main.';
    }
  }

  const camera = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    hidden: true,
    onchange: (e: Event) => onPhoto((e.target as HTMLInputElement).files?.[0]),
  });
  const gallery = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    onchange: (e: Event) => onPhoto((e.target as HTMLInputElement).files?.[0]),
  });

  const submit = h('button', { type: 'submit', class: 'primary big' }, editing ? 'Enregistrer les modifications' : 'Enregistrer la dépense');

  const form = h(
    'form',
    {
      class: 'card form',
      novalidate: true,
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const value = parseAmount(amount.value);
        if (!value) return toast('Montant invalide', 'error'), amount.focus();
        if (!date.value) return toast('Date manquante', 'error');
        if (!category.value) return toast('Choisis une catégorie', 'error'), category.focus();

        const expense: ExpenseInput = {
          id: initial?.id ?? uuid(),
          date: date.value,
          amount: value,
          category: category.value,
          store: store.value.trim(),
          note: note.value.trim(),
          by: initial?.by ?? getSettings().name,
          photo,
        };
        submit.disabled = true;
        try {
          if (editing) {
            const saved = await api.update(expense);
            toast('Modifiée');
            onSaved?.(saved);
          } else {
            await enqueue(expense);
            const r = await flush();
            if (r.error) toast('Enregistrée sur le téléphone, envoi en échec : ' + r.error, 'warn');
            else if (r.remaining) toast('Enregistrée hors ligne, envoi automatique au retour du réseau', 'warn');
            else toast(`${formatEuro(value)} enregistrés`);
            onSaved?.(expense);
          }
        } catch (err) {
          toast(err instanceof NetworkError ? 'Pas de connexion, réessaie plus tard' : (err as Error).message, 'error');
        } finally {
          submit.disabled = false;
        }
      },
    },
    h(
      'div',
      { class: 'photo-actions' },
      h('button', { type: 'button', class: 'primary', onclick: () => camera.click() }, '📷 Photo du ticket'),
      h('button', { type: 'button', onclick: () => gallery.click() }, '🖼️ Galerie'),
      camera,
      gallery,
    ),
    editing && initial?.photoId && !photo ? h('p', { class: 'hint' }, 'Une photo est déjà enregistrée. En choisir une nouvelle la remplacera.') : null,
    preview,
    progress,
    status,
    rawBox,
    h('label', { for: 'amount' }, 'Montant total (€)'),
    amount,
    h('label', { for: 'date' }, 'Date de la dépense'),
    date,
    h('label', { for: 'category' }, 'Catégorie'),
    category,
    h('label', { for: 'store' }, 'Magasin'),
    store,
    h('label', { for: 'note' }, 'Note'),
    note,
    submit,
  );

  root.replaceChildren(h('h1', null, editing ? 'Modifier la dépense' : 'Nouvelle dépense'), form);
  if (!editing) warmUpOcr();
}
