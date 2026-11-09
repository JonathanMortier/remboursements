import { api } from '../api';
import { h, toast } from '../dom';
import { flush, pending } from '../queue';
import { exportConfigCode, getSettings, importConfigCode, saveSettings } from '../settings';

export async function renderSettings(root: HTMLElement): Promise<void> {
  const s = getSettings();
  const name = h('input', { id: 'name', type: 'text', placeholder: 'Ton prénom', value: s.name, required: true });
  const url = h('input', {
    id: 'url',
    type: 'url',
    placeholder: 'https://script.google.com/macros/s/…/exec',
    value: s.url,
    autocomplete: 'off',
  });
  const secret = h('input', { id: 'secret', type: 'password', value: s.secret, autocomplete: 'off' });
  const code = h('textarea', { rows: 3, placeholder: "Colle ici le code copié depuis l'autre téléphone" });

  const save = async (e: Event) => {
    e.preventDefault();
    if (!name.value.trim()) return toast('Indique ton prénom', 'error');
    saveSettings({ name: name.value.trim(), url: url.value.trim(), secret: secret.value.trim() });
    try {
      await api.ping();
      await api.categories();
      const r = await flush();
      toast('Connexion OK' + (r.sent ? ` · ${r.sent} dépense(s) envoyée(s)` : ''));
      location.hash = '#/add';
    } catch (err) {
      toast('Enregistré, mais connexion impossible : ' + (err as Error).message, 'error');
    }
  };

  const queued = (await pending()).length;

  root.replaceChildren(
    h('h1', null, 'Réglages'),
    h(
      'form',
      { class: 'card form', onsubmit: save },
      h('label', { for: 'name' }, 'Ton prénom'),
      name,
      h('label', { for: 'url' }, 'URL du script Google'),
      url,
      h('label', { for: 'secret' }, 'Code secret'),
      secret,
      h('button', { type: 'submit', class: 'primary big' }, 'Enregistrer et tester'),
    ),
    h(
      'section',
      { class: 'card form' },
      h('h2', null, 'Configurer l’autre téléphone'),
      h('p', { class: 'hint' }, "Copie ce code et envoie-le (SMS, WhatsApp…). Sur l'autre téléphone, colle-le ci-dessous, depuis l'appli installée."),
      h(
        'button',
        {
          type: 'button',
          disabled: !s.url,
          onclick: async () => {
            const c = exportConfigCode();
            try {
              if (navigator.share) await navigator.share({ text: c });
              else {
                await navigator.clipboard.writeText(c);
                toast('Code copié');
              }
            } catch {
              code.value = c;
              code.select();
            }
          },
        },
        'Partager le code de configuration',
      ),
      code,
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            try {
              const c = importConfigCode(code.value);
              url.value = c.url;
              secret.value = c.secret;
              toast('Code importé : indique ton prénom puis enregistre');
              name.focus();
            } catch {
              toast('Code invalide', 'error');
            }
          },
        },
        'Importer le code',
      ),
    ),
    queued
      ? h(
          'section',
          { class: 'card form' },
          h('p', null, `${queued} dépense(s) en attente d'envoi.`),
          h(
            'button',
            {
              type: 'button',
              onclick: async () => {
                const r = await flush();
                toast(r.remaining ? `Toujours ${r.remaining} en attente${r.error ? ' : ' + r.error : ''}` : 'Tout est envoyé', r.remaining ? 'warn' : 'ok');
                renderSettings(root);
              },
            },
            'Envoyer maintenant',
          ),
        )
      : '',
  );
}
