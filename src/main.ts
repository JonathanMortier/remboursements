import { registerSW } from 'virtual:pwa-register';
import { currentMonth, h, toast } from './dom';
import { flush, onQueueChange, pending } from './queue';
import { icon } from './icons';
import { applyScriptParam, applyTheme, isConfigured } from './settings';
import { renderForm } from './views/form';
import { renderMonth } from './views/month';
import { renderSettings } from './views/settings';
import { renderYear } from './views/year';
import './style.css';

applyTheme();
applyScriptParam();

const main = document.getElementById('app')!;
const tabs = {
  add: h('a', { href: '#/add' }, icon('plus', 24), 'Ajouter'),
  month: h('a', { href: '#/month' }, icon('euro', 24), 'Mois'),
  settings: h('a', { href: '#/settings' }, icon('settings', 24), 'Réglages'),
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
  const tab = page === 'year' ? 'month' : page;
  Object.entries(tabs).forEach(([k, el]) => el.classList.toggle('active', k === tab));
  window.scrollTo(0, 0);

  switch (page) {
    case 'month':
      renderMonth(main, arg && /^\d{4}-\d{2}$/.test(arg) ? arg : currentMonth());
      break;
    case 'year':
      renderYear(main, arg && /^\d{4}$/.test(arg) ? Number(arg) : Number(currentMonth().slice(0, 4)));
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
// S'il reste des dépenses (réseau revenu mais pas encore utilisable), on réessaie de plus en plus
// espacé : 2 s, 4 s, 8 s… jusqu'à 1 min.
let retryTimer: number | undefined;
let retryDelay = 2000;
async function sync() {
  if (!isConfigured()) return;
  clearTimeout(retryTimer);
  const r = await flush();
  if (r.sent) toast(`${r.sent} dépense(s) en attente envoyée(s)`);
  if (r.remaining && !r.error && navigator.onLine) {
    retryTimer = window.setTimeout(sync, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60_000);
  } else {
    retryDelay = 2000;
  }
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
