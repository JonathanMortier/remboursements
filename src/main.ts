import { registerSW } from 'virtual:pwa-register';
import { currentMonth, h, toast } from './dom';
import { flush, onQueueChange, pending } from './queue';
import { applyScriptParam, isConfigured } from './settings';
import { renderForm } from './views/form';
import { renderMonth } from './views/month';
import { renderSettings } from './views/settings';
import './style.css';

applyScriptParam();

const main = document.getElementById('app')!;
const tabs = {
  add: h('a', { href: '#/add' }, h('span', null, '＋'), 'Ajouter'),
  month: h('a', { href: '#/month' }, h('span', null, '€'), 'Mois'),
  settings: h('a', { href: '#/settings' }, h('span', null, '⚙'), 'Réglages'),
};
const badge = h('i', { class: 'dot', hidden: true });
tabs.month.append(badge);
document.body.append(h('nav', { class: 'tabs' }, Object.values(tabs)));

async function updateBadge() {
  const n = (await pending()).length;
  badge.hidden = n === 0;
  badge.textContent = String(n);
}

function route() {
  const [, page = 'add', arg] = location.hash.split('/');
  if (!isConfigured() && page !== 'settings') {
    location.hash = '#/settings';
    return;
  }
  Object.entries(tabs).forEach(([k, el]) => el.classList.toggle('active', k === page));
  window.scrollTo(0, 0);

  switch (page) {
    case 'month':
      renderMonth(main, arg && /^\d{4}-\d{2}$/.test(arg) ? arg : currentMonth());
      break;
    case 'settings':
      renderSettings(main);
      break;
    default:
      renderForm(main, undefined, () => renderForm(main));
  }
}

window.addEventListener('hashchange', route);
route();

// Envoi des dépenses en attente : au démarrage, au retour du réseau et au retour dans l'appli.
async function sync() {
  if (!isConfigured()) return;
  const r = await flush();
  if (r.sent) toast(`${r.sent} dépense(s) en attente envoyée(s)`);
}
onQueueChange(updateBadge);
updateBadge();
sync();
window.addEventListener('online', sync);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync());

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('Une nouvelle version est disponible. Mettre à jour ?')) updateSW(true);
  },
});
