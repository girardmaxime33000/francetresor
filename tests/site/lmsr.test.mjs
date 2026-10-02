import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyShares, cost, initialBook, price, sharesForStake, trade } from '../../src/lib/lmsr.ts';
import { emptyPortfolio, parsePortfolio, placeBet, positions, settle, stats, validateStake } from '../../src/lib/portfolio.ts';

const market = (over = {}) => ({ id: 'm1', p0: 0.4, status: 'open', outcome: null, ...over });

test('livre initial : la cote du Oui vaut p0', () => {
  for (const p0 of [0.03, 0.25, 0.5, 0.74, 0.97]) assert.ok(Math.abs(price(initialBook(p0)) - p0) < 1e-12);
});

test('la mise est exactement le coût des parts obtenues', () => {
  const book = initialBook(0.3);
  for (const side of ['yes', 'no']) {
    for (const stake of [1, 10, 100, 5000, 1e6, 1e9]) {
      const s = sharesForStake(book, side, stake);
      assert.ok(s > 0 && Number.isFinite(s), `${side} ${stake}`);
      const paid = cost(applyShares(book, side, s)) - cost(book);
      assert.ok(Math.abs(paid - stake) / stake < 1e-9, `${side} ${stake} : ${paid}`);
    }
  }
});

test('parier Oui fait monter la cote du Oui, parier Non la fait baisser', () => {
  const book = initialBook(0.5);
  assert.ok(trade(book, 'yes', 100).priceAfter > 0.5);
  assert.ok(trade(book, 'no', 100).priceAfter < 0.5);
});

test('une grosse mise ne dépasse jamais 1 et une part coûte moins d’un jeton', () => {
  const t = trade(initialBook(0.5), 'yes', 1e9);
  assert.ok(t.priceAfter <= 1);
  const small = sharesForStake(initialBook(0.5), 'yes', 10);
  assert.ok(small > 10);
});

test('mise invalide refusée', () => {
  assert.ok(validateStake(0));
  assert.ok(validateStake(-5));
  assert.ok(validateStake(Number.NaN));
  assert.ok(validateStake(1e10));
  assert.equal(validateStake(100), null);
});

test('portefeuille : pari, position, règlement et score de Brier', () => {
  let st = emptyPortfolio();
  const m = market();
  st = placeBet(st, m, 'yes', 100, 0.7);
  st = placeBet(st, m, 'yes', 50, 0.8);
  const [p] = positions(st);
  assert.equal(p.bets, 2);
  assert.equal(p.stake, 150);
  assert.equal(p.estimate, 0.8);
  assert.equal(settle(p, m), null);
  const won = { ...m, status: 'resolved', outcome: true };
  const s = settle(p, won);
  assert.ok(s.payout > 150 && Math.abs(s.net - (s.payout - 150)) < 1e-9);
  const lost = { ...m, status: 'resolved', outcome: false };
  assert.equal(settle(p, lost).payout, 0);
  assert.equal(settle(p, lost).net, -150);
  const st2 = stats(st, [won]);
  assert.ok(Math.abs(st2.brier - 0.04) < 1e-12);
  assert.ok(Math.abs(st2.brierInitial - 0.36) < 1e-12);
  assert.equal(st2.resolvedPositions, 1);
  assert.equal(st2.calibration[0].observed, 1);
  assert.equal(stats(st, [m]).openPositions, 1);
  assert.equal(stats(st, [m]).brier, null);
});

test('un marché résolu n’accepte plus de pari', () => {
  assert.throws(() => placeBet(emptyPortfolio(), market({ status: 'resolved', outcome: true }), 'yes', 10, 0.5));
});

test('lecture tolérante du stockage', () => {
  assert.deepEqual(parsePortfolio(null), emptyPortfolio());
  assert.deepEqual(parsePortfolio('{pas du json'), emptyPortfolio());
  assert.deepEqual(parsePortfolio('{"version":2}'), emptyPortfolio());
  const st = placeBet(emptyPortfolio(), market(), 'no', 20, 0.3);
  assert.deepEqual(parsePortfolio(JSON.stringify(st)), st);
});
