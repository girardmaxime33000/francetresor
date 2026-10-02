import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DIST, ROOT, htmlFiles, load, pageName } from './helpers.mjs';

const pages = new Map(htmlFiles().map((f) => [pageName(f), load(f)]));
const get = (p) => {
  const doc = pages.get(p);
  assert.ok(doc, `page absente : ${p}`);
  return doc;
};
// Les espaces insécables sont conservées : seules les espaces ordinaires sont normalisées.
const text = (n) => n.text.replace(/[ \t\r\n]+/g, ' ').trim();

test('toutes les pages : un h1, un title, une description, une langue', () => {
  for (const [name, doc] of pages) {
    assert.equal(doc.querySelectorAll('h1').length, 1, `${name} : h1`);
    assert.ok(text(doc.querySelector('title')).length > 5, `${name} : title`);
    assert.ok((doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '').length > 20, `${name} : description`);
    assert.equal(doc.querySelector('html').getAttribute('lang'), 'fr');
    assert.ok(doc.querySelector('a.skip-link'), `${name} : lien d’évitement`);
    assert.ok(doc.querySelector('main#contenu'), `${name} : main`);
  }
});

test('titres et descriptions uniques', () => {
  const titles = new Map();
  const descs = new Map();
  for (const [name, doc] of pages) {
    if (name === '/404.html') continue;
    const t = text(doc.querySelector('title'));
    const d = doc.querySelector('meta[name="description"]').getAttribute('content');
    assert.ok(!titles.has(t), `titre en double : ${t} (${name}, ${titles.get(t)})`);
    assert.ok(!descs.has(d), `description en double : ${name}, ${descs.get(d)}`);
    titles.set(t, name);
    descs.set(d, name);
  }
});

test('navigation principale de cinq entrées au plus, fil d’Ariane sur les pages intérieures, pied de page', () => {
  for (const [name, doc] of pages) {
    assert.ok(doc.querySelectorAll('nav.main-nav li').length <= 5, `${name} : navigation`);
    const crumbs = doc.querySelector('nav.breadcrumb');
    if (name === '/' || name === '/404.html') assert.equal(crumbs, null, `${name} : fil d’Ariane inattendu`);
    else assert.ok(crumbs, `${name} : fil d’Ariane`);
    const footer = text(doc.querySelector('footer'));
    assert.match(footer, /Source des données : Agence France Trésor/, `${name} : source`);
    assert.match(footer, /Dernière mise à jour des données : \d/, `${name} : mise à jour`);
    assert.equal(doc.querySelectorAll('footer .footer-grid > div').length, 3, `${name} : trois colonnes`);
  }
});

