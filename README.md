# Remboursements

PWA (Android + iPhone) pour noter les dépenses à rembourser : photo du ticket → lecture automatique du total, catégorie, date. Les données sont partagées via un Google Sheet, et les photos sont enregistrées dans Google Drive. Tout est gratuit.

- **Front** : Vite + TypeScript, hébergé sur GitHub Pages
- **OCR** : Tesseract.js (langue `fra`), exécuté sur le téléphone ; rien n'est envoyé à un service d'OCR
- **Backend** : Google Apps Script ([apps-script/Code.gs](apps-script/Code.gs)) → Sheet `Dépenses` + dossier Drive `Tickets remboursements`
- **Hors ligne** : les dépenses saisies sans réseau sont mises en file d'attente puis envoyées automatiquement

## 1. Créer le backend Google (une seule fois)

1. Crée un Google Sheet (par exemple « Remboursements »).
2. Menu **Extensions → Apps Script**. Remplace le contenu de `Code.gs` par celui de [apps-script/Code.gs](apps-script/Code.gs), puis enregistre.
3. Sélectionne la fonction `setup` et clique sur **Exécuter**. Accepte les autorisations (Sheet + Drive). Tu verras l'écran « Google n'a pas validé cette application » : clique sur *Paramètres avancés → Accéder au projet*.
4. **Paramètres du projet** (roue dentée) → **Propriétés du script** → ajoute `SECRET` avec un code secret de ton choix.
5. **Déployer → Nouveau déploiement** → type *Application Web* :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
   - Copie l'URL qui se termine par `/exec`.

> Après une modification de `Code.gs` : *Déployer → Gérer les déploiements → ✏️ → Version : nouvelle version*. Cela garde la même URL.

Pour ajouter ou renommer des catégories, modifie directement l'onglet `Catégories` du Sheet.

## 2. Mettre l'appli en ligne (GitHub Pages)

```bash
gh repo create remboursements --public --source . --push
```

Ensuite, sur GitHub : **Settings → Pages → Source : GitHub Actions**. Le workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) lance les tests, construit l'appli et la publie à chaque push sur `main`. Elle est alors disponible à l'adresse `https://<ton-user>.github.io/remboursements/`.

Le dépôt ne contient ni l'URL ni le code secret : ils sont saisis dans l'appli.

## 3. Installer sur les téléphones

- **Android (Chrome)** : ouvre l'URL, puis menu ⋮ → **Installer l'application**.
- **iPhone (Safari)** : ouvre l'URL, puis **Partager** → **Sur l'écran d'accueil**.

Ouvre ensuite l'appli **depuis l'icône** et va dans **Réglages** : saisis ton prénom, l'URL `/exec` et le code secret. Sur iPhone, l'appli installée ne partage pas son stockage avec Safari ; la configuration doit donc se faire dans l'appli installée.

Pour configurer le deuxième téléphone plus vite : *Réglages → Partager le code de configuration*, envoie le code, puis colle-le dans *Importer le code* sur l'autre téléphone.

## Utilisation

- **Ajouter** : 📷 *Photo du ticket*. Le total, la date et le magasin sont pré-remplis. Vérifie-les, choisis une catégorie, puis enregistre. La première lecture télécharge le moteur OCR (quelques Mo) ; il reste ensuite en cache.
- **Mois** : affiche le total à rembourser, la répartition par catégorie et la liste des dépenses (avec la photo, et la possibilité de modifier ou de supprimer). Le bouton **Marquer comme remboursé** clôture le mois.

Conseils pour la photo : ticket à plat, bien éclairé, cadré au plus près. Le montant détecté peut toujours être corrigé.

## Développement

```bash
npm install
npm test          # tests du parsing des tickets (src/parse.test.ts)
npm run dev       # appli sur http://localhost:5173
node scripts/mock-server.mjs   # faux backend : URL http://localhost:8787, code secret « test »
npm run build
```

| Fichier | Rôle |
| --- | --- |
| `src/parse.ts` | Extraction du total, de la date et du magasin à partir du texte OCR |
| `src/ocr.ts`, `src/image.ts` | Tesseract, pré-traitement de l'image, compression de la photo |
| `src/api.ts`, `src/queue.ts` | Appels Apps Script, file d'attente hors ligne (IndexedDB) |
| `src/views/*` | Écrans Ajouter / Mois / Réglages |
| `apps-script/Code.gs` | Backend Google |
