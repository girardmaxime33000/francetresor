// Fonctions de formatage partagées par le build et les scripts client.
// Règles : Intl.NumberFormat('fr-FR'), signe moins U+2212, espace insécable U+00A0 avant « % »
// et avant les unités, espace fine insécable U+202F comme séparateur de milliers.

export const NBSP = ' ';
export const NNBSP = ' ';
export const MINUS = '−';
export const EN_DASH = '–';

const formatters = new Map<string, Intl.NumberFormat>();

function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true });
    formatters.set(key, f);
  }
  return f;
}

function normalize(s: string): string {
  // Intl insère déjà U+202F pour les milliers ; le signe peut sortir en trait d'union.
  return s.replace(/-/g, MINUS).replace(/ /g, NNBSP);
}

export type Nullable<T> = T | null | undefined;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function fmtInt(v: Nullable<number>): string {
  return isNum(v) ? normalize(nf(0, 0).format(v)) : '';
}

export function fmtDec(v: Nullable<number>, digits = 2): string {
  return isNum(v) ? normalize(nf(digits, digits).format(v)) : '';
}

/** Décimal jusqu'à `max` chiffres, sans zéros inutiles. */
export function fmtFlex(v: Nullable<number>, max = 3): string {
  return isNum(v) ? normalize(nf(0, max).format(v)) : '';
}

export function fmtPct(rate: Nullable<number>, digits = 2): string {
  return isNum(rate) ? `${fmtDec(rate * 100, digits)}${NBSP}%` : '';
}

export function fmtAmount(v: Nullable<number>): string {
  return isNum(v) ? `${fmtInt(v)}${NBSP}M€` : '';
}

export function fmtBp(v: Nullable<number>, digits = 1): string {
  return isNum(v) ? `${fmtDec(v, digits)}${NBSP}pb` : '';
}

export function fmtSignedBp(v: Nullable<number>, digits = 1): string {
  if (!isNum(v)) return '';
  const body = fmtDec(Math.abs(v), digits);
  const sign = v < 0 ? MINUS : '+';
  return `${sign}${body}${NBSP}pb`;
}

export function fmtPrice(p: Nullable<number>): string {
  return isNum(p) ? `${fmtDec(p * 100, 2)}${NBSP}% du pair` : '';
}

export function fmtCoef(c: Nullable<number>): string {
  return fmtDec(c, 5);
}

export function fmtRatio(r: Nullable<number>): string {
  return fmtDec(r, 2);
}

export function fmtYears(y: Nullable<number>): string {
  return isNum(y) ? `${fmtDec(y, 1)}${NBSP}ans` : '';
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

/** 17/09/2026 */
export function fmtDateShort(iso: Nullable<string>): string {
  if (!iso) return '';
  const [y, m, d] = parts(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** 17 septembre 2026 ; 1er pour le premier jour du mois. */
export function fmtDateLong(iso: Nullable<string>): string {
  if (!iso) return '';
  const [y, m, d] = parts(iso);
  const day = d === 1 ? '1er' : String(d);
  return `${day}${NBSP}${MONTHS[m - 1]}${NBSP}${y}`;
}

export function fmtMonthYear(iso: string): string {
  const [y, m] = parts(iso);
  return `${MONTHS[m - 1]} ${y}`;
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** Intervalle numérique avec demi-cadratin, ex. 2019–2026. */
export function range(a: string | number, b: string | number): string {
  return `${a}${EN_DASH}${b}`;
}

/** Nombre pour export CSV : virgule décimale, sans séparateur de milliers. */
export function csvNumber(v: number): string {
  return String(v).replace('.', ',');
}

export function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/** Échappe le HTML pour les rendus construits à la main côté client. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Applique la typographie française à un texte repris de la source :
 * espace insécable avant « : » et « % », espace fine insécable avant « ; », « ! » et « ? ». */
export function frTypo(text: string): string {
  return text.replace(/ ([:%])/g, `${NBSP}$1`).replace(/ ([;!?])/g, `${NNBSP}$1`);
}
