import { api } from '../api';
import { h, toast } from '../dom';
import { icon } from '../icons';
import { flush, pending } from '../queue';
import {
  exportConfigCode,
  getSettings,
  getTheme,
  importConfigCode,
  installLink,
  isValidScriptUrl,
  saveSettings,
  setTheme,
  type Theme,
} from '../settings';

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
  const eye = h(
    'button',
    {
      type: 'button',
      class: 'eye',
      'aria-label': 'Afficher le code secret',
      'aria-pressed': 'false',
      onclick: () => {
        const show = secret.type === 'password';
        secret.type = show ? 'text' : 'password';
        eye.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
        eye.setAttribute('aria-label', show ? 'Masquer le code secret' : 'Afficher le code secret');
        eye.setAttribute('aria-pressed', String(show));
      },
    },
    icon('eye'),
  );
  const code = h('textarea', { rows: 3, placeholder: "Colle ici le code copié depuis l'autre téléphone" });

  const save = async (e: Event) => {
    e.preventDefault();
    if (!name.value.trim()) return toast('Indique ton prénom', 'error');
    // En développement, le faux backend local (http://localhost) reste autorisé.
    if (!isValidScriptUrl(url.value.trim()) && !import.meta.env.DEV) {
      return toast("L'URL doit commencer par https://script.google.com/macros/", 'error');
    }
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
  const prefilled = Boolean(s.url && !s.secret);

  root.replaceChildren(
    h('h1', null, 'Réglages'),
    prefilled
      ? h('p', { class: 'banner ok' }, "✓ URL du script pré-remplie. Il ne reste qu'à saisir ton prénom et le code secret.")
      : '',
    h(
      'form',
      { class: 'card form', onsubmit: save },
      h('label', { for: 'name' }, 'Ton prénom'),
      name,
      h('label', { for: 'url' }, 'URL du script Google'),
      url,
      h('label', { for: 'secret' }, 'Code secret'),
      h('div', { class: 'password' }, secret, eye),
      h('button', { type: 'submit', class: 'primary big' }, 'Enregistrer et tester'),
    ),
    themeSection(),
    await shareSection(code, url, secret, name),
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
                toast(
                  r.remaining ? `Toujours ${r.remaining} en attente${r.error ? ' : ' + r.error : ''}` : 'Tout est envoyé',
                  r.remaining ? 'warn' : 'ok',
                );
                renderSettings(root);
              },
            },
            'Envoyer maintenant',
          ),
        )
      : '',
  );
  if (prefilled) name.focus();
}

/** QR code d'installation + méthode alternative par code de configuration. */
async function shareSection(
  code: HTMLTextAreaElement,
  url: HTMLInputElement,
  secret: HTMLInputElement,
  name: HTMLInputElement,
): Promise<HTMLElement> {
  const { url: savedUrl } = getSettings();
  const section = h('section', { class: 'card form' }, h('h2', null, 'Installer sur un autre téléphone'));

  if (!isValidScriptUrl(savedUrl)) {
    section.append(h('p', { class: 'hint' }, "Enregistre d'abord l'URL du script Google pour obtenir le QR code."));
  } else {
    const link = installLink();
    const qr = h('div', { class: 'qr', role: 'img', 'aria-label': "QR code d'installation" });
    try {
      const QRCode = await import('qrcode');
      // SVG généré par la bibliothèque à partir du lien : pas de donnée utilisateur brute injectée.
      qr.innerHTML = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    } catch {
      qr.textContent = 'QR code indisponible';
    }
    section.append(
      h(
        'p',
        { class: 'hint' },
        "Scanne ce QR code avec l'appareil photo de l'autre téléphone, puis installe l'appli depuis la page qui s'ouvre :",
      ),
      h(
        'ul',
        { class: 'hint steps' },
        h('li', null, 'Android (Chrome) : menu ⋮ → Installer l’application'),
        h('li', null, 'iPhone (Safari) : Partager → Sur l’écran d’accueil'),
      ),
      qr,
      h(
        'p',
        { class: 'hint' },
        "Ouvre ensuite l'appli installée : l'URL du script sera déjà remplie, il restera le prénom et le code secret.",
      ),
      h(
        'button',
        {
          type: 'button',
          onclick: async () => {
            try {
              if (navigator.share) await navigator.share({ title: 'Remboursements', url: link });
              else {
                await navigator.clipboard.writeText(link);
                toast('Lien copié');
              }
            } catch {
              /* partage annulé */
            }
          },
        },
        'Partager le lien',
      ),
    );
  }

  section.append(
    h(
      'details',
      { class: 'alt' },
      h('summary', null, 'Autre méthode : code de configuration (URL + code secret)'),
      h(
        'div',
        { class: 'form' },
        h('p', { class: 'hint' }, "Ce code contient aussi le code secret : envoie-le seulement à l'autre utilisateur."),
        h(
          'button',
          {
            type: 'button',
            disabled: !savedUrl,
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
    ),
  );
  return section;
}

/** Choix du thème : appliqué tout de suite, sans bouton Enregistrer. */
function themeSection(): HTMLElement {
  const current = getTheme();
  const options: [Theme, 'auto' | 'sun' | 'moon', string][] = [
    ['auto', 'auto', 'Auto'],
    ['light', 'sun', 'Clair'],
    ['dark', 'moon', 'Sombre'],
  ];
  return h(
    'section',
    { class: 'card form' },
    h('h2', { id: 'theme-label' }, 'Affichage'),
    h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'theme-label' },
      options.map(([value, ic, label]) =>
        h(
          'label',
          null,
          h('input', { type: 'radio', name: 'theme', value, checked: value === current, onchange: () => setTheme(value) }),
          h('span', null, icon(ic, 18), label),
        ),
      ),
    ),
    h('p', { class: 'hint' }, 'Auto suit le réglage clair / sombre du téléphone.'),
  );
}
