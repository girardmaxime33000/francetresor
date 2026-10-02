// Chargement des jeux produits par scripts/build_data.py (build uniquement).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BreakevenRow, BtfRow, CatalogEntry, CoefficientsFile, Dataset, LineRow, OatRow, RefRow, SyndRow } from './types';

const DIR = join(process.cwd(), 'public', 'data');
const cache = new Map<string, unknown>();

function load<T>(name: string): T {
  if (!cache.has(name)) {
    cache.set(name, JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf-8')));
  }
  return cache.get(name) as T;
}

export const oat = () => load<Dataset<OatRow>>('adjudications_oat');
export const btf = () => load<Dataset<BtfRow>>('adjudications_btf');
export const synd = () => load<Dataset<SyndRow>>('syndications');
export const breakeven = () => load<Dataset<BreakevenRow> & { meta: { series_label: string } }>('point_mort_inflation');
export const reference = () => load<Dataset<RefRow>>('reference_inflation');
export const coefficients = () => load<CoefficientsFile>('coefficients_indexation');
export const lines = () => load<Dataset<LineRow>>('lignes');
export const catalog = () => load<{ generated_at: string; datasets: CatalogEntry[] }>('catalog');

/** Date de dernière mise à jour affichée : dernière observation des jeux de marché. */
export function lastUpdate(): string {
  return [oat().meta, btf().meta, synd().meta, breakeven().meta].map((m) => m.last_observation).sort().at(-1) ?? '';
}
