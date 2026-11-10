/**
 * Backend de l'appli « Remboursements ».
 *
 * À coller dans Extensions > Apps Script d'un Google Sheet, puis :
 *   1. Exécuter une fois la fonction `setup` (autorise l'accès au Sheet et à Drive).
 *   2. Paramètres du projet > Propriétés du script : ajouter SECRET = <ton code secret>.
 *   3. Déployer > Nouveau déploiement > Application Web
 *        - Exécuter en tant que : Moi
 *        - Qui a accès : Tout le monde
 *      Copier l'URL (…/exec) dans les réglages de l'appli.
 *
 * Notifications (facultatif, voir README) : propriétés PUSH_URL, PUSH_SECRET et VAPID_PUBLIC_KEY.
 */

var SHEET_EXPENSES = 'Dépenses';
var SHEET_CATEGORIES = 'Catégories';
var HEADERS = ['id', 'date', 'montant', 'catégorie', 'magasin', 'note', 'photo_id', 'saisi_par', 'créé_le', 'remboursé_le', 'sécu'];
var COL = { id: 0, date: 1, amount: 2, category: 3, store: 4, note: 5, photoId: 6, by: 7, createdAt: 8, paidAt: 9, secu: 10 };
var DEFAULT_CATEGORIES = ['Courses', 'Pharma', 'Soins', 'Magasins', 'Divers', 'Transports'];
var FOLDER_NAME = 'Tickets remboursements';
var SHEET_SUBS = 'Notifications';
var SUBS_HEADERS = ['endpoint', 'prénom', 'abonnement', 'créé_le'];

/** Crée les onglets, les en-têtes et le dossier Drive. À lancer une fois à la main. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_EXPENSES) || ss.insertSheet(SHEET_EXPENSES);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  // Colonnes date / horodatages en texte brut pour éviter les conversions automatiques.
  sh.getRange('B:B').setNumberFormat('@');
  sh.getRange('I:J').setNumberFormat('@');
  sh.getRange('C:C').setNumberFormat('0.00');

  var cat = ss.getSheetByName(SHEET_CATEGORIES) || ss.insertSheet(SHEET_CATEGORIES);
  if (cat.getLastRow() === 0) {
    cat.appendRow(['catégorie']);
    DEFAULT_CATEGORIES.forEach(function (c) { cat.appendRow([c]); });
  }
  getFolder_();
}

/** Remplace le contenu de l'onglet Catégories par DEFAULT_CATEGORIES. À lancer à la main si besoin. */
function resetCategories() {
  var ss = SpreadsheetApp.getActive();
  var cat = ss.getSheetByName(SHEET_CATEGORIES) || ss.insertSheet(SHEET_CATEGORIES);
  cat.clear();
  cat.getRange(1, 1, DEFAULT_CATEGORIES.length + 1, 1)
    .setValues([['catégorie']].concat(DEFAULT_CATEGORIES.map(function (c) { return [c]; })));
}

function doGet() {
  var secret = getSecret_();
  return json_({
    ok: true,
    data: secret
      ? 'Remboursements API OK — code secret défini (' + secret.length + ' caractères)'
      : 'Remboursements API OK — ATTENTION : propriété SECRET absente'
  });
}

function getSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SECRET') || props.getProperty('secret') || '';
  return secret.trim();
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var secret = getSecret_();
    if (!secret) return json_({ ok: false, error: 'Propriété SECRET absente dans les paramètres du script' });
    if (String(req.secret || '').trim() !== secret) return json_({ ok: false, error: 'Code secret invalide' });

    switch (req.action) {
      case 'categories': return json_({ ok: true, data: categories_() });
      case 'list': return json_({ ok: true, data: list_(req.month) });
      case 'add': {
        var added = withLock_(function () { return add_(req.expense); });
        if (added.isNew) notifyNew_(added.expense);
        return json_({ ok: true, data: added.expense });
      }
      case 'update': return json_({ ok: true, data: withLock_(function () { return update_(req.expense); }) });
      case 'delete': return json_({ ok: true, data: withLock_(function () { return delete_(req.id); }) });
      case 'markPaid': return json_({ ok: true, data: withLock_(function () { return markPaid_(req.month, req.paid); }) });
      case 'photo': return json_({ ok: true, data: photo_(req.photoId) });
      case 'pushConfig': return json_({ ok: true, data: { publicKey: pushConfig_().publicKey } });
      case 'subscribe': return json_({ ok: true, data: withLock_(function () { return subscribe_(req.subscription, req.name); }) });
      case 'unsubscribe': return json_({ ok: true, data: withLock_(function () { return unsubscribe_(req.endpoint); }) });
      case 'pushTest': return json_({ ok: true, data: pushTest_(req.endpoint) });
      default: return json_({ ok: false, error: 'Action inconnue : ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------------------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_EXPENSES);
  if (!sh) { setup(); sh = SpreadsheetApp.getActive().getSheetByName(SHEET_EXPENSES); }
  // Sheet créé avec une ancienne version : on ajoute les en-têtes des nouvelles colonnes.
  if (sh.getLastColumn() < HEADERS.length) sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  return sh;
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* dossier supprimé : on le recrée */ }
  }
  var folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function secuToCell_(v) {
  return v === true ? 'oui' : v === false ? 'non' : '';
}

function rowToExpense_(r) {
  var secu = str_(r[COL.secu]).toLowerCase();
  return {
    secu: secu === 'oui' ? true : secu === 'non' ? false : undefined,
    id: str_(r[COL.id]),
    date: str_(r[COL.date]),
    amount: Number(r[COL.amount]) || 0,
    category: str_(r[COL.category]),
    store: str_(r[COL.store]),
    note: str_(r[COL.note]),
    photoId: str_(r[COL.photoId]),
    by: str_(r[COL.by]),
    createdAt: str_(r[COL.createdAt]),
    paidAt: str_(r[COL.paidAt])
  };
}

function allRows_() {
  var sh = sheet_();
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, HEADERS.length).getValues();
}

function findRow_(id) {
  var rows = allRows_();
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][COL.id]) === id) return { index: i + 2, row: rows[i] };
  }
  return null;
}

function categories_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CATEGORIES);
  if (!sh || sh.getLastRow() < 2) return DEFAULT_CATEGORIES;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    .map(function (r) { return str_(r[0]).trim(); })
    .filter(function (c) { return c; });
}

function list_(month) {
  return allRows_()
    .map(rowToExpense_)
    .filter(function (x) { return x.id && (!month || x.date.indexOf(month) === 0); })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
}

function savePhoto_(base64, expense) {
  var name = expense.date + '_' + (expense.store || 'ticket').replace(/[^\w\-]+/g, '_') + '_' + expense.id.slice(0, 8) + '.jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', name);
  return getFolder_().createFile(blob).getId();
}

function add_(x) {
  if (!x || !x.id) throw new Error('Dépense invalide');
  var existing = findRow_(x.id);
  if (existing) return { isNew: false, expense: rowToExpense_(existing.row) }; // envoi en double (file hors ligne)

  var photoId = x.photo ? savePhoto_(x.photo, x) : '';
  var row = [
    x.id, x.date, Number(x.amount) || 0, x.category || '', x.store || '', x.note || '',
    photoId, x.by || '', new Date().toISOString(), '', secuToCell_(x.secu)
  ];
  sheet_().appendRow(row);
  return { isNew: true, expense: rowToExpense_(row) };
}

function update_(x) {
  var found = findRow_(x.id);
  if (!found) throw new Error('Dépense introuvable');
  var r = found.row;
  r[COL.date] = x.date;
  r[COL.amount] = Number(x.amount) || 0;
  r[COL.category] = x.category || '';
  r[COL.store] = x.store || '';
  r[COL.note] = x.note || '';
  r[COL.secu] = secuToCell_(x.secu);
  if (x.photo) r[COL.photoId] = savePhoto_(x.photo, x);
  sheet_().getRange(found.index, 1, 1, HEADERS.length).setValues([r]);
  return rowToExpense_(r);
}

