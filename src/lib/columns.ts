import { AUCTION_TYPES, OPERATIONS, SYND_TYPES } from './labels';

export type ColKind = 'date' | 'text' | 'int' | 'rate' | 'price' | 'ratio' | 'coef' | 'bp' | 'pctnum' | 'year';

export interface Col {
  key: string;
  label: string;
  kind: ColKind;
  /** Table de correspondance valeur -> libellé. */
  map?: Record<string, string>;
  /** Gabarit de lien, ex. /adjudications/lignes/{isin}/ ; les champs entre accolades viennent de la ligne. */
  href?: string;
  /** Colonne d'en-tête de ligne (th scope="row"). */
  rowHeader?: boolean;
}

export interface FilterDef {
  id: string;
  label: string;
  field: string;
  kind: 'year' | 'value';
  /** Options fixes pour kind 'value' ; sinon déduites des données. */
  options?: { value: string; label: string }[];
}

export interface TableConfig {
  id: string;
  caption: string;
  columns: Col[];
  filters: FilterDef[];
  pageSize: number;
  csvName: string;
  sort: { key: string; dir: 'asc' | 'desc' };
  /** Jeu chargé à la demande (public/data/<dataset>.json) ; absent si les lignes sont intégrées. */
  dataset?: string;
  where?: { field: string; in: string[] };
  /** Clé secondaire de tri pour stabiliser l'ordre. */
  thenBy?: string;
}

const LINE_HREF = '/adjudications/lignes/{isin}/';

export const OAT_COLUMNS: Col[] = [
  { key: 'auction_date', label: 'Date d’adjudication', kind: 'date' },
  { key: 'auction_type', label: 'Type', kind: 'text', map: AUCTION_TYPES },
  { key: 'line_label', label: 'Ligne', kind: 'text', href: LINE_HREF },
  { key: 'offered_min', label: 'Offert min. (M€)', kind: 'int' },
  { key: 'offered_max', label: 'Offert max. (M€)', kind: 'int' },
  { key: 'bid_amount', label: 'Soumissions (M€)', kind: 'int' },
  { key: 'amount_served', label: 'Adjugé (M€)', kind: 'int' },
  { key: 'bid_to_cover', label: 'Couverture', kind: 'ratio' },
  { key: 'nct_amount', label: 'ONC (M€)', kind: 'int' },
  { key: 'total_issued', label: 'Total émis (M€)', kind: 'int' },
  { key: 'weighted_rate', label: 'Taux moyen pondéré', kind: 'rate' },
  { key: 'weighted_price', label: 'Prix moyen pondéré (% du pair)', kind: 'price' },
  { key: 'index_ratio', label: 'Coefficient d’indexation', kind: 'coef' },
];

export const BTF_COLUMNS: Col[] = [
  { key: 'auction_date', label: 'Date d’adjudication', kind: 'date' },
  { key: 'segment', label: 'Segment', kind: 'text' },
  { key: 'term_weeks', label: 'Durée (semaines)', kind: 'int' },
  { key: 'maturity_date', label: 'Échéance', kind: 'date' },
  { key: 'isin', label: 'Code ISIN', kind: 'text' },
  { key: 'offered_min', label: 'Offert min. (M€)', kind: 'int' },
  { key: 'offered_max', label: 'Offert max. (M€)', kind: 'int' },
  { key: 'bid_amount', label: 'Soumissions (M€)', kind: 'int' },
  { key: 'amount_served', label: 'Adjugé (M€)', kind: 'int' },
  { key: 'bid_to_cover', label: 'Couverture', kind: 'ratio' },
  { key: 'nct_amount', label: 'ONC (M€)', kind: 'int' },
  { key: 'total_issued', label: 'Total émis (M€)', kind: 'int' },
  { key: 'weighted_rate', label: 'Taux moyen pondéré', kind: 'rate' },
];

export const SYND_COLUMNS: Col[] = [
  { key: 'settlement_date', label: 'Date de règlement', kind: 'date' },
  { key: 'syndication_type', label: 'Type', kind: 'text', map: SYND_TYPES },
  { key: 'operation', label: 'Opération', kind: 'text', map: OPERATIONS },
  { key: 'line_label', label: 'Ligne', kind: 'text', href: LINE_HREF },
  { key: 'amount', label: 'Volume émis ou racheté (M€)', kind: 'int' },
  { key: 'weighted_rate', label: 'Taux moyen pondéré', kind: 'rate' },
  { key: 'weighted_price', label: 'Prix moyen pondéré (% du pair)', kind: 'price' },
  { key: 'index_ratio', label: 'Coefficient d’indexation', kind: 'coef' },
];

export const LINES_COLUMNS: Col[] = [
  { key: 'label', label: 'Ligne', kind: 'text', href: LINE_HREF, rowHeader: true },
  { key: 'isin', label: 'Code ISIN', kind: 'text' },
  { key: 'instrument_family', label: 'Famille', kind: 'text' },
  { key: 'maturity_date', label: 'Échéance', kind: 'date' },
  { key: 'auction_count', label: 'Adjudications', kind: 'int' },
  { key: 'syndication_count', label: 'Syndications', kind: 'int' },
  { key: 'auction_volume', label: 'Volume émis par adjudication (M€)', kind: 'int' },
  { key: 'syndication_volume', label: 'Volume émis par syndication (M€)', kind: 'int' },
  { key: 'last_operation', label: 'Dernière opération', kind: 'date' },
];

/** Opérations d'une ligne (adjudications et syndications) pour les fiches. */
export const LINE_OPS_COLUMNS: Col[] = [
  { key: 'date', label: 'Date', kind: 'date' },
  { key: 'channel', label: 'Voie d’émission', kind: 'text' },
  { key: 'volume', label: 'Volume (M€)', kind: 'int' },
  { key: 'bid_to_cover', label: 'Couverture', kind: 'ratio' },
  { key: 'rate', label: 'Taux moyen pondéré', kind: 'rate' },
  { key: 'price', label: 'Prix moyen pondéré (% du pair)', kind: 'price' },
  { key: 'index_ratio', label: 'Coefficient d’indexation', kind: 'coef' },
];

export const HOME_COLUMNS: Col[] = [
  { key: 'date', label: 'Date', kind: 'date' },
  { key: 'category', label: 'Catégorie', kind: 'text' },
  { key: 'label', label: 'Ligne', kind: 'text', href: '{href}' },
  { key: 'volume', label: 'Volume (M€)', kind: 'int' },
  { key: 'rate', label: 'Taux moyen pondéré', kind: 'rate' },
];

export const IDX_COLUMNS: Col[] = OAT_COLUMNS.filter((c) => c.key !== 'auction_type').flatMap((c): Col[] => {
  if (c.key === 'auction_date') return [c, { key: 'instrument_family', label: 'Famille', kind: 'text' }];
  if (c.key === 'weighted_rate') return [{ ...c, label: 'Rendement réel moyen pondéré' }];
  return [c];
});
