// Marchés fictifs : types, libellés et règles de règlement affichées.
import { fmtAmount, fmtBp, fmtDateLong, fmtDec, fmtPct, NBSP, NNBSP } from './format';

export type Indicator = 'breakeven' | 'btf_rate' | 'oat_cover' | 'oat_served';

export interface Market {
  id: string;
  indicator: Indicator;
  params: { horizon_days?: number; segment?: string; kind?: 'LT' | 'MT' };
  threshold: number;
  reference_date: string;
  target_date: string | null;
  last_value: number;
  p0: number;
  p0_sample: number;
  status: 'open' | 'resolved';
  outcome: boolean | null;
  resolved_value: number | null;
  resolved_date: string | null;
}

export interface MarketsFile {
  meta: { record_count: number; open_count: number; resolved_count: number; first_observation: string; last_observation: string; liquidity: number; generated_at: string };
  records: Market[];
}

export const INDICATOR_LABELS: Record<Indicator, string> = {
  breakeven: 'Point mort d’inflation à 10 ans',
  btf_rate: 'Taux des BTF',
  oat_cover: 'Ratio de couverture des OAT',
  oat_served: 'Volume adjugé des OAT',
};

const KIND: Record<string, string> = { LT: 'long terme', MT: 'moyen terme' };
const Q = `${NNBSP}?`;

export function formatValue(m: Pick<Market, 'indicator'>, v: number): string {
  switch (m.indicator) {
    case 'breakeven':
      return fmtBp(v, 1);
    case 'btf_rate':
      return fmtPct(v, 2);
    case 'oat_cover':
      return fmtDec(v, 2);
    default:
      return fmtAmount(v);
  }
}

export function formatThreshold(m: Market): string {
  return m.indicator === 'breakeven' ? fmtBp(m.threshold, 0) : formatValue(m, m.threshold);
}

export function question(m: Market): string {
  const t = formatThreshold(m);
  switch (m.indicator) {
    case 'breakeven':
      return `Le point mort d’inflation à 10 ans sera-t-il supérieur à ${t} le ${fmtDateLong(m.target_date)}${Q}`;
    case 'btf_rate':
      return `Le taux moyen pondéré du BTF à ${m.params.segment} sera-t-il supérieur à ${t} à la prochaine adjudication${Q}`;
    case 'oat_cover':
      return `Le ratio de couverture de la prochaine adjudication d’OAT à ${KIND[m.params.kind ?? 'LT']} sera-t-il supérieur à ${t}${Q}`;
    default:
      return `Le volume adjugé de la prochaine adjudication d’OAT à ${KIND[m.params.kind ?? 'LT']} dépassera-t-il ${t}${Q}`;
  }
}

/** Règle de règlement, en phrases déclaratives. */
export function resolutionRule(m: Market): string {
  const ref = fmtDateLong(m.reference_date);
  const strict = `Le marché est réglé Oui si la valeur est strictement supérieure au seuil de ${formatThreshold(m)}, Non sinon.`;
  switch (m.indicator) {
    case 'breakeven':
      return `La valeur retenue est la dernière observation de la série du point mort d’inflation à 10 ans à une date égale ou antérieure au ${fmtDateLong(m.target_date)}. Le marché est réglé dès que la série contient une observation à cette date ou après. ${strict}`;
    case 'btf_rate':
      return `La valeur retenue est le taux moyen pondéré du segment ${m.params.segment} lors de la première adjudication de BTF postérieure au ${ref}, pondéré par le volume adjugé si plusieurs lignes du segment sont adjugées ce jour. ${strict}`;
    case 'oat_cover':
      return `La valeur retenue est le rapport entre la somme des soumissions et la somme des volumes adjugés, toutes lignes confondues, de la première date d’adjudication postérieure au ${ref} comportant au moins une ligne à ${KIND[m.params.kind ?? 'LT']}. ${strict}`;
    default:
      return `La valeur retenue est la somme des volumes adjugés, toutes lignes confondues, de la première date d’adjudication postérieure au ${ref} comportant au moins une ligne à ${KIND[m.params.kind ?? 'LT']}. ${strict}`;
  }
}

export function windowLabel(m: Market): string {
  return m.target_date ? `Échéance le ${fmtDateLong(m.target_date)}` : `Prochaine adjudication après le ${fmtDateLong(m.reference_date)}`;
}

export const CHART_FOR: Record<Indicator, { kind: string; dataset: string; title: string; unit: string }> = {
  breakeven: { kind: 'breakeven', dataset: 'point_mort_inflation', title: 'L’historique du point mort d’inflation à 10 ans', unit: 'Points de base' },
  btf_rate: { kind: 'btf-rates', dataset: 'adjudications_btf', title: 'L’historique des taux des BTF par segment', unit: 'Pourcentage, par date d’adjudication' },
  oat_cover: { kind: 'oat-cover', dataset: 'adjudications_oat', title: 'Le ratio de couverture annuel des adjudications d’OAT', unit: 'Volume des soumissions rapporté au volume adjugé, par année' },
  oat_served: { kind: 'oat-volumes', dataset: 'adjudications_oat', title: 'Les volumes adjugés annuels d’OAT par type', unit: 'Millions d’euros, par année d’adjudication' },
};

export const NOTICE = `Monnaie fictive${NBSP}: jetons virtuels et illimités, sans valeur, non convertibles, sans lot ni gain réel. Projet éducatif.`;
