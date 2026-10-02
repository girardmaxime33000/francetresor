// Teneur de marché automatique LMSR (Hanson) pour un marché binaire.
// Les quantités yes et no sont des parts en circulation ; la fonction de coût borne la perte du teneur.

export interface Book {
  yes: number;
  no: number;
}
export type Side = 'yes' | 'no';

export const LIQUIDITY = 250;

function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

export function cost(book: Book, b = LIQUIDITY): number {
  return b * logSumExp(book.yes / b, book.no / b);
}

/** Probabilité implicite du Oui. */
export function price(book: Book, b = LIQUIDITY): number {
  return 1 / (1 + Math.exp((book.no - book.yes) / b));
}

/** Livre initial dont le prix du Oui vaut p0. */
export function initialBook(p0: number, b = LIQUIDITY): Book {
  return { yes: b * Math.log(p0 / (1 - p0)), no: 0 };
}

/** Nombre de parts obtenues pour une mise donnée, résolu en forme fermée. */
export function sharesForStake(book: Book, side: Side, stake: number, b = LIQUIDITY): number {
  const c = cost(book, b);
  const own = book[side];
  const other = book[side === 'yes' ? 'no' : 'yes'];
  // C(q + s) = C(q) + stake  =>  s = b * (k + ln(1 - exp(other/b - k))) - own, avec k = (C + stake) / b
  const k = (c + stake) / b;
  return b * (k + Math.log1p(-Math.exp(other / b - k))) - own;
}

export function applyShares(book: Book, side: Side, shares: number): Book {
  return side === 'yes' ? { yes: book.yes + shares, no: book.no } : { yes: book.yes, no: book.no + shares };
}

export function trade(book: Book, side: Side, stake: number, b = LIQUIDITY): { shares: number; book: Book; priceBefore: number; priceAfter: number } {
  const shares = sharesForStake(book, side, stake, b);
  const next = applyShares(book, side, shares);
  return { shares, book: next, priceBefore: price(book, b), priceAfter: price(next, b) };
}
