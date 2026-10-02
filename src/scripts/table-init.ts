import type { Row } from '../lib/cell';
import type { TableConfig } from '../lib/columns';
import { bodyHtml, csvContent, headHtml, initialState, pageRows, pagerHtml, shellHtml, statusText, type TableState } from '../lib/table';

const BASE = import.meta.env.BASE_URL;

export function mountTable(root: HTMLElement, cfg: TableConfig, rows: Row[]): void {
  const state: TableState = initialState(cfg);
  root.innerHTML = shellHtml(cfg, rows, state, BASE, false);
  const body = root.querySelector<HTMLElement>('[data-body]')!;
  const head = root.querySelector<HTMLElement>('[data-head]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const pager = root.querySelector<HTMLElement>('[data-pager]')!;

  const update = (focusSelector?: string): void => {
    const { slice, total, pages } = pageRows(cfg, rows, state);
    state.page = Math.min(state.page, pages - 1);
    head.innerHTML = headHtml(cfg, state);
    body.innerHTML = bodyHtml(cfg, slice, BASE);
    status.textContent = statusText(cfg, state, total);
    pager.innerHTML = pagerHtml(state, pages, false);
    if (focusSelector) root.querySelector<HTMLElement>(focusSelector)?.focus();
  };

  root.addEventListener('change', (e) => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-filter]');
    if (!sel) return;
    state.filters[sel.dataset.filter!] = sel.value;
    state.page = 0;
    update();
  });

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const sortBtn = target.closest<HTMLElement>('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort!;
      state.sort = state.sort.key === key ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
      state.page = 0;
      update(`[data-sort="${CSS.escape(key)}"]`);
      return;
    }
    const pageBtn = target.closest<HTMLElement>('[data-page]');
    if (pageBtn) {
      state.page += pageBtn.dataset.page === 'next' ? 1 : -1;
      update(`[data-page="${pageBtn.dataset.page}"]:not(:disabled)`);
      return;
    }
    if (target.closest('[data-csv]')) {
      const blob = new Blob([csvContent(cfg, rows, state)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cfg.csvName}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
}

async function loadRows(cfg: TableConfig, root: HTMLElement): Promise<Row[]> {
  const inline = root.querySelector<HTMLScriptElement>('script[data-rows]');
  if (inline?.textContent) return JSON.parse(inline.textContent) as Row[];
  const res = await fetch(`${BASE}data/${cfg.dataset}.json`);
  if (!res.ok) throw new Error(`Chargement impossible : ${res.status}`);
  const json = (await res.json()) as { records: Row[] };
  const w = cfg.where;
  return w ? json.records.filter((r) => w.in.includes(String(r[w.field]))) : json.records;
}

function init(): void {
  document.querySelectorAll<HTMLElement>('[data-table]').forEach(async (root) => {
    const cfg = JSON.parse(root.dataset.config!) as TableConfig;
    try {
      mountTable(root, cfg, await loadRows(cfg, root));
    } catch {
      const status = root.querySelector('[data-status]');
      if (status) status.textContent = 'Le chargement des données a échoué. Les fichiers restent disponibles dans la rubrique Données.';
    }
  });
}

init();
