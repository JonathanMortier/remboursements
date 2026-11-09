import { api, isCare, NetworkError, type Expense, type ExpenseInput } from '../api';
import { formatEuro, h, parseAmount, toast, todayIso, uuid } from '../dom';
import { icon } from '../icons';
import { compressForUpload, loadImage } from '../image';
import { readReceipt, warmUpOcr } from '../ocr';
import { enqueue, flush } from '../queue';
import { getSettings } from '../settings';

/** Formulaire d'ajout (initial absent) ou de modification d'une dépense. */
export function renderForm(
  root: HTMLElement,
  initial?: Expense,
  onSaved?: (e: Expense) => void,
  onCancel?: () => void,
): void {
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
    value: initial ? initial.amount.toFixed(2).replace('.', ',') : '',
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
  // Catégories en pastilles : un seul tap, tous les choix visibles.
  let categoryValue = initial?.category ?? '';
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'category-label' });
  function drawChips(list: string[]) {
    const all = [...new Set([...list, ...(categoryValue && !list.includes(categoryValue) ? [categoryValue] : [])])];
    chips.replaceChildren(
      ...all.map((c) =>
        h(
          'label',
          { class: 'chip' },
          h('input', {
            type: 'radio',
            name: 'category',
            value: c,
            checked: c === categoryValue,
            onchange: () => {
              categoryValue = c;
              updateSecu();
            },
          }),
          h('span', null, c),
        ),
      ),
    );
  }
  drawChips(api.cachedCategories());
  const store = h('input', {
    id: 'store',
    type: 'text',
    placeholder: 'Ex. Carrefour',
    value: initial?.store ?? '',
    oninput: () => touched.add('store'),
  });
  const note = h('input', { id: 'note', type: 'text', placeholder: 'Optionnel', value: initial?.note ?? '' });

  // Interrupteur « remboursé par la Sécu », visible seulement pour les soins.
  const secu = h('input', { id: 'secu', type: 'checkbox', role: 'switch', checked: initial?.secu === true });
  const secuRow = h(
    'label',
    { class: 'switch-row field', for: 'secu' },
    h('span', null, 'Remboursé par la Sécu'),
    secu,
  );
  function updateSecu() {
    secuRow.hidden = !isCare(categoryValue);
  }
  updateSecu();

  // Mise à jour des catégories depuis le Sheet (sans écraser la sélection).
  api.categories().then((fresh) => {
    drawChips(fresh);
    updateSecu();
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
        if (!categoryValue) return toast('Choisis une catégorie', 'error'), chips.querySelector('input')?.focus();

        const expense: ExpenseInput = {
          id: initial?.id ?? uuid(),
          date: date.value,
          amount: value,
          category: categoryValue,
          store: store.value.trim(),
          note: note.value.trim(),
          by: initial?.by ?? getSettings().name,
          secu: isCare(categoryValue) ? secu.checked : undefined,
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
      // En modification, la photo est secondaire : le seul bouton principal est « Enregistrer ».
      h('button', { type: 'button', class: editing ? '' : 'primary', onclick: () => camera.click() }, icon('camera'), 'Photo du ticket'),
      h('button', { type: 'button', onclick: () => gallery.click() }, icon('image'), 'Galerie'),
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
    h('label', { id: 'category-label' }, 'Catégorie'),
    chips,
    secuRow,
    h('label', { for: 'store' }, 'Magasin'),
    store,
    h('label', { for: 'note' }, 'Note'),
    note,
    submit,
    onCancel ? h('button', { type: 'button', class: 'cancel', onclick: onCancel }, 'Annuler') : null,
  );

  root.replaceChildren(h('h1', null, editing ? 'Modifier la dépense' : 'Nouvelle dépense'), form);
  if (!editing) warmUpOcr();
}
