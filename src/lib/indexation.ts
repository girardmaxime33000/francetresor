// Recherche d'un coefficient d'indexation et rendu du résultat du calculateur.
import { esc, fmtCoef, fmtDateLong, fmtDec, fmtFlex, NBSP } from './format';
import type { CoefficientsFile, IndexedSecurity } from './types';

export interface CalcInput {
  file: CoefficientsFile;
  security: IndexedSecurity;
  date: string;
}

const DAY = 86_400_000;
const utc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

export function securityLabel(s: IndexedSecurity): string {
  return `${s.type} ${fmtFlex(s.coupon * 100, 3)}${NBSP}% ${fmtDateLong(s.maturity_date)}`;
}

export function resultHtml({ file, security, date }: CalcInput): string {
  const cols = file.columns;
  const dates = cols.date as string[];
  const first = dates[0]!;
  const last = dates.at(-1)!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(utc(date))) {
    return '<p>Saisissez une date valide.</p>';
  }
  const idx = Math.round((utc(date) - utc(first)) / DAY);
  const coverage = `du ${fmtDateLong(security.first_coefficient_date)} au ${fmtDateLong(security.last_coefficient_date)}`;
  const coefs = cols[security.id] as (number | null)[];
  const published = idx >= 0 && idx < dates.length && dates[idx] === date ? coefs[idx] : null;
  if (published === null || published === undefined) {
    return `<p><strong>Date hors de la plage couverte.</strong></p><p>Aucun coefficient n’est publié pour ${esc(securityLabel(security))} le ${esc(fmtDateLong(date))}. Les coefficients de ce titre couvrent la période ${esc(coverage)}. Les fichiers sources couvrent du ${esc(fmtDateLong(first))} au ${esc(fmtDateLong(last))}.</p>`;
  }
  const ref = (cols.daily_reference as number[])[idx]!;
  const base = security.base_index_current_base;
  const recomputed = Math.round((ref / base) * 1e5) / 1e5;
  const gap = Math.abs(recomputed - published) > 1e-9;
  const rebased = security.base_index_label !== file.meta.base;
  return (
    `<p class="stat-value">${esc(fmtCoef(published))}</p>` +
    `<p class="stat-date">Coefficient d’indexation publié pour ${esc(securityLabel(security))} le ${esc(fmtDateLong(date))}</p>` +
    `<p class="formula">CI(d) = Réf(d) / Réf_base = ${esc(fmtDec(ref, 5))} / ${esc(fmtDec(base, 5))} = ${esc(fmtCoef(recomputed))}</p>` +
    `<p class="stat-context">Référence quotidienne d’inflation du jour&nbsp;: ${esc(fmtDec(ref, 5))} (${esc(file.meta.base)}). Indice de base du titre&nbsp;: ${esc(fmtDec(base, 5))} (${esc(file.meta.base)}). Arrondi à cinq décimales.` +
    (rebased ? ` Valeur publiée de l’indice de base en ${esc(security.base_index_label)}&nbsp;: ${esc(fmtDec(security.base_index, 5))}, convertie par le rapport ${esc(fmtDec(file.meta.rebase_ratio_previous_base, 6))}.` : '') +
    (gap ? ` Le calcul diffère du coefficient publié de ${esc(fmtDec(Math.abs(recomputed - published), 5))} (arrondis de conversion). Le coefficient publié fait foi.` : '') +
    '</p>'
  );
}
