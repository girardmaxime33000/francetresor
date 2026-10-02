# Rapport de validation des données

Généré le 2026-10-02T08:01:48+00:00.

Anomalies bloquantes : 0.

| Jeu | Fichier source | Lignes lues | Lignes rejetées | Lignes publiées | Anomalies bloquantes | Avertissements |
|---|---|---:|---:|---:|---:|---:|
| adjudications_oat | 2026-10_hist_mlt.xlsx | 2308 | 0 | 2308 | 0 | 0 |
| adjudications_btf | 2026-10_hist_btf.xlsx | 4067 | 0 | 4067 | 0 | 5 |
| syndications | 1999-2026_historique_syndications.xlsx | 45 | 0 | 45 | 0 | 1 |
| point_mort_inflation | 2026_10_01_point_mort_inflation_oati.xls | 1978 | 0 | 1978 | 0 | 0 |
| coefficients_indexation | 2026-09_coef_oati-novembre26.xls ; coef_oati_histo_1998_2016.xls | 16757 | 0 | 10327 | 0 | 0 |
| marches_fictifs | data/markets_state.json | 21 | 0 | 21 | 0 | 0 |

## adjudications_oat

Source : 2026-10_hist_mlt.xlsx

- Correction documentée sur 1 ligne(s) (2024-04-18|FR00140PM68|2030-02-25) : isin « FR00140PM68 » remplacé par « FR001400PM68 ». Motif : Code ISIN de 11 caractères dans la source. La même ligne (OAT 2,75% 25 février 2030) est adjugée le 16/05/2024 sous FR001400PM68.
- 7 ligne(s) sans taux moyen pondéré, familles : OAT TEC 10.
- Valeur 0 du coefficient d'indexation sur les titres nominaux convertie en valeur vide.
- Répartition par type : adju_LT 834, adju_MT 764, adju_I 661, adju_MLT 49.
- Répartition par famille : OAT 1336, OAT€i 407, BTAN 304, OATi 233, BTANi 13, BTAN€i 8, OAT TEC 10 7.
- 200 codes ISIN distincts, 210 libellés de ligne distincts dans la source, 200 libellés distincts après normalisation de la virgule décimale.

Aucune anomalie.

## adjudications_btf

Source : 2026-10_hist_btf.xlsx

- Correction documentée sur 1 ligne(s) (2023-09-11|FR012792154|2023-12-06) : isin « FR012792154 » remplacé par « FR0127921254 ». Motif : Code ISIN de 11 caractères dans la source. Le BTF d'échéance 06/12/2023 est adjugé les 04/09/2023 et 09/10/2023 sous FR0127921254.
- Durées en semaines présentes : 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52.
- Segment 3 mois : 1586 adjudications, durées de 1 à 15 semaines.
- Segment 6 mois : 1262 adjudications, durées de 16 à 30 semaines.
- Segment 12 mois : 1219 adjudications, durées de 31 à 52 semaines.

| Niveau | Contrôle | Occurrences | Détail |
|---|---|---:|---|
| avertissement | Doublons (clé : auction_date + isin) (anomalie de la source documentée) | 4 | Deux BTF d'échéances différentes (22 et 44 semaines) portent le même ISIN dans la source. Les deux opérations sont publiées sans modification. Deux BTF d'échéances différentes (23 et 45 semaines) portent le même ISIN dans la source. Les deux opérations sont publiées sans modification. Exemples : 2022-10-03/FR0127317008/2023-03-08 ; 2022-10-03/FR0127317008/2023-08-09 ; 2023-01-16/FR0127613463/2023-06-28 ; 2023-01-16/FR0127613463/2023-11-29 |
| avertissement | Volume total émis = volume adjugé + ONC (anomalie de la source documentée) | 1 | Volume total émis (468) différent de volume adjugé + ONC (438) dans la source. Valeurs publiées sans modification. Exemples : 2021-12-06/FR0126893702/2022-11-02 |
| avertissement | Volume offert min ≤ max (anomalie de la source documentée) | 2 | Volume offert minimum (1 800) supérieur au maximum (1 400) dans la source. Valeurs publiées sans modification. Volume offert minimum (3 000) supérieur au maximum (340) dans la source. Valeurs publiées sans modification. Exemples : 2022-10-10/FR0127317008/2023-03-08 ; 2025-03-24/FR0128838440/2025-06-25 |
| avertissement | Date d'adjudication ou ISIN manquant (anomalie de la source documentée) | 3 | Code ISIN absent de la source (BTF adjugé le 04/06/2018). L'adjudication est publiée sans ISIN. Code ISIN absent de la source (BTF adjugé le 11/06/2018). L'adjudication est publiée sans ISIN. Code ISIN absent de la source (BTF à taux négatif adjugé le 12/06/2017). L'adjudication est publiée sans ISIN. Exemples : 2017-06-12//2017-09-06 ; 2018-06-04//2018-09-05 ; 2018-06-11//2018-09-05 |
| avertissement | Un ISIN associé à plusieurs échéances dans la source | 10 | Opérations publiées sans modification. Exemples : FR0127317008 ; FR0127613463 ; FR0128379452 ; FR0128379486 ; FR0128537224 |

