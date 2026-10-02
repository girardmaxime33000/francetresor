// Formatage des cellules de tableau, commun au rendu serveur et au rendu client.
import type { Col } from './columns';
import { csvNumber, esc, fmtCoef, fmtDateShort, fmtDec, fmtInt, fmtPct, fmtRatio } from './format';

export type Row = Record<string, unknown>;

export function rawValue(col: Col, row: Row): unknown {
  return row[col.key];
}

export function cellText(col: Col, row: Row): string {
  const v = rawValue(col, row);
  if (v === null || v === undefined || v === '') return '';
  switch (col.kind) {
    case 'date':
      return fmtDateShort(String(v));
    case 'int':
      return fmtInt(Number(v));
    case 'rate':
      return fmtPct(Number(v), 3);
    case 'price':
      return fmtPct(Number(v), 2);
    case 'ratio':
      return fmtRatio(Number(v));
    case 'coef':
      return fmtCoef(Number(v));
    case 'dec':
      return fmtDec(Number(v), 2);
    case 'pctnum':
      return fmtDec(Number(v), 3);
    case 'bp':
      return fmtDec(Number(v), 1);
    case 'year':
      return String(v);
    default:
      return col.map ? (col.map[String(v)] ?? String(v)) : String(v);
  }
}

export function isNumeric(col: Col): boolean {
  return !['text', 'date', 'year'].includes(col.kind);
}

export function isNegative(col: Col, row: Row): boolean {
  const v = rawValue(col, row);
  return (col.kind === 'int' || col.kind === 'dec') && typeof v === 'number' && v < 0;
}

export function hrefFor(col: Col, row: Row): string | null {
  if (!col.href) return null;
  let missing = false;
  const url = col.href.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = row[k];
    if (v === null || v === undefined || v === '') missing = true;
    return String(v ?? '');
  });
  return missing ? null : url;
}

/** Valeur exportée en CSV : nombres avec virgule décimale, dates ISO, libellés bruts. */
export function csvText(col: Col, row: Row): string {
  const v = rawValue(col, row);
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return csvNumber(v);
  if (col.map) return col.map[String(v)] ?? String(v);
  return String(v);
}

export function cellHtml(col: Col, row: Row, base: string): string {
  const text = esc(cellText(col, row));
  const href = hrefFor(col, row);
  const inner = href && text ? `<a href="${esc(base + href.replace(/^\//, ''))}">${text}</a>` : text;
  const cls = [isNumeric(col) ? 'num' : col.kind === 'date' ? 'nowrap' : '', isNegative(col, row) ? 'neg' : ''].filter(Boolean).join(' ');
  const c = cls ? ` class="${cls}"` : '';
  const sign = isNegative(col, row) ? '' : '';
  return col.rowHeader ? `<th scope="row"${c}>${sign}${inner}</th>` : `<td${c}>${inner}</td>`;
}
