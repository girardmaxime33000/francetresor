export interface Meta {
  dataset: string;
  title: string;
  source_file: string;
  first_observation: string;
  last_observation: string;
  record_count: number;
  generated_at: string;
  [k: string]: unknown;
}

export interface OatRow {
  auction_type: 'adju_LT' | 'adju_MT' | 'adju_I' | 'adju_MLT';
  auction_date: string;
  settlement_date: string;
  offered_min: number | null;
  offered_max: number | null;
  isin: string;
  line: string;
  bid_amount: number;
  amount_served: number;
  bid_to_cover: number;
  nct_amount: number;
  total_issued: number;
  weighted_rate: number | null;
  weighted_price: number | null;
  index_ratio: number | null;
  instrument_family: string;
  coupon: number | null;
  maturity_date: string;
  residual_maturity_years: number;
  index_type: 'inflation_france' | 'inflation_zone_euro' | null;
  line_label: string;
}

export interface BtfRow {
  auction_date: string;
  settlement_date: string;
  term_weeks: number;
  maturity_date: string;
  offered_min: number | null;
  offered_max: number | null;
  isin: string | null;
  bid_amount: number;
  amount_served: number;
  bid_to_cover: number;
  nct_amount: number;
  total_issued: number;
  weighted_rate: number | null;
  segment: '3 mois' | '6 mois' | '12 mois';
}

export interface SyndRow {
  syndication_type: 'synd_LT' | 'synd_I';
  settlement_date: string;
  maturity_year: number;
  isin: string;
  line: string;
  amount: number;
  weighted_rate: number | null;
  weighted_price: number | null;
  index_ratio: number | null;
  operation: 'emission' | 'rachat';
  instrument_family: string;
  coupon: number | null;
  maturity_date: string;
  line_label: string;
}

export interface BreakevenRow {
  date: string;
  breakeven: number;
  breakeven_bp: number;
}

export interface RefRow {
  date: string;
  daily_reference: number;
}

export interface IndexedSecurity {
  id: string;
  type: string;
  coupon: number;
  maturity_date: string;
  reference_date: string;
  base_index: number;
  base_index_label: string;
  base_index_current_base: number;
  first_coefficient_date: string;
  last_coefficient_date: string;
  isin: string | null;
  source_file: string;
}

export interface CoefficientsFile {
  meta: Meta & { securities: IndexedSecurity[]; base: string; previous_base: string; rebase_ratio_previous_base: number };
  columns: Record<string, (number | string | null)[]>;
}

export interface LineRow {
  isin: string;
  label: string;
  instrument_family: string;
  coupon: number | null;
  maturity_date: string;
  auction_count: number;
  syndication_count: number;
  first_operation: string;
  last_operation: string;
  auction_volume: number;
  syndication_volume: number;
}

export interface Dataset<T> {
  meta: Meta;
  records: T[];
}

export interface CatalogEntry {
  id: string;
  title: string;
  files: { json: string; csv: string };
  meta: Meta;
  variables: { id: string; label: string; unit: string; description: string }[];
}
