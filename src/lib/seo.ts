import { EDITOR, SITE_NAME } from '../config';
import { DATA_SOURCE, DATA_SOURCE_URL } from '../config';
import type { Meta } from './types';

/** Données structurées schema.org/Dataset pour une page de données. */
export function datasetLd(meta: Meta, o: { name: string; description: string; path: string; files: string[] }) {
  const site = import.meta.env.SITE as string | undefined;
  const abs = (p: string) => (site ? new URL(p, site).href : p);
  const formats: Record<string, string> = { csv: 'text/csv', json: 'application/json' };
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: o.name,
    description: o.description,
    inLanguage: 'fr',
    url: abs(o.path),
    temporalCoverage: `${meta.first_observation}/${meta.last_observation}`,
    dateModified: meta.generated_at.slice(0, 10),
    creator: { '@type': 'Person', name: EDITOR },
    publisher: { '@type': 'Person', name: EDITOR },
    isBasedOn: { '@type': 'CreativeWork', name: `Données publiées par l’${DATA_SOURCE}`, url: DATA_SOURCE_URL },
    isPartOf: { '@type': 'WebSite', name: SITE_NAME },
    distribution: o.files.map((f) => ({
      '@type': 'DataDownload',
      encodingFormat: formats[f.split('.').pop() ?? ''] ?? 'application/octet-stream',
      contentUrl: abs(`/data/${f}`),
    })),
  };
}
