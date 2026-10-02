// Agrégations pures, utilisées au build (chapeaux, bandeau) et par les graphiques client.
import type { BreakevenRow, BtfRow, OatRow, SyndRow } from './types';
import { MATURITY_BUCKETS } from './labels';

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export function groupBy<T, K extends string | number>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const g = out.get(k);
    if (g) g.push(r);
    else out.set(k, [r]);
  }
  return out;
}

const year = (iso: string): number => Number(iso.slice(0, 4));

/** Moyenne pondérée ; ignore les observations sans valeur ou sans poids. */
export function weightedMean(items: { value: number | null; weight: number }[]): number | null {
  const valid = items.filter((i): i is { value: number; weight: number } => i.value !== null && i.weight > 0);
  const w = sum(valid.map((i) => i.weight));
  return w > 0 ? sum(valid.map((i) => i.value * i.weight)) / w : null;
}

export interface SeriesPoint {
  x: number | string;
  series: string;
  value: number;
}

/** Volumes adjugés annuels par type d'adjudication. */
export function yearlyServedByType(rows: OatRow[], types: string[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const byYear = groupBy(rows, (r) => year(r.auction_date));
  for (const [y, g] of [...byYear].sort((a, b) => a[0] - b[0])) {
    for (const t of types) {
      out.push({ x: y, series: t, value: sum(g.filter((r) => r.auction_type === t).map((r) => r.amount_served)) });
    }
  }
  return out;
}

/** Volumes adjugés annuels par indice d'indexation (OATi, OAT€i). */
export function yearlyServedByIndex(rows: OatRow[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const byYear = groupBy(rows, (r) => year(r.auction_date));
  for (const [y, g] of [...byYear].sort((a, b) => a[0] - b[0])) {
    for (const t of ['inflation_france', 'inflation_zone_euro']) {
      out.push({ x: y, series: t, value: sum(g.filter((r) => r.index_type === t).map((r) => r.amount_served)) });
    }
  }
  return out;
}

/** Ratio de couverture annuel : somme des soumissions / somme des volumes adjugés. */
export function yearlyCover(rows: { auction_date: string; bid_amount: number; amount_served: number }[]): { year: number; value: number }[] {
  return [...groupBy(rows, (r) => year(r.auction_date))]
    .sort((a, b) => a[0] - b[0])
    .map(([y, g]) => ({ year: y, value: sum(g.map((r) => r.bid_amount)) / sum(g.map((r) => r.amount_served)) }));
}

/** Rendement réel moyen pondéré par volume adjugé, par année et par indice. */
export function yearlyRealYield(rows: OatRow[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const byYear = groupBy(rows, (r) => year(r.auction_date));
  for (const [y, g] of [...byYear].sort((a, b) => a[0] - b[0])) {
    for (const t of ['inflation_france', 'inflation_zone_euro']) {
      const m = weightedMean(g.filter((r) => r.index_type === t).map((r) => ({ value: r.weighted_rate, weight: r.amount_served })));
      if (m !== null) out.push({ x: y, series: t, value: m });
    }
  }
  return out;
}

export function maturityBucket(years: number): (typeof MATURITY_BUCKETS)[number] | null {
  if (years < 2) return null;
  if (years < 7) return MATURITY_BUCKETS[0];
  if (years < 15) return MATURITY_BUCKETS[1];
  return MATURITY_BUCKETS[2];
}

export interface BucketPoint {
  date: string;
  bucket: string;
  rate: number;
  line: string;
}

/** Titres nominaux (OAT et BTAN) avec taux, maturité résiduelle d'au moins 2 ans. */
export function nominalRatePoints(rows: OatRow[]): BucketPoint[] {
  const out: BucketPoint[] = [];
  for (const r of rows) {
    if (r.weighted_rate === null) continue;
    if (!['OAT', 'BTAN', 'OAT verte'].includes(r.instrument_family)) continue;
    const b = maturityBucket(r.residual_maturity_years);
    if (b) out.push({ date: r.auction_date, bucket: b, rate: r.weighted_rate, line: r.line_label });
  }
  return out;
}

export interface BtfRatePoint {
  date: string;
  segment: string;
  rate: number;
}

/** Taux moyen pondéré par segment et par date d'adjudication (pondéré par le volume adjugé). */
export function btfRates(rows: BtfRow[]): BtfRatePoint[] {
  const out: BtfRatePoint[] = [];
  const byKey = groupBy(rows, (r) => `${r.auction_date}|${r.segment}`);
  for (const [k, g] of byKey) {
    const [date, segment] = k.split('|') as [string, string];
    const m = weightedMean(g.map((r) => ({ value: r.weighted_rate, weight: r.amount_served })));
    if (m !== null) out.push({ date, segment, rate: m });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Volumes adjugés de BTF agrégés par mois. */
export function btfMonthlyVolume(rows: BtfRow[]): { month: string; value: number }[] {
  return [...groupBy(rows, (r) => r.auction_date.slice(0, 7))]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, g]) => ({ month, value: sum(g.map((r) => r.amount_served)) }));
}

/** Émissions brutes de syndication par année et par type (rachats exclus). */
export function syndYearly(rows: SyndRow[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const emissions = rows.filter((r) => r.operation === 'emission');
  const years = [...new Set(emissions.map((r) => year(r.settlement_date)))].sort((a, b) => a - b);
  const first = years[0] ?? 0;
  const last = years.at(-1) ?? 0;
  for (let y = first; y <= last; y++) {
    for (const t of ['synd_LT', 'synd_I']) {
      out.push({ x: y, series: t, value: sum(emissions.filter((r) => year(r.settlement_date) === y && r.syndication_type === t).map((r) => r.amount)) });
    }
  }
  return out;
}

/** Dernière date d'adjudication et agrégats de cette date. */
export function lastOatAuction(rows: OatRow[]) {
  const last = rows.reduce((m, r) => (r.auction_date > m ? r.auction_date : m), '');
  const g = rows.filter((r) => r.auction_date === last);
  return {
    date: last,
    lines: g.map((r) => r.line_label),
    served: sum(g.map((r) => r.amount_served)),
    cover: sum(g.map((r) => r.bid_amount)) / sum(g.map((r) => r.amount_served)),
  };
}

export function lastBtfAuction(rows: BtfRow[]) {
  const last = rows.reduce((m, r) => (r.auction_date > m ? r.auction_date : m), '');
  const g = rows.filter((r) => r.auction_date === last);
  const rates = new Map<string, number | null>();
  for (const seg of ['3 mois', '6 mois', '12 mois']) {
    rates.set(seg, weightedMean(g.filter((r) => r.segment === seg).map((r) => ({ value: r.weighted_rate, weight: r.amount_served }))));
  }
  return { date: last, rates };
}

/** Dernière valeur du point mort et variation sur un mois (observation à une date égale ou antérieure à date − 1 mois). */
export function breakevenLatest(rows: BreakevenRow[]) {
  const last = rows[rows.length - 1]!;
  const d = new Date(`${last.date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const ref = d.toISOString().slice(0, 10);
  let prev: BreakevenRow | undefined;
  for (const r of rows) {
    if (r.date <= ref) prev = r;
    else break;
  }
  return { last, prev, change: prev ? last.breakeven_bp - prev.breakeven_bp : null };
}

export function periodStats(rows: BreakevenRow[], startIso: string | null) {
  const sel = startIso ? rows.filter((r) => r.date >= startIso) : rows;
  let min = sel[0]!;
  let max = sel[0]!;
  for (const r of sel) {
    if (r.breakeven_bp < min.breakeven_bp) min = r;
    if (r.breakeven_bp > max.breakeven_bp) max = r;
  }
  return { count: sel.length, from: sel[0]!.date, to: sel.at(-1)!.date, min, max, mean: sum(sel.map((r) => r.breakeven_bp)) / sel.length };
}

/** Date de début d'une période glissante de `years` années avant la dernière observation. */
export function periodStart(lastIso: string, years: number): string {
  const d = new Date(`${lastIso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}
