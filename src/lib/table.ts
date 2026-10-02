// Composant de tableau : logique de tri, filtre, pagination et gabarits HTML.
// Les mêmes fonctions servent au rendu serveur (première page) et au rendu client.
import { cellHtml, csvText, isNumeric, type Row } from './cell';
import type { FilterDef, TableConfig } from './columns';
import { esc, fmtInt, yearOf } from './format';

export interface TableState {
  filters: Record<string, string>;
  sort: { key: string; dir: 'asc' | 'desc' };
  page: number;
}

export function initialState(cfg: TableConfig): TableState {
  return { filters: {}, sort: { ...cfg.sort }, page: 0 };
}

function filterValue(f: FilterDef, row: Row): string {
  const v = row[f.field];
  if (v === null || v === undefined) return '';
  return f.kind === 'year' ? String(yearOf(String(v))) : String(v);
}

export function applyFilters(cfg: TableConfig, rows: Row[], state: TableState): Row[] {
  const active = cfg.filters.filter((f) => state.filters[f.id]);
  if (!active.length) return rows;
  return rows.filter((r) => active.every((f) => filterValue(f, r) === state.filters[f.id]));
}

function compare(a: unknown, b: unknown): number {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr');
}

export function sortRows(cfg: TableConfig, rows: Row[], state: TableState): Row[] {
  const sign = state.sort.dir === 'asc' ? 1 : -1;
  const key = state.sort.key;
  const col = cfg.columns.find((c) => c.key === key);
  const val = (r: Row): unknown => (col?.map && typeof r[key] === 'string' ? (col.map[r[key] as string] ?? r[key]) : r[key]);
  const tie = cfg.thenBy ?? cfg.sort.key;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const c = compare(val(x.r), val(y.r));
      if (c !== 0) return x.r[key] == null || y.r[key] == null ? c : sign * c;
      const t = compare(x.r[tie], y.r[tie]);
      return t !== 0 ? -t : x.i - y.i;
    })
    .map((x) => x.r);
}

export function filterOptions(rows: Row[], f: FilterDef): { value: string; label: string }[] {
  if (f.options) return f.options;
  const values = [...new Set(rows.map((r) => filterValue(f, r)).filter(Boolean))];
  values.sort((a, b) => b.localeCompare(a));
  return values.map((v) => ({ value: v, label: v }));
}

const SORT_ICON =
  '<svg class="sort-icon" viewBox="0 0 10 14" width="10" height="14" aria-hidden="true" focusable="false"><path class="up" d="M2 5l3-3 3 3"/><path class="down" d="M2 9l3 3 3-3"/></svg>';

export function headHtml(cfg: TableConfig, state: TableState): string {
  const cells = cfg.columns
    .map((c) => {
      const active = state.sort.key === c.key;
      const aria = active ? ` aria-sort="${state.sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
      const cls = isNumeric(c) ? ' class="num"' : '';
      return `<th scope="col"${cls}${aria}><button type="button" class="sort-button" data-sort="${esc(c.key)}">${esc(c.label)}${SORT_ICON}</button></th>`;
    })
    .join('');
  return `<tr>${cells}</tr>`;
}

export function pageRows(cfg: TableConfig, rows: Row[], state: TableState): { slice: Row[]; total: number; pages: number } {
  const sorted = sortRows(cfg, applyFilters(cfg, rows, state), state);
  const pages = Math.max(1, Math.ceil(sorted.length / cfg.pageSize));
  const page = Math.min(state.page, pages - 1);
  return { slice: sorted.slice(page * cfg.pageSize, (page + 1) * cfg.pageSize), total: sorted.length, pages };
}

export function bodyHtml(cfg: TableConfig, slice: Row[], base: string): string {
  if (!slice.length) return `<tr><td colspan="${cfg.columns.length}">Aucune ligne ne correspond aux filtres sélectionnés.</td></tr>`;
  return slice.map((r) => `<tr>${cfg.columns.map((c) => cellHtml(c, r, base)).join('')}</tr>`).join('');
}

export function statusText(cfg: TableConfig, state: TableState, total: number): string {
  if (total === 0) return '0 ligne';
  const page = state.page;
  const from = page * cfg.pageSize + 1;
  const to = Math.min(total, (page + 1) * cfg.pageSize);
  return `Lignes ${fmtInt(from)} à ${fmtInt(to)} sur ${fmtInt(total)}`;
}

export function pagerHtml(state: TableState, pages: number, disabled: boolean): string {
  const prev = disabled || state.page <= 0 ? ' disabled' : '';
  const next = disabled || state.page >= pages - 1 ? ' disabled' : '';
  return `<button type="button" class="button" data-page="prev"${prev}>Précédent</button><span>Page ${state.page + 1} sur ${pages}</span><button type="button" class="button" data-page="next"${next}>Suivant</button>`;
}

const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11"/></svg>';

export function shellHtml(cfg: TableConfig, rows: Row[], state: TableState, base: string, disabled: boolean): string {
  const { slice, total, pages } = pageRows(cfg, rows, state);
  const filters = cfg.filters
    .map((f) => {
      const id = `${cfg.id}-f-${f.id}`;
      const opts = filterOptions(rows, f)
        .map((o) => `<option value="${esc(o.value)}"${state.filters[f.id] === o.value ? ' selected' : ''}>${esc(o.label)}</option>`)
        .join('');
      return `<div><label for="${id}">${esc(f.label)}</label><select id="${id}" data-filter="${esc(f.id)}"${disabled ? ' disabled' : ''}><option value="">Toutes</option>${opts}</select></div>`;
    })
    .join('');
  const dis = disabled ? ' disabled' : '';
  return (
    `<div class="table-controls">${filters}<div><button type="button" class="button" data-csv${dis}>${DOWNLOAD_ICON}Exporter la vue en CSV</button></div></div>` +
    `<div class="table-scroll" role="region" aria-label="${esc(cfg.caption)}" tabindex="0"><table class="data"><caption>${esc(cfg.caption)}</caption>` +
    `<thead data-head>${headHtml(cfg, state)}</thead><tbody data-body>${bodyHtml(cfg, slice, base)}</tbody></table></div>` +
    `<div class="table-footer"><p class="table-status" role="status" aria-live="polite" data-status>${statusText(cfg, state, total)}</p><div class="pager" data-pager>${pagerHtml(state, pages, disabled)}</div></div>`
  );
}

function csvField(s: string): string {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export de la vue filtrée et triée (toutes les pages), UTF-8 avec BOM, séparateur point-virgule. */
export function csvContent(cfg: TableConfig, rows: Row[], state: TableState): string {
  const sorted = sortRows(cfg, applyFilters(cfg, rows, state), state);
  const lines = [cfg.columns.map((c) => csvField(c.label)).join(';')];
  for (const r of sorted) lines.push(cfg.columns.map((c) => csvField(csvText(c, r))).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