function delete_(id) {
  var found = findRow_(id);
  if (!found) return true;
  var photoId = str_(found.row[COL.photoId]);
  if (photoId) {
    try { DriveApp.getFileById(photoId).setTrashed(true); } catch (e) { /* déjà supprimée */ }
  }
  sheet_().deleteRow(found.index);
  return true;
}

function markPaid_(month, paid) {
  if (!month) throw new Error('Mois manquant');
  var sh = sheet_();
  var rows = allRows_();
  var now = paid === false ? '' : new Date().toISOString();
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][COL.date]).indexOf(month) !== 0) continue;
    if (paid !== false && str_(rows[i][COL.paidAt])) continue;
    sh.getRange(i + 2, COL.paidAt + 1).setValue(now);
    count++;
  }
  return count;
}

function photo_(photoId) {
  if (!photoId) throw new Error('Pas de photo');
  var blob = DriveApp.getFileById(photoId).getBlob();
  return { mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// --- Notifications ------------------------------------------------------------

/**
 * À lancer une fois à la main dans l'éditeur : déclenche l'autorisation « service externe »
 * (UrlFetchApp) et vérifie que le relais Cloudflare répond.
 */
function autoriserNotifications() {
  var cfg = pushConfig_();
  if (!cfg.url) throw new Error('Propriété PUSH_URL absente dans les paramètres du script');
  var res = UrlFetchApp.fetch(cfg.url + '/', { muteHttpExceptions: true });
  console.log('Relais ' + cfg.url + ' → ' + res.getResponseCode() + ' ' + res.getContentText());
  if (!cfg.secret) console.warn('Propriété PUSH_SECRET absente');
  if (!cfg.publicKey) console.warn('Propriété VAPID_PUBLIC_KEY absente');
}

function pushConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    url: (props.getProperty('PUSH_URL') || '').trim().replace(/\/+$/, ''),
    secret: (props.getProperty('PUSH_SECRET') || '').trim(),
    publicKey: (props.getProperty('VAPID_PUBLIC_KEY') || '').trim()
  };
}

function subsSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_SUBS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_SUBS);
    sh.appendRow(SUBS_HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function allSubs_() {
  var sh = subsSheet_();
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, SUBS_HEADERS.length).getValues().map(function (r, i) {
    var sub = null;
    try { sub = JSON.parse(r[2]); } catch (e) { /* ligne abîmée : ignorée */ }
    return { row: i + 2, endpoint: str_(r[0]), name: str_(r[1]), subscription: sub };
  }).filter(function (s) { return s.subscription && s.endpoint; });
}

function subscribe_(sub, name) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Abonnement invalide');
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error('Abonnement invalide');
  var clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  var values = [sub.endpoint, String(name || ''), JSON.stringify(clean), new Date().toISOString()];
  var existing = allSubs_().filter(function (s) { return s.endpoint === sub.endpoint; })[0];
  var sh = subsSheet_();
  if (existing) sh.getRange(existing.row, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
  return true;
}

function unsubscribe_(endpoint) {
  var rows = allSubs_().filter(function (s) { return s.endpoint === endpoint; });
  var sh = subsSheet_();
  rows.reverse().forEach(function (s) { sh.deleteRow(s.row); });
  return true;
}

