import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ROOT, decode, htmlFiles, load, pageName, visibleStrings, walk } from './helpers.mjs';

// Construit sans caractère littéral pour que ce fichier ne se signale pas lui-même.
const DASHES = new RegExp(`[${String.fromCharCode(0x2014, 0x2015)}]`);
const EMOJI = /\p{Extended_Pictographic}/u;
const files = htmlFiles();

test('le site généré contient des pages', () => {
  assert.ok(files.length > 200, `${files.length} pages`);
});

test('HTML généré : ni U+2014, ni U+2015, ni emoji', () => {
  const bad = [];
  for (const f of files) {
    const html = readFileSync(f, 'utf-8');
    if (DASHES.test(html)) bad.push(`${pageName(f)} : tiret cadratin ou barre horizontale`);
    const text = visibleStrings(load(f)).map(decode).join('\n');
    if (EMOJI.test(text)) bad.push(`${pageName(f)} : emoji`);
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('HTML généré : aucune espace ordinaire devant : ; % ! ?', () => {
  const bad = [];
  for (const f of files) {
    const text = visibleStrings(load(f)).map(decode).join('\n');
    const re = /(\S{0,25}) [:;%!?]/g;
    for (const m of text.matchAll(re)) {
      bad.push(`${pageName(f)} : «${m[0]}»`);
      if (bad.length > 30) break;
    }
  }
  assert.deepEqual(bad.slice(0, 15), []);
});

test('HTML généré : espaces insécables à l’intérieur des guillemets français', () => {
  const bad = [];
  for (const f of files) {
    const text = visibleStrings(load(f)).map(decode).join('\n');
    for (const m of text.matchAll(/« ?[^»\n]{0,30}|[^«\n]{0,30} ?»/g)) {
      if (/^«[^ ]|[^ ]»$/.test(m[0]) || /« | »/.test(m[0])) bad.push(`${pageName(f)} : ${m[0]}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('code source : ni U+2014 ni U+2015', () => {
  const src = walk(ROOT, (p) => /\.(astro|ts|mjs|css|py|md|json|toml|txt|svg)$/.test(p) && !p.includes('package-lock') && !p.endsWith('.csv') && !p.includes('/public/data/') && !p.includes('/data/raw/'));
  const bad = src.filter((p) => DASHES.test(readFileSync(p, 'utf-8')));
  assert.deepEqual(bad, []);
});
