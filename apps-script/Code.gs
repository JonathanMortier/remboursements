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
 */

var SHEET_EXPENSES = 'Dépenses';
var SHEET_CATEGORIES = 'Catégories';
var HEADERS = ['id', 'date', 'montant', 'catégorie', 'magasin', 'note', 'photo_id', 'saisi_par', 'créé_le', 'remboursé_le'];
var COL = { id: 0, date: 1, amount: 2, category: 3, store: 4, note: 5, photoId: 6, by: 7, createdAt: 8, paidAt: 9 };
var DEFAULT_CATEGORIES = ['Courses', 'Pharmacie / Santé', 'Enfants', 'Maison', 'Restaurant', 'Transport', 'Vêtements', 'Loisirs', 'Autre'];
var FOLDER_NAME = 'Tickets remboursements';

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
      case 'add': return json_({ ok: true, data: withLock_(function () { return add_(req.expense); }) });
      case 'update': return json_({ ok: true, data: withLock_(function () { return update_(req.expense); }) });
      case 'delete': return json_({ ok: true, data: withLock_(function () { return delete_(req.id); }) });
      case 'markPaid': return json_({ ok: true, data: withLock_(function () { return markPaid_(req.month, req.paid); }) });
      case 'photo': return json_({ ok: true, data: photo_(req.photoId) });
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

function rowToExpense_(r) {
  return {
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
  if (existing) return rowToExpense_(existing.row); // envoi en double (file hors ligne) : on ignore

  var photoId = x.photo ? savePhoto_(x.photo, x) : '';
  var row = [
    x.id, x.date, Number(x.amount) || 0, x.category || '', x.store || '', x.note || '',
    photoId, x.by || '', new Date().toISOString(), ''
  ];
  sheet_().appendRow(row);
  return rowToExpense_(row);
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
