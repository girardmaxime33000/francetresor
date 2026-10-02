// Portefeuille fictif, stocké localement dans le navigateur. Aucune donnée n'est transmise.
import { applyShares, initialBook, price, sharesForStake, type Book, type Side } from './lmsr.ts';
import type { Market } from './markets.ts';

export const STORAGE_KEY = 'jld.marches.v1';
export const MAX_STAKE = 1e9;

export interface Bet {
  marketId: string;
  side: Side;
  stake: number;
  shares: number;
  /** Probabilité du Oui estimée par le joueur au moment du pari, entre 0 et 1. */
  estimate: number;
  priceBefore: number;
  priceAfter: number;
  at: string;
}

export interface PortfolioState {
  version: 1;
  /** Livre local de chaque marché : seule la cote du joueur bouge. */
  books: Record<string, Book>;
  bets: Bet[];
}

export const emptyPortfolio = (): PortfolioState => ({ version: 1, books: {}, bets: [] });

export function bookFor(state: PortfolioState, m: Pick<Market, 'id' | 'p0'>): Book {
  return state.books[m.id] ?? initialBook(m.p0);
}

export function validateStake(stake: number): string | null {
  if (!Number.isFinite(stake) || stake <= 0) return 'Saisissez une mise strictement positive.';
  if (stake > MAX_STAKE) return 'La mise dépasse la limite technique de 1 000 000 000 jetons.';
  return null;
}

export function placeBet(state: PortfolioState, m: Market, side: Side, stake: number, estimate: number, at = new Date().toISOString()): PortfolioState {
  const err = validateStake(stake);
  if (err) throw new Error(err);
  if (m.status !== 'open') throw new Error('Ce marché est résolu.');
  const book = bookFor(state, m);
  const shares = sharesForStake(book, side, stake);
  const next = applyShares(book, side, shares);
  const bet: Bet = { marketId: m.id, side, stake, shares, estimate: Math.min(0.99, Math.max(0.01, estimate)), priceBefore: price(book), priceAfter: price(next), at };
  return { ...state, books: { ...state.books, [m.id]: next }, bets: [...state.bets, bet] };
}

export interface Position {
  marketId: string;
  yesShares: number;
  noShares: number;
  stake: number;
  /** Dernière estimation du joueur. */
  estimate: number;
  bets: number;
  lastAt: string;
}

export function positions(state: PortfolioState): Position[] {
  const map = new Map<string, Position>();
  for (const b of state.bets) {
    const p = map.get(b.marketId) ?? { marketId: b.marketId, yesShares: 0, noShares: 0, stake: 0, estimate: b.estimate, bets: 0, lastAt: b.at };
    if (b.side === 'yes') p.yesShares += b.shares;
    else p.noShares += b.shares;
    p.stake += b.stake;
    p.estimate = b.estimate;
    p.bets += 1;
    p.lastAt = b.at;
    map.set(b.marketId, p);
  }
  return [...map.values()];
}

export interface Settlement {
  payout: number;
  net: number;
}

/** Règlement d'une position : chaque part gagnante rapporte un jeton. */
export function settle(p: Position, m: Market): Settlement | null {
  if (m.status !== 'resolved' || m.outcome === null) return null;
  const payout = m.outcome ? p.yesShares : p.noShares;
  return { payout, net: payout - p.stake };
}

export interface Stats {
  staked: number;
  openPositions: number;
  resolvedPositions: number;
  netResolved: number;
  brier: number | null;
  brierInitial: number | null;
  calibration: { from: number; to: number; count: number; observed: number }[];
}

export function stats(state: PortfolioState, markets: Market[]): Stats {
  const byId = new Map(markets.map((m) => [m.id, m]));
  const pos = positions(state);
  let netResolved = 0;
  let open = 0;
  let resolved = 0;
  const sq: number[] = [];
  const sqInit: number[] = [];
  const bins = Array.from({ length: 5 }, (_, i) => ({ from: i * 20, to: (i + 1) * 20, count: 0, yes: 0 }));
  for (const p of pos) {
    const m = byId.get(p.marketId);
    if (!m) continue;
    const s = settle(p, m);
    if (!s || m.outcome === null) {
      open += 1;
      continue;
    }
    resolved += 1;
    netResolved += s.net;
    const o = m.outcome ? 1 : 0;
    sq.push((p.estimate - o) ** 2);
    sqInit.push((m.p0 - o) ** 2);
    const bin = bins[Math.min(4, Math.floor(p.estimate * 5))]!;
    bin.count += 1;
    bin.yes += o;
  }
  const mean = (a: number[]): number | null => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    staked: pos.reduce((a, p) => a + p.stake, 0),
    openPositions: open,
    resolvedPositions: resolved,
    netResolved,
    brier: mean(sq),
    brierInitial: mean(sqInit),
    calibration: bins.filter((b) => b.count > 0).map((b) => ({ from: b.from, to: b.to, count: b.count, observed: b.yes / b.count })),
  };
}

export function parsePortfolio(raw: string | null): PortfolioState {
  if (!raw) return emptyPortfolio();
  try {
    const d = JSON.parse(raw) as Partial<PortfolioState>;
    if (d.version !== 1 || typeof d.books !== 'object' || !Array.isArray(d.bets)) return emptyPortfolio();
    return { version: 1, books: d.books ?? {}, bets: d.bets };
  } catch {
    return emptyPortfolio();
  }
}

export function loadPortfolio(): PortfolioState {
  try {
    return parsePortfolio(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyPortfolio();
  }
}

export function savePortfolio(state: PortfolioState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
