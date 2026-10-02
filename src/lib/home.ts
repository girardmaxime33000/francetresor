import type { Row } from './cell';
import { AUCTION_TYPES } from './labels';
import type { BtfRow, OatRow, SyndRow } from './types';

/** Dix dernières opérations, toutes catégories confondues. */
export function recentOperations(oat: OatRow[], btf: BtfRow[], synd: SyndRow[], n = 10): Row[] {
  const ops: (Row & { order: number })[] = [];
  for (const r of oat) {
    ops.push({
      date: r.auction_date,
      category: r.auction_type === 'adju_I' ? 'Adjudication, titre indexé' : `Adjudication d’OAT, ${AUCTION_TYPES[r.auction_type]?.toLowerCase()}`,
      label: r.line_label,
      href: `/adjudications/lignes/${r.isin}/`,
      volume: r.amount_served,
      rate: r.weighted_rate,
      order: 1,
    });
  }
  for (const r of synd) {
    ops.push({
      date: r.settlement_date,
      category: r.operation === 'rachat' ? 'Rachat (syndication)' : 'Syndication',
      label: r.line_label,
      href: `/adjudications/lignes/${r.isin}/`,
      volume: r.amount,
      rate: r.weighted_rate,
      order: 0,
    });
  }
  const recentBtf = btf.slice(-60);
  for (const r of recentBtf) {
    ops.push({
      date: r.auction_date,
      category: 'Adjudication de BTF',
      label: `BTF ${r.segment}, échéance ${r.maturity_date.split('-').reverse().join('/')}`,
      href: null,
      volume: r.amount_served,
      rate: r.weighted_rate,
      order: 2,
    });
  }
  ops.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.order - b.order);
  return ops.slice(0, n).map(({ order: _o, ...rest }) => rest);
}