/** Envoie `payload` aux abonnements via le Worker et supprime ceux qui ont expiré. */
function sendPush_(subs, payload) {
  var cfg = pushConfig_();
  if (!cfg.url || !cfg.secret || !subs.length) return { sent: 0, failed: 0, configured: Boolean(cfg.url && cfg.secret) };
  var res = UrlFetchApp.fetch(cfg.url + '/send', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.secret },
    payload: JSON.stringify({ subscriptions: subs.map(function (s) { return s.subscription; }), payload: payload }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Service de notifications : erreur ' + res.getResponseCode());
  var results = JSON.parse(res.getContentText()).results || [];
  var gone = results.filter(function (r) { return r.status === 404 || r.status === 410; })
    .map(function (r) { return r.endpoint; });
  if (gone.length) withLock_(function () { gone.forEach(unsubscribe_); });
  var ok = results.filter(function (r) { return r.status >= 200 && r.status < 300; }).length;
  return { sent: ok, failed: results.length - ok, configured: true };
}

function euro_(n) {
  return (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',') + ' €';
}

/** Nouvelle dépense : notifie les autres utilisateurs (pas celui qui l'a saisie). */
function notifyNew_(x) {
  try {
    var subs = allSubs_().filter(function (s) { return s.name !== x.by; });
    if (!subs.length) return;
    var d = x.date.split('-');
    var details = [x.category, x.store, d.length === 3 ? d[2] + '/' + d[1] : x.date].filter(String);
    var lines = [details.join(' · ')];
    if (x.secu) lines.push('Remboursement attendu');
    if (x.note) lines.push(x.note);
    sendPush_(subs, {
      title: (x.by || 'Quelqu\u2019un') + ' a ajouté ' + euro_(x.amount),
      body: lines.join('\n'),
      tag: 'expense-' + x.id,
      url: '#/month/' + x.date.slice(0, 7)
    });
  } catch (err) {
    console.error('Notification non envoyée : ' + err); // l'ajout de la dépense reste valide
  }
}

/** Notification de test vers l'appareil qui la demande. */
function pushTest_(endpoint) {
  var subs = allSubs_().filter(function (s) { return s.endpoint === endpoint; });
  if (!subs.length) throw new Error('Cet appareil n\u2019est pas abonné');
  var r = sendPush_(subs, {
    title: 'Notifications activées ✓',
    body: 'Tu seras prévenu à chaque nouvelle dépense de l\u2019autre utilisateur.',
    tag: 'test',
    url: '#/month'
  });
  if (!r.configured) throw new Error('Notifications non configurées dans le script (PUSH_URL / PUSH_SECRET)');
  if (!r.sent) throw new Error('Envoi refusé par le service de notifications');
  return r;
}

// --- Récap de fin de mois -------------------------------------------------------

var MOIS_ = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Message de récap pour un mois « AAAA-MM », ou null s'il n'y a aucune dépense. */
function recapPayload_(month) {
  var rows = list_(month);
  if (!rows.length) return null;
  var nom = MOIS_[Number(month.slice(5, 7)) - 1];
  var Nom = nom.charAt(0).toUpperCase() + nom.slice(1);
  var unpaid = rows.filter(function (x) { return !x.paidAt; });
  var sum = function (list) { return list.reduce(function (s, x) { return s + x.amount; }, 0); };
  var n = rows.length + ' dépense' + (rows.length > 1 ? 's' : '');
  var payload = { tag: 'recap-' + month, url: '#/month/' + month };
  if (!unpaid.length) {
    payload.title = Nom + ' est entièrement remboursé ✓';
    payload.body = euro_(sum(rows)) + ' · ' + n;
  } else {
    var expected = sum(unpaid.filter(function (x) { return x.secu; }));
    payload.title = 'Récap ' + (/^[aeiouéèh]/i.test(nom) ? 'd’' : 'de ') + nom;
    payload.body = euro_(sum(unpaid)) + ' à rembourser · ' + n +
      (expected > 0 ? '\ndont ' + euro_(expected) + ' de remboursement attendu' : '');
  }
  return payload;
}

/** Déclenché le 1er de chaque mois : récap du mois précédent envoyé à tous les abonnés. */
function recapMensuel() {
  var now = new Date();
  var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var month = Utilities.formatDate(prev, Session.getScriptTimeZone(), 'yyyy-MM');
  var payload = recapPayload_(month);
  if (!payload) return;
  var subs = allSubs_();
  if (subs.length) sendPush_(subs, payload);
}

/** À lancer une fois à la main : programme recapMensuel le 1er de chaque mois vers 9 h. */
function installerRecapMensuel() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'recapMensuel') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('recapMensuel').timeBased().onMonthDay(1).atHour(9).create();
  console.log('Récap mensuel programmé le 1er de chaque mois vers 9 h.');
}