test('aucune ressource tierce au chargement', () => {
  for (const [name, doc] of pages) {
    for (const el of doc.querySelectorAll('link[href], script[src], img[src], iframe[src]')) {
      const url = el.getAttribute('href') ?? el.getAttribute('src');
      assert.ok(!/^(https?:)?\/\//.test(url), `${name} : ressource externe ${url}`);
    }
    for (const a of doc.querySelectorAll('a[href^="http"]')) {
      assert.match(a.getAttribute('href'), /^https:\/\/www\.aft\.gouv\.fr/, `${name} : lien externe`);
    }
  }
});

test('aucun texte de remplissage', () => {
  for (const [name, doc] of pages) assert.doesNotMatch(doc.text, /lorem|ipsum|TODO|à compléter/i, name);
});

test('titres en casse de phrase, sans capitales intégrales', () => {
  for (const [name, doc] of pages) {
    for (const h of doc.querySelectorAll('h1,h2,h3')) {
      const t = text(h);
      if (t.length < 4) continue;
      assert.ok(!(t === t.toUpperCase() && /[A-Z]{4}/.test(t)), `${name} : titre en capitales « ${t} »`);
    }
  }
});

test('accueil : bandeau de quatre chiffres et dix opérations', () => {
  const doc = get('/');
  assert.equal(doc.querySelectorAll('.stat-band .stat').length, 4);
  assert.equal(doc.querySelectorAll('table.data tbody tr').length, 10);
  assert.match(text(doc.querySelector('.chapeau')), /du 4 janvier 1999 au 1er octobre 2026/);
});

test('page OAT : chapeau chiffré, tableau, trois graphiques', () => {
  const doc = get('/adjudications/oat-moyen-long-terme/');
  assert.match(text(doc.querySelector('.chapeau')), /Cette page recense les 2 308 résultats d’adjudications d’OAT réalisées entre le 7 janvier 1999 et le 17 septembre 2026\./);
  assert.ok(doc.querySelector('[data-table] table.data caption'));
  assert.ok(doc.querySelectorAll('[data-table] tbody tr').length === 25);
  assert.equal(doc.querySelectorAll('figure[data-chart]').length, 3);
  for (const f of doc.querySelectorAll('figure[data-chart]')) assert.match(text(f.querySelector('summary')), /Voir les données/);
  const html = readFileSync(join(DIST, 'adjudications', 'oat-moyen-long-terme', 'index.html'), 'utf-8');
  assert.match(html, /<script type="application\/ld\+json">.*"@type":"Dataset"/);
});

test('pages indexées et BTF', () => {
  assert.equal(get('/adjudications/oat-indexees/').querySelectorAll('figure[data-chart]').length, 3);
  const btf = get('/adjudications/btf/');
  assert.equal(btf.querySelectorAll('figure[data-chart]').length, 2);
  assert.match(text(btf.querySelector('.chapeau')), /4 067 résultats/);
});

test('syndications : 45 opérations, rachats signalés', () => {
  const doc = get('/syndications/');
  assert.match(text(doc.querySelector('.chapeau')), /45 opérations de syndication/);
  assert.match(text(doc), /rachats/);
  assert.equal(doc.querySelectorAll('figure[data-chart]').length, 1);
});

test('titres indexés : tableau des titres, calculateur, note de changement de base', () => {
  const doc = get('/titres-indexes/');
  assert.equal(doc.querySelectorAll('table.data tbody tr').length, 11);
  assert.ok(doc.querySelector('[data-calculator] select option'));
  assert.ok(doc.querySelector('[data-calculator] input[type="date"]'));
  assert.match(text(doc.querySelector('.note.alert')), /1,509487/);
  assert.match(text(doc), /CI\(d\) = Réf\(d\) \/ Réf_base/);
});

test('point mort : libellé officiel, trois périodes, statistiques', () => {
  const doc = get('/point-mort-inflation/');
  assert.equal(doc.querySelectorAll('[data-control="period"]').length, 3);
  assert.equal(doc.querySelectorAll('[data-stats-block]').length, 3);
  assert.match(text(doc), /Point-mort inflation FR 10 ans \(Ecart rendement : OAT 05\/36 - OATi 03\/36\)/);
});

test('fiches par ligne : une page par ISIN', () => {
  const lines = [...pages.keys()].filter((n) => /^\/adjudications\/lignes\/[A-Z]{2}[A-Z0-9]{9}\d\/$/.test(n));
  assert.equal(lines.length, 200);
  const doc = get('/adjudications/lignes/FR001400PM68/');
  assert.ok(doc.querySelector('dl.facts'));
  assert.ok(doc.querySelector('table.data'));
  assert.match(text(doc.querySelector('.chapeau')), /OAT 2,75% 25 février 2030/);
  assert.ok(get('/adjudications/lignes/'));
});

test('données : catalogue de six jeux et dictionnaire', () => {
  const doc = get('/donnees/');
  assert.equal(doc.querySelectorAll('#catalogue ~ .table-block tbody tr, section[aria-labelledby="catalogue"] tbody tr').length, 6);
  assert.ok(doc.querySelectorAll('a[href$=".csv"]').length >= 6);
  assert.ok(doc.querySelector('#dictionnaire'));
  for (const f of ['adjudications_oat', 'adjudications_btf', 'syndications', 'point_mort_inflation', 'reference_inflation', 'coefficients_indexation']) {
    assert.ok(existsSync(join(DIST, 'data', `${f}.csv`)), f);
    assert.ok(existsSync(join(DIST, 'data', `${f}.json`)), f);
  }
});

test('fichiers CSV : BOM UTF-8, séparateur point-virgule', () => {
  const buf = readFileSync(join(DIST, 'data', 'adjudications_oat.csv'));
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(buf.toString('utf-8').split('\n')[0].includes(';'));
});

test('méthodologie et glossaire', () => {
  const doc = get('/methodologie/');
  assert.ok(doc.querySelectorAll('dl.glossary dt').length >= 10);
  for (const t of ['Adjudication', 'Syndication', 'ONC', 'Ratio de couverture', 'Taux moyen pondéré', 'Coefficient d’indexation', 'Point mort d’inflation', 'BTF', 'OAT', 'OATi', 'OAT€i']) {
    assert.ok([...doc.querySelectorAll('dl.glossary dt')].some((d) => text(d).startsWith(t)), t);
  }
  assert.match(text(doc), /Changement de base/);
});

test('pages légales, plan du site, 404, plan XML', () => {
  for (const p of ['/mentions-legales/', '/accessibilite/', '/plan-du-site/']) get(p);
  assert.ok(get('/404.html').querySelector('.error-page'));
  assert.ok(existsSync(join(DIST, 'sitemap-index.xml')));
  assert.ok(existsSync(join(ROOT, 'public', 'fonts', 'source-sans-3-latin-400-normal.woff2')));
});

test('marchés fictifs : liste, fiches, portefeuille, règles et avertissement', () => {
  const index = get('/marches/');
  assert.match(text(index), /Monnaie fictive : jetons virtuels et illimités/);
  const rows = index.querySelectorAll('section[aria-labelledby="ouverts"] tbody tr');
  assert.equal(rows.length, 21);
  const hrefs = [...index.querySelectorAll('section[aria-labelledby="ouverts"] tbody a')].map((a) => a.getAttribute('href'));
  assert.equal(new Set(hrefs).size, 21);
  for (const h of hrefs) {
    const doc = get(h);
    assert.ok(doc.querySelector('[data-ticket] form'), `${h} : formulaire de pari`);
    assert.ok(doc.querySelector('.game-banner'), `${h} : avertissement`);
    assert.match(text(doc.querySelector('h1')), / \?$/, `${h} : question`);
    assert.ok(doc.querySelector('#regle'), `${h} : règle de règlement`);
    assert.equal(doc.querySelectorAll('figure[data-chart]').length, 1, `${h} : graphique`);
  }
  assert.match(text(get('/marches/portefeuille/')), /Aucun pari enregistré|Chargement/);
  assert.ok(get('/marches/portefeuille/').querySelector('[data-export]'));
  assert.match(text(get('/marches/regles/')), /LMSR/);
});

test('marchés fictifs : jamais plus de cinq entrées dans la navigation principale, lien dédié', () => {
  const doc = get('/');
  assert.equal(doc.querySelectorAll('nav.main-nav li').length, 5);
  assert.ok(doc.querySelector('nav.nav-games a[href="/marches/"]'));
});

test('mentions légales : monnaie fictive et stockage local', () => {
  const t = text(get('/mentions-legales/'));
  assert.match(t, /jetons sont virtuels et illimités/);
  assert.match(t, /localStorage/);
});
