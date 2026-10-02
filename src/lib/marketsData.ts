import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketsFile } from './markets';

let cache: MarketsFile | undefined;
export function marketsFile(): MarketsFile {
  cache ??= JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'marches.json'), 'utf-8')) as MarketsFile;
  return cache;
}