## syndications

Source : 1999-2026_historique_syndications.xlsx

- Répartition par type : synd_LT 26, synd_I 19.
- 2 rachat(s) (volume négatif), exclus des totaux d'émission brute.

| Niveau | Contrôle | Occurrences | Détail |
|---|---|---:|---|
| avertissement | Doublons (clé : date de règlement + ISIN) (anomalie de la source documentée) | 4 | Deux lignes de même date et même ISIN dans la source (3 080,144 et 919,856, soit 4 000 au total). Les deux lignes sont publiées, les volumes s'additionnent. Deux lignes de même date et même ISIN dans la source (volumes distincts). Les deux lignes sont publiées, les volumes s'additionnent. Exemples : 2001-10-31/FR0000188013/4000 ; 2001-10-31/FR0000188013/2500 ; 2002-10-31/FR0000188799/3080.14 ; 2002-10-31/FR0000188799/919.856 |

## point_mort_inflation

Source : 2026_10_01_point_mort_inflation_oati.xls

- Libellé de la série : Point-mort inflation FR 10 ans (Ecart rendement : OAT 05/36 - OATi 03/36)

Aucune anomalie.

## coefficients_indexation

Source : 2026-09_coef_oati-novembre26.xls ; coef_oati_histo_1998_2016.xls

- Fichier courant : base 2025, 10327 jours, 5 titres. Fichier historique : base 1998, 6430 jours, 7 titres.
- Rapport base 1998 / base 2025 calculé sur 6430 jours communs : 1.509487 (écart relatif maximal à la médiane : 1.32e-07).
- 0 jour(s) présents uniquement dans le fichier historique, convertis par le rapport ci-dessus.
- Écart absolu maximal entre l'ancienne référence convertie et la référence courante sur la période commune : 0.00001.
- Titre OATi 3.4 % 25/07/2029 présent dans les deux fichiers : 6065 jours communs, écart maximal 0.00000. Le fichier courant est retenu.
- Écart maximal constaté entre coefficient publié et valeur recalculée, par titre : BTANi 0.45 % 2016 0.00000 ; OATi 1 % 2017 0.00000 ; OATi 1.3 % 2019 0.00000 ; OATi 0.1 % 2021 0.00000 ; OATi 2.1 % 2023 0.00000 ; OATi 0.1 % 2025 0.00000 ; OATi 3.4 % 2029 0.00001 ; OATi 0.1 % 2028 0.00001 ; OATi 0.1 % 2032 0.00001 ; OATi 0.1 % 2036 0.00001 ; OATi 0.55 % 2039 0.00001.
- 11 titre(s) sur 11 rattaché(s) à un ISIN par (famille, coupon, échéance) dans les adjudications.

Aucune anomalie.

## marches_fictifs

Source : data/markets_state.json

- 0 marché(s) ouvert(s) à cette exécution, 0 marché(s) réglé(s). Total : 21 ouvert(s), 0 résolu(s).
- Cotes initiales : fréquence empirique sur les cinq dernières années. Règlement strict (Oui si la valeur dépasse le seuil).

Aucune anomalie.
