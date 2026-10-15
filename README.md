# Planning Chantier

Planning des techniciens sur les chantiers : une application web à déployer sur **Vercel**, sans dépendance et sans étape de build.

## Fonctionnalités

- **Vue par technicien** et **vue par chantier** sur 1, 2 ou 4 semaines, avec ou sans week-end
- **Interventions** à la journée, le matin ou l'après-midi, avec une tâche, un statut (prévu / en cours / terminé) et des notes
- **Création en lot** : plusieurs techniciens sur une période en une seule fois, en sautant les week-ends et les jours fériés
- **Absences** : congés, RTT, formation, maladie
- **Détection des conflits** : alerte quand un technicien a deux affectations qui se chevauchent
- **Glisser-déposer** pour déplacer une intervention (Ctrl + glisser pour la copier)
- **Jours fériés français** affichés, Pâques et Pentecôte compris
- **Mon planning** : vue mobile pour chaque technicien, avec le lien GPS vers le chantier, le contact sur site, les collègues présents et les boutons « En cours » / « Terminé ». Le lien direct se partage avec `?tech=…`
- **Export CSV** pour Excel, **impression** en A4 paysage, **sauvegarde et import** au format JSON
- **Synchronisation** entre tous les postes toutes les 15 s. Si deux personnes modifient le planning en même temps, aucune modification n'est perdue.

## Structure

```
public/          Front-end statique (index.html, app.js, style.css)
api/data.js      Fonction serverless Vercel : lecture et écriture du planning dans Upstash Redis
dev-server.mjs   Serveur local de test (stockage dans .data.local.json)
vercel.json      Configuration Vercel
```

## Déploiement sur Vercel

### 1. Mettre le projet en ligne

**Option A : avec GitHub (recommandé)**
1. Créez un dépôt GitHub et poussez-y le contenu de ce dossier `planning-chantier`.
2. Sur [vercel.com/new](https://vercel.com/new), importez le dépôt. Laissez *Framework Preset* sur **Other** et ne changez rien d'autre, puis cliquez sur **Deploy**.

**Option B : avec la ligne de commande**
```bash
npx vercel --prod
```
Lancez cette commande depuis le dossier `planning-chantier`.

À ce stade, l'application fonctionne déjà en **mode local** : chaque navigateur garde son propre planning.

### 2. Brancher la base partagée (gratuite)

1. Dans le projet Vercel, ouvrez **Storage → Create Database → Upstash for Redis**. L'offre gratuite suffit.
2. Connectez la base au projet. Vercel ajoute alors automatiquement les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN`.
3. Dans **Settings → Environment Variables**, créez les codes d'accès :
   - `APP_PASSWORD` : le code **responsable**, qui permet de tout modifier (fortement recommandé) ;
   - `VIEW_PASSWORD` : le code **technicien**, qui permet seulement de **consulter** le planning (facultatif, fonctionne seulement si `APP_PASSWORD` est défini).
4. **Redéployez** le projet (onglet Deployments → ⋯ → Redeploy).

Le point vert « Partagé · à jour » en haut à droite confirme que le planning est commun à toute l'équipe. Le code d'accès n'est demandé qu'une fois par appareil.

### Accès technicien en lecture seule

Avec le code `VIEW_PASSWORD`, le technicien peut seulement consulter le planning :
- il ne voit ni le bouton « + Intervention » ni l'onglet Ressources ;
- un clic sur une intervention ouvre une fiche de consultation (adresse, contact, tâche, notes) ;
- le glisser-déposer et les boutons de statut sont désactivés.

Le serveur refuse aussi toute modification faite avec ce code : la lecture seule ne repose pas seulement sur l'interface.
Le badge « 🔒 Lecture seule » s'affiche en haut à droite. Un clic dessus permet de saisir un autre code, par exemple le code responsable sur le poste d'un chef d'équipe.

> Vous aviez déjà saisi des données en mode local ? Exportez-les avant de brancher la base (Ressources → *Exporter une sauvegarde*), puis réimportez-les ensuite.

## Tester en local

```bash
npm run dev
```
Ouvrez ensuite http://localhost:3000. Pour simuler l'absence de base, lancez `npm run dev -- --no-api`.

## Raccourcis clavier (vues planning)

| Touche | Action |
|---|---|
| ← / → | Période précédente / suivante |
| T | Revenir à aujourd'hui |
| N | Nouvelle intervention |
