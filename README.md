# J'ai la dall€

Site statique de diffusion de données sur la dette négociable de l'État français : adjudications d'OAT et de BTF, syndications, titres indexés sur l'inflation et point mort d'inflation. Publication indépendante, sans lien avec l'Agence France Trésor (AFT), citée comme source des données.

Le nom du site et l'éditeur sont centralisés dans `src/config.ts`, avec les coordonnées de contact et d'hébergement à renseigner avant publication (les mentions légales les masquent tant qu'elles sont vides).

## Installation

Prérequis : Node 22 ou plus, Python 3.12.

```
make setup        # environnement Python (.venv) et dépendances
npm install
```

## Commandes

| Commande | Effet |
|---|---|
| `make data` | Lit `data/raw/`, valide, écrit `public/data/` et `data/validation_report.md` |
| `npm run dev` | Serveur de développement |
| `npm run build` | Génère le site statique dans `dist/` |
| `npm run check` | Typage (`astro check`), build, tests du HTML généré, lint Python, tests du pipeline |
| `make test` | Tests `pytest` du pipeline seuls |

`SITE_URL` (variable d'environnement lue au build) fixe l'adresse publique pour le plan de site XML et les adresses canoniques. `BASE_PATH` fixe le sous-chemin de publication (par exemple `/francetresor`). Les adresses relatives à la racine sont préfixées au build, y compris dans les feuilles de style.

## Publication sur GitHub Pages

Le workflow `.github/workflows/pages.yml` s'exécute à chaque push sur `main` (et sur la branche de développement `claude/trusting-shannon-f4y54t`) : il régénère les données, lance `npm run check`, construit le site avec l'adresse et le sous-chemin fournis par GitHub, puis le déploie. Réglage unique : dans les paramètres du dépôt, Pages, source « GitHub Actions ».

## Pipeline de données

`scripts/build_data.py` lit les six fichiers sources de `data/raw/`. Le format est détecté sur le contenu du fichier, pas sur l'extension. Pour chaque jeu, le fichier le plus récent est retenu d'après le préfixe de date de son nom.

| Jeu | Fichier source (motif) |
|---|---|
| `adjudications_oat` | `*hist_mlt.xlsx` |
| `adjudications_btf` | `*hist_btf.xlsx` |
| `syndications` | `*historique_syndications.xlsx` |
| `point_mort_inflation` | `*point_mort_inflation_oati.xls` |
| `reference_inflation`, `coefficients_indexation` | `*coef_oati-*.xls` (courant) et `coef_oati_histo_*.xls` (historique) |

Le fichier `Courbe_taux.xls` présent dans `data/raw/` n'est pas utilisé.

Contrôles : schéma (libellés et ordre des colonnes), types, doublons, cohérence du ratio de couverture, du volume total émis, des bornes de volume offert, des dates, format des codes ISIN, rapport constant de rebasage de la référence d'inflation, égalité de chaque coefficient publié avec `round(référence / indice de base, 5)` à 1e-5 près. Toute anomalie non documentée dans `data/known_issues.json` fait échouer `make data`.

`data/known_issues.json` consigne les anomalies constatées dans les sources, chacune avec son motif : corrections de valeur (codes ISIN tronqués) et anomalies tolérées, publiées sans modification. Le rapport `data/validation_report.md` est réécrit à chaque exécution.

### Données publiées (`public/data/`)

Chaque JSON contient `meta` (jeu, titre, fichier source, première et dernière observation, nombre d'enregistrements, date de génération) puis `records`. Les coefficients d'indexation sont organisés en colonnes (`columns`) et leur `meta` décrit les titres. Les CSV utilisent le point-virgule, la virgule décimale, UTF-8 avec BOM et des dates AAAA-MM-JJ. `catalog.json` liste les jeux et leur dictionnaire de variables. `lignes.json` alimente les fiches par ISIN.

Unités : montants en millions d'euros, taux en décimal, prix en fraction du nominal.

## Marchés fictifs

La rubrique `/marches/` propose des marchés de prédiction à monnaie virtuelle, à visée pédagogique : jetons illimités, sans valeur, non convertibles, sans lot ni classement sur les gains. Les cotes et les paris sont locaux au navigateur (`localStorage`) : aucun serveur, aucun compte, aucune donnée transmise.

- `scripts/markets.py` ouvre des marchés à chaque exécution de `make data` (point mort à 10 ans à 14 et 28 jours, taux des BTF par segment à la prochaine adjudication, ratio de couverture et volume adjugé de la prochaine adjudication d'OAT), calcule la cote initiale (fréquence empirique sur cinq ans), règle les marchés dont l'observation est publiée et écrit `public/data/marches.json`.
- `data/markets_state.json` conserve les définitions et les règlements : **il doit être versionné après chaque `make data`**, sans quoi les marchés ouverts lors d'une mise à jour précédente seraient perdus.
- Cotation : teneur de marché LMSR (`src/lib/lmsr.ts`, paramètre de liquidité 250), évaluation par score de Brier et calibration (`src/lib/portfolio.ts`).
- Dérogations assumées au cahier des charges, limitées à cette rubrique : verbes d'action sur les boutons et formulaires, lien « Marchés fictifs » hors de la navigation principale (qui reste à cinq entrées), avertissement permanent sur chaque page.

## Mise à jour

1. Déposer les nouveaux fichiers sources dans `data/raw/`.
2. `make data && npm run build`.
3. Versionner `data/markets_state.json` avec les nouvelles données.
4. Lire `data/validation_report.md`. Une nouvelle anomalie de source se traite en l'ajoutant, avec son motif, à `data/known_issues.json`.

## Choix de méthode

Les règles de regroupement et de calcul (segments BTF, tranches de maturité résiduelle, ratios annuels pondérés, rebasage de la référence d'inflation, traitement des rachats) sont décrites sur la page Méthodologie du site. Le rapport de rebasage est calculé sur les jours communs aux deux fichiers de coefficients et jamais codé en dur. Les coefficients d'indexation ne sont jamais convertis.

Les graphiques utilisent Observable Plot, chargé uniquement sur les pages qui en comportent, et leurs données sont récupérées à la demande. Les tableaux, les graphiques et le calculateur sont écrits à la main, sans framework CSS.

Polices Source Serif 4 et Source Sans 3, auto-hébergées (`public/fonts/`, licence SIL OFL 1.1).
