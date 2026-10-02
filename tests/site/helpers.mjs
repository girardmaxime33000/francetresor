import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'node-html-parser';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const DIST = join(ROOT, 'dist');

export function walk(dir, filter) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '.git' || name === '.venv' || name === 'dist' || name === '.astro') continue;
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, filter));
    else if (!filter || filter(p)) out.push(p);
  }
  return out;
}

export const htmlFiles = () => walk(DIST, (p) => p.endsWith('.html'));
export const pageName = (p) => '/' + relative(DIST, p).replace(/index\.html$/, '');
export const load = (p) => parse(readFileSync(p, 'utf-8'), { blockTextElements: { script: false, style: false, noscript: true } });

/** Texte visible d'un document : nœuds texte hors script et style, plus attributs textuels. */
export function visibleStrings(root) {
  const out = [];
  const visit = (node) => {
    if (node.nodeType === 3) {
      out.push(node.rawText);
      return;
    }
    const tag = node.rawTagName?.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    for (const attr of ['aria-label', 'alt', 'title', 'content']) {
      const v = node.getAttribute?.(attr);
      if (v && !(tag === 'meta' && !['description'].includes(node.getAttribute('name') ?? ''))) out.push(v);
    }
    node.childNodes?.forEach(visit);
  };
  visit(root);
  return out;
}

export function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8239;|&#x202F;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}
